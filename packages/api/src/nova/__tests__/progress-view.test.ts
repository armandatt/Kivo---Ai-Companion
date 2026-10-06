// The Progress read model: what counts, how days and weeks are drawn, what a
// comeback is, when a topic has moved, and which moments reach the journey.
// Pure builder, no database.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  COMEBACK_GAP_DAYS, COUNTED_SESSION_MINUTES, MASTERY_MOVE_POINTS, NO_EARLIER_SESSIONS,
  buildProgressView, isCountedSession,
  type MasteryRecord, type ProgressInputs, type ProgressSessionRecord,
} from "../product/progress";
import { MIN_BLOCK_MINUTES } from "../engines/planning-engine";
import type { TopicMasteryState } from "../types/engine.types";

const NOW = new Date("2026-10-05T12:00:00Z");   // a Monday
const DAY = 86_400_000;
const daysAgo = (days: number, hourUtc = 10) => {
  const d = new Date(NOW.getTime() - days * DAY);
  d.setUTCHours(hourUtc, 0, 0, 0);
  return d;
};

const SUBJECTS = [{ id: "os", name: "Operating Systems" }, { id: "db", name: "DBMS" }];

let seq = 0;
function session(at: Date, over: Partial<ProgressSessionRecord> & { outcome?: string | null } = {}): ProgressSessionRecord {
  const { outcome, ...rest } = over;
  return {
    id: `s${++seq}`, subjectId: "os", topicName: "Deadlocks", sessionDate: at,
    durationMinutes: 30, activityType: "active",
    executionReport: outcome === undefined ? null : { outcome },
    ...rest,
  };
}
function topic(over: Partial<TopicMasteryState> = {}): TopicMasteryState {
  return {
    topicId: "t1", topicName: "Deadlocks", subjectName: "Operating Systems",
    masteryProbability: 0.6, lastStudied: daysAgo(1), retentionEstimate: 0.9, confidenceReported: 0.6,
    calibrationGap: 0, reviewDueAt: null, masteryTrend: "stable", reviewCount: 2,
    ...over,
  };
}
function record(at: Date, before: number | null, after: number, reviewCount: number, over: Partial<MasteryRecord> = {}): MasteryRecord {
  return { id: `r${++seq}`, topicId: "t1", source: "session_report", sessionId: `x${seq}`, masteryBefore: before, masteryAfter: after, reviewCount, recordedAt: at, ...over };
}
function build(over: Partial<ProgressInputs> = {}) {
  return buildProgressView({
    timezone: null, subjects: SUBJECTS, topics: [], sessions: [], masteryRecords: [],
    before: NO_EARLIER_SESSIONS, goals: [], nextExam: null, learningDna: null, now: NOW,
    ...over,
  });
}

beforeEach(() => { seq = 0; });

describe("a learner with nothing on record", () => {
  it("is an empty view, not an invented one", () => {
    const view = build();
    expect(view.hasEvidence).toBe(false);
    expect(view.overview).toEqual({
      since: null, sessions: 0, learningMinutes: 0, activeDays: 0, topicsImproved: 0,
      notCounted: { selfReported: 0, underTenMinutes: 0 },
    });
    expect(view.changes).toEqual([]);
    expect(view.journey).toEqual([]);
    expect(view.growth).toEqual({ improving: [], steady: [], needsAttention: [], justStarted: [] });
    expect(view.consistency.trend).toBe("not_enough_history");
    expect(view.consistency.lastActiveDay).toBeNull();
    expect(view.consistency.daysSinceLastActive).toBeNull();
    expect(view.consistency.weeks).toHaveLength(9);
    expect(view.consistency.weeks.every(w => w.beforeStart && w.activeDays === 0)).toBe(true);
    expect(view.usualSession).toBeNull();
    expect(view.nextExam).toBeNull();
  });

  it("stays empty when the only thing on record is a chat report or a stopped timer", () => {
    const view = build({ sessions: [
      session(daysAgo(1), { activityType: "self_reported", durationMinutes: 90 }),
      session(daysAgo(1), { durationMinutes: 3 }),
    ] });
    expect(view.hasEvidence).toBe(false);
    expect(view.overview.activeDays).toBe(0);
    expect(view.overview.notCounted).toEqual({ selfReported: 1, underTenMinutes: 1 });
    expect(view.journey).toEqual([]);
  });
});

