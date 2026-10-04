// ─── Proactive Decision Graph tests ──────────────────────────────────────────
import { runProactiveDecisionGraph } from "../decision/proactive-decision-graph.js";
import type { InterventionDecision, MomentumState } from "../types/proactive.types.js";
import type { AcademicState } from "../types/academic-state.types.js";
import { STATE_BASELINES } from "../types/academic-state.types.js";
import type { NovaRealityFact } from "../types/reality.types.js";

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

function intervention(overrides: Partial<InterventionDecision> = {}): InterventionDecision {
  return {
    type:          "study_reminder",
    reason:        "morning study window",
    priority:      5,
    confidence:    0.7,
    constraints:   [],
    cooldownHours: 4,
    shouldFire:    true,
    ...overrides,
  };
}

function healthFact(): NovaRealityFact {
  return {
    id:          "r1",
    category:    "health_constraint",
    description: "flu",
    confidence:  0.9,
    relevance:   0.9,
    expiresAt:   new Date(Date.now() + 7 * 86_400_000),
    sourceText:  null,
  };
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    intervention:    intervention(),
    academicState:   STANDARD_STATE,
    momentum:        STABLE_MOMENTUM,
    realityFacts:    [] as NovaRealityFact[],
    hasActiveSession: false,
    studiedToday:    false,
    isInCooldown:    false,
    messagedRecently: false,
    isQuietHours:    false,
    ...overrides,
  };
}

