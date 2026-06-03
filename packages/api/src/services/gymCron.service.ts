import { prisma } from "@repo/db/client";
import {
  detectDeloadTriggerForWeeklyReport,
  runProgressiveOverloadCheck,
} from "./gymDetections.service";
import { generateWeeklyReview } from "./review.service";
import { buildGymTimeContext } from "./gymTimeContext.service";

export type GymCronMessage = {
  userId: string;
  chatId: string;
  text: string;
  intent: string;
};

export async function runGymCronJobs(now = new Date()) {
  const [preSession, postSession, reengagement, sundayReports,
         rexPre, rexEvening, rexRestDay, rexSilence] = await Promise.all([
    runPreSessionFormCueCron(now),
    runPostSessionDebriefCron(now),
    runReengagementCron(now),
    runSundayPlateauAndDeloadCron(now),
    runRexPreSessionCron(now),
    runRexEveningAccountabilityCron(now),
    runRexRestDayCron(now),
    runRexSilenceCheckCron(now),
  ]);

  return [
    ...preSession, ...postSession, ...reengagement, ...sundayReports,
    ...rexPre, ...rexEvening, ...rexRestDay, ...rexSilence,
  ];
}

// ─── Rex Telegram Cron Jobs ───────────────────────────────────────────────────
// These operate on MessengerUser (Telegram-native Rex users).
// chatId = platformChatId for all outbound messages.

// JOB 1 — Pre-session fire-up (30 min before gym_time on training days)
async function runRexPreSessionCron(now: Date): Promise<GymCronMessage[]> {
  const users = await getRexUsersDueAtLocalTime(now, -30);
  const messages: GymCronMessage[] = [];

  for (const user of users) {
    const ctx = await buildGymTimeContext(user.platformChatId, now);
    if (!ctx?.isTrainingDay) continue;
    if (await wasRexCronSentToday(user.platformChatId, "rex_pre_session", now)) continue;
    if (await hadRexSessionToday(user.platformChatId, now)) continue;

    const text = buildPreSessionMessage(ctx, user);
    messages.push({ userId: user.platformChatId, chatId: user.platformChatId, text, intent: "rex_pre_session" });
  }

  return messages;
}

// JOB 2 — Evening accountability (9pm on training days if no log)
async function runRexEveningAccountabilityCron(now: Date): Promise<GymCronMessage[]> {
  const users = await getRexUsersAtLocalHour(now, 21);
  const messages: GymCronMessage[] = [];

  for (const user of users) {
    const ctx = await buildGymTimeContext(user.platformChatId, now);
    if (!ctx?.isTrainingDay) continue;
    if (await wasRexCronSentToday(user.platformChatId, "rex_evening_check", now)) continue;
    if (await hadRexSessionToday(user.platformChatId, now)) continue;

    messages.push({
      userId: user.platformChatId,
      chatId: user.platformChatId,
      text: "No log yet today. Did you train or did something come up?",
      intent: "rex_evening_check",
    });
  }

  return messages;
}

// JOB 3 — Rest day morning (10am on rest days)
async function runRexRestDayCron(now: Date): Promise<GymCronMessage[]> {
  const users = await getRexUsersAtLocalHour(now, 10);
  const messages: GymCronMessage[] = [];

  for (const user of users) {
    const ctx = await buildGymTimeContext(user.platformChatId, now);
    if (!ctx || ctx.isTrainingDay) continue;
    if (await wasRexCronSentToday(user.platformChatId, "rex_rest_day", now)) continue;

    const text = pickRestDayMessage(ctx);
    messages.push({ userId: user.platformChatId, chatId: user.platformChatId, text, intent: "rex_rest_day" });
  }

  return messages;
}

// JOB 4 — 5-day silence check
async function runRexSilenceCheckCron(now: Date): Promise<GymCronMessage[]> {
  const users = await getRexUsersAtLocalHour(now, 10);
  const messages: GymCronMessage[] = [];

  for (const user of users) {
    if (await wasRexCronSentToday(user.platformChatId, "rex_silence_check", now)) continue;
    if (!(await hasBeenSilentForDays(user.platformChatId, now, 5))) continue;

    const ctx = await buildGymTimeContext(user.platformChatId, now);
    const muscles = ctx?.todayMuscles ?? "your next session";
    const days = ctx?.lastSessionDaysAgo ?? 5;

    messages.push({
      userId: user.platformChatId,
      chatId: user.platformChatId,
      text: `Still alive? Your ${muscles} session is ${days} days overdue. What happened?`,
      intent: "rex_silence_check",
    });
  }

  return messages;
}