describe("what counts as a session", () => {
  it("is a timed session of at least the shortest planned block", () => {
    expect(COUNTED_SESSION_MINUTES).toBe(MIN_BLOCK_MINUTES);
    expect(isCountedSession({ activityType: "active", durationMinutes: 10 })).toBe(true);
    expect(isCountedSession({ activityType: "active", durationMinutes: 9 })).toBe(false);
    expect(isCountedSession({ activityType: "self_reported", durationMinutes: 90 })).toBe(false);
  });

  it("never adds a self-reported session's placeholder duration to learning time", () => {
    const view = build({ sessions: [
      session(daysAgo(2), { durationMinutes: 25 }),
      session(daysAgo(1), { activityType: "self_reported", durationMinutes: 90 }),
    ] });
    expect(view.overview.sessions).toBe(1);
    expect(view.overview.learningMinutes).toBe(25);
  });

  it("adds totals from before the window", () => {
    const view = build({
      sessions: [session(daysAgo(1), { durationMinutes: 20 })],
      before: { counted: 40, minutes: 1200, firstAt: daysAgo(500), lastAt: daysAgo(400), selfReported: 2, underTenMinutes: 1 },
    });
    expect(view.overview.sessions).toBe(41);
    expect(view.overview.learningMinutes).toBe(1220);
    expect(view.overview.since).toBe(daysAgo(500).toISOString());
    expect(view.overview.notCounted).toEqual({ selfReported: 2, underTenMinutes: 1 });
  });
});

describe("active days", () => {
  it("counts a day once however many sessions it had", () => {
    const view = build({ sessions: [session(daysAgo(1, 8)), session(daysAgo(1, 14)), session(daysAgo(1, 20)), session(daysAgo(3))] });
    expect(view.overview.sessions).toBe(4);
    expect(view.overview.activeDays).toBe(2);
  });

  it("draws the day in the learner's timezone", () => {
    // 19:30 UTC on Sunday 4 Oct is 01:00 on Monday 5 Oct in Kolkata.
    const late = new Date("2026-10-04T19:30:00Z");
    const sessions = [session(late), session(new Date("2026-10-05T06:00:00Z"))];

    const utc = build({ sessions, timezone: null });
    expect(utc.consistency.timezone).toBe("UTC");
    expect(utc.overview.activeDays).toBe(2);
    expect(utc.consistency.weeks[8]).toMatchObject({ weekStart: "2026-10-05", sessions: 1, current: true });
    expect(utc.consistency.weeks[7]).toMatchObject({ weekStart: "2026-09-28", sessions: 1 });

    const kolkata = build({ sessions, timezone: "Asia/Kolkata" });
    expect(kolkata.overview.activeDays).toBe(1);
    expect(kolkata.consistency.weeks[8]).toMatchObject({ weekStart: "2026-10-05", sessions: 2, activeDays: 1 });
    expect(kolkata.consistency.lastActiveDay).toBe("2026-10-05");
    expect(kolkata.consistency.daysSinceLastActive).toBe(0);
  });

  it("falls back to UTC for a timezone that does not exist", () => {
    expect(build({ timezone: "Mars/Olympus" }).consistency.timezone).toBe("UTC");
  });

  it("does not move a day across a daylight-saving change", () => {
    // New York leaves DST on 1 Nov 2026. Sessions at local noon on both sides.
    const view = build({
      timezone: "America/New_York", now: new Date("2026-11-03T17:00:00Z"),
      sessions: [session(new Date("2026-10-31T16:00:00Z")), session(new Date("2026-11-01T17:00:00Z")), session(new Date("2026-11-02T17:00:00Z"))],
    });
    expect(view.overview.activeDays).toBe(3);
    expect(view.consistency.comebacks).toEqual([]);
    expect(view.consistency.weeks[8]).toMatchObject({ weekStart: "2026-11-02", activeDays: 1 });
    expect(view.consistency.weeks[7]).toMatchObject({ weekStart: "2026-10-26", activeDays: 2 });
  });
});

