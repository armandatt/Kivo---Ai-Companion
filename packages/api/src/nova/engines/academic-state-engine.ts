// ─── Academic State Engine ────────────────────────────────────────────────────
// SKILL.md §10 — always deterministic. LLMs never write here, never infer this.
// Computes the three-tier AcademicState from raw DB data.
// Owner: Academic State Engine. No other engine may modify AcademicState.

import type {
  AcademicState,
  AcademicScores,
  AcademicStateSnapshot,
  ActiveMode,
  HardDirectives,
  MomentaryState,
  SemesterPhase,
} from "../types/academic-state.types";
import {
  STATE_BASELINES,
  STATE_DECAY_RATES,
} from "../types/academic-state.types";
import type { AcademicUnderstanding } from "../types/understanding.types";
import type { SignalEngineOutput } from "../types/engine.types";
import type { TopicMasteryState } from "../types/engine.types";

// ── Raw DB data for state computation ─────────────────────────────────────────

export interface AcademicStateInput {
  // From NovaAcademicProfile
  semesterStartDate: Date | null;
  semesterEndDate:   Date | null;
  daysSinceJoined:   number;

  // From study sessions
  studySessions: Array<{
    sessionDate:     Date;
    status:          string;  // completed | skipped | partial
    durationMinutes: number;
  }>;

  // From exams
  upcomingExams: Array<{ scheduledAt: Date; }>;

  // From cognitive state history
  stateHistory: AcademicStateSnapshot[];

  // Signals (applied this turn)
  signals: SignalEngineOutput;

  // Topic mastery (if a topic was mentioned — for calibration gap)
  mentionedTopicMastery: TopicMasteryState | null;

  // Understanding Brain output (for momentary state)
  understanding: AcademicUnderstanding;

  // From stored state (loaded from DB, represents prior accumulated scores)
  storedScores: AcademicScores | null;
  storedStreakDays: number;
  storedConsecutiveMisses: number;
}

// ── Clamp helper ──────────────────────────────────────────────────────────────

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, n));
}

// ── Semester phase computation ────────────────────────────────────────────────

function computeSemesterPhase(
  semesterStart: Date | null,
  semesterEnd:   Date | null,
  now:           Date,
): SemesterPhase {
  if (!semesterStart || !semesterEnd) return "beginning";

  const total    = semesterEnd.getTime() - semesterStart.getTime();
  const elapsed  = now.getTime()         - semesterStart.getTime();
  const fraction = elapsed / total;

  if (fraction < 0)    return "beginning";
  if (fraction > 1)    return "post_exam";
  if (fraction < 0.25) return "beginning";
  if (fraction < 0.55) return "midterm";
  if (fraction < 0.85) return "finals";
  return "post_exam";
}

// ── Score decay ───────────────────────────────────────────────────────────────

function applyDecay(scores: AcademicScores, inactiveDays: number): AcademicScores {
  if (inactiveDays <= 0) return scores;

  const decayed = { ...scores };
  for (const [field, rate] of Object.entries(STATE_DECAY_RATES) as Array<[keyof AcademicScores, number]>) {
    const baseline = STATE_BASELINES[field];
    const current  = scores[field];
    const decay    = rate * inactiveDays;
    // Decays toward baseline
    if (rate > 0) {
      decayed[field] = clamp(current - Math.abs(decay), baseline, 100);
    } else {
      // Negative rate (burnoutRisk) — reduces toward baseline with rest
      decayed[field] = clamp(current + decay, 0, baseline);
    }
  }
  return decayed;
}

// ── Apply signal deltas to scores ─────────────────────────────────────────────

function applySignals(scores: AcademicScores, signals: SignalEngineOutput): AcademicScores {
  const updated = { ...scores };
  for (const upd of signals.stateUpdates) {
    const current = updated[upd.field] ?? STATE_BASELINES[upd.field];
    updated[upd.field] = clamp(current + upd.delta);
  }
  return updated;
}

// ── Session streak and miss computation ──────────────────────────────────────