// ─── Rex Message Builders ─────────────────────────────────────────────────────

function buildPreSessionMessage(
  ctx: Awaited<ReturnType<typeof buildGymTimeContext>> & object,
  user: { intakeAnswers: unknown }
): string {
  const intake = parseRexIntake(user.intakeAnswers);
  const primaryLift = primaryLiftForMuscles(ctx.todayMuscles);
  const baselineKg  = parseFloat(intake[`${primaryLift}_kg`] ?? "0") || 0;
  const targetKg    = baselineKg > 0 ? baselineKg + 2.5 : null;
  const time        = ctx.localTimeStr.split(",")[0] ?? ctx.gymTimeStr;

  const liftLine = ctx.lastLiftSummary
    ? `Last session: ${ctx.lastLiftSummary}.`
    : baselineKg > 0
      ? `Last logged ${primaryLift}: ${baselineKg}kg.`
      : null;

  const targetLine = targetKg ? `Today: ${targetKg}kg.` : null;
  const mindset    = pickPreSessionMindset(ctx.todayMuscles);

  return [
    `Yo. ${time}. ${ctx.todayMuscles} day doesn't cancel itself.`,
    liftLine,
    targetLine,
    `${mindset} 🔥`,
  ].filter(Boolean).join(" ");
}

const REST_DAY_MESSAGES = [
  (_muscles: string, _days: number) => `Rest day. Eat your protein. Don't skip it because you're not training.`,
  (muscles: string, _days: number) => `Recovery day. ${muscles} tomorrow. Sleep 8hrs.`,
  (muscles: string, days: number)  =>
    days > 1
      ? `You've trained ${days} days this week. Good. Rest today, ${muscles} next.`
      : `Rest day. ${muscles} next session. Protein and sleep.`,
];

function pickRestDayMessage(ctx: NonNullable<Awaited<ReturnType<typeof buildGymTimeContext>>>): string {
  const idx = Math.floor(Math.random() * REST_DAY_MESSAGES.length);
  return REST_DAY_MESSAGES[idx]!(ctx.todayMuscles, ctx.daysPerWeek);
}

function primaryLiftForMuscles(muscles: string): string {
  const m = muscles.toLowerCase();
  if (m.includes("chest") || m.includes("push"))  return "bench";
  if (m.includes("leg") || m.includes("lower"))   return "squat";
  if (m.includes("back") || m.includes("pull"))   return "deadlift";
  return "squat";
}

const PRE_SESSION_MINDSET: Record<string, string[]> = {
  chest:    ["CNS is fresh. Use it.", "This is the session that separates weeks.", "No grinding through — attack it."],
  legs:     ["Leg days build everything else. Don't cut depth.", "The people who skip leg day are easy to spot.", "Full range. No partials."],
  back:     ["Pull heavy. Control the negative.", "Back work is the thing most people do wrong. You won't."],
  default:  ["Show up and do the work.", "This one matters.", "No warm-up sets on effort."],
};

function pickPreSessionMindset(muscles: string): string {
  const m = muscles.toLowerCase();
  const key = m.includes("chest") || m.includes("push") ? "chest"
    : m.includes("leg") || m.includes("lower") ? "legs"
    : m.includes("back") || m.includes("pull") ? "back"
    : "default";
  const lines = PRE_SESSION_MINDSET[key] ?? PRE_SESSION_MINDSET.default!;
  return lines[Math.floor(Math.random() * lines.length)]!;
}

// ─── Rex DB Helpers ───────────────────────────────────────────────────────────

async function getRexUsersDueAtLocalTime(now: Date, gymOffsetMin: number) {
  const users = await prisma.messengerUser.findMany({
    where: {
      persona:              "rex",
      intakeComplete:       true,
      preferredCheckInTime: { not: null },
      timezone:             { not: null },
    },
    select: {
      platformChatId:       true,
      preferredCheckInTime: true,
      timezone:             true,
      intakeAnswers:        true,
    },
  });

  return users.filter(u => {
    const local = getLocalTime(now, u.timezone!);
    const target = addMinutes(u.preferredCheckInTime!, gymOffsetMin);
    return local === target;
  });
}

