// ═══════════════════════════════════════════════════════════════════════════════
// RECOVERY ENGINE — Phase 5C.1 (Hardened)
//
// Deterministic recovery assessment from existing training data.
// OpenAI consumes this output. OpenAI never calculates recovery.
//
// Phase 5C.1 additions:
//   • applySystemicOverrides — burnout cap: burnoutRisk ≥ 70 cannot yield READY
//   • calculateRecoveryDirective — per-status directive with scheduler conflict
//     resolution baked in (RECOVERY > SCHEDULER)
//   • Volume/RPE recency gate: only penalises sessions within last 2 days
//   • directive field on RecoveryStatus so the LLM receives a resolved action,
//     not two contradictory signals
//
// Feature flag: RECOVERY_INTELLIGENCE_ENABLED
//   Set env var to "false" to bypass completely and restore pre-5c Rex behavior.
//   Default: enabled.
// ═══════════════════════════════════════════════════════════════════════════════

import { prisma }            from "@repo/db/client";
import { getMentorState }    from "./user-state-engine";
import type { SchedulerContextV2 } from "./scheduler-intelligence-v2";

// ─── Feature flag ─────────────────────────────────────────────────────────────

export const RECOVERY_INTELLIGENCE_ENABLED =
  process.env.RECOVERY_INTELLIGENCE_ENABLED !== "false";

// ─── Types ────────────────────────────────────────────────────────────────────

export type RecoveryStatusLevel = "ready" | "limited" | "rest";

export type RecoveryConstraintLevel = "training_blocked" | "intensity_reduced" | "unrestricted";

export interface RecoveryStatus {
  score:           number;                  // 0–100; higher = more recovered
  status:          RecoveryStatusLevel;
  constraintLevel: RecoveryConstraintLevel; // calculated fact; replaces coaching directive
  factors:         string[];                // ordered by impact, most significant first
}

// Internal shape built from Prisma rows before the pure calculation stage.
export interface RecentSession {
  date:           Date;
  musclesTrained: string[];
  totalSets:      number | null;
  avgRpe:         number | null;  // null when no RPE data logged
}

// ─── Thresholds ───────────────────────────────────────────────────────────────

const SCORE_READY   = 80;   // 80–100 → ready
const SCORE_LIMITED = 50;   // 50–79  → limited
                             // 0–49   → rest

const BURNOUT_OVERRIDE_THRESHOLD = 70; // burnoutRisk ≥ this caps READY → LIMITED

const MS_24H = 24 * 60 * 60 * 1000;
const MS_48H = 48 * 60 * 60 * 1000;

// ═══════════════════════════════════════════════════════════════════════════════
// calculateRecoveryStatus
// Pure. Given a 0–100 score, returns the raw status label.
// Does NOT apply systemic overrides — call applySystemicOverrides after this.
// ═══════════════════════════════════════════════════════════════════════════════

export function calculateRecoveryStatus(score: number): RecoveryStatusLevel {
  if (score >= SCORE_READY)   return "ready";
  if (score >= SCORE_LIMITED) return "limited";
  return "rest";
}

// ═══════════════════════════════════════════════════════════════════════════════
// applySystemicOverrides
// Pure. Applies overrides that the numeric score cannot capture alone.
//
// Burnout rule: burnoutRisk ≥ 70 prevents READY.
// Rationale: burnoutRisk is a CNS/psychological signal. A rested body does not
// mean a recovered nervous system. The score can reach 80 after a rest day even
// at burnoutRisk=90 — this override closes that gap.
// ═══════════════════════════════════════════════════════════════════════════════

export function applySystemicOverrides(
  rawStatus:   RecoveryStatusLevel,
  burnoutRisk: number,
): RecoveryStatusLevel {
  if (burnoutRisk >= BURNOUT_OVERRIDE_THRESHOLD && rawStatus === "ready") {
    return "limited";
  }
  return rawStatus;
}

// ═══════════════════════════════════════════════════════════════════════════════
// calculateConstraintLevel
// Pure. Maps recovery status to a machine-readable constraint level.
// OpenAI reads this and decides how to respond — the engine does not prescribe.
// ═══════════════════════════════════════════════════════════════════════════════

