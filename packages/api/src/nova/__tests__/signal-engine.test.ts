// ─── Signal Engine unit tests ─────────────────────────────────────────────────
// Jest is the test runner — no import needed; describe/it/expect are globals.
import { extractSignals } from "../engines/signal-engine.js";
import type { AcademicState } from "../types/academic-state.types.js";
import { STATE_BASELINES } from "../types/academic-state.types.js";

const NEUTRAL_STATE: AcademicState = {
  semesterPhase:  "beginning",
  activeMode:     "standard",
  momentaryState: "neutral",
  scores:         { ...STATE_BASELINES },
  hardDirectives: {
    noStudyPressure: false, examCrisisMode: false, planFreezeMode: false,
    calibrationAlert: false, noChallenging: false, recoveryMode: false, beginnerMode: false,
  },
  daysSinceJoined:      30,
  daysSinceLastSession: 0,
  consecutiveMisses:    0,
  studyStreakDays:       3,
  daysUntilNextExam:    null,
  momentum7dTrend:      [60, 70, 80, 70, 60, 50, 80],
  stateHistory:         [],
};

describe("Signal Engine", () => {
  describe("study_report signal", () => {
    it("detects 'finished chapter'", () => {
      const out = extractSignals("I finished chapter 5 today", NEUTRAL_STATE);
      expect(out.detectedSignals).toContainEqual(expect.objectContaining({ type: "study_report" }));
    });

    it("detects 'reviewed notes'", () => {
      const out = extractSignals("I reviewed my notes for 2 hours", NEUTRAL_STATE);
      expect(out.detectedSignals.some(s => s.type === "study_report")).toBe(true);
    });

    it("adds positive state updates for engagement", () => {
      const out = extractSignals("Studied chapter 3 lecture material", NEUTRAL_STATE);
      const engagementUpdate = out.stateUpdates.find(u => u.field === "engagement");
      expect(engagementUpdate?.delta).toBeGreaterThan(0);
    });

    it("emits evidence only — no memory write instruction (SKILL.md §11.7)", () => {
      const out = extractSignals("I completed the exercises for chapter 2", NEUTRAL_STATE);
      expect(out).not.toHaveProperty("memoryWrites");
      expect(Object.keys(out).sort()).toEqual(["detectedSignals", "stateUpdates"]);
    });
  });

  describe("study_skip signal", () => {
    it("detects 'didn't study'", () => {
      const out = extractSignals("I didn't study at all today", NEUTRAL_STATE);
      expect(out.detectedSignals.some(s => s.type === "study_skip")).toBe(true);
    });

    it("detects 'missed class'", () => {
      const out = extractSignals("I missed the lecture today", NEUTRAL_STATE);
      expect(out.detectedSignals.some(s => s.type === "study_skip")).toBe(true);
    });

    it("adds negative engagement delta", () => {
      const out = extractSignals("I skipped studying today", NEUTRAL_STATE);
      const engDelta = out.stateUpdates.find(u => u.field === "engagement");
      expect(engDelta?.delta).toBeLessThan(0);
    });
  });

  describe("commitment signal", () => {
    it("detects 'I'll study'", () => {
      const out = extractSignals("I'll study chapter 4 tonight", NEUTRAL_STATE);
      expect(out.detectedSignals.some(s => s.type === "commitment")).toBe(true);
    });

    it("reports the matched text as evidence", () => {
      const out = extractSignals("I'm going to review everything this weekend", NEUTRAL_STATE);
      const signal = out.detectedSignals.find(s => s.type === "commitment");
      expect(signal?.evidence.length).toBeGreaterThan(0);
    });
  });

  describe("burnout signal", () => {
    it("detects exhaustion", () => {
      const out = extractSignals("I'm completely burned out, I can't go on", NEUTRAL_STATE);
      expect(out.detectedSignals.some(s => s.type === "burnout_behavioral")).toBe(true);
    });

    it("raises burnoutRisk delta significantly", () => {
      const out = extractSignals("I'm burned out and I don't care anymore", NEUTRAL_STATE);
      const burnoutDelta = out.stateUpdates.find(u => u.field === "burnoutRisk");
      expect(burnoutDelta?.delta).toBeGreaterThan(5);
    });
  });

  describe("clean report bonus", () => {
    it("adds extra adherence when report with no miss", () => {
      const out = extractSignals("I finished reviewing chapter 3", NEUTRAL_STATE);
      const extra = out.stateUpdates.filter(u => u.field === "planAdherence" && u.reason.includes("clean_report"));
      expect(extra.length).toBe(1);
    });

    it("does NOT add bonus when report + skip same turn", () => {
      const out = extractSignals("I finished chapter 3 but I skipped the lecture", NEUTRAL_STATE);
      const extra = out.stateUpdates.filter(u => u.reason?.includes("clean_report"));
      expect(extra.length).toBe(0);
    });
  });

  describe("ownership — what signal engine must NOT do", () => {
    it("returns no reply text", () => {
      const out = extractSignals("I studied so much today!", NEUTRAL_STATE);
      expect(out).not.toHaveProperty("reply");
    });

    it("has no emotion classification", () => {
      const out = extractSignals("I'm feeling great about studying today", NEUTRAL_STATE);
      expect(out.detectedSignals.every(s => s.type !== ("emotion" as any))).toBe(true);
    });
  });
});