async function getRexUsersAtLocalHour(now: Date, hour: number) {
  const users = await prisma.messengerUser.findMany({
    where: {
      persona:        "rex",
      intakeComplete: true,
      timezone:       { not: null },
    },
    select: {
      platformChatId:       true,
      timezone:             true,
      preferredCheckInTime: true,
      intakeAnswers:        true,
    },
  });

  const targetHHMM = `${String(hour).padStart(2, "0")}:00`;
  return users.filter(u => getLocalTime(now, u.timezone!) === targetHHMM);
}

async function wasRexCronSentToday(platformChatId: string, intent: string, now: Date): Promise<boolean> {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  const user = await prisma.messengerUser.findUnique({
    where: { platform_platformChatId: { platform: "telegram", platformChatId } },
    select: {
      messages: {
        where: { role: "assistant", intent, createdAt: { gte: start } },
        select: { id: true },
        take: 1,
      },
    },
  });
  return Boolean(user?.messages.length);
}

async function hadRexSessionToday(platformChatId: string, now: Date): Promise<boolean> {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  const gymIntents = ["gym_checkin", "lift_log", "pr_log", "soreness_log", "missed_session"];
  const user = await prisma.messengerUser.findUnique({
    where: { platform_platformChatId: { platform: "telegram", platformChatId } },
    select: {
      messages: {
        where: { role: "user", intent: { in: gymIntents }, createdAt: { gte: start } },
        select: { id: true },
        take: 1,
      },
    },
  });
  return Boolean(user?.messages.length);
}

async function hasBeenSilentForDays(platformChatId: string, now: Date, days: number): Promise<boolean> {
  const since = new Date(now);
  since.setDate(since.getDate() - days);

  const user = await prisma.messengerUser.findUnique({
    where: { platform_platformChatId: { platform: "telegram", platformChatId } },
    select: {
      messages: {
        where: { role: "user", createdAt: { gte: since } },
        select: { id: true },
        take: 1,
      },
    },
  });
  return !user?.messages.length;
}

function parseRexIntake(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as Record<string, string>;
}

export async function runPreSessionFormCueCron(now = new Date()): Promise<GymCronMessage[]> {
  const users = await getGymUsersDueAt(now, -30);
  const messages: GymCronMessage[] = [];

  for (const user of users) {
    if (await hasWorkoutToday(user.userId, now)) continue;
    if (await wasCronSentToday(user.userId, "pre_session_form_cue", now)) continue;

    const compoundLift = getPrimaryCompoundLift(user.currentSplit, now);
    const text = [
      "Any pain or tightness before we start?",
      getFormCue(compoundLift),
      "If you do not reply in 10 minutes, we proceed normally.",
    ].join("\n");

    await markCronSent(user.userId, "pre_session_form_cue", now);
    messages.push(toCronMessage(user.userId, text, "pre_session_form_cue"));
  }

  return messages;
}

export async function runPostSessionDebriefCron(now = new Date()): Promise<GymCronMessage[]> {
  const users = await getGymUsersDueAt(now, 45);
  const messages: GymCronMessage[] = [];

  for (const user of users) {
    const workout = await getTodayWorkoutNeedingDebrief(user.userId, now);
    if (!workout) continue;
    if (await wasCronSentToday(user.userId, "post_session_debrief", now)) continue;

    await markCronSent(user.userId, "post_session_debrief", now);
    messages.push(
      toCronMessage(
        user.userId,
        "Session rating 1-5? Send the lifts too, like `bench 80kg 4x8, squat 90kg 3x10`.",
        "post_session_debrief"
      )
    );
  }

  return messages;
}

export async function handlePostSessionDebriefResponse(userId: string, text: string) {
  const workout = await getTodayWorkoutNeedingDebrief(userId, new Date());
  if (!workout) return null;

  const intensityScore = extractIntensityScore(text);
  const lifts = extractLiftEntries(text);

  await (prisma as any).workoutLog.update({
    where: { id: workout.id },
    data: {
      intensityScore,
      musclesWorked: mergeUnique(workout.musclesWorked, lifts.flatMap((lift) => musclesForExercise(lift.exercise))),
    },
  });

  for (const lift of lifts) {
    const createdLift = await (prisma as any).liftLog.create({
      data: {
        userId,
        workoutLogId: workout.id,
        exercise: lift.exercise,
        weightKg: lift.weightKg,
        reps: lift.reps,
        sets: lift.sets,
      },
    });

    await runProgressiveOverloadCheck(userId, createdLift);
  }

  if (!intensityScore && !lifts.length) return null;

  return [
    intensityScore ? `Intensity logged: ${intensityScore}/5.` : null,
    lifts.length ? `Logged ${lifts.length} lift${lifts.length === 1 ? "" : "s"}.` : null,
  ].filter(Boolean).join(" ");
}