describe("weeks and the consistency trend", () => {
  // `perWeek[i]` active days in the i-th finished week, oldest first.
  const weeksOf = (perWeek: number[]) => perWeek.flatMap((n, i) => {
    const monday = 7 * (perWeek.length - i);   // days ago
    return Array.from({ length: n }, (_, d) => session(daysAgo(monday - d)));
  });

  it("runs Monday to Sunday: eight finished weeks, then this one", () => {
    const view = build({ sessions: [session(daysAgo(0)), session(daysAgo(1)), session(daysAgo(7))] });
    const weeks = view.consistency.weeks;
    expect(weeks.map(w => w.weekStart)).toEqual([
      "2026-08-10", "2026-08-17", "2026-08-24", "2026-08-31", "2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28", "2026-10-05",
    ]);
    expect(weeks[8]).toMatchObject({ current: true, sessions: 1, activeDays: 1, minutes: 30 });
    // Sunday 4 Oct and Monday 28 Sep are both in the week of 28 Sep.
    expect(weeks[7]).toMatchObject({ current: false, sessions: 2, activeDays: 2, minutes: 60 });
  });

  it("marks weeks before the first session instead of counting them as missed", () => {
    const view = build({ sessions: [session(daysAgo(10))] });
    expect(view.consistency.weeks.map(w => w.beforeStart)).toEqual([true, true, true, true, true, true, false, false, false]);
  });

  it("gives no trend until eight finished weeks lie behind the first session", () => {
    const view = build({ sessions: weeksOf([0, 0, 0, 5, 5, 5, 5, 5]) });
    expect(view.consistency.trend).toBe("not_enough_history");
    expect(view.consistency.trendBasis).toBeNull();
    expect(view.changes.some(c => c.kind === "consistency")).toBe(false);
  });

  it("compares the last four finished weeks with the four before", () => {
    const more = build({ sessions: weeksOf([1, 2, 1, 2, 4, 4, 3, 5]) });
    expect(more.consistency.trend).toBe("more_consistent");
    expect(more.consistency.trendBasis).toEqual({ earlier: 1.5, recent: 4 });
    expect(more.changes.find(c => c.kind === "consistency")?.text).toBe("You're studying on more days each week: about 4, up from 1.5.");

    expect(build({ sessions: weeksOf([5, 5, 4, 4, 1, 2, 1, 2]) }).consistency.trend).toBe("less_consistent");
    expect(build({ sessions: weeksOf([3, 3, 3, 3, 3, 4, 3, 3]) }).consistency.trend).toBe("steady");
  });

  it("leaves the unfinished week out of the trend", () => {
    const base = weeksOf([3, 3, 3, 3, 3, 3, 3, 3]);
    expect(build({ sessions: [...base, session(daysAgo(0))] }).consistency.trendBasis).toEqual({ earlier: 3, recent: 3 });
  });
});

describe("comebacks", () => {
  it("is the session that ends a gap of four calendar days or more", () => {
    expect(COMEBACK_GAP_DAYS).toBe(4);
    const short = build({ sessions: [session(daysAgo(10)), session(daysAgo(7))] });
    expect(short.consistency.comebacks).toEqual([]);

    const back = build({ sessions: [session(daysAgo(10)), session(daysAgo(6), { topicName: "Paging" })] });
    expect(back.consistency.comebacks).toEqual([{ date: daysAgo(6).toISOString(), gapDays: 4, topicName: "Paging" }]);
    expect(back.journey.find(e => e.type === "comeback")).toMatchObject({
      title: "Back after 4 days away", importance: "notable", topicName: "Paging", source: { kind: "session", id: "s4" },
    });
    expect(back.changes.find(c => c.kind === "comeback")?.text).toBe("You came back after 4 days away.");
  });

  it("never calls a first session a comeback", () => {
    const view = build({ sessions: [session(daysAgo(2))] });
    expect(view.consistency.comebacks).toEqual([]);
    expect(view.journey.map(e => e.type)).toEqual(["first_session"]);
  });

  it("does not let a chat report or a stopped timer end, or break, a gap", () => {
    const view = build({ sessions: [
      session(daysAgo(12)),
      session(daysAgo(9), { activityType: "self_reported", durationMinutes: 90 }),
      session(daysAgo(6), { durationMinutes: 2 }),
      session(daysAgo(3)),
    ] });
    expect(view.consistency.comebacks.map(c => c.gapDays)).toEqual([9]);
  });

  it("measures a gap that started before the window", () => {
    const view = build({
      sessions: [session(daysAgo(20))],
      before: { ...NO_EARLIER_SESSIONS, counted: 6, minutes: 180, firstAt: daysAgo(500), lastAt: daysAgo(400) },
    });
    expect(view.consistency.comebacks).toEqual([{ date: daysAgo(20).toISOString(), gapDays: 380, topicName: "Deadlocks" }]);
    expect(view.journey.find(e => e.type === "comeback")?.importance).toBe("major");
    // Twenty days ago is recent enough to list, too old to call a change.
    expect(view.changes.some(c => c.kind === "comeback")).toBe(true);
  });

  it("says a comeback changed something only while it is recent", () => {
    const view = build({ sessions: [session(daysAgo(90)), session(daysAgo(60)), session(daysAgo(59))] });
    expect(view.consistency.comebacks).toHaveLength(1);
    expect(view.changes.some(c => c.kind === "comeback")).toBe(false);
  });
});

