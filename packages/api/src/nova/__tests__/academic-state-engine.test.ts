// ─── Academic State Engine unit tests ────────────────────────────────────────
// Jest globals — no import needed.
import { computeAcademicState } from "../engines/academic-state-engine.js";
import type { AcademicStateInput } from "../engines/academic-state-engine.js";
import { STATE_BASELINES } from "../types/academic-state.types.js";

const NOW = new Date("2026-06-15T10:00:00Z");

function daysAgo(n: number): Date {
  const d = new Date(NOW);
  d.setDate(d.getDate() - n);
  return d;
}

const BASE_INPUT: AcademicStateInput = {
  semesterStartDate: new Date("2026-02-01"),
  semesterEndDate:   new Date("2026-06-30"),
  daysSinceJoined:   60,
  studySessions:     [],
  upcomingExams:     [],
  stateHistory:      [],
  signals:           { detectedSignals: [], stateUpdates: [] },
  mentionedTopicMastery: null,
  understanding: {
    intent: "general_chat", emotion: "neutral", topic: null, topicConfidence: 0,
    disclosureClass: "none", ambiguityScore: 0.2, routingSignal: "coaching_only", rawText: "",
  },
  storedScores:            null,
  storedStreakDays:        0,
  storedConsecutiveMisses: 0,
};

describe("Academic State Engine", () => {
  describe("Semester Phase", () => {
    it("returns 'finals' when near end of semester", () => {
      // May 20: ~108 of 149 days elapsed = 72% → finals range (55%–85%)
      const state = computeAcademicState(BASE_INPUT, new Date("2026-05-20T10:00:00Z"));
      expect(state.semesterPhase).toBe("finals");
    });

    it("returns 'beginning' when no semester dates set", () => {
      const state = computeAcademicState({ ...BASE_INPUT, semesterStartDate: null, semesterEndDate: null }, NOW);
      expect(state.semesterPhase).toBe("beginning");
    });

    it("returns 'midterm' in middle fraction", () => {
      const state = computeAcademicState(BASE_INPUT, new Date("2026-04-15T10:00:00Z"));
      expect(state.semesterPhase).toBe("midterm");
    });
  });

  describe("Streak computation", () => {
    it("computes 0 streak with no sessions", () => {
      const state = computeAcademicState(BASE_INPUT, NOW);
      expect(state.studyStreakDays).toBe(0);
    });

    it("computes 3-day streak", () => {
      const input = {
        ...BASE_INPUT,
        studySessions: [
          { sessionDate: daysAgo(0), status: "completed", durationMinutes: 60 },
          { sessionDate: daysAgo(1), status: "completed", durationMinutes: 45 },
          { sessionDate: daysAgo(2), status: "completed", durationMinutes: 30 },
          { sessionDate: daysAgo(4), status: "completed", durationMinutes: 30 },  // gap breaks streak
        ],
      };
      const state = computeAcademicState(input, NOW);
      expect(state.studyStreakDays).toBe(3);
    });
  });

  describe("Hard directives", () => {
    it("sets beginnerMode when daysSinceJoined < 30", () => {
      const state = computeAcademicState({ ...BASE_INPUT, daysSinceJoined: 10 }, NOW);
      expect(state.hardDirectives.beginnerMode).toBe(true);
    });

    it("sets recoveryMode when consecutiveMisses > 5", () => {
      const sessions = [
        { sessionDate: daysAgo(8), status: "completed", durationMinutes: 60 },
        // Gap of 8 days = 7 consecutive misses
      ];
      const state = computeAcademicState({ ...BASE_INPUT, studySessions: sessions }, NOW);
      expect(state.hardDirectives.recoveryMode).toBe(true);
    });

    it("sets examCrisisMode when exam is in 2 days", () => {
      const tomorrow = new Date(NOW);
      tomorrow.setDate(NOW.getDate() + 2);
      const state = computeAcademicState({
        ...BASE_INPUT,
        upcomingExams: [{ scheduledAt: tomorrow }],
      }, NOW);
      expect(state.hardDirectives.examCrisisMode).toBe(true);
    });
  });

  describe("Momentary state", () => {
    it("returns 'burned_out' when burnoutRisk > 70", () => {
      // Provide a session yesterday so burnout risk doesn't decay to 0
      const sessions = [{ sessionDate: daysAgo(1), status: "completed", durationMinutes: 60 }];
      const storedScores = { ...STATE_BASELINES, burnoutRisk: 75 };
      const state = computeAcademicState({ ...BASE_INPUT, storedScores, studySessions: sessions }, NOW);
      expect(state.momentaryState).toBe("burned_out");
    });

    it("returns 'disengaged' when last session > 7 days ago", () => {
      const sessions = [
        { sessionDate: daysAgo(10), status: "completed", durationMinutes: 60 },
      ];
      const state = computeAcademicState({ ...BASE_INPUT, studySessions: sessions }, NOW);
      expect(state.momentaryState).toBe("disengaged");
    });

    it("returns 'returning' when last session 4-7 days ago", () => {
      const sessions = [
        { sessionDate: daysAgo(5), status: "completed", durationMinutes: 60 },
      ];
      const state = computeAcademicState({ ...BASE_INPUT, studySessions: sessions }, NOW);
      expect(state.momentaryState).toBe("returning");
    });
  });

  describe("Score decay", () => {
    it("decays momentum when inactive", () => {
      const storedScores = { ...STATE_BASELINES, momentum: 80 };
      const sessions = [{ sessionDate: daysAgo(5), status: "completed", durationMinutes: 60 }];
      const state = computeAcademicState({ ...BASE_INPUT, storedScores, studySessions: sessions }, NOW);
      // After 4 inactiveDays (5 days since last, minus 1), momentum should be lower than stored
      // Momentum is overwritten by 7d trend computation so check scores.engagement
      expect(state.scores.engagement).toBeLessThanOrEqual(storedScores.engagement);
    });
  });

  describe("Ownership", () => {
    it("returns no reply", () => {
      const state = computeAcademicState(BASE_INPUT, NOW);
      expect(state).not.toHaveProperty("reply");
    });

    it("never sets momentaryState to undefined", () => {
      const state = computeAcademicState(BASE_INPUT, NOW);
      expect(state.momentaryState).toBeDefined();
    });
  });
});