export async function runReengagementCron(now = new Date()): Promise<GymCronMessage[]> {
  const profiles = await (prisma as any).userProfile.findMany({
    where: { gymMode: true },
    select: {
      userId: true,
      primaryPersona: true,
      onboardingAnswers: true,
    },
  });
  const messages: GymCronMessage[] = [];

  for (const profile of profiles) {
    const memory = getGymCronMemory(profile.onboardingAnswers);
    if (memory.reengagementSent) continue;
    if (!(await wasStreakPreviouslyActive(profile.userId, now))) continue;
    if (!(await hasBeenQuietFor72Hours(profile.userId, now))) continue;

    await updateGymCronMemory(profile.userId, {
      ...memory,
      reengagementSent: true,
    });

    messages.push(
      toCronMessage(
        profile.userId,
        reengagementMessage(profile.primaryPersona),
        "gym_reengagement"
      )
    );
  }

  return messages;
}

export async function resetReengagementFlag(userId: string) {
  const profile = await (prisma as any).userProfile.findUnique({
    where: { userId },
    select: { onboardingAnswers: true },
  });

  if (!profile) return;
  const memory = getGymCronMemory(profile.onboardingAnswers);
  if (!memory.reengagementSent) return;

  await updateGymCronMemory(userId, {
    ...memory,
    reengagementSent: false,
  });
}

export async function runSundayPlateauAndDeloadCron(now = new Date()): Promise<GymCronMessage[]> {
  const profiles = await (prisma as any).userProfile.findMany({
    where: { gymMode: true },
    select: {
      userId: true,
      timezone: true,
    },
  });
  const messages: GymCronMessage[] = [];

  for (const profile of profiles) {
    if (!isSundayEightPm(now, profile.timezone || undefined)) continue;
    if (await wasCronSentToday(profile.userId, "sunday_gym_weekly_report", now)) continue;

    await flagPlateausForWeeklyReport(profile.userId);
    await detectDeloadTriggerForWeeklyReport(profile.userId);

    const report = await generateWeeklyReview(profile.userId);
    await markCronSent(profile.userId, "sunday_gym_weekly_report", now);
    messages.push(toCronMessage(profile.userId, report, "weekly_review"));
  }

  return messages;
}

async function getGymUsersDueAt(now: Date, offsetMinutes: number) {
  const profiles = await (prisma as any).userProfile.findMany({
    where: {
      gymMode: true,
      sessionTime: { not: null },
    },
    select: {
      userId: true,
      currentSplit: true,
      sessionTime: true,
      timezone: true,
    },
  });

  return profiles.filter((profile: any) => {
    const localTime = getLocalTime(now, profile.timezone || "Asia/Kolkata");
    return localTime === addMinutes(profile.sessionTime, offsetMinutes);
  });
}

async function hasWorkoutToday(userId: string, now: Date) {
  const { start, end } = dayBounds(now);
  const workout = await (prisma as any).workoutLog.findFirst({
    where: {
      userId,
      date: { gte: start, lt: end },
    },
    select: { id: true },
  });

  return Boolean(workout);
}

async function getTodayWorkoutNeedingDebrief(userId: string, now: Date) {
  const { start, end } = dayBounds(now);
  return (prisma as any).workoutLog.findFirst({
    where: {
      userId,
      completed: true,
      intensityScore: null,
      date: { gte: start, lt: end },
    },
    orderBy: { date: "desc" },
    select: {
      id: true,
      musclesWorked: true,
    },
  });
}

async function wasStreakPreviouslyActive(userId: string, now: Date) {
  const workouts = await (prisma as any).workoutLog.count({
    where: {
      userId,
      completed: true,
      date: { gte: daysAgoFrom(now, 14) },
    },
  });

  return workouts >= 2;
}