describe("session milestones", () => {
  it("marks the first, fifth and tenth counted sessions, and nothing in between", () => {
    const sessions = Array.from({ length: 11 }, (_, i) => session(daysAgo(11 - i)));
    const view = build({ sessions });
    const marks = view.journey.filter(e => e.type === "first_session" || e.type === "session_milestone");
    expect(marks.map(e => [e.type, e.title, e.source.id])).toEqual([
      ["session_milestone", "10 sessions", "s10"],
      ["session_milestone", "5 sessions", "s5"],
      ["first_session", "Your first session", "s1"],
    ]);
    expect(marks[0]!.description).toBe("Your 10th focused session, on Deadlocks.");
  });

  it("numbers sessions from the learner's real first one", () => {
    const view = build({
      sessions: [session(daysAgo(3)), session(daysAgo(2)), session(daysAgo(1))],
      before: { ...NO_EARLIER_SESSIONS, counted: 3, minutes: 90, firstAt: daysAgo(400), lastAt: daysAgo(4) },
    });
    expect(view.journey.map(e => [e.type, e.title, e.source.id])).toEqual([["session_milestone", "5 sessions", "s2"]]);
  });

  it("does not count uncounted sessions toward a milestone", () => {
    const sessions = [
      ...Array.from({ length: 4 }, (_, i) => session(daysAgo(9 - i))),
      session(daysAgo(4), { durationMinutes: 4 }),
      session(daysAgo(3), { activityType: "self_reported" }),
    ];
    expect(build({ sessions }).journey.some(e => e.type === "session_milestone")).toBe(false);
  });
});

