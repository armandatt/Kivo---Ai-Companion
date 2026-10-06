// Learning DNA: what Nova may conclude about how a learner studies, how much
// has to stand behind it, and how a conclusion weakens and changes.
// Pure engine and view builder, no database.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  DNA_EMERGING_AT, DNA_EVIDENCE_DAYS, DNA_LEAD, DNA_MIN_PER_SIDE, DNA_STRONG_AT, DNA_SUPPORTED_AT,
  advanceDnaMemory, compare, computeLearningDna, legacyDnaColumns, levelFor, percentile, trendOf,
  type DnaEvidence, type DnaMemoryMap, type DnaSession, type DnaSignal, type DnaSignalKey,
} from "../engines/learning-dna-engine";
import { COUNTED_SESSION_MINUTES, isCountedSession } from "../engines/study-session-engine";
import { MIN_BLOCK_MINUTES } from "../engines/planning-engine";
import { currentZoneName, isValidTimezone, localHour } from "../engines/learner-calendar";
import { NOT_TRACKED, buildLearningDnaView } from "../product/learning-dna";
import type { TopicMasteryState } from "../types/engine.types";
import type { SessionOutcome } from "../types/session.types";

const NOW = new Date("2026-10-05T12:00:00Z");   // a Monday
const DAY = 86_400_000;
const SUBJECTS = [{ id: "os", name: "Operating Systems" }, { id: "db", name: "DBMS" }];

let seq = 0;
beforeEach(() => { seq = 0; });

// A counted session `daysAgo` days back, starting at `hourUtc`.
function s(daysAgo: number, over: Partial<DnaSession> & { hourUtc?: number } = {}): DnaSession {
  const { hourUtc = 10, ...rest } = over;
  const startedAt = new Date(NOW.getTime() - daysAgo * DAY);
  startedAt.setUTCHours(hourUtc, 0, 0, 0);
  return { id: `s${++seq}`, startedAt, minutes: 30, plannedMinutes: null, subjectId: "os", topicName: `Topic ${seq}`, outcome: null, ...rest };
}
// `count` sessions on consecutive days ending `endDaysAgo` days back.
const run = (count: number, over: Partial<DnaSession> & { hourUtc?: number } = {}, endDaysAgo = 1) =>
  Array.from({ length: count }, (_, i) => s(endDaysAgo + count - 1 - i, over));

function dna(sessions: DnaSession[], over: Partial<DnaEvidence> = {}): Record<DnaSignalKey, DnaSignal> {
  const signals = computeLearningDna({
    sessions, topics: [], subjects: SUBJECTS, timezone: "UTC",
    firstCountedAt: sessions.length ? new Date(Math.min(...sessions.map(x => x.startedAt.getTime()))) : null,
    now: NOW, ...over,
  });
  return Object.fromEntries(signals.map(x => [x.key, x])) as Record<DnaSignalKey, DnaSignal>;
}

describe("evidence thresholds", () => {
  it("says nothing with no sessions", () => {
    const all = dna([]);
    expect(Object.keys(all)).toHaveLength(8);
    for (const signal of Object.values(all)) {
      expect(signal).toMatchObject({ level: "unknown", value: null, valueKey: null, valueLabel: null, weakening: false });
      expect(signal.explanation.length).toBeGreaterThan(20);
    }
  });

  it("says nothing from four sessions, and something tentative from five", () => {
    expect(DNA_EMERGING_AT).toBe(5);
    const four = dna(run(4)).typical_session;
    expect(four).toMatchObject({ level: "unknown", value: null, evidenceCount: 4 });
    expect(four.explanation).toBe("Nova needs 5 finished sessions before it says anything here. It has 4.");

    expect(dna(run(5)).typical_session).toMatchObject({ level: "emerging", evidenceCount: 5 });
  });

  it("moves emerging → supported → strong only as evidence accumulates", () => {
    expect([levelFor(0), levelFor(4), levelFor(5), levelFor(9), levelFor(10), levelFor(19), levelFor(20), levelFor(500)])
      .toEqual(["unknown", "unknown", "emerging", "emerging", "supported", "supported", "strong", "strong"]);
    expect([DNA_SUPPORTED_AT, DNA_STRONG_AT]).toEqual([10, 20]);
    expect(dna(run(10)).typical_session.level).toBe("supported");
    expect(dna(run(20)).typical_session.level).toBe("strong");
  });

  it("counts the same sessions Progress counts", () => {
    expect(COUNTED_SESSION_MINUTES).toBe(MIN_BLOCK_MINUTES);
    expect(isCountedSession({ activityType: "self_reported", durationMinutes: 90 })).toBe(false);
    expect(isCountedSession({ activityType: "active", durationMinutes: 9 })).toBe(false);
  });

  it("lets evidence older than the window fall away, so an unrenewed belief fades", () => {
    expect(DNA_EVIDENCE_DAYS).toBe(90);
    const old = run(20, {}, 100);                       // all between 100 and 119 days ago
    expect(dna(old).typical_session).toMatchObject({ level: "unknown", evidenceCount: 0 });
    // Twenty old sessions and five recent ones are five sessions of evidence.
    expect(dna([...old, ...run(5)]).typical_session).toMatchObject({ level: "emerging", evidenceCount: 5 });
  });

  it("never reads a session dated after now", () => {
    expect(dna([...run(4), s(-2)]).typical_session.evidenceCount).toBe(4);
  });
});

