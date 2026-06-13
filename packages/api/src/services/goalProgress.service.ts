import { prisma }                    from "@repo/db/client";
import { invalidateFitnessSnapshot } from "./fitnessSnapshot.service";
import { getLatestWeight }           from "./bodyweight.service";

// ═══════════════════════════════════════════════════════════════════════════════
// FEATURE FLAG
// ═══════════════════════════════════════════════════════════════════════════════

export const GOAL_PROGRESS_ENABLED = process.env.GOAL_PROGRESS_ENABLED !== "false";

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export type GoalType   = "muscle" | "fat_loss" | "strength";
export type GoalStatus = "ahead" | "on_track" | "behind" | "unknown";

export interface GoalProgress {
  goalType:        GoalType;
  exercise:        string | null;   // null for bodyweight goals
  baselineValue:   number;
  currentValue:    number | null;   // null when no tracking data yet
  targetValue:     number | null;   // null until user sets a target
  unit:            string;
  startDate:       string;          // YYYY-MM-DD
  targetDate:      string | null;
  progressPercent: number;          // 0–100, clamped
  status:          GoalStatus;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

// Priority order for selecting the primary tracked lift (strength goal)
const BIG_FOUR = ["deadlift", "squat", "bench_press", "overhead_press"] as const;

// Display labels used in the prompt section
export const GOAL_TYPE_LABEL: Record<GoalType, string> = {
  muscle:   "Muscle Gain",
  fat_loss: "Fat Loss",
  strength: "Strength",
};

export const EXERCISE_LABEL: Record<string, string> = {
  deadlift:       "Deadlift",
  squat:          "Squat",
  bench_press:    "Bench Press",
  overhead_press: "OHP",
};

// ═══════════════════════════════════════════════════════════════════════════════
// PURE FUNCTIONS — calculate / verify only, no DB
// ═══════════════════════════════════════════════════════════════════════════════

// Maps raw gym_goal strings to the 3 supported tracking types.
// Returns null for unsupported goals (recomp, performance, habit, etc.).
export function resolveGoalType(gymGoal: string): GoalType | null {
  const g = gymGoal.toLowerCase().trim();
  if (g === "muscle" || g === "bulk")       return "muscle";
  if (g === "fat_loss" || g === "cut")      return "fat_loss";
  if (g === "strength")                     return "strength";
  return null;
}

export function calculateProgressPercent(
  baseline: number,
  current:  number,
  target:   number,
): number {
  const range = target - baseline;
  if (Math.abs(range) < 0.001) return 100;
  const raw = ((current - baseline) / range) * 100;
  return Math.max(0, Math.min(100, Math.round(raw * 10) / 10));
}

export function calculateGoalStatus(
  progressPercent: number,
  startDate:       Date,
  targetDate:      Date | null,
  now:             Date,
): GoalStatus {
  if (!targetDate) return "unknown";
  const total   = targetDate.getTime() - startDate.getTime();
  const elapsed = now.getTime() - startDate.getTime();
  if (total <= 0 || elapsed < 0) return "unknown";
  const elapsedPct = Math.min(100, (elapsed / total) * 100);
  if (progressPercent >= elapsedPct + 10) return "ahead";
  if (progressPercent >= elapsedPct - 10) return "on_track";
  return "behind";
}

// ═══════════════════════════════════════════════════════════════════════════════
// DB WRITES
// ═══════════════════════════════════════════════════════════════════════════════

// Upsert a GoalProgress record.
// On conflict (same userId/goalType/exercise): only updates targetValue and
// targetDate — NEVER overwrites baselineValue or startDate.
export async function createGoalProgress(
  messengerUserId: string,
  goalType:        GoalType,
  exercise:        string,       // "" for bodyweight goals
  baselineValue:   number,
  targetValue:     number | null,
  unit:            string,
  startDate:       Date,
  targetDate:      Date | null,
): Promise<void> {
  await prisma.goalProgress.upsert({
    where:  { userId_goalType_exercise: { userId: messengerUserId, goalType, exercise } },
    create: { userId: messengerUserId, goalType, exercise, baselineValue, targetValue, unit, startDate, targetDate },
    update: { targetValue, targetDate },
  });
}

// Updates only mutable goal fields and invalidates snapshot so the next
// context build picks up the new target.
export async function updateGoalProgress(
  messengerUserId: string,
  goalType:        GoalType,
  exercise:        string,
  updates: {
    targetValue?: number | null;
    targetDate?:  Date | null;
  },
): Promise<void> {
  await prisma.goalProgress.update({
    where: { userId_goalType_exercise: { userId: messengerUserId, goalType, exercise } },
    data:  updates,
  });
  invalidateFitnessSnapshot(messengerUserId, "goal_target_update");
}

// ═══════════════════════════════════════════════════════════════════════════════
// GOAL SUMMARY — orchestrates read + lazy-init + calculation
// ═══════════════════════════════════════════════════════════════════════════════

export async function getGoalSummary(
  messengerUserId: string,
  now = new Date(),
): Promise<GoalProgress | null> {
  if (!GOAL_PROGRESS_ENABLED) return null;

  const user = await prisma.messengerUser.findUnique({
    where:  { id: messengerUserId },
    select: {
      intakeAnswers:      true,
      personalRecords:    true,
      splitState:         true,
      goalProgressRecords: {
        select: {
          goalType: true, exercise: true, baselineValue: true,
          targetValue: true, unit: true, startDate: true, targetDate: true,
        },
      },
    },
  });
  if (!user) return null;

  const ia       = user.intakeAnswers as Record<string, string> | null | undefined;
  const gymGoal  = ia?.gym_goal ?? "";
  const goalType = resolveGoalType(gymGoal);
  if (!goalType) return null;

  // ── Determine exercise for strength goal ──────────────────────────────────
  let exercise = "";
  if (goalType === "strength") {
    const records = (user.personalRecords ?? {}) as Record<string, unknown>;
    const primary = BIG_FOUR.find(e => records[e]);
    if (!primary) return null;
    exercise = primary;
  }

  // ── Current value from live sources ───────────────────────────────────────
  let currentValue: number | null = null;
  if (!exercise) {
    // Prefer BodyweightHistory (append-only time series). Fall back to intakeAnswers
    // for users who have not yet logged a bodyweight entry.
    currentValue = await getLatestWeight(messengerUserId);
    if (currentValue === null) {
      const bw = parseFloat(ia?.current_bodyweight_kg ?? "");
      currentValue = Number.isFinite(bw) ? bw : null;
    }
  } else {
    const records = (user.personalRecords ?? {}) as Record<string, { weightKg: number }>;
    currentValue = records[exercise]?.weightKg ?? null;
  }

  // ── Look up existing DB record ────────────────────────────────────────────
  let row = user.goalProgressRecords.find(
    r => r.goalType === goalType && r.exercise === exercise,
  ) ?? null;

  // ── Lazy init: if no record, baseline = current value right now ───────────
  if (!row) {
    let baselineValue: number | null = null;

    if (!exercise) {
      const bw = parseFloat(ia?.current_bodyweight_kg ?? "");
      baselineValue = Number.isFinite(bw) ? bw : null;
    } else {
      // Prefer firstExerciseWeights (actual first-ever logged weight for this lift)
      const splitState  = (user.splitState ?? {}) as Record<string, Record<string, number>>;
      const firstWeight = (splitState.firstExerciseWeights ?? {})[exercise];
      const records     = (user.personalRecords ?? {}) as Record<string, { weightKg: number }>;
      baselineValue     = typeof firstWeight === "number" ? firstWeight : (records[exercise]?.weightKg ?? null);
    }

    if (baselineValue === null) return null;

    // Write lazily — upsert is idempotent under concurrent calls
    await prisma.goalProgress.upsert({
      where:  { userId_goalType_exercise: { userId: messengerUserId, goalType, exercise } },
      create: { userId: messengerUserId, goalType, exercise, baselineValue, unit: "kg", startDate: now },
      update: {},
    });

    row = { goalType, exercise, baselineValue, targetValue: null, unit: "kg", startDate: now, targetDate: null };
  }

  // ── Calculate derived fields ──────────────────────────────────────────────
  const progressPercent = (currentValue !== null && row.targetValue !== null)
    ? calculateProgressPercent(row.baselineValue, currentValue, row.targetValue)
    : 0;

  const status = (currentValue !== null && row.targetValue !== null)
    ? calculateGoalStatus(progressPercent, row.startDate, row.targetDate, now)
    : "unknown";

  console.log("[GOAL_PROGRESS]", {
    userId:  messengerUserId,
    goalType,
    progressPercent,
    status,
  });

  return {
    goalType,
    exercise:        exercise || null,
    baselineValue:   row.baselineValue,
    currentValue,
    targetValue:     row.targetValue ?? null,
    unit:            row.unit,
    startDate:       row.startDate.toISOString().slice(0, 10),
    targetDate:      row.targetDate ? row.targetDate.toISOString().slice(0, 10) : null,
    progressPercent,
    status,
  };
}
