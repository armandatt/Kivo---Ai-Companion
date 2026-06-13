import { prisma }                                              from "@repo/db/client";
import { computePatternReport }                               from "./gymPatternDetector.service";
import type { PatternReport }                                  from "./gymPatternDetector.service";
import { buildEngagementContext }                             from "./engagement.service";
import type { EngagementContext }                              from "./engagement.service";
import { buildSchedulerContextV2 }                           from "../engines/scheduler-intelligence-v2";
import type { SchedulerContextV2 }                            from "../engines/scheduler-intelligence-v2";
import { getGoalSummary }                                    from "./goalProgress.service";
import type { GoalProgress }                                   from "./goalProgress.service";
import { getRecoverySummary }                                from "../engines/recovery-engine";
import type { RecoveryStatus }                                from "../engines/recovery-engine";
import { getWeightTrend }                                    from "./bodyweight.service";
import type { WeightTrend }                                   from "./bodyweight.service";

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface FitnessSnapshot {
  consistencyScore:    number;        // 0–100 from PatternReport (28-day window)
  streakDays:          number;        // consecutive training days from gymStreak
  plateauDetected:     boolean;       // true when any lifts have ≥3 sessions at same weight
  stalledLifts:        string[];      // exercise names with no weight progression
  biggestPR:           string;        // "Deadlift 120kg" or "none yet"
  weeklyCompletionRate: number;       // 0.0–1.0 from SchedulerContextV2
  totalSessions:       number;        // all-time completed session count
  lastWorkoutDate:     string | null; // "YYYY-MM-DD" or null
  goalCategory:        string | null; // raw gym_goal from intakeAnswers
  goalProgress:        GoalProgress | null;
  recoveryStatus:      RecoveryStatus | null; // null when flag disabled or no history
  weightTrend:         WeightTrend | null;    // null when flag disabled or no history
}

// Raw sub-results returned alongside the snapshot so the orchestrator can
// populate its existing PatternReport / EngagementContext / SchedulerContextV2
// fields without re-fetching.
export interface FitnessSnapshotBundle {
  snapshot:       FitnessSnapshot;
  patternReport:  PatternReport | null;
  engagementCtx:  EngagementContext | null;
  schedulerCtx:   SchedulerContextV2 | null;
  recoveryStatus: RecoveryStatus | null;
  weightTrend:    WeightTrend | null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CACHE
// ═══════════════════════════════════════════════════════════════════════════════

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry {
  bundle:    FitnessSnapshotBundle;
  expiresAt: number;
}

const snapshotCache = new Map<string, CacheEntry>();

function readCache(userId: string, now: Date): FitnessSnapshotBundle | null {
  const entry = snapshotCache.get(userId);
  if (!entry) return null;
  if (now.getTime() >= entry.expiresAt) {
    snapshotCache.delete(userId);
    return null;
  }
  return entry.bundle;
}

function writeCache(userId: string, bundle: FitnessSnapshotBundle, now: Date): void {
  snapshotCache.set(userId, { bundle, expiresAt: now.getTime() + CACHE_TTL_MS });
}

// Called by any mutation that changes fields surfaced in FitnessSnapshot.
// reason: one of finish_session | skip_reason | nl_workout_commit | pr_update | intake_update
export function invalidateFitnessSnapshot(userId: string, reason: string): void {
  snapshotCache.delete(userId);
  console.log("[FITNESS_SNAPSHOT_INVALIDATED]", { userId, reason });
}

// ═══════════════════════════════════════════════════════════════════════════════
// BUILDER
// ═══════════════════════════════════════════════════════════════════════════════

export async function buildFitnessSnapshot(
  messengerUserId: string,
  platformChatId:  string,
  now = new Date(),
): Promise<FitnessSnapshotBundle | null> {
  const cached = readCache(messengerUserId, now);
  if (cached) return cached;

  // FIX 3: getWeightTrend runs in the first batch — independent of workout history.
  // Weight tracking must function for users who have bodyweight entries but no sessions.
  const [patternReport, engagementCtx, schedulerCtx, totalSessions, goalRow, goalProgress, weightTrend] =
    await Promise.all([
      computePatternReport(messengerUserId, now).catch(err => {
        console.error("[FITNESS_SNAPSHOT] patternReport:", err);
        return null as PatternReport | null;
      }),
      buildEngagementContext(messengerUserId, now).catch(err => {
        console.error("[FITNESS_SNAPSHOT] engagementCtx:", err);
        return null as EngagementContext | null;
      }),
      buildSchedulerContextV2(platformChatId, now).catch(err => {
        console.error("[FITNESS_SNAPSHOT] schedulerCtx:", err);
        return null as SchedulerContextV2 | null;
      }),
      prisma.telegramWorkoutSession
        .count({ where: { messengerUserId, completed: true } })
        .catch(err => {
          console.error("[FITNESS_SNAPSHOT] totalSessions:", err);
          return 0;
        }),
      prisma.messengerUser
        .findUnique({
          where:  { id: messengerUserId },
          select: { intakeAnswers: true },
        })
        .catch(() => null),
      getGoalSummary(messengerUserId, now).catch(err => {
        console.error("[FITNESS_SNAPSHOT] goalProgress:", err);
        return null as GoalProgress | null;
      }),
      getWeightTrend(messengerUserId, now).catch(err => {
        console.error("[FITNESS_SNAPSHOT] weightTrend:", err);
        return null as WeightTrend | null;
      }),
    ]);

  // Bail only when there is no training history AND no bodyweight data.
  // A weight-only user must still receive a snapshot so their trend is visible.
  if (!engagementCtx && !schedulerCtx?.hasAnyHistory && !weightTrend) return null;

  const ia          = goalRow?.intakeAnswers as Record<string, string> | null | undefined;
  const goalCategory = typeof ia?.gym_goal === "string" ? ia.gym_goal : null;

  // Recovery assessment runs after scheduler context resolves so it can
  // use daysSinceLastSession and completionRate7d without an extra query.
  const recoveryStatus = await getRecoverySummary(
    messengerUserId,
    platformChatId,
    schedulerCtx,
    now,
  ).catch(err => {
    console.error("[FITNESS_SNAPSHOT] recoveryStatus:", err);
    return null as RecoveryStatus | null;
  });

  const snapshot: FitnessSnapshot = {
    consistencyScore:    patternReport?.consistencyScore ?? 0,
    streakDays:          engagementCtx?.streak ?? 0,
    plateauDetected:     (patternReport?.stalledLifts.length ?? 0) > 0,
    stalledLifts:        patternReport?.stalledLifts.map(s => s.exercise) ?? [],
    biggestPR:           engagementCtx?.biggestPR ?? "none yet",
    weeklyCompletionRate: schedulerCtx?.completionRate7d ?? 0,
    totalSessions,
    lastWorkoutDate:     schedulerCtx?.lastSessionDate ?? null,
    goalCategory,
    goalProgress:        goalProgress ?? null,
    recoveryStatus,
    weightTrend,
  };

  const bundle: FitnessSnapshotBundle = {
    snapshot,
    patternReport,
    engagementCtx,
    schedulerCtx,
    recoveryStatus,
    weightTrend,
  };

  writeCache(messengerUserId, bundle, now);
  return bundle;
}