describe("typical session", () => {
  it("is the median with its middle half, not an average", () => {
    expect(percentile([10, 20, 30, 40, 50], 0.5)).toBe(30);
    expect(percentile([10, 20, 30, 40], 0.5)).toBe(25);
    const lengths = [20, 25, 30, 30, 35, 35, 40, 45, 50];
    const signal  = dna(lengths.map((minutes, i) => s(i + 1, { minutes }))).typical_session;
    expect(signal.value).toEqual({ kind: "minutes", typical: 35, low: 30, high: 40 });
    expect(signal.valueLabel).toBe("About 35 minutes");
    expect(signal.explanation).toBe("The middle half of your last 9 sessions ran 30 to 40 minutes. The one in the middle was 35.");
  });

  it("is not moved by one very long session", () => {
    const usual = dna(run(9, { minutes: 30 })).typical_session;
    const withMarathon = dna([...run(9, { minutes: 30 }, 2), s(1, { minutes: 300 })]).typical_session;
    expect(withMarathon.value).toEqual(usual.value);
    expect(withMarathon.valueKey).toBe("medium");
    // The average would have said 57 minutes.
  });

  it("does not turn one long session into a habit of long sessions", () => {
    const signal = dna([s(1, { minutes: 180 })]).typical_session;
    expect(signal).toMatchObject({ level: "unknown", value: null });
    expect(dna([s(1, { minutes: 180 })]).best_session_size.value).toBeNull();
  });

  it("says so, and stays tentative, when session lengths are all over the place", () => {
    const lengths = [10, 12, 15, 20, 30, 45, 60, 90, 120, 150, 15, 100];
    const signal  = dna(lengths.map((minutes, i) => s(i + 1, { minutes }))).typical_session;
    expect(signal.level).toBe("emerging");     // twelve sessions would otherwise be "supported"
    expect(signal.explanation).toMatch(/vary a lot/);
    expect(signal.explanation).toMatch(/a midpoint more than a habit/);
  });

  it("is marked weakening when the latest eight sessions have moved away", () => {
    // Twelve 45-minute sessions, then eight of 25.
    const sessions = [...run(12, { minutes: 45 }, 9), ...run(8, { minutes: 25 }, 1)];
    const signal = dna(sessions).typical_session;
    expect(signal.weakening).toBe(true);
    expect(signal.recent).toBe("Your last 8 sessions ran about 25 minutes, shorter than the 45 before them.");
    expect(signal.value).toMatchObject({ typical: 45 });   // not yet overturned
  });

  it("adapts once the newer sessions outnumber the old belief", () => {
    const sessions = [...run(8, { minutes: 45 }, 15), ...run(14, { minutes: 25 }, 1)];
    const signal = dna(sessions).typical_session;
    expect(signal.value).toMatchObject({ typical: 25 });
    expect(signal.valueKey).toBe("medium");
  });

  it("does not call a small wobble a change", () => {
    const sessions = [...run(12, { minutes: 32 }, 9), ...run(8, { minutes: 36 }, 1)];
    expect(dna(sessions).typical_session.weakening).toBe(false);
  });
});

describe("comparisons: does one way of studying go better than another?", () => {
  const item = (key: string, well: boolean) => ({ bucket: { key, label: key }, well });
  const many = (key: string, well: number, of: number) => [...Array(well).fill(item(key, true)), ...Array(of - well).fill(item(key, false))];

  it("needs four answered sessions on each of two sides", () => {
    expect(DNA_MIN_PER_SIDE).toBe(4);
    expect(compare([...many("a", 4, 4), ...many("b", 0, 3)])).toEqual({ status: "too_few", answered: 7 });
    expect(compare(many("a", 9, 9))).toEqual({ status: "too_few", answered: 9 });
    expect(compare([...many("a", 4, 4), ...many("b", 0, 4)]).status).toBe("clear");
  });

  it("needs a twenty-point lead", () => {
    expect(DNA_LEAD).toBe(0.2);
    expect(compare([...many("a", 6, 10), ...many("b", 5, 10)]).status).toBe("no_difference");   // 60% v 50%
    expect(compare([...many("a", 7, 10), ...many("b", 5, 10)]).status).toBe("clear");           // 70% v 50%
  });

  it("ignores a side too thin to judge, however good it looks", () => {
    // One perfect extended session does not beat anything.
    const result = compare([...many("medium", 6, 10), ...many("short", 2, 10), ...many("extended", 1, 1)]);
    expect(result.status).toBe("clear");
    expect(result.status === "clear" && result.best.bucket.key).toBe("medium");
    expect(result.status === "clear" && result.against.map(t => t.bucket.key)).toEqual(["short"]);
  });

  it("is deterministic on a tie", () => {
    const a = compare([...many("a", 4, 4), ...many("b", 4, 4), ...many("c", 0, 4)]);
    const b = compare([...many("c", 0, 4), ...many("b", 4, 4), ...many("a", 4, 4)]);
    expect(a).toEqual(b);
  });
});