describe("topic growth", () => {
  it("leaves out a topic no session has fed", () => {
    const view = build({ topics: [topic({ reviewCount: 0, masteryProbability: 0.5 })] });
    expect(view.growth).toEqual({ improving: [], steady: [], needsAttention: [], justStarted: [] });
  });

  it("calls one session a start, not a trend", () => {
    const view = build({
      topics: [topic({ reviewCount: 1, masteryProbability: 0.9 })],
      sessions: [session(daysAgo(1), { outcome: "crushed_it" })],
      masteryRecords: [record(daysAgo(1), null, 0.9, 1)],
    });
    expect(view.growth.justStarted).toHaveLength(1);
    expect(view.growth.justStarted[0]).toMatchObject({ direction: "just_started", change: null, reason: "One session so far: Crushed it", level: "solid" });
    expect(view.overview.topicsImproved).toBe(0);
    expect(view.changes.some(c => c.kind === "topic_improved")).toBe(false);
  });

  it("reports a recorded rise of ten points or more as improving", () => {
    expect(MASTERY_MOVE_POINTS).toBe(10);
    const view = build({
      topics: [topic({ masteryProbability: 0.62, reviewCount: 3 })],
      masteryRecords: [record(daysAgo(20), null, 0.3, 1), record(daysAgo(10), 0.3, 0.48, 2), record(daysAgo(2), 0.48, 0.62, 3)],
    });
    const t = view.growth.improving[0]!;
    expect(t).toMatchObject({ direction: "improving", masteryPercent: 62, level: "developing", sessions: 3, reason: "Up from 30% to 62%" });
    expect(t.change).toEqual({ fromPercent: 30, toPercent: 62, fromLevel: "weak", toLevel: "developing", since: daysAgo(20).toISOString() });
    expect(view.overview.topicsImproved).toBe(1);
    expect(view.changes[0]).toEqual({ kind: "topic_improved", text: "Deadlocks moved from 30% to 62% (weak to developing)." });
  });

  it("starts from the value that stood before the first record, when a session was already behind it", () => {
    // A topic studied before history was kept: its first record carries the old value.
    const view = build({
      topics: [topic({ masteryProbability: 0.56, reviewCount: 5 })],
      masteryRecords: [record(daysAgo(3), 0.44, 0.56, 5)],
    });
    expect(view.growth.improving[0]!.change).toMatchObject({ fromPercent: 44, toPercent: 56, since: daysAgo(3).toISOString() });
  });

  it("does not take a conversation-only number as a starting point", () => {
    // Mentioned in chat (no session), then one session.
    const view = build({
      topics: [topic({ masteryProbability: 0.75, reviewCount: 1 })],
      masteryRecords: [
        record(daysAgo(9), null, 0.21, 0, { source: "conversation_signal", sessionId: null }),
        record(daysAgo(2), 0.21, 0.75, 1),
      ],
    });
    expect(view.growth.improving).toEqual([]);
    expect(view.growth.justStarted[0]).toMatchObject({ change: null, direction: "just_started" });
  });

  it("reports a recorded fall as needing attention, and says so", () => {
    const view = build({
      topics: [topic({ masteryProbability: 0.55, reviewCount: 4 })],
      masteryRecords: [record(daysAgo(30), 0.7, 0.72, 3), record(daysAgo(2), 0.72, 0.55, 4)],
    });
    expect(view.growth.needsAttention[0]).toMatchObject({ direction: "needs_attention", reason: "Down from 70% to 55%" });
    expect(view.changes).toContainEqual({ kind: "topic_slipped", text: "Deadlocks slipped from 70% to 55%." });
  });

  it("holds a small movement as steady", () => {
    const view = build({
      topics: [topic({ masteryProbability: 0.74, reviewCount: 4 })],
      masteryRecords: [record(daysAgo(30), 0.7, 0.72, 3), record(daysAgo(2), 0.72, 0.74, 4)],
    });
    expect(view.growth.steady[0]).toMatchObject({ direction: "steady", reason: "Holding at 74% over 4 sessions" });
  });

  it("puts a topic the learner last struggled with under needs attention, even after a rise", () => {
    const view = build({
      topics: [topic({ masteryProbability: 0.5, reviewCount: 3 })],
      sessions: [session(daysAgo(9), { outcome: "good" }), session(daysAgo(1), { outcome: "struggled" })],
      masteryRecords: [record(daysAgo(20), 0.3, 0.4, 2), record(daysAgo(1), 0.4, 0.5, 3)],
    });
    expect(view.growth.needsAttention[0]!.reason).toBe("Your last session on it: Struggled");
  });

  it("keeps a weak topic that has not moved under needs attention", () => {
    const view = build({ topics: [topic({ masteryProbability: 0.3, reviewCount: 4 })] });
    expect(view.growth.needsAttention[0]!.reason).toBe("Still weak after 4 sessions");
  });

  describe("with no recorded history", () => {
    const topics = [topic({ masteryProbability: 0.6, reviewCount: 3 })];

    it("reads direction from the learner's own answers", () => {
      const up = build({ topics, sessions: [
        session(daysAgo(9), { outcome: "struggled" }), session(daysAgo(5), { outcome: "okay" }), session(daysAgo(1), { outcome: "good" }),
      ] });
      expect(up.growth.improving[0]).toMatchObject({
        change: null, outcomes: ["struggled", "okay", "good"], reason: "From Struggled to Good over 3 sessions",
      });
      expect(up.changes[0]).toEqual({ kind: "topic_improved", text: "Deadlocks went from Struggled to Good." });

      const down = build({ topics, sessions: [session(daysAgo(9), { outcome: "crushed_it" }), session(daysAgo(1), { outcome: "okay" })] });
      expect(down.growth.needsAttention[0]!.reason).toBe("From Crushed it to Okay over 2 sessions");

      const flat = build({ topics, sessions: [session(daysAgo(9), { outcome: "good" }), session(daysAgo(1), { outcome: "good" })] });
      expect(flat.growth.steady).toHaveLength(1);
    });

    it("draws no movement at all", () => {
      const view = build({ topics });
      expect(view.growth.steady[0]!.change).toBeNull();
      expect(view.overview.topicsImproved).toBe(0);
    });

    it("matches a session to its topic by subject and name, whatever the casing", () => {
      const view = build({ topics, sessions: [
        session(daysAgo(9), { outcome: "struggled", topicName: "deadlocks " }),
        session(daysAgo(5), { outcome: "good", subjectId: "db" }),          // same name, another subject
        session(daysAgo(1), { outcome: "okay" }),
      ] });
      expect(view.growth.improving[0]!.outcomes).toEqual(["struggled", "okay"]);
    });
  });

  it("orders improving topics by how far they moved", () => {
    const view = build({
      topics: [
        topic({ topicId: "a", topicName: "Paging", masteryProbability: 0.6, reviewCount: 3 }),
        topic({ topicId: "b", topicName: "Semaphores", masteryProbability: 0.9, reviewCount: 3 }),
      ],
      masteryRecords: [record(daysAgo(9), 0.45, 0.6, 3, { topicId: "a" }), record(daysAgo(9), 0.4, 0.9, 3, { topicId: "b" })],
    });
    expect(view.growth.improving.map(t => t.topicName)).toEqual(["Semaphores", "Paging"]);
  });
});

