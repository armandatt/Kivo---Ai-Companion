// ─── Academic State types ─────────────────────────────────────────────────────
// SKILL.md §10 — three-tier hierarchy, always deterministic.
// LLMs never write to this. LLMs never infer this.

// ── Tier 1: Semester Phase ────────────────────────────────────────────────────
export type SemesterPhase =
  | "beginning"   // weeks 1-4, habit formation
  | "midterm"     // exam pressure zone
  | "finals"      // maximum stakes
  | "post_exam"   // recovery + reflection
  | "break";      // no academic pressure

// ── Tier 2: Active Mode ───────────────────────────────────────────────────────
export type ActiveMode =
  | "standard"       // normal study cycle
  | "exam_crisis"    // daysUntilExam < 3
  | "recovery"       // burnoutRisk > 70 OR consecutiveMisses > 5
  | "revision_only"; // Exam engine says review only, no new material

// ── Tier 3: Momentary State ───────────────────────────────────────────────────
export type MomentaryState =
  | "momentum"          // 7+ day streak, high engagement
  | "returning"         // gap > 3 days, first message back
  | "disengaged"        // gap > 7 days
  | "burned_out"        // behavioral signals + high burnoutRisk
  | "self_doubt"        // identity_doubt intent OR emotion self_doubt
  | "overwhelmed"       // overwhelmed emotion OR too many open topics
  | "excuse_active"     // excuse_loop pattern + excuse signal this turn
  | "calibration_gap"   // masteryProbability vs confidence gap > 0.25 on mentioned topic
  | "comparison_trap"   // comparison_trap pattern + signal this turn
  | "neutral";

// ── Numeric scores ────────────────────────────────────────────────────────────
export interface AcademicScores {
  engagement:    number;  // 0-100, study frequency vs plan
  confidence:    number;  // 0-100, self-assessed
  momentum:      number;  // 0-100, 7-day weighted streak
  burnoutRisk:   number;  // 0-100, composite risk score
  planAdherence: number;  // 0-100, completed vs scheduled
  retention:     number;  // 0-100, avg retention across active topics
}

// ── Hard directives (pre-computed before LLM runs) ────────────────────────────
// SKILL.md §10.3 — enforced structurally in Decision Graph, not by LLM instruction.
export interface HardDirectives {
  noStudyPressure:  boolean;  // burnoutRisk > 70 OR mode = recovery
  examCrisisMode:   boolean;  // daysUntilExam < 3
  planFreezeMode:   boolean;  // daysUntilExam < 1
  calibrationAlert: boolean;  // calibrationGap > 0.25 on mentioned topic
  noChallenging:    boolean;  // SELF_DOUBT momentary state
  recoveryMode:     boolean;  // consecutiveMisses > 5 AND NOT examCrisisMode
  beginnerMode:     boolean;  // daysSinceJoined < 30
}

// ── Full state ────────────────────────────────────────────────────────────────
export interface AcademicState {
  semesterPhase:  SemesterPhase;
  activeMode:     ActiveMode;
  momentaryState: MomentaryState;

  scores: AcademicScores;
  hardDirectives: HardDirectives;

  // Derived metrics
  daysSinceJoined:      number;
  daysSinceLastSession: number;
  consecutiveMisses:    number;
  studyStreakDays:       number;
  daysUntilNextExam:    number | null;

  // History
  momentum7dTrend:  number[];  // engagement scores for last 7 days
  stateHistory:     AcademicStateSnapshot[];  // last 12 snapshots
}

export interface AcademicStateSnapshot {
  timestamp:     string;
  scores:        AcademicScores;
  semesterPhase: SemesterPhase;
  activeMode:    ActiveMode;
  momentaryState: MomentaryState;
}

// ── Decay rates (per inactive day, toward baseline) ───────────────────────────
export const STATE_DECAY_RATES: Record<keyof AcademicScores, number> = {
  engagement:    3.0,
  confidence:    0.5,
  momentum:      8.0,
  burnoutRisk:   -2.0,  // negative = burnout reduces with rest
  planAdherence: 2.5,
  retention:     1.0,
};

export const STATE_BASELINES: Record<keyof AcademicScores, number> = {
  engagement:    50,
  confidence:    60,
  momentum:      50,
  burnoutRisk:   10,
  planAdherence: 50,
  retention:     70,
};