describe("best session size", () => {
  const sized = (count: number, minutes: number, outcome: SessionOutcome | null, endDaysAgo: number) => run(count, { minutes, outcome }, endDaysAgo);

  it("says nothing while only one length has answers", () => {
    const signal = dna(sized(12, 30, "good", 1)).best_session_size;
    expect(signal).toMatchObject({ level: "unknown", value: null, evidenceCount: 12 });
    expect(signal.explanation).toMatch(/needs 4 answered sessions in each of two length ranges/);
  });

  it("ignores sessions with no answer: a timer cannot say how it went", () => {
    const signal = dna([...sized(10, 30, null, 12), ...sized(10, 60, null, 1)]).best_session_size;
    expect(signal).toMatchObject({ level: "unknown", evidenceCount: 0 });
  });

  it("concludes from the learner's own answers when one length clearly goes better", () => {
    const sessions = [
      ...sized(5, 30, "good", 20), ...sized(1, 30, "okay", 19),            // 5 of 6
      ...sized(1, 90, "good", 12), ...sized(4, 90, "struggled", 1),        // 1 of 5
    ];
    const signal = dna(sessions).best_session_size;
    expect(signal).toMatchObject({ level: "emerging", valueKey: "medium", valueLabel: "25–44 minutes", evidenceCount: 11, weakening: false });
    expect(signal.value).toEqual({
      kind: "comparison", label: "25–44 minutes", wentWell: 5, of: 6,
      against: [{ label: "75 minutes or more", wentWell: 1, of: 5 }],
    });
    expect(signal.explanation).toBe("5 of 6 went well at 25–44 minutes, against 1 of 5 at 75 minutes or more.");
  });

  it("counts Okay as answered but not as going well", () => {
    const sessions = [...sized(6, 30, "okay", 10), ...sized(4, 90, "okay", 1)];
    const signal = dna(sessions).best_session_size;
    expect(signal.level).toBe("unknown");
    expect(signal.explanation).toMatch(/^No session length stands out: 0 of 6 went well at 25–44 minutes; 0 of 4 went well at 75 minutes or more\.$/);
  });

  it("is only as confident as its smaller side", () => {
    const level = (a: number, b: number) => dna([...sized(a, 30, "good", b + 1), ...sized(b, 90, "struggled", 1)]).best_session_size.level;
    expect([level(30, 4), level(8, 8), level(15, 15)]).toEqual(["emerging", "supported", "strong"]);
  });

  it("weakens, then changes, when the learner starts doing better in shorter sessions", () => {
    // The belief: 50-minute sessions work, 30-minute ones do not.
    const belief = [...sized(8, 50, "good", 40), ...sized(8, 30, "struggled", 30)];
    expect(dna(belief).best_session_size).toMatchObject({ valueKey: "long", weakening: false });

    // Then the opposite, repeatedly.
    const turning = [...belief, ...sized(4, 30, "good", 9), ...sized(4, 50, "struggled", 1)];
    const mid = dna(turning).best_session_size;
    expect(mid.valueKey).toBe("long");              // 8 of 12 against 4 of 12: still ahead overall
    expect(mid.weakening).toBe(true);
    expect(mid.recent).toBe("In your latest 12, 25–44 minutes went better: 4 of 8.");

    // More of the same: the two lengths draw level, and Nova stops claiming either.
    const level = dna([...belief, ...sized(10, 30, "good", 11), ...sized(10, 50, "struggled", 1)]).best_session_size;
    expect(level).toMatchObject({ level: "unknown", valueKey: null, value: null });
    expect(level.explanation).toBe("No session length stands out: 10 of 18 went well at 25–44 minutes; 8 of 18 went well at 45–74 minutes.");

    // The old sessions leave the 90-day window; what remains says the opposite.
    const aged  = belief.map(x => ({ ...x, startedAt: new Date(x.startedAt.getTime() - 60 * DAY) }));
    const after = dna([...aged, ...sized(10, 30, "good", 11), ...sized(10, 50, "struggled", 1)]).best_session_size;
    expect(after).toMatchObject({ valueKey: "medium", level: "supported", weakening: false });
    expect(after.explanation).toBe("10 of 10 went well at 25–44 minutes, against 0 of 10 at 45–74 minutes.");
  });

  it("is not flipped by one unusual day", () => {
    const belief = [...sized(8, 50, "good", 20), ...sized(8, 30, "struggled", 10)];
    const oneBadDay = [...belief, s(1, { minutes: 50, outcome: "struggled" }), s(1, { minutes: 30, outcome: "crushed_it", hourUtc: 15 })];
    expect(dna(oneBadDay).best_session_size).toMatchObject({ valueKey: "long", weakening: false });
  });
});

