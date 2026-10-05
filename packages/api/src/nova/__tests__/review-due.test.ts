// One definition of "due for review" (retention-engine.ts): the scheduled
// date is the authority. Retention is context, never a condition.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  RETENTION_TARGET, daysOverdue, daysSinceStudied, estimateRetention,
  getOverdueTopics, isDueForReview,
} from "../engines/retention-engine";
import type { TopicMasteryState } from "../types/engine.types";

const DAY = 86_400_000;
const NOW = new Date("2026-10-05T18:00:00Z");
const days = (d: number) => new Date(NOW.getTime() + d * DAY);

// A stored topic row, read the way the Knowledge Engine reads it.
function read(row: { nextReviewAt: Date | null; lastStudiedAt: Date | null; efFactor?: number }, now = NOW): TopicMasteryState {
  return {
    topicId: "t", topicName: "Deadlocks", subjectName: "Operating Systems",
    masteryProbability: 0.5, confidenceReported: 0.5, calibrationGap: 0, masteryTrend: "stable", reviewCount: 1,
    lastStudied: row.lastStudiedAt,
    retentionEstimate: estimateRetention(row.efFactor ?? 2.5, daysSinceStudied(row.lastStudiedAt, now)),
    reviewDueAt: row.nextReviewAt,
  };
}

describe("due for review: the schedule decides", () => {
  it("a topic with no review date is not due", () => {
    const t = read({ nextReviewAt: null, lastStudiedAt: days(-30) });
    expect(isDueForReview(t, NOW)).toBe(false);
    expect(daysOverdue(t, NOW)).toBe(0);
  });

  it("is not due before its date, due from the moment the date arrives", () => {
    const row = { nextReviewAt: days(1), lastStudiedAt: NOW };
    expect(isDueForReview(read(row), NOW)).toBe(false);
    expect(isDueForReview(read(row), new Date(days(1).getTime() - 1))).toBe(false);
    expect(isDueForReview(read(row, days(1)), days(1))).toBe(true);           // nextReviewAt <= now
    expect(isDueForReview(read(row, days(4)), days(4))).toBe(true);
  });

  it("overdue is counted in whole days past the date", () => {
    const row = { nextReviewAt: days(-2), lastStudiedAt: days(-9) };
    expect(daysOverdue(read(row), NOW)).toBe(2);
    expect(daysOverdue(read({ ...row, nextReviewAt: new Date(NOW.getTime() - 3_600_000) }), NOW)).toBe(0);   // due today
    expect(daysOverdue(read({ ...row, nextReviewAt: days(3) }), NOW)).toBe(0);                                // not due
  });

  it("a topic scheduled for tomorrow is due tomorrow even though it is still fresh", () => {
    // What "Struggled" produces: studied now, next review in one day.
    const row = { nextReviewAt: days(1), lastStudiedAt: NOW };
    const tomorrow = days(1);
    expect(read(row, tomorrow).retentionEstimate).toBeGreaterThanOrEqual(RETENTION_TARGET);
    expect(isDueForReview(read(row, tomorrow), tomorrow)).toBe(true);
  });

  it("a topic that has faded is still not due before its date", () => {
    const row = { nextReviewAt: days(4), lastStudiedAt: days(-20) };
    expect(read(row).retentionEstimate).toBeLessThan(RETENTION_TARGET);
    expect(isDueForReview(read(row), NOW)).toBe(false);
  });

  it("retention does not change the answer, at any ease, age or date", () => {
    // Every combination of ease factor, days since study, and scheduled date,
    // judged at 21 moments: due is exactly "the date has arrived".
    const efs = [1.3, 2.0, 2.5, 3.1, 3.5];
    let checked = 0, due = 0, dueWhileFresh = 0, fadedNotDue = 0;
    for (const ef of efs) for (let studied = 0; studied <= 16; studied++) for (let scheduled = -3; scheduled <= 12; scheduled++) {
      const row = {
        efFactor: ef,
        lastStudiedAt: new Date(NOW.getTime() - studied * DAY - 3_600_000),
        nextReviewAt:  new Date(NOW.getTime() - studied * DAY + scheduled * DAY),
      };
      for (let ahead = 0; ahead <= 20; ahead++) {
        const now      = new Date(NOW.getTime() + ahead * DAY);
        const topic    = read(row, now);
        const expected = row.nextReviewAt <= now;
        expect(isDueForReview(topic, now)).toBe(expected);
        expect(getOverdueTopics([topic], now).length).toBe(expected ? 1 : 0);
        checked++;
        if (expected) due++;
        if (expected && topic.retentionEstimate >= RETENTION_TARGET) dueWhileFresh++;
        if (!expected && topic.retentionEstimate < RETENTION_TARGET) fadedNotDue++;
      }
    }
    expect(checked).toBe(28_560);
    expect(due).toBeGreaterThan(1_000);
    expect(due).toBeLessThan(checked);
    // Both directions occur in the grid, so the test would catch retention
    // creeping back into the rule either way.
    expect(dueWhileFresh).toBeGreaterThan(100);
    expect(fadedNotDue).toBeGreaterThan(100);
  });
});

