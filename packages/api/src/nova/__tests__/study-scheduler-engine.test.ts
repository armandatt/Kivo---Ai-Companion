// ─── Study Scheduler Engine tests ─────────────────────────────────────────────
import { computeSchedulingDecision } from "../engines/study-scheduler-engine.js";
import type { MomentumState } from "../types/proactive.types.js";

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

const CRITICAL_MOMENTUM: MomentumState = {
  ...STABLE_MOMENTUM,
  currentMomentum:   "critical",
  consecutiveMisses: 6,
  currentStreak:     0,
  sessionsLast7Days: 0,
};

function examIn(daysUntil: number): Date {
  const d = new Date("2024-11-15T10:00:00Z");
  d.setDate(d.getDate() + daysUntil);
  return d;
}

describe("Study Scheduler Engine", () => {
  describe("exam_countdown priority", () => {
    it("returns exam_countdown at priority 10 when exam is tomorrow", () => {
      const now = new Date("2024-11-15T10:00:00Z");
      const out = computeSchedulingDecision({
        momentum:                  STABLE_MOMENTUM,
        preferredStudyTime:        "morning",
        preferredStudyHoursPerDay: 3,
        upcomingExams:             [{ title: "OS Exam", subjectName: "OS", scheduledAt: examIn(1) }],
        topicsOverdueForReview:    [],
        studiedToday:              false,
        hasActiveSession:          false,
        now,
      });
      expect(out.eventType).toBe("exam_countdown");
      expect(out.priority).toBe(10);
      expect(out.isUrgent).toBe(true);
    });

    it("exam_countdown at priority 9 when exam is in 3 days", () => {
      const now = new Date("2024-11-15T10:00:00Z");
      const out = computeSchedulingDecision({
        momentum:                  STABLE_MOMENTUM,
        preferredStudyTime:        "morning",
        preferredStudyHoursPerDay: 3,
        upcomingExams:             [{ title: "Math Exam", subjectName: "Math", scheduledAt: examIn(3) }],
        topicsOverdueForReview:    [],
        studiedToday:              false,
        hasActiveSession:          false,
        now,
      });
      expect(out.eventType).toBe("exam_countdown");
      expect(out.priority).toBeGreaterThanOrEqual(7);
    });

    it("exam more than 7 days away does not trigger exam_countdown", () => {
      const now = new Date("2024-11-15T10:00:00Z");
      const out = computeSchedulingDecision({
        momentum:                  STABLE_MOMENTUM,
        preferredStudyTime:        "morning",
        preferredStudyHoursPerDay: 3,
        upcomingExams:             [{ title: "Far Exam", subjectName: "Far", scheduledAt: examIn(14) }],
        topicsOverdueForReview:    [],
        studiedToday:              false,
        hasActiveSession:          false,
        now,
      });
      expect(out.eventType).not.toBe("exam_countdown");
    });
  });

  describe("burnout prevention", () => {
    it("returns burnout_prevention when consecutive misses >= 5", () => {
      const now = new Date("2024-11-15T10:00:00Z");
      const out = computeSchedulingDecision({
        momentum:                  CRITICAL_MOMENTUM,
        preferredStudyTime:        "morning",
        preferredStudyHoursPerDay: 3,
        upcomingExams:             [],
        topicsOverdueForReview:    [],
        studiedToday:              false,
        hasActiveSession:          false,
        now,
      });
      expect(out.eventType).toBe("burnout_prevention");
    });
  });

  describe("morning brief", () => {
    it("fires during 7–9am window when not yet studied", () => {
      const morningNow = new Date("2024-11-15T08:00:00Z");
      const out = computeSchedulingDecision({
        momentum:                  STABLE_MOMENTUM,
        preferredStudyTime:        "morning",
        preferredStudyHoursPerDay: 3,
        upcomingExams:             [],
        topicsOverdueForReview:    [],
        studiedToday:              false,
        hasActiveSession:          false,
        now:                       morningNow,
      });
      expect(out.eventType).toBe("morning_brief");
    });

    it("does not fire if already studied today", () => {
      const morningNow = new Date("2024-11-15T08:00:00Z");
      const out = computeSchedulingDecision({
        momentum:                  STABLE_MOMENTUM,
        preferredStudyTime:        "morning",
        preferredStudyHoursPerDay: 3,
        upcomingExams:             [],
        topicsOverdueForReview:    [],
        studiedToday:              true,
        hasActiveSession:          false,
        now:                       morningNow,
      });
      expect(out.eventType).not.toBe("morning_brief");
    });
  });

  describe("active session", () => {
    it("returns mid_session_support when student is in session", () => {
      const now = new Date("2024-11-15T15:00:00Z");
      const out = computeSchedulingDecision({
        momentum:                  STABLE_MOMENTUM,
        preferredStudyTime:        null,
        preferredStudyHoursPerDay: 3,
        upcomingExams:             [],
        topicsOverdueForReview:    [],
        studiedToday:              true,
        hasActiveSession:          true,
        now,
      });
      expect(out.eventType).toBe("mid_session_support");
    });
  });

  describe("missed_session", () => {
    it("fires when 1+ misses and no session yesterday", () => {
      const now = new Date("2024-11-15T15:00:00Z");
      const momentum: MomentumState = {
        ...STABLE_MOMENTUM,
        consecutiveMisses:  1,
        lastSessionDaysAgo: 2,
      };
      const out = computeSchedulingDecision({
        momentum,
        preferredStudyTime:        "afternoon",
        preferredStudyHoursPerDay: 3,
        upcomingExams:             [],
        topicsOverdueForReview:    [],
        studiedToday:              false,
        hasActiveSession:          false,
        now,
      });
      expect(out.eventType).toBe("missed_session");
    });
  });

  describe("milestone celebration", () => {
    it("fires on streak milestone (7 days)", () => {
      const now = new Date("2024-11-15T15:00:00Z");
      const momentum: MomentumState = { ...STABLE_MOMENTUM, currentStreak: 7 };
      const out = computeSchedulingDecision({
        momentum,
        preferredStudyTime:        "afternoon",
        preferredStudyHoursPerDay: 3,
        upcomingExams:             [],
        topicsOverdueForReview:    [],
        studiedToday:              true,
        hasActiveSession:          false,
        now,
      });
      expect(out.eventType).toBe("milestone_celebration");
    });

    it("does not fire on non-milestone streak (5 days)", () => {
      const now = new Date("2024-11-15T15:00:00Z");
      const momentum: MomentumState = { ...STABLE_MOMENTUM, currentStreak: 5 };
      const out = computeSchedulingDecision({
        momentum,
        preferredStudyTime:        "afternoon",
        preferredStudyHoursPerDay: 3,
        upcomingExams:             [],
        topicsOverdueForReview:    [],
        studiedToday:              true,
        hasActiveSession:          false,
        now,
      });
      expect(out.eventType).not.toBe("milestone_celebration");
    });
  });

  describe("none", () => {
    it("returns none when nothing is due (mid-day, studied, no exam, no misses)", () => {
      const now = new Date("2024-11-15T12:00:00Z");  // noon — not in any window
      const out = computeSchedulingDecision({
        momentum:                  STABLE_MOMENTUM,
        preferredStudyTime:        "morning",
        preferredStudyHoursPerDay: 3,
        upcomingExams:             [],
        topicsOverdueForReview:    [],
        studiedToday:              true,
        hasActiveSession:          false,
        now,
      });
      expect(out.eventType).toBe("none");
    });
  });
});