function computeStreakAndMisses(
  sessions: AcademicStateInput["studySessions"],
  priorStreak:  number,
  priorMisses:  number,
  now:          Date,
): { streakDays: number; consecutiveMisses: number; daysSinceLastSession: number } {
  const sorted = [...sessions].sort((a, b) => b.sessionDate.getTime() - a.sessionDate.getTime());
  const lastCompleted = sorted.find(s => s.status === "completed");

  const daysSinceLastSession = lastCompleted
    ? Math.floor((now.getTime() - lastCompleted.sessionDate.getTime()) / 86_400_000)
    : 999;

  // Count consecutive days with at least one completed session (going back from today)
  let streakDays = 0;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  for (let i = 0; i < 90; i++) {
    const dayStart = new Date(today);
    dayStart.setDate(today.getDate() - i);
    const dayEnd   = new Date(dayStart);
    dayEnd.setHours(23, 59, 59, 999);

    const hadSession = sorted.some(
      s => s.status === "completed" &&
           s.sessionDate >= dayStart &&
           s.sessionDate <= dayEnd,
    );
    if (hadSession) streakDays++;
    else if (i > 0) break;  // gap found — streak ends
  }

  // Consecutive misses: days since last completed session
  const consecutiveMisses = daysSinceLastSession < 999 ? Math.max(0, daysSinceLastSession - 1) : priorMisses;

  return { streakDays, consecutiveMisses, daysSinceLastSession };
}

// ── Momentary state ────────────────────────────────────────────────────────────

function computeMomentaryState(
  scores:           AcademicScores,
  streakDays:       number,
  consecutiveMisses: number,
  daysSinceLast:    number,
  understanding:    AcademicUnderstanding,
  mentionedTopic:   TopicMasteryState | null,
  patterns:         { hasExcuseLoop: boolean; hasComparisonTrap: boolean },
): MomentaryState {
  // Priority order matches SKILL.md §10.1 description
  if (scores.burnoutRisk > 70)  return "burned_out";

  if (understanding.emotion === "distressed") return "burned_out";

  if (understanding.intent === "identity_doubt" || understanding.emotion === "identity_threat")
    return "self_doubt";

  if (understanding.emotion === "self_doubt") return "self_doubt";

  if (understanding.emotion === "overwhelmed") return "overwhelmed";

  if (understanding.intent === "excuse" && patterns.hasExcuseLoop) return "excuse_active";

  if (mentionedTopic && mentionedTopic.calibrationGap > 0.25) return "calibration_gap";

  if (patterns.hasComparisonTrap && understanding.emotion === "discouraged") return "comparison_trap";

  if (daysSinceLast > 7)  return "disengaged";
  if (daysSinceLast > 3)  return "returning";

  if (streakDays >= 7 && scores.engagement > 65) return "momentum";

  return "neutral";
}

// ── Hard directives ────────────────────────────────────────────────────────────

function computeHardDirectives(
  scores:            AcademicScores,
  activeMode:        ActiveMode,
  momentaryState:    MomentaryState,
  consecutiveMisses: number,
  daysSinceJoined:   number,
  daysUntilExam:     number | null,
): HardDirectives {
  return {
    noStudyPressure:  scores.burnoutRisk > 70 || activeMode === "recovery",
    examCrisisMode:   daysUntilExam !== null && daysUntilExam < 3,
    planFreezeMode:   daysUntilExam !== null && daysUntilExam < 1,
    calibrationAlert: momentaryState === "calibration_gap",
    noChallenging:    momentaryState === "self_doubt",
    recoveryMode:     consecutiveMisses > 5 && !(daysUntilExam !== null && daysUntilExam < 3),
    beginnerMode:     daysSinceJoined < 30,
  };
}

// ── Active mode ───────────────────────────────────────────────────────────────

function computeActiveMode(
  scores:            AcademicScores,
  consecutiveMisses: number,
  daysUntilExam:     number | null,
): ActiveMode {
  if (daysUntilExam !== null && daysUntilExam < 3) return "exam_crisis";
  if (scores.burnoutRisk > 70 || consecutiveMisses > 5) return "recovery";
  if (daysUntilExam !== null && daysUntilExam < 14 && scores.retention < 60) return "revision_only";
  return "standard";
}

// ── 7-day momentum trend ──────────────────────────────────────────────────────