describe("retention is context", () => {
  it("still falls with time and is still read through the one curve", () => {
    expect(estimateRetention(2.5, 0)).toBe(1);
    expect(estimateRetention(2.5, 4)).toBeGreaterThanOrEqual(RETENTION_TARGET);
    expect(estimateRetention(2.5, 5)).toBeLessThan(RETENTION_TARGET);
    expect(estimateRetention(3.5, 5)).toBeGreaterThan(estimateRetention(2.5, 5));   // a higher ease fades more slowly
    expect(daysSinceStudied(null, NOW)).toBe(999);
  });

  it("orders the due topics, least retained first, without deciding which are due", () => {
    const named = (name: string, row: Parameters<typeof read>[0]) => ({ ...read(row), topicName: name });
    const topics = [
      named("Fresh, due",      { nextReviewAt: days(-1), lastStudiedAt: days(-1) }),
      named("Faded, due",      { nextReviewAt: days(-1), lastStudiedAt: days(-8) }),
      named("Gone, due",       { nextReviewAt: days(-9), lastStudiedAt: days(-40) }),
      named("Faded, not due",  { nextReviewAt: days(5),  lastStudiedAt: days(-30) }),
      named("Never scheduled", { nextReviewAt: null,     lastStudiedAt: days(-30) }),
    ];
    expect(getOverdueTopics(topics, NOW).map(t => t.topicName)).toEqual(["Gone, due", "Faded, due", "Fresh, due"]);
  });
});

// Every surface reads the one definition. These read the source, like the
// architecture-boundary tests: a surface that grows its own date comparison
// would not fail any behaviour test until the two drifted apart.
describe("one definition, every surface", () => {
  const src = (file: string) => readFileSync(resolve(__dirname, "..", file), "utf8");

  it.each([
    ["Home / Today",            "product/today.ts"],
    ["Knowledge",               "product/knowledge.ts"],
    ["Planning Engine",         "engines/planning-engine.ts"],
    ["Telegram proactive cron", "proactive/nova-proactive-cron.ts"],
  ])("%s takes its due topics from getOverdueTopics", (_name, file) => {
    expect(src(file)).toMatch(/getOverdueTopics\(/);
  });

  it("the due date every reader sees is the stored schedule, untouched", () => {
    expect(src("engines/knowledge-engine.ts")).toMatch(/reviewDueAt:\s+topic\.nextReviewAt,/);
    expect(src("product/planner.ts")).toMatch(/dayKey\(t\.reviewDueAt, timezone\) === date/);
  });

  it("the rule itself does not mention retention", () => {
    const code = src("engines/retention-engine.ts").replace(/\/\/.*$/gm, "");
    const rule = code.slice(code.indexOf("export function isDueForReview"), code.indexOf("export function daysOverdue"));
    expect(rule).toMatch(/reviewDueAt <= now/);
    expect(rule).not.toMatch(/retention/i);
  });

  it.each([
    "product/today.ts", "product/planner.ts", "product/knowledge.ts",
    "engines/planning-engine.ts", "proactive/nova-proactive-cron.ts",
  ])("%s does not compare review dates or the stored nextReviewAt itself", file => {
    const code = src(file).replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/reviewDueAt\s*(<=?|>=?)\s*now/);
    expect(code).not.toMatch(/nextReviewAt\s*:\s*\{\s*lte?/);
    expect(code).not.toMatch(/retentionEstimate\s*<\s*(RETENTION_TARGET|0\.85)/);
  });

  it("the forgetting curve is defined once", () => {
    expect(src("engines/knowledge-engine.ts")).not.toMatch(/Math\.exp/);
  });
});