describe("journey", () => {
  it("marks Good after Struggled once, and waits for another struggle before marking again", () => {
    const view = build({ sessions: [
      session(daysAgo(20), { outcome: "struggled" }),
      session(daysAgo(18), { outcome: "okay" }),
      session(daysAgo(15), { outcome: "good" }),         // breakthrough
      session(daysAgo(12), { outcome: "crushed_it" }),   // not another one
      session(daysAgo(9),  { outcome: "struggled" }),
      session(daysAgo(6),  { outcome: "crushed_it" }),   // breakthrough
    ] });
    const marks = view.journey.filter(e => e.type === "breakthrough");
    expect(marks.map(e => [e.source.id, e.title])).toEqual([
      ["s6", "Deadlocks: from Struggled to Crushed it"],
      ["s3", "Deadlocks: from Struggled to Good"],
    ]);
  });

  it("does not carry a struggle from one topic to another", () => {
    const view = build({ sessions: [
      session(daysAgo(5), { outcome: "struggled" }),
      session(daysAgo(4), { outcome: "good", topicName: "Paging" }),
      session(daysAgo(3), { outcome: "good", subjectId: "db" }),
    ] });
    expect(view.journey.some(e => e.type === "breakthrough")).toBe(false);
  });

  it("marks a session that moved a topic into a higher level", () => {
    const view = build({
      topics: [topic({ masteryProbability: 0.72, reviewCount: 3 })],
      masteryRecords: [record(daysAgo(9), null, 0.3, 1), record(daysAgo(6), 0.3, 0.48, 2), record(daysAgo(2), 0.68, 0.72, 3)],
    });
    const marks = view.journey.filter(e => e.type === "topic_level_up");
    expect(marks.map(e => [e.title, e.importance, e.source.kind])).toEqual([
      ["Deadlocks: developing to solid", "major", "mastery_record"],
      ["Deadlocks: weak to developing", "notable", "mastery_record"],
    ]);
    expect(marks[0]!.description).toBe("Its mastery estimate went from 68% to 72% after this session.");
    expect(marks[0]!.subjectName).toBe("Operating Systems");
  });

  it("does not mark a level reached through conversation, or on a topic's first session", () => {
    const view = build({
      topics: [topic({ masteryProbability: 0.75, reviewCount: 1 })],
      masteryRecords: [
        record(daysAgo(9), null, 0.2, 0, { source: "conversation_signal", sessionId: null }),
        record(daysAgo(6), 0.2, 0.75, 1),
        record(daysAgo(2), 0.68, 0.71, 1, { source: "conversation_signal", sessionId: null }),
      ],
    });
    expect(view.journey.some(e => e.type === "topic_level_up")).toBe(false);
  });

  it("is newest first, capped, and the same for the same evidence", () => {
    const sessions = Array.from({ length: 60 }, (_, i) => session(daysAgo(300 - i * 5), { outcome: i % 2 ? "good" : "struggled" }));
    const input = { sessions };
    const view = build(input);
    expect(view.journey.length).toBe(40);
    const dates = view.journey.map(e => e.date);
    expect([...dates].sort().reverse()).toEqual(dates);
    expect(new Set(view.journey.map(e => e.id)).size).toBe(40);
    expect(build(input)).toEqual(view);
  });

  it("names the record every event rests on", () => {
    const view = build({
      topics: [topic({ masteryProbability: 0.5, reviewCount: 2 })],
      sessions: [session(daysAgo(20), { outcome: "struggled" }), session(daysAgo(3), { outcome: "good" })],
      masteryRecords: [record(daysAgo(20), null, 0.3, 1), record(daysAgo(3), 0.3, 0.48, 2)],
    });
    const sessionIds = new Set(["s1", "s2"]);
    expect(view.journey.map(e => e.type).sort()).toEqual(["breakthrough", "comeback", "first_session", "topic_level_up"]);
    for (const e of view.journey) {
      expect(e.evidence.length).toBeGreaterThan(0);
      if (e.source.kind === "session") expect(sessionIds.has(e.source.id)).toBe(true);
      else expect(e.source.id).toBe("r4");
    }
  });
});