export function calculateConstraintLevel(status: RecoveryStatusLevel): RecoveryConstraintLevel {
  switch (status) {
    case "rest":    return "training_blocked";
    case "limited": return "intensity_reduced";
    case "ready":   return "unrestricted";
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// calculateRecoveryScore
// Pure. All inputs are pre-computed primitives. No DB, no LLM.
// Returns 0–100 (already clamped and rounded).
//
// Volume/RPE recency gate (Phase 5C.1):
//   Volume and RPE penalties only apply when daysSinceLastSession <= 2.
//   A session 3+ days old no longer penalises recovery — the body has had
//   the standard recovery window. The muscle-overlap check already had this
//   gate; volume/RPE now matches it.
// ═══════════════════════════════════════════════════════════════════════════════

export function calculateRecoveryScore(
  daysSinceLastSession: number,
  recentSessions:       RecentSession[],
  completionRate7d:     number,
  burnoutRisk:          number,
  stress:               number,
  nowMs                 = Date.now(),
): number {
  let score = 100;

  // ── Rest time since last session ──────────────────────────────────────────
  if      (daysSinceLastSession === 0) score -= 25;
  else if (daysSinceLastSession === 1) score -= 10;
  else if (daysSinceLastSession >= 3)  score  = Math.min(score + 5, 100);
  // daysSinceLastSession === 2 → no change; 48 h is the standard recovery window

  // ── Recent training load: sessions completed in the last 48 h ────────────
  const cutoff48h  = nowMs - MS_48H;
  const veryRecent = recentSessions.filter(s => s.date.getTime() >= cutoff48h);
  if      (veryRecent.length >= 3) score -= 20;
  else if (veryRecent.length === 2) score -= 10;
  // 1 session in 48 h is accounted for by daysSinceLastSession above

  // ── Volume and RPE of the most recent session (recency-gated) ────────────
  // Only penalise when the last session is within the standard recovery window.
  // Sessions older than 2 days have already been absorbed.
  const lastSession = recentSessions[0] ?? null;
  if (lastSession && daysSinceLastSession <= 2) {
    const sets = lastSession.totalSets ?? 0;
    if      (sets > 30) score -= 15;
    else if (sets > 20) score -= 8;

    if (lastSession.avgRpe !== null) {
      if      (lastSession.avgRpe > 8.5) score -= 12;
      else if (lastSession.avgRpe > 7.5) score -= 6;
    }
  }

  // ── Muscle-group overlap: most-recent vs. second-most-recent ─────────────
  if (recentSessions.length >= 2 && daysSinceLastSession <= 1) {
    const latestMuscles  = new Set(recentSessions[0].musclesTrained.map(m => m.toLowerCase()));
    const prevMuscles    = recentSessions[1].musclesTrained.map(m => m.toLowerCase());
    const overlap        = prevMuscles.filter(m => latestMuscles.has(m));
    if      (overlap.length >= 2) score -= 15;
    else if (overlap.length === 1) score -= 7;
  }

  // ── Weekly training frequency vs. target ──────────────────────────────────
  if (completionRate7d > 0.9) score -= 5;

  // ── Systemic fatigue (burnout risk) ───────────────────────────────────────
  if      (burnoutRisk >= 70) score -= 20;
  else if (burnoutRisk >= 50) score -= 10;

  // ── External stress impairs muscular and CNS recovery ────────────────────
  if      (stress >= 75) score -= 8;
  else if (stress >= 55) score -= 4;

  return Math.max(0, Math.min(100, Math.round(score)));
}

// ═══════════════════════════════════════════════════════════════════════════════
// buildRecoveryFactors
// Pure. Produces ordered, human-readable factor strings for the LLM prompt.
// Most limiting factors first.
//
// Matches the recency gate in calculateRecoveryScore: volume/RPE factors are
// only surfaced when daysSinceLastSession <= 2.
// ═══════════════════════════════════════════════════════════════════════════════

export function buildRecoveryFactors(
  daysSinceLastSession: number,
  recentSessions:       RecentSession[],
  completionRate7d:     number,
  burnoutRisk:          number,
  stress:               number,
  score:                number,
  nowMs                 = Date.now(),
): string[] {
  const factors: string[] = [];

  // Systemic fatigue (highest priority — affects whole recovery picture)
  if      (burnoutRisk >= 70) factors.push("High burnout risk");
  else if (burnoutRisk >= 50) factors.push("Elevated burnout risk");

  if      (stress >= 75) factors.push("High external stress");
  else if (stress >= 55) factors.push("Elevated stress");

  // Recent load
  const cutoff48h  = nowMs - MS_48H;
  const veryRecent = recentSessions.filter(s => s.date.getTime() >= cutoff48h);
  if (veryRecent.length >= 2) factors.push("Consecutive training days");

  // Volume & intensity of last session — recency-gated to match score logic
  const lastSession = recentSessions[0] ?? null;
  if (lastSession && daysSinceLastSession <= 2) {
    const sets = lastSession.totalSets ?? 0;
    if      (sets > 30) factors.push("Very high session volume");
    else if (sets > 20) factors.push("High session volume");

    if (lastSession.avgRpe !== null && lastSession.avgRpe > 8.5) {
      factors.push("High session intensity (RPE > 8.5)");
    } else if (lastSession.avgRpe !== null && lastSession.avgRpe > 7.5) {
      factors.push("Moderate-high session intensity");
    }
  }

  // Muscle overlap
  if (recentSessions.length >= 2 && daysSinceLastSession <= 1) {
    const latestMuscles = new Set(recentSessions[0].musclesTrained.map(m => m.toLowerCase()));
    const prevMuscles   = recentSessions[1].musclesTrained.map(m => m.toLowerCase());
    const overlap       = prevMuscles.filter(m => latestMuscles.has(m));
    if (overlap.length >= 1) factors.push("Same muscle group trained back-to-back");
  }

  // Rest time
  if      (daysSinceLastSession === 0) factors.push("Trained today");
  else if (daysSinceLastSession === 1) factors.push("24 h since last session");
  else if (daysSinceLastSession >= 3)  factors.push(`${daysSinceLastSession} days since last session`);

  // Frequency
  if (completionRate7d > 0.9) factors.push("High training frequency this week");

  // Positive summary when all clear
  if (score >= SCORE_READY && factors.length === 0) {
    factors.push("Adequate rest since last session");
  }

  return factors;
}

// ═══════════════════════════════════════════════════════════════════════════════
// getRecoverySummary
// Async entry point. Fetches training data, delegates to pure functions.
// Returns null when: feature disabled, user has no history, or a DB error.
//
// Applies systemic overrides after calculateRecoveryStatus so that burnout
// cannot produce a READY status regardless of numeric score.
// ═══════════════════════════════════════════════════════════════════════════════

export async function getRecoverySummary(
  messengerUserId: string,
  platformChatId:  string,
  schedulerCtx:    SchedulerContextV2 | null,
  now              = new Date(),
): Promise<RecoveryStatus | null> {
  if (!RECOVERY_INTELLIGENCE_ENABLED) return null;
  if (!schedulerCtx?.hasAnyHistory)   return null;

  try {
    const sevenDaysAgo = new Date(now.getTime() - 7 * MS_24H);

    const [rawSessions, mentorState] = await Promise.all([
      prisma.telegramWorkoutSession.findMany({
        where: {
          messengerUserId,
          date:      { gte: sevenDaysAgo },
          completed: true,
        },
        include: {
          sets: { select: { rpe: true } },
        },
        orderBy: { date: "desc" },
        take:    10,
      }),
      getMentorState(platformChatId),
    ]);

    if (rawSessions.length === 0) return null;

    const recentSessions: RecentSession[] = rawSessions.map(s => {
      const rpes   = s.sets
        .map(sl => sl.rpe)
        .filter((r): r is number => typeof r === "number");
      const avgRpe = rpes.length > 0
        ? rpes.reduce((a, b) => a + b, 0) / rpes.length
        : null;
      return {
        date:           s.date,
        musclesTrained: s.musclesTrained,
        totalSets:      s.totalSets,
        avgRpe,
      };
    });

    const daysSinceLastSession = schedulerCtx.daysSinceLastSession;
    const completionRate7d     = schedulerCtx.completionRate7d;
    const burnoutRisk          = mentorState.burnoutRisk;
    const stress               = mentorState.stress;
    const nowMs                = now.getTime();

    const score          = calculateRecoveryScore(daysSinceLastSession, recentSessions, completionRate7d, burnoutRisk, stress, nowMs);
    const rawStatus      = calculateRecoveryStatus(score);
    const status         = applySystemicOverrides(rawStatus, burnoutRisk);
    const constraintLevel = calculateConstraintLevel(status);
    const factors        = buildRecoveryFactors(daysSinceLastSession, recentSessions, completionRate7d, burnoutRisk, stress, score, nowMs);

    const result: RecoveryStatus = { score, status, constraintLevel, factors };

    console.log("[RECOVERY_STATUS]", {
      userId:  messengerUserId,
      score,
      status,
      constraintLevel,
      factors,
    });

    return result;
  } catch (err) {
    console.error("[RECOVERY_ENGINE] getRecoverySummary failed:", err);
    return null;
  }
}