function compute7dTrend(
  sessions: AcademicStateInput["studySessions"],
  now:      Date,
): number[] {
  const trend: number[] = [];
  for (let i = 6; i >= 0; i--) {
    const dayStart = new Date(now);
    dayStart.setDate(now.getDate() - i);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setHours(23, 59, 59, 999);

    const mins = sessions
      .filter(s => s.status === "completed" && s.sessionDate >= dayStart && s.sessionDate <= dayEnd)
      .reduce((sum, s) => sum + s.durationMinutes, 0);

    // Normalize to 0-100: 60+ mins = 100, 0 = 0
    trend.push(Math.min(100, Math.round((mins / 60) * 100)));
  }
  return trend;
}

// ── Main compute function ─────────────────────────────────────────────────────

export function computeAcademicState(input: AcademicStateInput, now = new Date()): AcademicState {
  const {
    semesterStartDate, semesterEndDate, daysSinceJoined,
    studySessions, upcomingExams, stateHistory,
    signals, mentionedTopicMastery, understanding,
    storedScores, storedStreakDays, storedConsecutiveMisses,
  } = input;

  // ── 1. Streak + miss metrics ──────────────────────────────────────────────
  const { streakDays, consecutiveMisses, daysSinceLastSession } = computeStreakAndMisses(
    studySessions, storedStreakDays, storedConsecutiveMisses, now,
  );

  // ── 2. Next exam ──────────────────────────────────────────────────────────
  const futureExams = upcomingExams
    .filter(e => e.scheduledAt > now)
    .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
  const daysUntilNextExam = futureExams.length > 0
    ? Math.ceil((futureExams[0]!.scheduledAt.getTime() - now.getTime()) / 86_400_000)
    : null;

  // ── 3. Scores: start from stored or baselines, then decay, then signals ──
  let scores: AcademicScores = storedScores ?? { ...STATE_BASELINES };
  scores = applyDecay(scores, Math.max(0, daysSinceLastSession - 1));
  scores = applySignals(scores, signals);

  // ── 4. Derived metrics ────────────────────────────────────────────────────
  const momentum7dTrend = compute7dTrend(studySessions, now);
  // Momentum score: average of last 7 days weighted toward recent
  const weightedMomentum = momentum7dTrend.reduce((acc, v, i) => acc + v * (i + 1), 0) /
    momentum7dTrend.reduce((_, __, i) => _ + (i + 1), 0);
  scores.momentum = clamp(Math.round(weightedMomentum));

  // ── 5. Tier computations (in order) ──────────────────────────────────────
  const semesterPhase = computeSemesterPhase(semesterStartDate, semesterEndDate, now);

  const hasExcuseLoop    = false;  // Pattern Detector result — injected by orchestrator
  const hasComparisonTrap = false; // Pattern Detector result — injected by orchestrator

  const momentaryState = computeMomentaryState(
    scores, streakDays, consecutiveMisses,
    daysSinceLastSession, understanding,
    mentionedTopicMastery,
    { hasExcuseLoop, hasComparisonTrap },
  );

  const activeMode = computeActiveMode(scores, consecutiveMisses, daysUntilNextExam);

  const hardDirectives = computeHardDirectives(
    scores, activeMode, momentaryState,
    consecutiveMisses, daysSinceJoined, daysUntilNextExam,
  );

  return {
    semesterPhase,
    activeMode,
    momentaryState,
    scores,
    hardDirectives,
    daysSinceJoined,
    daysSinceLastSession,
    consecutiveMisses,
    studyStreakDays: streakDays,
    daysUntilNextExam,
    momentum7dTrend,
    stateHistory: stateHistory.slice(-12),
  };
}

// ── Patch momentary state with pattern detector results ───────────────────────
// Called after Pattern Detector runs (it's a slow path, not on every message).

export function patchMomentaryState(
  state:            AcademicState,
  hasExcuseLoop:    boolean,
  hasComparisonTrap: boolean,
  understanding:    AcademicUnderstanding,
): AcademicState {
  if (!hasExcuseLoop && !hasComparisonTrap) return state;

  let momentaryState = state.momentaryState;
  if (hasExcuseLoop && understanding.intent === "excuse" && momentaryState !== "burned_out") {
    momentaryState = "excuse_active";
  }
  if (hasComparisonTrap && understanding.emotion === "discouraged") {
    momentaryState = "comparison_trap";
  }

  return {
    ...state,
    momentaryState,
    hardDirectives: computeHardDirectives(
      state.scores, state.activeMode, momentaryState,
      state.consecutiveMisses, state.daysSinceJoined, state.daysUntilNextExam,
    ),
  };
}