describe("what changed", () => {
  it("counts the last thirty days, and compares only when the learner had started by the thirty before", () => {
    const recent = [session(daysAgo(2)), session(daysAgo(5)), session(daysAgo(29))];

    const fresh = build({ sessions: recent });
    expect(fresh.changes.find(c => c.kind === "sessions")?.text).toBe("You've completed 3 focused sessions in the last 30 days.");

    const up = build({ sessions: [session(daysAgo(70)), session(daysAgo(40)), ...recent] });
    expect(up.changes.find(c => c.kind === "sessions")?.text).toBe("You've completed 3 focused sessions in the last 30 days, up from 1 in the 30 days before.");

    const down = build({ sessions: [session(daysAgo(70)), session(daysAgo(50)), session(daysAgo(45)), session(daysAgo(2))] });
    expect(down.changes.find(c => c.kind === "sessions")?.text).toBe("You've completed 1 focused session in the last 30 days, down from 2 in the 30 days before.");
  });

  it("says nothing about sessions when there were none lately", () => {
    expect(build({ sessions: [session(daysAgo(45))] }).changes).toEqual([]);
  });

  it("never holds more than five statements", () => {
    const topics = ["a", "b", "c", "d"].map(id => topic({ topicId: id, topicName: `Topic ${id}`, masteryProbability: 0.8, reviewCount: 3 }));
    const view = build({
      topics,
      masteryRecords: topics.map(t => record(daysAgo(9), 0.4, 0.8, 3, { topicId: t.topicId })),
      sessions: [session(daysAgo(40)), session(daysAgo(3))],
    });
    expect(view.changes.length).toBeLessThanOrEqual(5);
    expect(view.changes.filter(c => c.kind === "topic_improved")).toHaveLength(2);
  });
});

describe("what Nova will not claim", () => {
  it("shows no usual session length until Learning DNA has enough behind it", () => {
    const dna = { optimalSessionMinutes: 42, dataPointCount: 1, confidence: "low" };
    expect(build({ learningDna: dna }).usualSession).toBeNull();
    expect(build({ learningDna: { ...dna, dataPointCount: 3, confidence: "medium" } }).usualSession).toEqual({ minutes: 42, basedOnSessions: 3 });
    expect(build({ learningDna: { optimalSessionMinutes: null, dataPointCount: 12, confidence: "high" } }).usualSession).toBeNull();
  });

  it("passes goals through in the learner's words, with no progress on them", () => {
    const view = build({ goals: ["  Crack GATE 2027 ", "", "Placement"] });
    expect(view.goals).toEqual(["Crack GATE 2027", "Placement"]);
    expect(JSON.stringify(view)).not.toMatch(/goalProgress|percentComplete|xp|score/i);
  });

  it("shows only an exam that is still ahead", () => {
    const exam = { title: "OS midterm", subjectId: "os", scheduledAt: new Date("2026-10-12T04:00:00Z") };
    expect(build({ nextExam: exam }).nextExam).toEqual({ title: "OS midterm", subjectName: "Operating Systems", date: exam.scheduledAt.toISOString(), daysUntil: 7 });
    expect(build({ nextExam: { ...exam, scheduledAt: daysAgo(1) } }).nextExam).toBeNull();
  });
});