async function hasBeenQuietFor72Hours(userId: string, now: Date) {
  const since = daysAgoFrom(now, 3);
  const [workout, message] = await Promise.all([
    (prisma as any).workoutLog.findFirst({
      where: {
        userId,
        date: { gte: since },
      },
      select: { id: true },
    }),
    (prisma as any).companionMessage.findFirst({
      where: {
        user: {
          platform: "telegram",
          platformChatId: userId,
        },
        createdAt: { gte: since },
        OR: [
          { intent: { startsWith: "gym" } },
          { intent: { in: ["lift_log", "pr_log", "soreness_log", "missed_session", "weight_log", "energy_checkin", "nutrition_query", "pain_report"] } },
        ],
      },
      select: { id: true },
    }),
  ]);

  return !workout && !message;
}

async function flagPlateausForWeeklyReport(userId: string) {
  const lifts = await (prisma as any).liftLog.findMany({
    where: { userId },
    orderBy: { id: "desc" },
    select: {
      exercise: true,
      weightKg: true,
      reps: true,
    },
  });

  const grouped = groupByExercise(lifts);

  for (const [exercise, entries] of Object.entries(grouped)) {
    const lastThree = entries.slice(0, 3);
    if (
      lastThree.length === 3 &&
      lastThree.every((entry: any) => entry.weightKg === lastThree[0].weightKg && entry.reps === lastThree[0].reps)
    ) {
      await writeMemoryFact(
        userId,
        "gym_signal",
        "plateau_flag",
        `${formatExercise(exercise)} has stayed at ${lastThree[0].weightKg}kg x ${lastThree[0].reps} for 3 consecutive sessions.`
      );
    }
  }
}

async function wasCronSentToday(userId: string, key: string, now: Date) {
  const { start, end } = dayBounds(now);
  const fact = await (prisma as any).memoryFact.findFirst({
    where: {
      key,
      value: userId,
      createdAt: { gte: start, lt: end },
    },
    select: { id: true },
  });

  return Boolean(fact);
}

async function markCronSent(userId: string, key: string, now: Date) {
  await writeMemoryFact(userId, "gym_cron", key, userId);
}

async function writeMemoryFact(userId: string, type: string, key: string, value: string) {
  const user = await (prisma as any).messengerUser.upsert({
    where: {
      platform_platformChatId: {
        platform: "telegram",
        platformChatId: userId,
      },
    },
    update: {},
    create: {
      platform: "telegram",
      platformChatId: userId,
    },
  });

  await (prisma as any).memoryFact.create({
    data: {
      userId: user.id,
      type,
      key,
      value,
    },
  });
}

function toCronMessage(userId: string, text: string, intent: string): GymCronMessage {
  return {
    userId,
    chatId: userId,
    text,
    intent,
  };
}

function getPrimaryCompoundLift(currentSplit: string | null, now: Date) {
  const day = now.getDay();
  if (currentSplit === "upper-lower") return day % 2 === 0 ? "squat" : "bench";
  if (currentSplit === "full-body") return ["squat", "bench", "deadlift"][day % 3];
  if (currentSplit === "bro-split") return ["bench", "row", "squat", "press", "curl", "deadlift", "bench"][day];
  return ["bench", "squat", "row", "press", "deadlift", "bench", "squat"][day];
}

function getFormCue(lift: string) {
  if (lift === "bench") return "Bench cue: shoulder blades back, feet planted, controlled touch, no ego bounce.";
  if (lift === "squat") return "Squat cue: brace before descent, knees track toes, depth you can own.";
  if (lift === "deadlift") return "Deadlift cue: wedge in, lats tight, push the floor away.";
  if (lift === "press") return "Press cue: ribs down, glutes tight, bar path close.";
  if (lift === "row") return "Row cue: chest fixed, pull elbows back, no swinging.";
  return "Compound cue: warm up slowly, keep reps clean, stop before form breaks.";
}

function extractIntensityScore(text: string) {
  const match = text.match(/\b([1-5])\s*(\/\s*5|out of 5)?\b/);
  return match ? Number(match[1]) : null;
}

function extractLiftEntries(text: string) {
  return text
    .split(/[,;\n]/)
    .map((line) => extractLift(line.trim()))
    .filter((lift): lift is { exercise: string; weightKg: number; reps: number; sets: number } => Boolean(lift));
}