describe("Proactive Decision Graph", () => {
  describe("approval", () => {
    it("approves a valid study_reminder with no blocks", () => {
      const out = runProactiveDecisionGraph(baseInput());
      expect(out.approved).toBe(true);
      expect(out.finalInterventionType).toBe("study_reminder");
    });
  });

  describe("Gate 1 — quiet hours", () => {
    it("suppresses all interventions during quiet hours", () => {
      const out = runProactiveDecisionGraph(baseInput({ isQuietHours: true }));
      expect(out.approved).toBe(false);
      expect(out.suppressReason).toContain("quiet hours");
    });
  });

  describe("Gate 2 — recently messaged", () => {
    it("suppresses when student messaged recently", () => {
      const out = runProactiveDecisionGraph(baseInput({ messagedRecently: true }));
      expect(out.approved).toBe(false);
      expect(out.suppressReason).toContain("active in conversation");
    });
  });

  describe("Gate 3 — cooldown", () => {
    it("suppresses when cooldown is active", () => {
      const out = runProactiveDecisionGraph(baseInput({ isInCooldown: true }));
      expect(out.approved).toBe(false);
      expect(out.suppressReason).toContain("cooldown");
    });
  });

  describe("Gate 4 — health constraint", () => {
    it("suppresses study_reminder when health constraint is active", () => {
      const out = runProactiveDecisionGraph(baseInput({
        realityFacts: [healthFact()],
        intervention: intervention({ type: "study_reminder" }),
      }));
      expect(out.approved).toBe(false);
      expect(out.suppressReason).toContain("health");
    });

    it("does NOT suppress morning_brief for health constraint", () => {
      const out = runProactiveDecisionGraph(baseInput({
        realityFacts: [healthFact()],
        intervention: intervention({ type: "morning_brief" }),
      }));
      expect(out.approved).toBe(true);
    });

    it("does NOT suppress exam_countdown for health constraint", () => {
      const out = runProactiveDecisionGraph(baseInput({
        realityFacts: [healthFact()],
        intervention: intervention({ type: "exam_countdown", priority: 10 }),
      }));
      expect(out.approved).toBe(true);
    });
  });

  describe("Gate 5 — burnout override", () => {
    it("converts study_reminder to burnout_prevention when burnout risk >= 75", () => {
      const state: AcademicState = {
        ...STANDARD_STATE,
        scores: { ...STATE_BASELINES, burnoutRisk: 80 },
      };
      const out = runProactiveDecisionGraph(baseInput({
        academicState: state,
        intervention:  intervention({ type: "study_reminder" }),
      }));
      expect(out.approved).toBe(true);
      expect(out.finalInterventionType).toBe("burnout_prevention");
      expect(out.overrideReason).toContain("burnout");
    });

    it("does NOT convert missed_session when burnout risk is 60", () => {
      const state: AcademicState = {
        ...STANDARD_STATE,
        scores: { ...STATE_BASELINES, burnoutRisk: 60 },
      };
      const out = runProactiveDecisionGraph(baseInput({
        academicState: state,
        intervention:  intervention({ type: "missed_session" }),
      }));
      expect(out.finalInterventionType).toBe("missed_session");
    });
  });

  describe("Gate 7 — exam tomorrow override", () => {
    it("overrides any intervention to exam_countdown when exam is tomorrow", () => {
      const state: AcademicState = { ...STANDARD_STATE, daysUntilNextExam: 1 };
      const out = runProactiveDecisionGraph(baseInput({
        academicState: state,
        intervention:  intervention({ type: "morning_brief" }),
      }));
      expect(out.approved).toBe(true);
      expect(out.finalInterventionType).toBe("exam_countdown");
      expect(out.priority).toBe(10);
    });

    it("does not override if intervention is already exam_countdown", () => {
      const state: AcademicState = { ...STANDARD_STATE, daysUntilNextExam: 1 };
      const out = runProactiveDecisionGraph(baseInput({
        academicState: state,
        intervention:  intervention({ type: "exam_countdown", priority: 10 }),
      }));
      expect(out.finalInterventionType).toBe("exam_countdown");
      expect(out.overrideReason).toBeNull();
    });
  });

  describe("Gate 8 — active session", () => {
    it("suppresses study_reminder when student is in active session", () => {
      const out = runProactiveDecisionGraph(baseInput({
        hasActiveSession: true,
        intervention:     intervention({ type: "study_reminder" }),
      }));
      expect(out.approved).toBe(false);
      expect(out.suppressReason).toContain("active session");
    });

    it("approves mid_session_support when student is in active session", () => {
      const out = runProactiveDecisionGraph(baseInput({
        hasActiveSession: true,
        intervention:     intervention({ type: "mid_session_support" }),
      }));
      expect(out.approved).toBe(true);
    });
  });

  describe("Gate 9 — already studied today", () => {
    it("suppresses study_reminder when studied today", () => {
      const out = runProactiveDecisionGraph(baseInput({
        studiedToday: true,
        intervention: intervention({ type: "study_reminder" }),
      }));
      expect(out.approved).toBe(false);
      expect(out.suppressReason).toContain("already studied");
    });

    it("suppresses morning_brief when studied today", () => {
      const out = runProactiveDecisionGraph(baseInput({
        studiedToday: true,
        intervention: intervention({ type: "morning_brief" }),
      }));
      expect(out.approved).toBe(false);
    });

    it("does NOT suppress reflection_reminder when studied today", () => {
      const out = runProactiveDecisionGraph(baseInput({
        studiedToday: true,
        intervention: intervention({ type: "reflection_reminder" }),
      }));
      expect(out.approved).toBe(true);
    });
  });

  describe("Gate 10 — milestone during misses", () => {
    it("suppresses milestone_celebration when 3+ consecutive misses", () => {
      const momentum: MomentumState = { ...STABLE_MOMENTUM, consecutiveMisses: 3 };
      const out = runProactiveDecisionGraph(baseInput({
        momentum,
        intervention: intervention({ type: "milestone_celebration" }),
      }));
      expect(out.approved).toBe(false);
      expect(out.suppressReason).toContain("misses");
    });
  });

  describe("Gate 11 — no active session for check-in", () => {
    it("suppresses session_check_in when no active session", () => {
      const out = runProactiveDecisionGraph(baseInput({
        hasActiveSession: false,
        intervention:     intervention({ type: "session_check_in" }),
      }));
      expect(out.approved).toBe(false);
      expect(out.suppressReason).toContain("no active session");
    });
  });

  describe("priority ordering", () => {
    it("exam override produces priority 10", () => {
      const state: AcademicState = { ...STANDARD_STATE, daysUntilNextExam: 1 };
      const out = runProactiveDecisionGraph(baseInput({
        academicState: state,
        intervention:  intervention({ type: "morning_brief", priority: 5 }),
      }));
      expect(out.priority).toBe(10);
    });

    it("burnout override produces priority 8", () => {
      const state: AcademicState = {
        ...STANDARD_STATE,
        scores: { ...STATE_BASELINES, burnoutRisk: 80 },
      };
      const out = runProactiveDecisionGraph(baseInput({
        academicState: state,
        intervention:  intervention({ type: "study_reminder", priority: 5 }),
      }));
      expect(out.priority).toBe(8);
    });
  });
});