describe("a long history", () => {
  it("builds from thousands of sessions without slowing or growing the response", () => {
    const sessions = Array.from({ length: 4000 }, (_, i) => session(new Date(NOW.getTime() - (i % 365) * DAY - (i % 12) * 3_600_000), { outcome: i % 3 ? "good" : "struggled", topicName: `Topic ${i % 40}` }));
    const started = Date.now();
    const view = build({ sessions });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(view.overview.sessions).toBe(4000);
    expect(view.journey.length).toBeLessThanOrEqual(40);
    expect(view.consistency.weeks).toHaveLength(9);
    expect(JSON.stringify(view).length).toBeLessThan(40_000);
  });
});

// ── Boundaries, read from the source ──────────────────────────────────────────

const NOVA = join(__dirname, "..");
const read = (path: string) => readFileSync(join(NOVA, path), "utf8");
function sourceFiles(dir: string): string[] {
  return readdirSync(join(NOVA, dir)).flatMap(name => {
    const path = join(dir, name);
    if (statSync(join(NOVA, path)).isDirectory()) return name.startsWith("__") ? [] : sourceFiles(path);
    return name.endsWith(".ts") ? [path] : [];
  });
}

describe("Progress is a read model", () => {
  const source = read("product/progress.ts");

  it("writes nothing", () => {
    // Every database call in the file, by the method it uses.
    const calls = [...source.matchAll(/prisma\.\w+\.(\w+)\(/g)].map(m => m[1]);
    expect(calls.length).toBeGreaterThan(0);
    expect([...new Set(calls)].sort()).toEqual(["aggregate", "count", "findMany", "findUnique"]);
    expect(source).not.toMatch(/\$transaction|\$executeRaw|\$queryRaw/);
  });

  it("calls no brain, no LLM client, no consolidation and no decision graph", () => {
    expect(source).not.toMatch(/from "\.\.\/(brains|consolidation|decision|context|adapters|persistence)\//);
    expect(source).not.toMatch(/openai|generateOpenAIText|handleNovaTurn/i);
  });

  it("does not read notes, messages, facts, reality or behavioural patterns", () => {
    expect(source).not.toMatch(/novaNote|companionMessage|userFact|userReality|behavioralPattern|novaCognitiveState/);
  });

  it("takes mastery levels from the Knowledge Engine and has no bands of its own", () => {
    expect(source).toMatch(/masteryLevel\(/);
    expect(source).not.toMatch(/WEAK_BELOW|DEVELOPING_BELOW|< 0\.4|< 0\.7/);
  });

  it("has a contract the web app can import without pulling in the server", () => {
    expect(read("product/progress.types.ts")).not.toMatch(/^import /m);
  });
});

describe("mastery history has one writer and one reader", () => {
  const users = sourceFiles(".").filter(f => /novaTopicMasterySnapshot/.test(read(f)));

  it("is written only by the Topic Mastery Engine and read only by Progress", () => {
    expect(users.sort()).toEqual(["engines/topic-mastery-engine.ts", "product/progress.ts"]);
    expect(read("engines/topic-mastery-engine.ts")).toMatch(/novaTopicMasterySnapshot\.create\(/);
    expect(read("product/progress.ts")).toMatch(/novaTopicMasterySnapshot\.findMany\(/);
  });

  it("is never an input to the mastery calculation", () => {
    expect(read("engines/topic-mastery-engine.ts")).not.toMatch(/novaTopicMasterySnapshot\.(find|count|aggregate)/);
  });
});
