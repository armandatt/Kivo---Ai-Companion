import { prisma } from "@repo/db/client";
import { computeProgressiveOverloadForSession } from "./workoutTracking.service";
import { generateOpenAIText } from "./openai.service";

// 5-minute in-memory cache keyed by platformChatId
// Key includes a 5-min bucket so it expires naturally without explicit invalidation
const contextCache = new Map<string, string>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function cacheKey(platformChatId: string, now: Date): string {
  return `${platformChatId}:${Math.floor(now.getTime() / CACHE_TTL_MS)}`;
}

// ─── Nutrition log ────────────────────────────────────────────────────────────

export async function saveNutritionLog(
  platformChatId: string,
  data: {
    description:     string;
    mealType?:       string | null;
    proteinEstimate?: number | null;
    notedBy?:        "user" | "rex";
  },
): Promise<void> {
  const user = await prisma.messengerUser.findUnique({
    where:  { platform_platformChatId: { platform: "telegram", platformChatId } },
    select: { id: true },
  });
  if (!user) return;

  await prisma.nutritionLog.create({
    data: {
      userId:          user.id,
      description:     data.description,
      mealType:        data.mealType ?? null,
      proteinEstimate: data.proteinEstimate ?? null,
      notedBy:         data.notedBy ?? "user",
    },
  });
}

// ─── Parse nutrition mention ──────────────────────────────────────────────────

export async function parseAndSaveNutrition(
  platformChatId: string,
  text: string,
): Promise<void> {
  const lower = text.toLowerCase();

  // Rough meal type detection
  const mealType =
    /\bbreakfast\b/.test(lower) ? "breakfast" :
    /\blunch\b/.test(lower)     ? "lunch"     :
    /\bdinner\b/.test(lower)    ? "dinner"    :
    /\bsnack\b/.test(lower)     ? "snack"     :
    /\bpre.?workout\b/.test(lower) ? "pre-workout"  :
    /\bpost.?workout\b/.test(lower) ? "post-workout" :
    null;

  // Simple protein estimate from "Xg protein" or "Xg"
  const proteinMatch = text.match(/(\d+)\s*g(?:rams?)?\s*(?:of\s*)?protein/i);
  const proteinEstimate = proteinMatch ? parseInt(proteinMatch[1]!, 10) : null;

  await saveNutritionLog(platformChatId, {
    description:     text.slice(0, 400),
    mealType,
    proteinEstimate,
    notedBy:         "user",
  });
}

// ─── Last session detail ──────────────────────────────────────────────────────

async function getLastSessionDetail(userId: string) {
  const session = await prisma.telegramWorkoutSession.findFirst({
    where:   { messengerUserId: userId, completed: true },
    orderBy: { date: "desc" },
    select: {
      id:             true,
      date:           true,
      musclesTrained: true,
      durationMinutes: true,
      sessionSummary: true,
      sets: {
        where:   { completed: true },
        orderBy: [{ exerciseName: "asc" }, { setNumber: "asc" }],
        select:  { exerciseName: true, setNumber: true, reps: true, weightKg: true, rpe: true },
      },
    },
  });
  return session;
}

// ─── Today's session detail ───────────────────────────────────────────────────

async function getTodaySessionDetail(userId: string, now: Date) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  const session = await prisma.telegramWorkoutSession.findFirst({
    where: {
      messengerUserId: userId,
      date: { gte: start },
    },
    orderBy: { date: "desc" },
    select: {
      id:             true,
      musclesTrained: true,
      completed:      true,
      sets: {
        where:   { completed: true },
        orderBy: [{ exerciseName: "asc" }, { setNumber: "asc" }],
        select:  { exerciseName: true, setNumber: true, reps: true, weightKg: true },
      },
    },
  });
  return session;
}

// ─── Recent nutrition ─────────────────────────────────────────────────────────

async function getRecentNutrition(userId: string, now: Date) {
  const since = new Date(now);
  since.setDate(since.getDate() - 2);

  return prisma.nutritionLog.findMany({
    where:   { userId, date: { gte: since } },
    orderBy: { date: "desc" },
    take:    8,
    select:  { mealType: true, description: true, date: true, proteinEstimate: true },
  });
}

// ─── Personal records ─────────────────────────────────────────────────────────

function parsePersonalRecords(raw: unknown): Record<string, { weightKg: number; reps: number; date: string }> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as Record<string, { weightKg: number; reps: number; date: string }>;
}

// ─── Main context block builder ───────────────────────────────────────────────