describe("time of day", () => {
  it("makes no claim without a timezone", () => {
    const all = dna(run(20, { outcome: "good" }), { timezone: null });
    for (const key of ["usual_study_window", "best_study_window"] as const) {
      expect(all[key]).toMatchObject({ level: "unknown", value: null });
      expect(all[key].explanation).toBe("Nova doesn't know your timezone, so it makes no claim about the time of day you study.");
    }
    // Everything that does not depend on the clock is unaffected.
    expect(all.typical_session.level).toBe("strong");
  });

  it("reads the clock in the learner's timezone, not the server's", () => {
    expect(localHour(new Date("2026-10-04T16:30:00Z"), "UTC")).toBe(16);
    expect(localHour(new Date("2026-10-04T16:30:00Z"), "Asia/Kolkata")).toBe(22);
    expect(localHour(new Date("2026-10-04T18:30:00Z"), "Asia/Kolkata")).toBe(0);

    const sessions = run(10, { hourUtc: 16 });                 // 16:00 UTC is 21:30 in Kolkata
    expect(dna(sessions, { timezone: "UTC" }).usual_study_window.valueKey).toBe("afternoon");
    expect(dna(sessions, { timezone: "Asia/Kolkata" }).usual_study_window).toMatchObject({
      valueKey: "night", valueLabel: "Night (9pm–midnight)", level: "supported",
      value: { kind: "window", label: "Night (9pm–midnight)", sessions: 10, of: 10 },
    });
  });

  it("knows a real timezone from an invented one, and stores a renamed zone under its current name", () => {
    expect(["Asia/Kolkata", "America/New_York", "UTC"].every(isValidTimezone)).toBe(true);
    expect(["Mars/Olympus", "", "../../etc/passwd", "Asia/Kolkata; drop table x"].some(isValidTimezone)).toBe(false);
    expect(currentZoneName("Asia/Calcutta")).toBe("Asia/Kolkata");
    expect(currentZoneName("Europe/Berlin")).toBe("Europe/Berlin");
    expect(localHour(new Date("2026-10-04T16:30:00Z"), "Asia/Calcutta")).toBe(localHour(new Date("2026-10-04T16:30:00Z"), "Asia/Kolkata"));
  });

  it("does not make a night owl out of one late session", () => {
    expect(dna([s(1, { hourUtc: 23 })]).usual_study_window.value).toBeNull();
    const signal = dna([...run(9, { hourUtc: 10 }, 2), s(1, { hourUtc: 23 })]).usual_study_window;
    expect(signal.valueKey).toBe("morning");
    expect(signal.explanation).toBe("9 of your last 10 sessions started in this part of the day.");
  });

  it("names no usual time when sessions are spread across the day", () => {
    const sessions = [8, 10, 13, 15, 18, 20, 22, 23, 6, 16].map((hourUtc, i) => s(i + 1, { hourUtc }));
    const signal = dna(sessions).usual_study_window;
    expect(signal).toMatchObject({ level: "unknown", value: null });
    expect(signal.explanation).toMatch(/spread across the day/);
  });

  it("weakens when the latest eight sessions have moved to another part of the day", () => {
    const signal = dna([...run(12, { hourUtc: 10 }, 9), ...run(8, { hourUtc: 22 }, 1)]).usual_study_window;
    expect(signal).toMatchObject({ valueKey: "morning", weakening: true });
    expect(signal.recent).toBe("8 of your last 8 sessions started in the night (9pm–midnight).");
  });

  it("calls a time of day best from how sessions went, not from how many there were", () => {
    // Most sessions are in the evening, but the morning ones go better.
    const sessions = [
      ...run(4, { hourUtc: 18, outcome: "good" }, 30), ...run(8, { hourUtc: 18, outcome: "struggled" }, 18),   // 4 of 12
      ...run(5, { hourUtc: 10, outcome: "crushed_it" }, 5), s(1, { hourUtc: 10, outcome: "okay" }),             // 5 of 6
    ];
    const all = dna(sessions);
    expect(all.usual_study_window.valueKey).toBe("evening");
    expect(all.best_study_window).toMatchObject({ valueKey: "morning", level: "emerging" });
    expect(all.best_study_window.explanation).toBe("5 of 6 went well in the Morning (9am–noon), against 4 of 12 in the Evening (5–9pm).");
  });
});

describe("weekly rhythm", () => {
  // `perWeek[i]` study days in the i-th finished week, oldest first.
  const weeks = (perWeek: number[]) => perWeek.flatMap((n, i) => {
    const monday = 7 * (perWeek.length - i);
    return Array.from({ length: n }, (_, d) => s(monday - d));
  });

  it("needs four finished weeks", () => {
    const three = dna(weeks([4, 4, 4])).days_per_week;
    expect(three).toMatchObject({ level: "unknown", value: null, evidenceUnit: "weeks" });
    expect(dna(weeks([4, 4, 4, 4])).days_per_week).toMatchObject({ level: "emerging", evidenceCount: 4, valueLabel: "4 days a week" });
  });

  it("leaves out the week the learner started in, and the week still running", () => {
    // First session on a Thursday; three finished weeks after it; two sessions this week.
    const sessions = [s(25), ...weeks([3, 3, 3]), s(0)];
    expect(dna(sessions).days_per_week).toMatchObject({ level: "unknown", evidenceCount: 3 });
  });

  it("is the middle of the weeks, so one empty week does not rewrite it", () => {
    const signal = dna(weeks([4, 4, 0, 4, 5, 4])).days_per_week;
    expect(signal.value).toEqual({ kind: "days_per_week", typical: 4, low: 4, high: 4 });
    expect(signal.level).toBe("supported");
  });

  it("counts a day once, and in the learner's timezone", () => {
    // One study day in each of three weeks, then two sessions on one day of the fourth.
    const sessions = [...weeks([1, 1, 1, 0]), s(5, { hourUtc: 8 }), s(5, { hourUtc: 20 })];
    expect(dna(sessions).days_per_week.value).toEqual({ kind: "days_per_week", typical: 1, low: 1, high: 1 });
  });

  it("does not describe weeks of absence as a rhythm", () => {
    // Four finished weeks behind the first session, but only two sessions in them.
    const signal = dna([s(30), s(29)]).days_per_week;
    expect(signal).toMatchObject({ level: "unknown", value: null });
  });

  it("stays tentative when the weeks are uneven, and weakens when the last three differ", () => {
    const uneven = dna(weeks([1, 6, 2, 7, 1, 6, 2, 6])).days_per_week;
    expect(uneven.level).toBe("emerging");
    expect(uneven.explanation).toMatch(/is the middle, not a routine/);

    const dropped = dna(weeks([5, 5, 5, 5, 5, 1, 1, 1])).days_per_week;
    expect(dropped.weakening).toBe(true);
    expect(dropped.recent).toBe("Your last 3 weeks had about 1 study day each, down from 5 before.");
  });
});

