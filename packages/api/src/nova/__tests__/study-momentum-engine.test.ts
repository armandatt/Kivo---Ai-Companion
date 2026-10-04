// ─── Study Momentum Engine tests ──────────────────────────────────────────────
import { computeMomentumState } from "../engines/study-momentum-engine.js";

const NOW = new Date("2024-11-15T10:00:00Z");

function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * 86_400_000);
}

function session(daysBack: number, durationMinutes = 60, hour = 9): { sessionDate: Date; durationMinutes: number; status: string } {
  const d = daysAgo(daysBack);
  d.setHours(hour, 0, 0, 0);
  return { sessionDate: d, durationMinutes, status: "completed" };
}

describe("Study Momentum Engine", () => {
  describe("currentMomentum", () => {
    it("high when streak >= 7 and sessions >= 5 last 7 days", () => {
      const sessions = [0, 1, 2, 3, 4, 5, 6].map(d => session(d));
      const out = computeMomentumState({ studySessions: sessions, consecutiveMisses: 0, studyStreakDays: 7, stateHistory: [], now: NOW });
      expect(out.currentMomentum).toBe("high");
    });

    it("moderate when streak >= 3 and sessions >= 3 last 7 days", () => {
      const sessions = [0, 1, 2].map(d => session(d));
      const out = computeMomentumState({ studySessions: sessions, consecutiveMisses: 0, studyStreakDays: 3, stateHistory: [], now: NOW });
      expect(out.currentMomentum).toBe("moderate");
    });

    it("low when only 1 session last 7 days", () => {
      const sessions = [session(0)];
      const out = computeMomentumState({ studySessions: sessions, consecutiveMisses: 0, studyStreakDays: 1, stateHistory: [], now: NOW });
      expect(out.currentMomentum).toBe("low");
    });

    it("critical when 5+ consecutive misses", () => {
      const out = computeMomentumState({ studySessions: [], consecutiveMisses: 5, studyStreakDays: 0, stateHistory: [], now: NOW });
      expect(out.currentMomentum).toBe("critical");
    });
  });

  describe("weeklyConsistency", () => {
    it("excellent when 6+ sessions in last 7 days", () => {
      const sessions = [0, 1, 2, 3, 4, 5].map(d => session(d));
      const out = computeMomentumState({ studySessions: sessions, consecutiveMisses: 0, studyStreakDays: 6, stateHistory: [], now: NOW });
      expect(out.weeklyConsistency).toBe("excellent");
    });

    it("poor when 0 sessions in last 7 days", () => {
      const out = computeMomentumState({ studySessions: [], consecutiveMisses: 7, studyStreakDays: 0, stateHistory: [], now: NOW });
      expect(out.weeklyConsistency).toBe("poor");
    });
  });

  describe("studyRhythm", () => {
    it("morning when most sessions are 6–12h", () => {
      const sessions = [0, 1, 2, 3, 4].map(d => session(d, 60, 8));
      const out = computeMomentumState({ studySessions: sessions, consecutiveMisses: 0, studyStreakDays: 5, stateHistory: [], now: NOW });
      expect(out.studyRhythm).toBe("morning");
    });

    it("evening when most sessions are 18–22h", () => {
      const sessions = [0, 1, 2, 3, 4].map(d => session(d, 60, 19));
      const out = computeMomentumState({ studySessions: sessions, consecutiveMisses: 0, studyStreakDays: 5, stateHistory: [], now: NOW });
      expect(out.studyRhythm).toBe("evening");
    });

    it("irregular when sessions spread across all slots", () => {
      const sessions = [
        session(0, 60, 8),   // morning
        session(1, 60, 14),  // afternoon
        session(2, 60, 20),  // evening
        session(3, 60, 23),  // night
      ];
      const out = computeMomentumState({ studySessions: sessions, consecutiveMisses: 0, studyStreakDays: 4, stateHistory: [], now: NOW });
      expect(out.studyRhythm).toBe("irregular");
    });
  });

  describe("recoveryTrend", () => {
    it("stable when no misses", () => {
      const sessions = [session(0)];
      const out = computeMomentumState({ studySessions: sessions, consecutiveMisses: 0, studyStreakDays: 1, stateHistory: [], now: NOW });
      expect(out.recoveryTrend).toBe("stable");
    });

    it("recovering when session exists in last 48h despite prior misses", () => {
      const sessions = [session(0)];
      const out = computeMomentumState({ studySessions: sessions, consecutiveMisses: 2, studyStreakDays: 0, stateHistory: [], now: NOW });
      expect(out.recoveryTrend).toBe("recovering");
    });

    it("declining when misses and no recent session", () => {
      const out = computeMomentumState({ studySessions: [], consecutiveMisses: 3, studyStreakDays: 0, stateHistory: [], now: NOW });
      expect(out.recoveryTrend).toBe("declining");
    });
  });

  describe("motivationTrend", () => {
    it("rising when engagement scores increase over time", () => {
      const stateHistory = [
        { engagement: 40 }, { engagement: 50 }, { engagement: 60 },
        { engagement: 70 }, { engagement: 80 }, { engagement: 90 },
      ];
      const out = computeMomentumState({ studySessions: [], consecutiveMisses: 0, studyStreakDays: 0, stateHistory, now: NOW });
      expect(out.motivationTrend).toBe("rising");
    });

    it("falling when engagement decreases", () => {
      const stateHistory = [
        { engagement: 80 }, { engagement: 70 }, { engagement: 60 },
        { engagement: 50 }, { engagement: 40 }, { engagement: 30 },
      ];
      const out = computeMomentumState({ studySessions: [], consecutiveMisses: 0, studyStreakDays: 0, stateHistory, now: NOW });
      expect(out.motivationTrend).toBe("falling");
    });

    it("stable when insufficient data points", () => {
      const out = computeMomentumState({ studySessions: [], consecutiveMisses: 0, studyStreakDays: 0, stateHistory: [{ engagement: 60 }], now: NOW });
      expect(out.motivationTrend).toBe("stable");
    });
  });

  describe("sessionsLast7Days", () => {
    it("counts only sessions within 7 days", () => {
      const sessions = [
        session(0), session(3), session(6),  // within 7 days
        session(8), session(14),              // outside
      ];
      const out = computeMomentumState({ studySessions: sessions, consecutiveMisses: 0, studyStreakDays: 1, stateHistory: [], now: NOW });
      expect(out.sessionsLast7Days).toBe(3);
    });
  });

  describe("averageSessionMinutes", () => {
    it("computes average from recent sessions", () => {
      const sessions = [session(0, 60), session(1, 120), session(2, 60)];
      const out = computeMomentumState({ studySessions: sessions, consecutiveMisses: 0, studyStreakDays: 3, stateHistory: [], now: NOW });
      expect(out.averageSessionMinutes).toBe(80);
    });

    it("returns 0 when no sessions", () => {
      const out = computeMomentumState({ studySessions: [], consecutiveMisses: 5, studyStreakDays: 0, stateHistory: [], now: NOW });
      expect(out.averageSessionMinutes).toBe(0);
    });
  });
});
