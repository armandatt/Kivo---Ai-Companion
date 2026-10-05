// One definition of "due for review" (retention-engine.ts), and everything
// that shows or acts on reviews reading it.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  RETENTION_TARGET, daysOverdue, daysSinceStudied, estimateRetention,
  getOverdueTopics, isDueForReview, reviewDueAt,
} from "../engines/retention-engine";
import type { TopicMasteryState } from "../types/engine.types";

const DAY = 86_400_000;
const NOW = new Date("2026-10-05T18:00:00Z");
const days = (d: number) => new Date(NOW.getTime() + d * DAY);

// A stored topic row, read the way the Knowledge Engine reads it.
function read(row: { nextReviewAt: Date | null; lastStudiedAt: Date | null; efFactor?: number }, now = NOW): TopicMasteryState {
  const efFactor = row.efFactor ?? 2.5;
  return {
    topicId: "t", topicName: "Deadlocks", subjectName: "Operating Systems",
    masteryProbability: 0.5, confidenceReported: 0.5, calibrationGap: 0, masteryTrend: "stable", reviewCount: 1,
    lastStudied: row.lastStudiedAt,
    retentionEstimate: estimateRetention(efFactor, daysSinceStudied(row.lastStudiedAt, now)),
    reviewDueAt: reviewDueAt({ ...row, efFactor }),
  };
}

// The rule the planner used before there was one definition.
const oldPlannerRule = (row: { nextReviewAt: Date | null; lastStudiedAt: Date | null; efFactor?: number }, now: Date) => {
  const t = read(row, now);
  return row.nextReviewAt !== null && row.nextReviewAt <= now && t.retentionEstimate < RETENTION_TARGET;
};

describe("reviewDueAt", () => {
  it("is null for a topic that was never scheduled", () => {
    expect(reviewDueAt({ nextReviewAt: null, lastStudiedAt: days(-30), efFactor: 2.5 })).toBeNull();
    expect(isDueForReview(read({ nextReviewAt: null, lastStudiedAt: days(-30) }), NOW)).toBe(false);
  });

  it("a passed date is not enough while the topic is still fresh", () => {
    // Scheduled two days after study, but retention only falls below the
    // target on day 5 (ease 2.5): due on day 5, not day 2.
    const row = { nextReviewAt: days(-1), lastStudiedAt: days(-3) };
    expect(read(row).retentionEstimate).toBeGreaterThanOrEqual(RETENTION_TARGET);
    expect(isDueForReview(read(row), NOW)).toBe(false);
    expect(reviewDueAt({ ...row, efFactor: 2.5 })).toEqual(days(2));
  });

  it("faded retention is not enough before the scheduled date", () => {
    const row = { nextReviewAt: days(4), lastStudiedAt: days(-20) };
    expect(read(row).retentionEstimate).toBeLessThan(RETENTION_TARGET);
    expect(isDueForReview(read(row), NOW)).toBe(false);
    expect(reviewDueAt({ ...row, efFactor: 2.5 })).toEqual(days(4));
  });

  it("due once both hold", () => {
    const t = read({ nextReviewAt: days(-2), lastStudiedAt: days(-9) });
    expect(isDueForReview(t, NOW)).toBe(true);
    expect(daysOverdue(t, NOW)).toBe(2);
  });

  it("a topic first mentioned in conversation (scheduled for now, studied now) is not due", () => {
    const t = read({ nextReviewAt: NOW, lastStudiedAt: NOW });
    expect(isDueForReview(t, NOW)).toBe(false);
    expect(t.reviewDueAt).toEqual(days(5));
  });

  it("a topic never studied is due as soon as its date passes", () => {
    expect(isDueForReview(read({ nextReviewAt: days(-1), lastStudiedAt: null }), NOW)).toBe(true);
  });

  it("a topic that fades more slowly comes due later", () => {
    const base = { nextReviewAt: days(-10), lastStudiedAt: days(-5) };
    expect(isDueForReview(read({ ...base, efFactor: 2.5 }), NOW)).toBe(true);
    expect(isDueForReview(read({ ...base, efFactor: 3.5 }), NOW)).toBe(false);
  });

  it("agrees with the planner's previous rule at every moment, for every row", () => {
    const efs = [1.3, 2.0, 2.5, 3.1, 3.5];
    let checked = 0, due = 0;
    for (const ef of efs) for (let studied = 0; studied <= 16; studied++) for (let scheduled = -3; scheduled <= 12; scheduled++) {
      const row = { efFactor: ef, lastStudiedAt: new Date(NOW.getTime() - studied * DAY - 3_600_000), nextReviewAt: new Date(NOW.getTime() - studied * DAY + scheduled * DAY) };
      for (let ahead = 0; ahead <= 20; ahead++) {
        const now = new Date(NOW.getTime() + ahead * DAY);
        const expected = oldPlannerRule(row, now);
        expect(isDueForReview(read(row, now), now)).toBe(expected);
        checked++; if (expected) due++;
      }
    }
    expect(checked).toBeGreaterThan(20_000);
    expect(due).toBeGreaterThan(1_000);
    expect(due).toBeLessThan(checked);
  });
});

describe("getOverdueTopics", () => {
  it("returns exactly the due topics, the least retained first", () => {
    const fresh   = { ...read({ nextReviewAt: days(-1), lastStudiedAt: days(-2) }), topicName: "Fresh" };
    const faded   = { ...read({ nextReviewAt: days(-1), lastStudiedAt: days(-8) }), topicName: "Faded" };
    const gone    = { ...read({ nextReviewAt: days(-9), lastStudiedAt: days(-40) }), topicName: "Gone" };
    const later   = { ...read({ nextReviewAt: days(5), lastStudiedAt: days(-30) }), topicName: "Later" };
    expect(getOverdueTopics([fresh, faded, gone, later], NOW).map(t => t.topicName)).toEqual(["Gone", "Faded"]);
  });
});

// Every surface reads the one definition. These read the source, like the
// architecture-boundary tests: a surface that grows its own date comparison
// would not fail any behaviour test until the two drifted apart.
describe("one definition, every surface", () => {
  const src = (file: string) => readFileSync(resolve(__dirname, "..", file), "utf8");

  it.each([
    ["Home / Today",          "product/today.ts"],
    ["Knowledge",             "product/knowledge.ts"],
    ["Planning Engine",       "engines/planning-engine.ts"],
    ["Telegram proactive cron", "proactive/nova-proactive-cron.ts"],
  ])("%s takes its due topics from getOverdueTopics", (_name, file) => {
    expect(src(file)).toMatch(/getOverdueTopics\(/);
  });

  it("the Planner's week view places reviews by the same due date", () => {
    expect(src("product/planner.ts")).toMatch(/dayKey\(t\.reviewDueAt, timezone\) === date/);
    expect(src("engines/knowledge-engine.ts")).toMatch(/reviewDueAt:\s+reviewDueAt\(topic\)/);
  });

  it.each([
    "product/today.ts", "product/planner.ts", "product/knowledge.ts",
    "engines/planning-engine.ts", "proactive/nova-proactive-cron.ts",
  ])("%s does not compare review dates or the stored nextReviewAt itself", file => {
    const code = src(file).replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/reviewDueAt\s*(<=?|>=?)\s*now/);
    expect(code).not.toMatch(/nextReviewAt\s*:\s*\{\s*lte?/);
  });

  it("the forgetting curve is defined once", () => {
    expect(src("engines/knowledge-engine.ts")).not.toMatch(/Math\.exp/);
  });
});