describe("planned length", () => {
  it("needs five sessions that had a plan", () => {
    expect(dna(run(20)).plan_follow_through).toMatchObject({ level: "unknown", evidenceCount: 0 });
    expect(dna(run(4, { minutes: 25, plannedMinutes: 25 })).plan_follow_through.level).toBe("unknown");
  });

  it("describes the typical session against its plan", () => {
    const signal = dna([...run(6, { minutes: 25, plannedMinutes: 25 }, 3), s(2, { minutes: 5 + 10, plannedMinutes: 50 }), s(1, { minutes: 24, plannedMinutes: 25 })]).plan_follow_through;
    expect(signal).toMatchObject({ level: "emerging", valueKey: "on", valueLabel: "You usually finish the planned length", value: { kind: "percent_of_plan", typical: 100 } });
    expect(signal.explanation).toBe("In 7 of your last 8 sessions that had a planned length, you studied at least 90% of it. The typical one ran 100% of the plan.");
  });

  it("is not set by a single session", () => {
    const columns = legacyDnaColumns(Object.values(dna([s(1, { minutes: 10, plannedMinutes: 60 })])));
    expect(columns).toEqual({ optimalSessionMinutes: null, planAdherenceProfile: null, dataPointCount: 1, confidence: "low" });
  });
});

describe("gap before coming back to a topic", () => {
  const visits = (topic: string, plan: Array<[daysAgo: number, outcome: SessionOutcome]>) =>
    plan.map(([daysAgo, outcome]) => s(daysAgo, { topicName: topic, outcome }));

  it("needs repeated return visits at two different gaps", () => {
    const signal = dna(visits("Deadlocks", [[10, "good"], [8, "good"], [6, "good"]])).revision_spacing;
    expect(signal).toMatchObject({ level: "unknown", evidenceUnit: "reviews", evidenceCount: 2 });
  });

  it("compares how return visits went by how long the learner had been away", () => {
    const sessions = [
      // Back within a day or two: went well 4 of 4.
      ...visits("A", [[80, "okay"], [79, "good"], [78, "good"], [76, "good"], [75, "crushed_it"]]),
      // Back after two weeks or more: went well 0 of 4.
      ...visits("B", [[85, "good"], [70, "struggled"], [50, "struggled"], [30, "okay"], [10, "struggled"]]),
    ];
    const signal = dna(sessions).revision_spacing;
    expect(signal).toMatchObject({ level: "emerging", valueKey: "1-2", valueLabel: "a day or two later", evidenceCount: 8 });
    expect(signal.explanation).toBe("4 of 4 went well when you came back a day or two later, against 0 of 4 when you came back 2 weeks or more later.");
  });

  it("does not pair sessions on different topics, or twice on the same day", () => {
    const sessions = [
      s(9, { topicName: "A", outcome: "good" }), s(8, { topicName: "B", outcome: "good" }),
      s(5, { topicName: "C", outcome: "good", hourUtc: 9 }), s(5, { topicName: "C", outcome: "good", hourUtc: 15 }),
      s(4, { topicName: "A", subjectId: "db", outcome: "good" }),
    ];
    expect(dna(sessions).revision_spacing.evidenceCount).toBe(0);
  });
});

describe("topics that need more retrieval", () => {
  const on = (topic: string, outcomes: SessionOutcome[], over: Partial<DnaSession> = {}) =>
    outcomes.map((outcome, i) => s(outcomes.length - i, { topicName: topic, outcome, ...over }));
  const topic = (name: string, mastery: number, reviewCount: number): TopicMasteryState => ({
    topicId: name, topicName: name, subjectName: "Operating Systems", masteryProbability: mastery, lastStudied: NOW,
    retentionEstimate: 0.9, confidenceReported: mastery, calibrationGap: 0, reviewDueAt: null, masteryTrend: "stable", reviewCount,
  });

  it("does not flag a topic for one bad session", () => {
    expect(dna(on("Deadlocks", ["struggled"])).needs_more_retrieval.value).toBeNull();
    expect(dna(on("Deadlocks", ["good", "struggled", "good"])).needs_more_retrieval.value).toBeNull();
    expect(dna(on("Deadlocks", ["struggled", "struggled"])).needs_more_retrieval.value).toBeNull();   // two sessions is not three
  });

  it("flags a topic the learner has repeatedly said they struggled with", () => {
    const signal = dna(on("Deadlocks", ["struggled", "okay", "struggled"]), { topics: [topic("Deadlocks", 0.34, 3)] }).needs_more_retrieval;
    expect(signal).toMatchObject({ level: "emerging", valueLabel: "Deadlocks", evidenceCount: 3 });
    expect(signal.value).toEqual({ kind: "topics", topics: [{ topicName: "Deadlocks", subjectName: "Operating Systems", struggled: 2, answered: 3, masteryPercent: 34 }] });
    expect(signal.explanation).toBe("Deadlocks: \"Struggled\" in 2 of 3 answered sessions.");
  });

  it("drops a topic once its last two sessions went well", () => {
    const signal = dna(on("Deadlocks", ["struggled", "struggled", "struggled", "good", "crushed_it"])).needs_more_retrieval;
    expect(signal).toMatchObject({ level: "unknown", value: null });
    expect(signal.explanation).toBe("No topic shows repeated struggle in your recent answers.");
  });

  it("does not flag a topic that mostly goes well, unless it has just gone badly twice", () => {
    expect(dna(on("Paging", ["struggled", "good", "good", "struggled", "good", "good", "okay"])).needs_more_retrieval.value).toBeNull();
    const recent = dna(on("Paging", ["good", "good", "good", "good", "struggled", "struggled"])).needs_more_retrieval;
    expect(recent.valueLabel).toBe("Paging");
  });

  it("keeps the same topic name under two subjects apart", () => {
    const sessions = [...on("Indexing", ["struggled", "good"]), ...on("Indexing", ["struggled", "good"], { subjectId: "db" })];
    expect(dna(sessions).needs_more_retrieval.value).toBeNull();
  });

  it("lists the most-struggled topic first and grows more confident with more sessions", () => {
    const sessions = [...on("Paging", ["struggled", "okay", "struggled"]), ...on("Deadlocks", ["struggled", "struggled", "okay", "struggled", "struggled"])];
    const signal = dna(sessions).needs_more_retrieval;
    expect(signal.valueLabel).toBe("Deadlocks, Paging");
    expect(signal.level).toBe("supported");
    expect(signal.evidenceCount).toBe(8);
  });

  it("shows a mastery number only for a topic a session has fed", () => {
    const signal = dna(on("Deadlocks", ["struggled", "okay", "struggled"]), { topics: [topic("Deadlocks", 0.21, 0)] }).needs_more_retrieval;
    expect(signal.value).toMatchObject({ topics: [{ masteryPercent: null }] });
  });
});

