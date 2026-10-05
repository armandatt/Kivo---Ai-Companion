// ─── Intervention Engine tests ────────────────────────────────────────────────
import { computeIntervention } from "../engines/intervention-engine.js";
import type { SchedulingDecision, MomentumState } from "../types/proactive.types.js";
import type { AcademicState } from "../types/academic-state.types.js";
import { STATE_BASELINES } from "../types/academic-state.types.js";
import type { NovaRealityFact } from "../types/reality.types.js";

const NOW = new Date("2024-11-15T10:00:00Z");

const STANDARD_STATE: AcademicState = {
  semesterPhase:      "beginning",
  activeMode:         "standard",
  momentaryState:     "neutral",
  scores:             { ...STATE_BASELINES },
  hardDirectives: {
    noStudyPressure: false, examCrisisMode: false, planFreezeMode: false,
    calibrationAlert: false, noChallenging: false, recoveryMode: false, beginnerMode: false,
  },
  daysSinceJoined:      60,
  daysSinceLastSession: 1,
  consecutiveMisses:    0,
  studyStreakDays:       4,
  daysUntilNextExam:    null,
  momentum7dTrend:      [60, 70, 80, 70, 60, 50, 80],
  stateHistory:         [],
};

const STABLE_MOMENTUM: MomentumState = {
  currentMomentum:      "moderate",
  weeklyConsistency:    "good",
  currentStreak:        4,
  lastSessionDaysAgo:   1,
  consecutiveMisses:    0,
  recoveryTrend:        "stable",
  motivationTrend:      "stable",
  studyRhythm:          "morning",
  averageSessionMinutes: 60,
  sessionsLast7Days:    4,
};

function scheduling(overrides: Partial<SchedulingDecision> = {}): SchedulingDecision {
  return {
    eventType:      "study_reminder",
    reason:         "morning study window",
    priority:       5,
    scheduledFor:   NOW,
    isUrgent:       false,
    triggeringFact: null,
    ...overrides,
  };
}

function healthFact(): NovaRealityFact {
  return {
    id:          "reality-1",
    category:    "health",
    subtype:     "illness",
    description: "recovering from illness",
    confidence:  0.9,
    relevance:   0.9,
    expiresAt:   new Date(NOW.getTime() + 7 * 86_400_000),
    sourceText:  null,
  };
}

describe("Intervention Engine", () => {
  describe("shouldFire", () => {
    it("fires when event is valid and no blocks", () => {
      const out = computeIntervention({
        scheduling: scheduling(),
        momentum:   STABLE_MOMENTUM,
        academicState: STANDARD_STATE,
        realityFacts:  [],
      });
      expect(out.shouldFire).toBe(true);
    });

    it("does not fire when eventType is none", () => {
      const out = computeIntervention({
        scheduling: scheduling({ eventType: "none", priority: 0 }),
        momentum:   STABLE_MOMENTUM,
        academicState: STANDARD_STATE,
        realityFacts:  [],
      });
      expect(out.shouldFire).toBe(false);
    });
  });

  describe("reality block", () => {
    it("blocks study_reminder when health constraint is active", () => {
      const out = computeIntervention({
        scheduling: scheduling({ eventType: "study_reminder" }),
        momentum:   STABLE_MOMENTUM,
        academicState: STANDARD_STATE,
        realityFacts:  [healthFact()],
      });
      expect(out.shouldFire).toBe(false);
    });

    it("blocks missed_session when health constraint is active", () => {
      const out = computeIntervention({
        scheduling: scheduling({ eventType: "missed_session" }),
        momentum:   STABLE_MOMENTUM,
        academicState: STANDARD_STATE,
        realityFacts:  [healthFact()],
      });
      expect(out.shouldFire).toBe(false);
    });

    it("does not block exam_countdown when health constraint is active", () => {
      const out = computeIntervention({
        scheduling: scheduling({ eventType: "exam_countdown", priority: 10, isUrgent: true }),
        momentum:   STABLE_MOMENTUM,
        academicState: STANDARD_STATE,
        realityFacts:  [healthFact()],
      });
      expect(out.shouldFire).toBe(true);
    });

    it("does not block burnout_prevention when health constraint is active", () => {
      const out = computeIntervention({
        scheduling: scheduling({ eventType: "burnout_prevention", priority: 8 }),
        momentum:   STABLE_MOMENTUM,
        academicState: STANDARD_STATE,
        realityFacts:  [healthFact()],
      });
      expect(out.shouldFire).toBe(true);
    });
  });

  describe("constraints", () => {
    it("includes exam_mode when examCrisisMode directive is active", () => {
      const state: AcademicState = {
        ...STANDARD_STATE,
        hardDirectives: { ...STANDARD_STATE.hardDirectives, examCrisisMode: true },
      };
      const out = computeIntervention({
        scheduling: scheduling({ eventType: "exam_countdown", priority: 10 }),
        momentum:   STABLE_MOMENTUM,
        academicState: state,
        realityFacts:  [],
      });
      expect(out.constraints).toContain("exam_mode");
    });

    it("includes burnout_risk when burnout score >= 70", () => {
      const state: AcademicState = {
        ...STANDARD_STATE,
        scores: { ...STATE_BASELINES, burnoutRisk: 75 },
      };
      const out = computeIntervention({
        scheduling: scheduling({ eventType: "burnout_prevention", priority: 8 }),
        momentum:   STABLE_MOMENTUM,
        academicState: state,
        realityFacts:  [],
      });
      expect(out.constraints).toContain("burnout_risk");
    });

    it("includes health_constraint from reality facts", () => {
      const out = computeIntervention({
        scheduling: scheduling({ eventType: "exam_countdown", priority: 10 }),
        momentum:   STABLE_MOMENTUM,
        academicState: STANDARD_STATE,
        realityFacts:  [healthFact()],
      });
      expect(out.constraints).toContain("health_constraint");
    });
  });

  describe("confidence", () => {
    it("higher confidence for urgent exams", () => {
      const urgentOut = computeIntervention({
        scheduling: scheduling({ eventType: "exam_countdown", priority: 10, isUrgent: true }),
        momentum:   STABLE_MOMENTUM,
        academicState: STANDARD_STATE,
        realityFacts:  [],
      });
      const normalOut = computeIntervention({
        scheduling: scheduling({ priority: 3 }),
        momentum:   STABLE_MOMENTUM,
        academicState: STANDARD_STATE,
        realityFacts:  [],
      });
      expect(urgentOut.confidence).toBeGreaterThan(normalOut.confidence);
    });

    it("cooldown hours match the intervention type", () => {
      const out = computeIntervention({
        scheduling: scheduling({ eventType: "morning_brief", priority: 5 }),
        momentum:   STABLE_MOMENTUM,
        academicState: STANDARD_STATE,
        realityFacts:  [],
      });
      expect(out.cooldownHours).toBe(22);
    });
  });
});
