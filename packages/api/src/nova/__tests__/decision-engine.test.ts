// ─── Decision Engine unit tests ────────────────────────────────────────────────
// Jest globals — no import needed.
import { runDecisionEngine } from "../decision/decision-engine.js";
import type { DecisionEngineInput } from "../types/engine.types.js";
import { STATE_BASELINES } from "../types/academic-state.types.js";
import type { AcademicState } from "../types/academic-state.types.js";

const BASE_STATE: AcademicState = {
  semesterPhase:  "midterm",
  activeMode:     "standard",
  momentaryState: "neutral",
  scores:         { ...STATE_BASELINES },
  hardDirectives: {
    noStudyPressure: false, examCrisisMode: false, planFreezeMode: false,
    calibrationAlert: false, noChallenging: false, recoveryMode: false, beginnerMode: false,
  },
  daysSinceJoined:      60,
  daysSinceLastSession: 1,
  consecutiveMisses:    0,
  studyStreakDays:       3,
  daysUntilNextExam:    null,
  momentum7dTrend:      [60, 70, 50, 80, 60, 70, 80],
  stateHistory:         [],
};

const BASE_PATTERNS = {
  detectedPatterns: [], dominantPattern: null,
  analysisRunAt: new Date(), messagesSinceLastRun: 0,
};

function makeInput(overrides: Partial<DecisionEngineInput>): DecisionEngineInput {
  return {
    understanding: {
      intent: "general_chat", emotion: "neutral", topic: null, topicConfidence: 0,
      disclosureClass: "none", ambiguityScore: 0.2, routingSignal: "coaching_only", rawText: "",
    },
    state:    BASE_STATE,
    memories: [],
    signals:  [],
    patterns: BASE_PATTERNS,
    ...overrides,
  };
}

describe("Decision Engine", () => {
  describe("Hard blocks", () => {
    it("blocks challenge when noChallenging directive is active", () => {
      const input = makeInput({
        state: { ...BASE_STATE, hardDirectives: { ...BASE_STATE.hardDirectives, noChallenging: true } },
        understanding: { ...makeInput({}).understanding, intent: "excuse", emotion: "neutral" },
      });
      const out = runDecisionEngine(input);
      expect(out.blockedInterventions).toContain("challenge");
      expect(out.intervention).not.toBe("challenge");
    });

    it("blocks accountability when noStudyPressure is active", () => {
      const input = makeInput({
        state: { ...BASE_STATE,
          hardDirectives: { ...BASE_STATE.hardDirectives, noStudyPressure: true },
          momentaryState: "burned_out",
          scores: { ...STATE_BASELINES, burnoutRisk: 75 },
        },
      });
      const out = runDecisionEngine(input);
      expect(out.blockedInterventions).toContain("accountability");
    });
  });

  describe("Intent-driven scores", () => {
    it("favors empathize for emotional_vent intent", () => {
      const input = makeInput({
        understanding: { ...makeInput({}).understanding, intent: "emotional_vent", emotion: "overwhelmed" },
      });
      const out = runDecisionEngine(input);
      expect(out.intervention).toBe("empathize");
    });

    it("favors celebrate_win for achievement + long streak", () => {
      const input = makeInput({
        understanding: { ...makeInput({}).understanding, intent: "study_report" },
        state: { ...BASE_STATE, studyStreakDays: 10 },
        signals: [{ type: "achievement", intensity: 0.8, valence: "positive", confidence: 0.9, evidence: "aced it" }],
      });
      const out = runDecisionEngine(input);
      expect(out.intervention).toBe("celebrate_win");
    });

    it("favors reinforce_identity for identity_doubt", () => {
      const input = makeInput({
        understanding: { ...makeInput({}).understanding, intent: "identity_doubt", emotion: "identity_threat" },
      });
      const out = runDecisionEngine(input);
      expect(out.intervention).toBe("reinforce_identity");
    });
  });

  describe("Output contract", () => {
    it("always returns an intervention", () => {
      const out = runDecisionEngine(makeInput({}));
      expect(out.intervention).toBeTruthy();
    });

    it("always returns top 5 candidates", () => {
      const out = runDecisionEngine(makeInput({}));
      expect(out.candidates.length).toBeGreaterThanOrEqual(1);
      expect(out.candidates.length).toBeLessThanOrEqual(5);
    });

    it("evidence is a non-empty string", () => {
      const out = runDecisionEngine(makeInput({}));
      expect(typeof out.evidence).toBe("string");
      expect(out.evidence.length).toBeGreaterThan(0);
    });
  });
});