describe("one-off events never become traits", () => {
  const cases: Array<[string, DnaSession]> = [
    ["one late-night session", s(1, { hourUtc: 23, outcome: "good" })],
    ["one failed session", s(1, { outcome: "struggled" })],
    ["one very long session", s(1, { minutes: 240, outcome: "crushed_it" })],
    ["one abandoned plan", s(1, { minutes: 10, plannedMinutes: 90 })],
  ];
  it.each(cases)("%s concludes nothing", (_name, session) => {
    for (const signal of Object.values(dna([session]))) {
      expect(signal.level).toBe("unknown");
      expect(signal.value).toBeNull();
    }
  });

  it("an established learner's signals do not move for one odd day", () => {
    // Twenty days, alternating a good 30-minute session and a hard 60-minute one.
    const steady = Array.from({ length: 20 }, (_, i) => i % 2
      ? s(21 - i, { minutes: 60, hourUtc: 10, outcome: "struggled", plannedMinutes: 60 })
      : s(21 - i, { minutes: 30, hourUtc: 10, outcome: "good", plannedMinutes: 30 }));
    const odd    = s(1, { minutes: 200, hourUtc: 2, outcome: "crushed_it", plannedMinutes: 25 });
    const before = dna(steady), after = dna([...steady, odd]);
    for (const key of ["typical_session", "usual_study_window", "best_session_size", "plan_follow_through"] as const) {
      expect([key, after[key].valueKey, after[key].weakening]).toEqual([key, before[key].valueKey, false]);
    }
  });
});