export async function buildRexSessionContextBlock(
  platformChatId: string,
  now = new Date(),
): Promise<string> {
  const key = cacheKey(platformChatId, now);
  const hit = contextCache.get(key);
  if (hit !== undefined) return hit;

  const user = await prisma.messengerUser.findUnique({
    where:  { platform_platformChatId: { platform: "telegram", platformChatId } },
    select: { id: true, gymStreak: true, personalRecords: true, intakeAnswers: true },
  });
  if (!user) return "";

  const [lastSession, todaySession, recentNutrition] = await Promise.all([
    getLastSessionDetail(user.id),
    getTodaySessionDetail(user.id, now),
    getRecentNutrition(user.id, now),
  ]);

  const lines: string[] = ["\nREX SESSION MEMORY"];

  // ── Last session ──────────────────────────────────────────────────────────
  if (lastSession) {
    const sessionDate = new Date(lastSession.date).toLocaleDateString("en-GB", {
      weekday: "short", day: "numeric", month: "short",
    });
    const muscles = lastSession.musclesTrained.filter(Boolean).join(" / ");

    if (lastSession.sessionSummary) {
      lines.push(`LAST SESSION (${sessionDate} — ${muscles}):`);
      lines.push(`  ${lastSession.sessionSummary}`);
      if (lastSession.durationMinutes) lines.push(`  Duration: ${lastSession.durationMinutes} min`);
    } else if (lastSession.sets.length > 0) {
      lines.push(`LAST SESSION (${sessionDate} — ${muscles}):`);
      const grouped = groupSetsByExercise(lastSession.sets);
      for (const [exercise, sets] of Object.entries(grouped)) {
        const maxW   = Math.max(...sets.map(s => s.weightKg));
        const reps   = sets[0]!.reps;
        const rpeTag = sets.some(s => s.rpe) ? ` @RPE${sets.find(s => s.rpe)!.rpe}` : "";
        lines.push(`  ${exercise}: ${sets.length} sets × ${reps} reps × ${maxW}kg${rpeTag}`);
      }
      if (lastSession.durationMinutes) lines.push(`  Duration: ${lastSession.durationMinutes} min`);
    }
  } else {
    lines.push("LAST SESSION: None yet.");
  }

  // ── Today's session ───────────────────────────────────────────────────────
  if (todaySession && todaySession.sets.length > 0) {
    const muscles = todaySession.musclesTrained.filter(Boolean).join(" / ");
    lines.push(`\nTODAY'S SESSION SO FAR (${muscles}):`);
    const grouped = groupSetsByExercise(todaySession.sets);
    for (const [exercise, sets] of Object.entries(grouped)) {
      const maxW = Math.max(...sets.map(s => s.weightKg));
      lines.push(`  ${exercise}: ${sets.length} sets × ${sets[0]!.reps} reps × ${maxW}kg`);
    }
    lines.push(`  Sets completed: ${todaySession.sets.length}`);
  } else {
    lines.push("\nTODAY'S SESSION: Nothing logged yet.");
  }

  // ── Next session targets ──────────────────────────────────────────────────
  if (lastSession) {
    try {
      const targets = await computeProgressiveOverloadForSession(user.id, lastSession.id);
      if (targets.length > 0) {
        lines.push("\nNEXT SESSION TARGETS:");
        for (const t of targets) {
          lines.push(`  ${t.exercise}: ${t.nextWeightKg}kg — ${t.note}`);
        }
      }
    } catch {
      // non-critical — skip if it fails
    }
  }

  // ── Personal records ──────────────────────────────────────────────────────
  const prs = parsePersonalRecords(user.personalRecords);
  const prEntries = Object.entries(prs);
  if (prEntries.length > 0) {
    lines.push("\nPERSONAL RECORDS:");
    for (const [exercise, pr] of prEntries.slice(0, 8)) {
      lines.push(`  ${exercise}: ${pr.weightKg}kg × ${pr.reps} (${pr.date})`);
    }
  }

  // ── Recent nutrition ──────────────────────────────────────────────────────
  if (recentNutrition.length > 0) {
    lines.push("\nRECENT NUTRITION:");
    for (const meal of recentNutrition.slice(0, 5)) {
      const d   = new Date(meal.date).toLocaleDateString("en-GB", { weekday: "short", day: "numeric" });
      const tag = meal.mealType ? `${meal.mealType} (${d})` : d;
      const protein = meal.proteinEstimate ? ` — ${meal.proteinEstimate}g protein` : "";
      lines.push(`  ${tag}: ${meal.description.slice(0, 120)}${protein}`);
    }
  } else {
    lines.push("\nRECENT NUTRITION: Nothing logged.");
  }

  // ── Streak ────────────────────────────────────────────────────────────────
  lines.push(`\nSTREAK: ${user.gymStreak ?? 0} days`);

  const packet = lines.join("\n");
  contextCache.set(key, packet);
  return packet;
}

// ─── Experience level block ───────────────────────────────────────────────────

export function buildExperienceLevelBlock(intakeAnswers: unknown): string {
  const answers = parseIntakeAnswers(intakeAnswers);
  const raw     = (answers.gym_experience ?? answers.gymExperience ?? "").toLowerCase();

  let level: "beginner" | "intermediate" | "advanced";
  if (/beginner|newbie|new to|just start|less than|under 6|1 month|2 month|3 month/i.test(raw)) {
    level = "beginner";
  } else if (/advanced|elite|competitive|powerlifter|3\+|4\+|5 year|10 year/i.test(raw)) {
    level = "advanced";
  } else {
    level = "intermediate";
  }

  const instructions: Record<typeof level, string> = {
    beginner: [
      "Never use RPE, RIR, periodization, CNS without explaining.",
      "Say 'effort level' not RPE. Say 'how hard it felt (1-10)' not 'RPE'.",
      "Weight suggestions: always explain why ('add 2.5kg because your last set felt easy').",
      "Keep instructions simple: '3 sets of 5 reps at 60kg'.",
    ].join(" "),
    intermediate: [
      "RPE is fine — no need to explain. Progressive overload language OK.",
      "Can reference splits, volume, intensity.",
    ].join(" "),
    advanced: [
      "Full technical language. RPE, RIR, periodization, deload, CNS fatigue, hypertrophy, frequency — all normal.",
      "No explanations needed.",
    ].join(" "),
  };

  return `\nUSER LEVEL: ${level.toUpperCase()}\n${instructions[level]}`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function groupSetsByExercise<T extends { exerciseName: string }>(sets: T[]): Record<string, T[]> {
  return sets.reduce<Record<string, T[]>>((acc, s) => {
    acc[s.exerciseName] ??= [];
    acc[s.exerciseName]!.push(s);
    return acc;
  }, {});
}

function parseIntakeAnswers(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as Record<string, string>;
}