function extractLift(text: string) {
  const exercise = extractExercise(text);
  if (!exercise) return null;

  const weightMatch = text.match(/\b(\d{1,3}(?:\.\d+)?)\s*kg\b/);
  const compact = text.match(/\b(\d{1,2})\s*x\s*(\d{1,2})\b/);
  const setsReps = text.match(/\b(\d{1,2})\s*sets?\s*(of)?\s*(\d{1,2})\b/);
  if (!weightMatch) return null;

  return {
    exercise,
    weightKg: Number(weightMatch[1]),
    sets: compact ? Number(compact[1]) : setsReps ? Number(setsReps[1]) : 1,
    reps: compact ? Number(compact[2]) : setsReps ? Number(setsReps[3]) : 1,
  };
}

function extractExercise(text: string) {
  if (/\bbench\b/.test(text)) return "bench";
  if (/\bsquats?\b/.test(text)) return "squat";
  if (/\bdeadlifts?\b/.test(text)) return "deadlift";
  if (/\bpress(ing)?\b/.test(text)) return "press";
  if (/\brows?\b/.test(text)) return "row";
  if (/\bcurls?\b/.test(text)) return "curl";
  return null;
}

function musclesForExercise(exercise: string) {
  if (exercise === "bench") return ["chest"];
  if (exercise === "squat") return ["legs"];
  if (exercise === "deadlift") return ["back", "legs"];
  if (exercise === "press") return ["shoulders"];
  if (exercise === "row") return ["back"];
  if (exercise === "curl") return ["arms"];
  return [];
}

function mergeUnique(a: string[], b: string[]) {
  return Array.from(new Set([...a, ...b]));
}

function groupByExercise(lifts: any[]) {
  return lifts.reduce<Record<string, any[]>>((groups, lift) => {
    groups[lift.exercise] ||= [];
    groups[lift.exercise].push(lift);
    return groups;
  }, {});
}

function getGymCronMemory(onboardingAnswers: unknown) {
  if (!onboardingAnswers || typeof onboardingAnswers !== "object" || Array.isArray(onboardingAnswers)) {
    return {};
  }

  return onboardingAnswers as { reengagementSent?: boolean };
}

async function updateGymCronMemory(userId: string, memory: { reengagementSent?: boolean }) {
  const profile = await (prisma as any).userProfile.findUnique({
    where: { userId },
    select: { onboardingAnswers: true },
  });
  const current =
    profile?.onboardingAnswers && typeof profile.onboardingAnswers === "object" && !Array.isArray(profile.onboardingAnswers)
      ? profile.onboardingAnswers
      : {};

  await (prisma as any).userProfile.update({
    where: { userId },
    data: {
      onboardingAnswers: {
        ...current,
        ...memory,
      },
    },
  });
}

function reengagementMessage(persona?: string | null) {
  if (persona === "nova") {
    return "Your streak was starting to take shape. Come back gently today: even a small session counts.";
  }

  return "Your streak was alive. Do not let 72 hours become a new identity. Show me one set today.";
}

function getLocalTime(now: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: timezone,
  }).format(now);
}

function addMinutes(time: string, minutesToAdd: number) {
  const [hours = "0", minutes = "0"] = time.split(":");
  const total = (Number(hours) * 60 + Number(minutes) + minutesToAdd) % (24 * 60);
  const normalized = total < 0 ? total + 24 * 60 : total;
  const nextHours = Math.floor(normalized / 60);
  const nextMinutes = normalized % 60;

  return `${String(nextHours).padStart(2, "0")}:${String(nextMinutes).padStart(2, "0")}`;
}

function isSundayEightPm(now: Date, timezone = "Asia/Kolkata") {
  const parts = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: timezone,
  }).formatToParts(now);
  const weekday = parts.find((part) => part.type === "weekday")?.value.toLowerCase();
  const hour = parts.find((part) => part.type === "hour")?.value;
  const minute = parts.find((part) => part.type === "minute")?.value;

  return weekday === "sunday" && hour === "20" && minute === "00";
}

function dayBounds(now: Date) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  return { start, end };
}

function daysAgoFrom(now: Date, days: number) {
  const date = new Date(now);
  date.setDate(date.getDate() - days);
  return date;
}

function formatExercise(exercise: string) {
  if (exercise === "bench") return "Bench";
  return exercise.charAt(0).toUpperCase() + exercise.slice(1);
}
