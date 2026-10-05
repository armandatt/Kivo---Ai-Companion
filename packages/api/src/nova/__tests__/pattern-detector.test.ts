// ─── Pattern Detector unit tests ──────────────────────────────────────────────
// Jest globals — no import needed.
import { runPatternDetector } from "../engines/pattern-detector.js";
import type { PatternDetectorInput } from "../engines/pattern-detector.js";

const NOW = new Date("2026-06-15T10:00:00Z");

function daysAgo(n: number): Date {
  const d = new Date(NOW);
  d.setDate(d.getDate() - n);
  return d;
}

const BASE_INPUT: PatternDetectorInput = {
  studySessions:        [],
  signalHistory:        [],
  topicMasteries:       [],
  priorPatterns:        [],
  messagesSinceLastRun: 5,
};

describe("Pattern Detector", () => {
  describe("ghosting", () => {
    it("detects ghosting when no sessions for 5+ days", () => {
      const input: PatternDetectorInput = {
        ...BASE_INPUT,
        studySessions: [
          { sessionDate: daysAgo(7), status: "completed", durationMinutes: 60 },
        ],
      };
      const out = runPatternDetector(input, NOW);
      expect(out.detectedPatterns.some(p => p.type === "ghosting")).toBe(true);
    });

    it("does not detect ghosting for a new student with no sessions at all", () => {
      const out = runPatternDetector({ ...BASE_INPUT, studySessions: [] }, NOW);
      expect(out.detectedPatterns.some(p => p.type === "ghosting")).toBe(false);
    });

    it("does not detect ghosting when the only records are skipped sessions", () => {
      const out = runPatternDetector({
        ...BASE_INPUT,
        studySessions: [{ sessionDate: daysAgo(9), status: "skipped", durationMinutes: 0 }],
      }, NOW);
      expect(out.detectedPatterns.some(p => p.type === "ghosting")).toBe(false);
    });

    it("confidence grows with the length of the absence", () => {
      const at = (days: number) => runPatternDetector({
        ...BASE_INPUT,
        studySessions: [{ sessionDate: daysAgo(days), status: "completed", durationMinutes: 60 }],
      }, NOW).detectedPatterns.find(p => p.type === "ghosting")!.confidence;
      expect(at(7)).toBeLessThan(at(14));
      expect(at(60)).toBe(0.95);
    });

    it("does not detect ghosting with recent session", () => {
      const input: PatternDetectorInput = {
        ...BASE_INPUT,
        studySessions: [
          { sessionDate: daysAgo(2), status: "completed", durationMinutes: 60 },
        ],
      };
      const out = runPatternDetector(input, NOW);
      expect(out.detectedPatterns.some(p => p.type === "ghosting")).toBe(false);
    });
  });

  describe("excuse_loop", () => {
    it("detects when 3+ excuse signals in last 15 messages", () => {
      const input: PatternDetectorInput = {
        ...BASE_INPUT,
        signalHistory: [
          { timestamp: daysAgo(0), signals: ["excuse"] },
          { timestamp: daysAgo(1), signals: ["excuse"] },
          { timestamp: daysAgo(2), signals: ["excuse"] },
          { timestamp: daysAgo(3), signals: ["study_report"] },
        ],
      };
      const out = runPatternDetector(input, NOW);
      expect(out.detectedPatterns.some(p => p.type === "excuse_loop")).toBe(true);
    });
  });

  describe("calibration_delusion", () => {
    it("detects when confidence >> mastery", () => {
      const input: PatternDetectorInput = {
        ...BASE_INPUT,
        topicMasteries: [
          {
            topicName:          "Integration",
            masteryProbability: 0.30,
            confidenceReported: 0.85,
            reviewCount:        5,
            lastStudiedAt:      daysAgo(3),
          },
        ],
      };
      const out = runPatternDetector(input, NOW);
      expect(out.detectedPatterns.some(p => p.type === "calibration_delusion")).toBe(true);
    });

    it("does not detect when calibration is fine", () => {
      const input: PatternDetectorInput = {
        ...BASE_INPUT,
        topicMasteries: [
          {
            topicName:          "Integration",
            masteryProbability: 0.75,
            confidenceReported: 0.70,
            reviewCount:        5,
            lastStudiedAt:      daysAgo(3),
          },
        ],
      };
      const out = runPatternDetector(input, NOW);
      expect(out.detectedPatterns.some(p => p.type === "calibration_delusion")).toBe(false);
    });
  });

  describe("overplanning", () => {
    it("detects many commitments + no sessions", () => {
      const signals = Array.from({ length: 10 }, (_, i) => ({
        timestamp: daysAgo(i),
        signals:   i < 4 ? ["commitment"] : ["general_chat"],
      }));
      const input: PatternDetectorInput = {
        ...BASE_INPUT,
        signalHistory: signals,
        studySessions: [],
      };
      const out = runPatternDetector(input, NOW);
      expect(out.detectedPatterns.some(p => p.type === "overplanning")).toBe(true);
    });
  });

  describe("dominantPattern", () => {
    it("picks highest severity", () => {
      const input: PatternDetectorInput = {
        ...BASE_INPUT,
        studySessions: [
          { sessionDate: daysAgo(10), status: "completed", durationMinutes: 60 },
        ],
        signalHistory: [
          { timestamp: daysAgo(0), signals: ["excuse"] },
          { timestamp: daysAgo(1), signals: ["excuse"] },
          { timestamp: daysAgo(2), signals: ["excuse"] },
        ],
      };
      const out = runPatternDetector(input, NOW);
      expect(out.dominantPattern).not.toBeNull();
    });
  });

  describe("Output contract", () => {
    it("always returns analysisRunAt", () => {
      const out = runPatternDetector(BASE_INPUT, NOW);
      expect(out.analysisRunAt).toBeInstanceOf(Date);
    });

    it("returns no reply", () => {
      const out = runPatternDetector(BASE_INPUT, NOW);
      expect(out).not.toHaveProperty("reply");
    });
  });
});
