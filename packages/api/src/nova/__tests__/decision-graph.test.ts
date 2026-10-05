// ─── Decision Graph unit tests ────────────────────────────────────────────────
// Jest globals — no import needed.
import { runDecisionGraph } from "../decision/decision-graph.js";
import { STATE_BASELINES } from "../types/academic-state.types.js";
import type { AcademicState } from "../types/academic-state.types.js";
import type { SignalEngineOutput } from "../types/engine.types.js";

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
  momentum7dTrend:      [60, 60, 60, 60, 60, 60, 60],
  stateHistory:         [],
};

const EMPTY_SIGNALS: SignalEngineOutput = { detectedSignals: [], stateUpdates: [] };
const EMPTY_PATTERNS = {
  detectedPatterns: [], dominantPattern: null, analysisRunAt: new Date(), messagesSinceLastRun: 0,
};

const BASE_UNDERSTANDING = {
  intent: "general_chat" as const, emotion: "neutral" as const, topic: null,
  topicConfidence: 0, disclosureClass: "none" as const, ambiguityScore: 0.2,
  routingSignal: "coaching_only" as const, rawText: "",
};

describe("Decision Graph", () => {
  describe("N1 — Crisis Gate", () => {
    it("returns crisis_redirect for distressed + emotional_vent", () => {
      const out = runDecisionGraph(
        { ...BASE_UNDERSTANDING, intent: "emotional_vent", emotion: "distressed" },
        BASE_STATE, EMPTY_SIGNALS, EMPTY_PATTERNS, [],
      );
      expect(out.selectedIntervention).toBe("crisis_redirect");
      expect(out.graphNode).toBe("N1");
    });

    it("returns empathize for life_event disclosure", () => {
      const out = runDecisionGraph(
        { ...BASE_UNDERSTANDING, intent: "life_disclosure", disclosureClass: "life_event" },
        BASE_STATE, EMPTY_SIGNALS, EMPTY_PATTERNS, [],
      );
      expect(out.selectedIntervention).toBe("empathize");
      expect(out.graphNode).toBe("N1");
    });
  });

  describe("N2 — Directive Gate", () => {
    it("returns prevent_burnout in recovery mode", () => {
      const state = {
        ...BASE_STATE,
        hardDirectives: { ...BASE_STATE.hardDirectives, recoveryMode: true },
        consecutiveMisses: 6,
      };
      const out = runDecisionGraph(BASE_UNDERSTANDING, state, EMPTY_SIGNALS, EMPTY_PATTERNS, []);
      expect(out.selectedIntervention).toBe("prevent_burnout");
      expect(out.graphNode).toBe("N2");
    });

    it("returns exam-appropriate intervention in crisis mode", () => {
      const state = {
        ...BASE_STATE,
        hardDirectives: { ...BASE_STATE.hardDirectives, examCrisisMode: true },
        daysUntilNextExam: 1,
      };
      const out = runDecisionGraph(BASE_UNDERSTANDING, state, EMPTY_SIGNALS, EMPTY_PATTERNS, []);
      expect(["empathize", "reduce_friction"]).toContain(out.selectedIntervention);
      expect(out.graphNode).toBe("N2");
    });
  });

  describe("N5 — Momentum Gate", () => {
    it("celebrates win when streak is 5+ days", () => {
      const state = { ...BASE_STATE, studyStreakDays: 7, momentaryState: "momentum" as const };
      const out = runDecisionGraph(
        { ...BASE_UNDERSTANDING, intent: "study_report" },
        state, EMPTY_SIGNALS, EMPTY_PATTERNS, [],
      );
      expect(out.selectedIntervention).toBe("celebrate_win");
      expect(out.graphNode).toBe("N5");
    });

    it("fires re_engagement after 5+ day gap", () => {
      const state = { ...BASE_STATE, daysSinceLastSession: 8, momentaryState: "disengaged" as const };
      const out = runDecisionGraph(BASE_UNDERSTANDING, state, EMPTY_SIGNALS, EMPTY_PATTERNS, []);
      expect(out.selectedIntervention).toBe("re_engagement");
      expect(out.graphNode).toBe("N5");
    });
  });

  describe("N6 — Signal Gate", () => {
    it("handles study_report signal", () => {
      const signals: SignalEngineOutput = {
        detectedSignals: [{ type: "study_report", intensity: 0.75, valence: "positive", confidence: 0.9, evidence: "finished" }],
        stateUpdates: [],
      };
      const out = runDecisionGraph(
        { ...BASE_UNDERSTANDING, intent: "study_report" },
        BASE_STATE, signals, EMPTY_PATTERNS, [],
      );
      expect(out.graphNode).toBe("N6");
    });

    it("empathizes on skip when emotional", () => {
      const signals: SignalEngineOutput = {
        detectedSignals: [{ type: "study_skip", intensity: 0.75, valence: "negative", confidence: 0.9, evidence: "didn't study" }],
        stateUpdates: [],
      };
      const out = runDecisionGraph(
        { ...BASE_UNDERSTANDING, intent: "study_skip_report", emotion: "discouraged" },
        BASE_STATE, signals, EMPTY_PATTERNS, [],
      );
      expect(out.selectedIntervention).toBe("empathize");
      expect(out.graphNode).toBe("N6");
    });
  });

  describe("Output contract", () => {
    it("always returns a graphNode", () => {
      const out = runDecisionGraph(BASE_UNDERSTANDING, BASE_STATE, EMPTY_SIGNALS, EMPTY_PATTERNS, []);
      expect(["N1","N2","N3","N4","N5","N6","N7"]).toContain(out.graphNode);
    });

    it("always returns a confidence 0-1", () => {
      const out = runDecisionGraph(BASE_UNDERSTANDING, BASE_STATE, EMPTY_SIGNALS, EMPTY_PATTERNS, []);
      expect(out.confidence).toBeGreaterThanOrEqual(0);
      expect(out.confidence).toBeLessThanOrEqual(1);
    });
  });
});