describe("remembering a conclusion, and noticing it change", () => {
  const T0 = new Date("2026-09-01T12:00:00Z");
  const later = (days: number) => new Date(T0.getTime() + days * DAY);
  const signal = (over: Partial<DnaSignal> = {}): DnaSignal => ({
    key: "typical_session", level: "emerging", valueKey: "long", valueLabel: "About 45 minutes",
    value: { kind: "minutes", typical: 45, low: 40, high: 50 }, evidenceCount: 6, evidenceUnit: "sessions",
    lastEvidenceAt: T0, weakening: false, recent: null, explanation: "x", ...over,
  });

  it("starts remembering when a conclusion is first reached, not before", () => {
    expect(advanceDnaMemory({}, [signal({ level: "unknown", valueKey: null, valueLabel: null, value: null })], T0)).toEqual({});
    expect(advanceDnaMemory({}, [signal()], T0).typical_session).toEqual({
      valueKey: "long", valueLabel: "About 45 minutes", level: "emerging",
      since: T0.toISOString(), levelSince: T0.toISOString(), previousLevel: null, previous: null,
    });
  });

  it("keeps the start date while the conclusion holds, and notes a change of level", () => {
    let memory = advanceDnaMemory({}, [signal()], T0);
    memory = advanceDnaMemory(memory, [signal({ valueLabel: "About 47 minutes" })], later(3));
    expect(memory.typical_session).toMatchObject({ since: T0.toISOString(), levelSince: T0.toISOString(), valueLabel: "About 47 minutes" });

    memory = advanceDnaMemory(memory, [signal({ level: "supported" })], later(9));
    expect(memory.typical_session).toMatchObject({ since: T0.toISOString(), level: "supported", levelSince: later(9).toISOString(), previousLevel: "emerging" });
  });

  it("records what a new conclusion replaced", () => {
    let memory: DnaMemoryMap = advanceDnaMemory({}, [signal({ level: "supported" })], T0);
    memory = advanceDnaMemory(memory, [signal({ valueKey: "medium", valueLabel: "About 25 minutes", level: "supported" })], later(20));
    expect(memory.typical_session).toEqual({
      valueKey: "medium", valueLabel: "About 25 minutes", level: "supported",
      since: later(20).toISOString(), levelSince: later(20).toISOString(), previousLevel: "supported",
      previous: { label: "About 45 minutes", until: later(20).toISOString() },
    });
  });

  it("describes the trend: new, strengthening, steady, changed, weakening", () => {
    const fresh = advanceDnaMemory({}, [signal()], T0);
    expect(trendOf(signal(), fresh.typical_session, later(2))).toEqual({ trend: "new", note: "Nova has only recently had enough evidence to say this." });
    expect(trendOf(signal(), fresh.typical_session, later(40)).trend).toBe("steady");

    const stronger = advanceDnaMemory(fresh, [signal({ level: "supported" })], later(20));
    expect(trendOf(signal({ level: "supported" }), stronger.typical_session, later(22)).trend).toBe("strengthening");
    expect(trendOf(signal({ level: "supported" }), stronger.typical_session, later(60)).trend).toBe("steady");

    const changed = advanceDnaMemory(stronger, [signal({ valueKey: "medium", valueLabel: "About 25 minutes" })], later(30));
    expect(trendOf(signal({ valueKey: "medium", valueLabel: "About 25 minutes" }), changed.typical_session, later(35)))
      .toEqual({ trend: "changed", note: "This used to be \"About 45 minutes\"." });

    // Recent sessions disagree: weakening, whatever the memory says.
    expect(trendOf(signal({ weakening: true, recent: "Your last 8 sessions ran about 25 minutes." }), fresh.typical_session, later(2)))
      .toEqual({ trend: "weakening", note: "Your last 8 sessions ran about 25 minutes." });

    // The evidence behind it thinned out (sessions aged out of the window).
    const thinner = advanceDnaMemory(stronger, [signal({ level: "emerging" })], later(70));
    expect(trendOf(signal({ level: "emerging" }), thinner.typical_session, later(72)).trend).toBe("weakening");
  });

  it("has no trend for a signal with no conclusion, and ignores memory of a different one", () => {
    const memory = advanceDnaMemory({}, [signal()], T0);
    expect(trendOf(signal({ level: "unknown", valueKey: null, value: null }), memory.typical_session, later(1))).toEqual({ trend: null, note: null });
    expect(trendOf(signal({ valueKey: "short" }), memory.typical_session, later(1)).trend).toBe("steady");
    expect(trendOf(signal(), undefined, later(1)).trend).toBe("steady");
  });
});

describe("the legacy columns hold the engine's conclusion and nothing else", () => {
  it("fills them from the signals", () => {
    const sessions = run(12, { minutes: 35, plannedMinutes: 30 });
    expect(legacyDnaColumns(Object.values(dna(sessions)))).toEqual({
      optimalSessionMinutes: 35, planAdherenceProfile: "consistent", dataPointCount: 12, confidence: "medium",
    });
    expect(legacyDnaColumns(Object.values(dna(run(25)))).confidence).toBe("high");
    expect(legacyDnaColumns(Object.values(dna(run(6)))).confidence).toBe("low");
  });
});

