// ─── Study Momentum Engine ────────────────────────────────────────────────────
// Computes MomentumState from raw session history and academic state.
// NEVER makes LLM calls. NEVER reads DB. Input-pure, output-deterministic.
// Owner: Phase 5 Proactive Mentor System.

import type {
  MomentumState,
  MomentumLevel,
  ConsistencyLevel,
  StudyRhythm,
  RecoveryTrend,
  MotivationTrend,
} from "../types/proactive.types.js";

// Input shape — only the fields this engine actually needs.
export interface MomentumInput {
  studySessions: Array<{
    sessionDate: Date;
    durationMinutes: number;
    status: string;
  }>;
  consecutiveMisses:  number;
  studyStreakDays:     number;
  stateHistory:       Array<{ engagement?: number; createdAt?: Date }>;
  now:                Date;
}

// ── Public export ─────────────────────────────────────────────────────────────

export function computeMomentumState(input: MomentumInput): MomentumState {
  const { studySessions, consecutiveMisses, studyStreakDays, stateHistory, now } = input;

  const completed = studySessions.filter(s => s.status === "completed");

  const sessionsLast7Days   = countSessionsInLastNDays(completed, 7, now);
  const lastSessionDaysAgo  = computeLastSessionDaysAgo(completed, now);
  const averageSessionMinutes = computeAverageSessionMinutes(completed, 14, now);
  const studyRhythm         = computeStudyRhythm(completed, now);
  const currentStreak       = studyStreakDays;

  const currentMomentum    = classifyMomentum(currentStreak, sessionsLast7Days, consecutiveMisses);
  const weeklyConsistency  = classifyConsistency(sessionsLast7Days);
  const recoveryTrend      = computeRecoveryTrend(consecutiveMisses, completed, now);
  const motivationTrend    = computeMotivationTrend(stateHistory);

  return {
    currentMomentum,
    weeklyConsistency,
    currentStreak,
    lastSessionDaysAgo,
    consecutiveMisses,
    recoveryTrend,
    motivationTrend,
    studyRhythm,
    averageSessionMinutes,
    sessionsLast7Days,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function countSessionsInLastNDays(
  sessions: Array<{ sessionDate: Date }>,
  days: number,
  now: Date,
): number {
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  return sessions.filter(s => s.sessionDate >= cutoff).length;
}

function computeLastSessionDaysAgo(
  sessions: Array<{ sessionDate: Date }>,
  now: Date,
): number {
  if (sessions.length === 0) return 999;
  const sorted  = [...sessions].sort((a, b) => b.sessionDate.getTime() - a.sessionDate.getTime());
  const last    = sorted[0]!;
  const msAgo   = now.getTime() - last.sessionDate.getTime();
  return Math.floor(msAgo / 86_400_000);
}

function computeAverageSessionMinutes(
  sessions: Array<{ sessionDate: Date; durationMinutes: number }>,
  lookbackDays: number,
  now: Date,
): number {
  const cutoff = new Date(now.getTime() - lookbackDays * 86_400_000);
  const recent = sessions.filter(s => s.sessionDate >= cutoff);
  if (recent.length === 0) return 0;
  const total = recent.reduce((sum, s) => sum + s.durationMinutes, 0);
  return Math.round(total / recent.length);
}

function computeStudyRhythm(
  sessions: Array<{ sessionDate: Date }>,
  now: Date,
): StudyRhythm {
  const cutoff = new Date(now.getTime() - 14 * 86_400_000);
  const recent = sessions.filter(s => s.sessionDate >= cutoff);
  if (recent.length < 2) return "irregular";

  const buckets = { morning: 0, afternoon: 0, evening: 0, night: 0 };
  for (const s of recent) {
    const hour = s.sessionDate.getHours();
    if (hour >= 6  && hour < 12) buckets.morning++;
    else if (hour >= 12 && hour < 18) buckets.afternoon++;
    else if (hour >= 18 && hour < 22) buckets.evening++;
    else buckets.night++;
  }

  const top = (Object.entries(buckets) as [StudyRhythm, number][])
    .sort((a, b) => b[1] - a[1])[0]!;

  // Only call it a rhythm if the top bucket has >40% share
  const dominance = top[1] / recent.length;
  return dominance >= 0.40 ? top[0] : "irregular";
}

function classifyMomentum(
  streak:           number,
  sessionsLast7:    number,
  consecutiveMisses: number,
): MomentumLevel {
  if (consecutiveMisses >= 5)                            return "critical";
  if (streak >= 7 && sessionsLast7 >= 5)                 return "high";
  if (streak >= 3 && sessionsLast7 >= 3)                 return "moderate";
  if (sessionsLast7 >= 1 || consecutiveMisses <= 1)      return "low";
  return "critical";
}

function classifyConsistency(sessionsLast7: number): ConsistencyLevel {
  if (sessionsLast7 >= 6) return "excellent";
  if (sessionsLast7 >= 4) return "good";
  if (sessionsLast7 >= 2) return "fair";
  return "poor";
}

function computeRecoveryTrend(
  consecutiveMisses: number,
  sessions: Array<{ sessionDate: Date }>,
  now: Date,
): RecoveryTrend {
  if (consecutiveMisses === 0) return "stable";

  // Check if student completed a session in the last 48h despite prior misses
  const fortyEightHoursAgo = new Date(now.getTime() - 48 * 3_600_000);
  const recentSessions = sessions.filter(s => s.sessionDate >= fortyEightHoursAgo);
  if (recentSessions.length >= 1) return "recovering";

  return "declining";
}

function computeMotivationTrend(
  stateHistory: Array<{ engagement?: number; createdAt?: Date }>,
): MotivationTrend {
  // Need at least 3 data points to detect a trend
  const withEngagement = stateHistory
    .filter(h => typeof h.engagement === "number")
    .slice(-6);  // last 6 state snapshots

  if (withEngagement.length < 3) return "stable";

  const scores = withEngagement.map(h => h.engagement as number);
  const first  = scores.slice(0, Math.ceil(scores.length / 2));
  const last   = scores.slice(Math.floor(scores.length / 2));

  const firstAvg = first.reduce((s, v) => s + v, 0) / first.length;
  const lastAvg  = last.reduce((s, v) => s + v, 0) / last.length;
  const delta    = lastAvg - firstAvg;

  if (delta > 8)  return "rising";
  if (delta < -8) return "falling";
  return "stable";
}