describe("the view", () => {
  const view = (sessions: DnaSession[], memory: DnaMemoryMap = {}, timezone: string | null = "UTC") => buildLearningDnaView({
    signals: Object.values(dna(sessions, { timezone })), memory,
    sessionsConsidered: sessions.length, answeredSessions: sessions.filter(x => x.outcome).length,
    timezone, statedStudyTime: "evening", now: NOW,
  });

  it("gives every signal a label, a section, its support and its reason", () => {
    const v = view(run(12, { minutes: 35, outcome: "good" }));
    expect(v.signals.map(x => [x.key, x.section])).toEqual([
      ["typical_session", "rhythm"], ["plan_follow_through", "rhythm"], ["days_per_week", "rhythm"], ["usual_study_window", "rhythm"],
      ["best_session_size", "works"], ["best_study_window", "works"], ["revision_spacing", "works"], ["needs_more_retrieval", "struggles"],
    ]);
    const typical = v.signals[0]!;
    expect(typical).toMatchObject({
      label: "Typical session", level: "supported", headline: "About 35 minutes", evidenceCount: 12, evidenceUnit: "sessions", trend: "steady",
    });
    expect(typical.lastUpdated).toBe(new Date(NOW.getTime() - DAY).toISOString().replace("T12", "T10"));
    for (const x of v.signals) expect(x.explanation.length).toBeGreaterThan(10);
  });

  it("never gives a value, a headline or a trend to a signal with no conclusion", () => {
    const v = view(run(3));
    expect(v.sessionsConsidered).toBe(3);
    for (const x of v.signals) expect([x.level, x.value, x.headline, x.trend, x.heldSince]).toEqual(["unknown", null, null, null, null]);
    expect(v.changing).toEqual([]);
  });

  it("lists what is changing, and only that", () => {
    const sessions = [...run(12, { minutes: 45 }, 9), ...run(8, { minutes: 25 }, 1)];
    const v = view(sessions);
    expect(v.changing).toContain("typical_session");
    expect(v.signals.find(x => x.key === "typical_session")).toMatchObject({ trend: "weakening", trendNote: expect.stringContaining("Your last 8 sessions ran about 25 minutes") });
    expect(v.changing.every(key => v.signals.find(x => x.key === key)!.trend !== "steady")).toBe(true);
  });

  it("carries since-when and what-it-replaced from memory, for the same conclusion only", () => {
    const sessions = run(12, { minutes: 35 });
    const since = new Date(NOW.getTime() - 5 * DAY).toISOString();
    const memory: DnaMemoryMap = { typical_session: { valueKey: "medium", valueLabel: "About 35 minutes", level: "supported", since, levelSince: since, previousLevel: "supported", previous: { label: "About 60 minutes", until: since } } };
    const held = view(sessions, memory).signals[0]!;
    expect(held).toMatchObject({ heldSince: since, previous: { label: "About 60 minutes", until: since }, trend: "changed" });

    const other = view(sessions, { typical_session: { ...memory.typical_session!, valueKey: "long" } }).signals[0]!;
    expect(other).toMatchObject({ heldSince: null, previous: null, trend: "steady" });
  });

  it("passes on what the learner said as a statement, and says what Nova does not track", () => {
    const v = view(run(6), {}, null);
    expect(v.statedStudyTime).toBe("evening");
    expect(v.timezone).toBeNull();
    expect(v.signals.find(x => x.key === "usual_study_window")!.value).toBeNull();
    expect(v.notTracked).toBe(NOT_TRACKED);
    expect(v.notTracked.map(n => n.label)).toEqual(["Distraction triggers", "Burnout threshold", "Preferred formats", "Focus and energy"]);
    expect(v.thresholds).toEqual({ emerging: 5, supported: 10, strong: 20, perSide: 4, leadPoints: 20 });
  });

  it("claims nothing about distraction, burnout, focus, energy or formats", () => {
    const sessions = [...run(20, { minutes: 15, outcome: "struggled", hourUtc: 2 }, 22), ...run(20, { minutes: 200, outcome: "struggled" }, 1)];
    const v = view(sessions);
    const said = JSON.stringify({ signals: v.signals, changing: v.changing });
    expect(said).not.toMatch(/distract|burn.?out|focus|energy|video|night owl|procrastinat|lazy|attention/i);
  });

  it("is the same for the same evidence", () => {
    const sessions = run(15, { minutes: 35, outcome: "good" });
    expect(view(sessions)).toEqual(view([...sessions].reverse()));
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
const files = sourceFiles(".").map(path => ({ path, src: read(path) }));

describe("Learning DNA has one owner", () => {
  it("is computed in the engine, which touches no database and no LLM", () => {
    const engine = read("engines/learning-dna-engine.ts");
    expect(engine).not.toMatch(/@repo\/db|prisma|openai|generateOpenAIText/);
    expect(engine).not.toMatch(/from "\.\.\/(brains|consolidation|decision|context|adapters|persistence|product)\//);
  });

  it("is written by the store and by nothing else", () => {
    const writers = files.filter(f => /novaLearningDNA\.(create|update|upsert|delete)/.test(f.src)).map(f => f.path);
    expect(writers).toEqual(["persistence/learning-dna-store.ts"]);
    const callers = files.filter(f => /\brefreshLearningDna\(/.test(f.src)).map(f => f.path).sort();
    expect(callers).toEqual(["persistence/learning-dna-store.ts", "persistence/nova-persistence.ts"]);
  });

  it("is concluded nowhere else: no other file computes a signal", () => {
    const computing = files.filter(f => /\bcomputeLearningDna\(/.test(f.src)).map(f => f.path).sort();
    expect(computing).toEqual(["engines/learning-dna-engine.ts", "persistence/learning-dna-store.ts"]);
    // Progress shows the stored session length; it does not work one out.
    const progress = read("product/progress.ts");
    expect(progress).toMatch(/optimalSessionMinutes/);
    expect(progress).not.toMatch(/percentile|median|computeLearningDna/);
  });

  it("writes to no memory system: facts, reality, patterns, mastery and messages are untouched", () => {
    for (const path of ["engines/learning-dna-engine.ts", "persistence/learning-dna-store.ts", "product/learning-dna.ts"]) {
      const src = read(path);
      expect(src).not.toMatch(/userFact|userReality|behavioralPattern|companionMessage|novaCognitiveState|novaNote|memoryFact/);
      expect(src).not.toMatch(/novaTopicMastery\.(create|update|upsert|delete)|updateTopicMastery/);
      expect(src).not.toMatch(/from "\.\.\/(brains|consolidation|decision)\//);
    }
  });

  it("reads only finished, timed sessions of ten minutes or more as evidence", () => {
    const store = read("persistence/learning-dna-store.ts");
    expect(store).toMatch(/status:\s+"completed"/);
    expect(store).toMatch(/activityType:\s+\{ not: SELF_REPORTED_ACTIVITY \}/);
    expect(store).toMatch(/durationMinutes: \{ gte: COUNTED_SESSION_MINUTES \}/);
  });

  it("is not tied to a browser: evidence is sessions, whatever surface produced them", () => {
    for (const path of ["engines/learning-dna-engine.ts", "persistence/learning-dna-store.ts"]) {
      expect(read(path)).not.toMatch(/\bchrome\b|\bnavigator\.|\bdocument\.|extension/i);
    }
  });

  it("lets the view builder change one thing only: an unset timezone", () => {
    const product = read("product/learning-dna.ts");
    const writes  = [...product.matchAll(/prisma\.(\w+)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/g)].map(m => `${m[1]}.${m[2]}`);
    expect(writes).toEqual(["novaAcademicProfile.updateMany"]);
    expect(product).toMatch(/OR: \[\{ timezone: null \}/);
  });

  it("has a contract the web app can import without pulling in the server", () => {
    expect(read("product/learning-dna.types.ts")).not.toMatch(/^import /m);
  });
});
