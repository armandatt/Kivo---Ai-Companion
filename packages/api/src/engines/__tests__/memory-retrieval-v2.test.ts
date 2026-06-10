import { scoreAndRankFacts } from "../memory-retrieval-v2";
import type { RawMemoryInput } from "../memory-retrieval-v2";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fact(
  overrides: Partial<RawMemoryInput> & { type: string; value: string },
): RawMemoryInput {
  return {
    id:         overrides.id         ?? "id-" + Math.random().toString(36).slice(2),
    type:       overrides.type,
    key:        overrides.key        ?? overrides.type,
    value:      overrides.value,
    confidence: overrides.confidence ?? 0.90,
    createdAt:  overrides.createdAt  ?? new Date(Date.now() - 7 * 24 * 3600_000),  // 7 days ago
    updatedAt:  overrides.updatedAt  ?? new Date(Date.now() - 7 * 24 * 3600_000),
  };
}

const NOW = new Date("2026-06-09T12:00:00Z");

function rank(
  facts:       RawMemoryInput[],
  message:     string,
  opts:        { intent?: string; emotion?: string; activeGoals?: string[]; topK?: number } = {},
) {
  return scoreAndRankFacts(facts, {
    message,
    intent:      opts.intent      ?? "general_chat",
    emotion:     opts.emotion     ?? "neutral",
    activeGoals: opts.activeGoals ?? [],
    topK:        opts.topK        ?? facts.length,
  }, NOW);
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRIORITY ORDER
// Struggles must outrank achievements which must outrank preferences,
// even when token overlap is equal.
// ═══════════════════════════════════════════════════════════════════════════════

describe("Priority ordering", () => {
  test("struggle ranks above achievement above preference for neutral message", () => {
    const facts = [
      fact({ type: "preference",  value: "trains at 6pm" }),
      fact({ type: "achievement", value: "hit a new bench press PR" }),
      fact({ type: "struggle",    value: "keeps missing leg day" }),
    ];
    const ranked = rank(facts, "just checking in");
    expect(ranked[0]!.type).toBe("struggle");
    expect(ranked[1]!.type).toBe("achievement");
    expect(ranked[2]!.type).toBe("preference");
  });

  test("commitment ranks above promise above breakthrough above goal", () => {
    const facts = [
      fact({ type: "goal",        value: "build more muscle" }),
      fact({ type: "breakthrough",value: "finally figured out my sleep schedule" }),
      fact({ type: "promise",     value: "promised to stop skipping Fridays" }),
      fact({ type: "commitment",  value: "committed to 4 sessions this week" }),
    ];
    const ranked = rank(facts, "just checking in");
    const types = ranked.map(r => r.type);
    expect(types.indexOf("commitment")).toBeLessThan(types.indexOf("promise"));
    expect(types.indexOf("promise")).toBeLessThan(types.indexOf("breakthrough"));
    expect(types.indexOf("breakthrough")).toBeLessThan(types.indexOf("goal"));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SEMANTIC MATCHING
// V2 must surface semantically related memories even without exact word match.
// ═══════════════════════════════════════════════════════════════════════════════

describe("Semantic matching", () => {
  test("struggle fact surfaces when message mentions skipping (synonym cluster)", () => {
    const facts = [
      fact({ type: "struggle", value: "I keep missing leg day and can't stay consistent" }),
      fact({ type: "preference", value: "prefers morning sessions" }),
    ];
    const ranked = rank(facts, "I skipped leg day again today");
    expect(ranked[0]!.type).toBe("struggle");
    expect(ranked[0]!.score).toBeGreaterThan(ranked[1]!.score);
  });

  test("achievement fact surfaces when message mentions PR (cluster match)", () => {
    const facts = [
      fact({ type: "achievement", value: "hit a new personal record on bench press — 100kg" }),
      fact({ type: "preference",  value: "trains early morning" }),
    ];
    const ranked = rank(facts, "thinking about my best lift");
    expect(ranked[0]!.type).toBe("achievement");
  });

  test("stemming: 'struggled' in fact matches 'struggling' in message", () => {
    const facts = [
      fact({ type: "struggle",   value: "struggled with sleep consistency for months" }),
      fact({ type: "preference", value: "eats 150g protein daily" }),
    ];
    const ranked = rank(facts, "I keep struggling to get enough sleep");
    expect(ranked[0]!.type).toBe("struggle");
  });

  test("commitment fact surfaces when message signals a commitment intent", () => {
    const facts = [
      fact({ type: "commitment", value: "going to train 4x this week no matter what" }),
      fact({ type: "preference", value: "likes PPL split" }),
    ];
    const ranked = rank(facts, "I plan to go every day this week", { intent: "commitment_made" });
    expect(ranked[0]!.type).toBe("commitment");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SIGNAL AMPLIFICATION
// Intent and emotion signals boost matching bucket types.
// ═══════════════════════════════════════════════════════════════════════════════

describe("Signal amplification", () => {
  test("failure_report intent boosts struggle and commitment facts", () => {
    const struggleFact = fact({ type: "struggle",    value: "tends to give up on hard weeks" });
    const prefFact     = fact({ type: "preference",  value: "trains at 7pm" });
    const facts = [prefFact, struggleFact];

    const ranked = rank(facts, "I failed again this week", { intent: "failure_report" });
    expect(ranked[0]!.type).toBe("struggle");
  });

  test("progress_report intent boosts achievement and goal facts", () => {
    const achieveFact = fact({ type: "achievement", value: "completed 4 weeks straight" });
    const prefFact    = fact({ type: "preference",  value: "morning person" });
    const ranked = rank([prefFact, achieveFact], "here is my progress update", {
      intent: "progress_report",
    });
    expect(ranked[0]!.type).toBe("achievement");
  });

  test("negative emotion boosts struggle facts", () => {
    const struggleFact = fact({ type: "struggle",   value: "gets frustrated when results are slow" });
    const prefFact     = fact({ type: "preference", value: "likes deadlifts" });
    const ranked = rank([prefFact, struggleFact], "not feeling great today", {
      emotion: "frustrated",
    });
    expect(ranked[0]!.type).toBe("struggle");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GOAL RELEVANCE
// Facts semantically related to the user's active goals rank higher.
// ═══════════════════════════════════════════════════════════════════════════════

describe("Goal relevance", () => {
  test("fact overlapping with active goal scores higher than unrelated fact", () => {
    const gymFact     = fact({ type: "anchor", value: "always trains legs on Thursday" });
    const unrelFact   = fact({ type: "anchor", value: "likes coffee in the morning" });
    const ranked = rank([unrelFact, gymFact], "thinking about my training", {
      activeGoals: ["build muscle and improve gym consistency"],
    });
    expect(ranked[0]!.value).toContain("legs on Thursday");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// RECENCY CURVE
// Old but semantically relevant facts still surface; recency is not dominant.
// ═══════════════════════════════════════════════════════════════════════════════

describe("Recency: old relevant fact beats recent irrelevant fact", () => {
  test("6-month-old struggle beats 1-day-old preference for struggle message", () => {
    const oldStruggle = fact({
      type: "struggle",
      value: "always skips workouts when stressed",
      updatedAt: new Date(NOW.getTime() - 180 * 24 * 3600_000),  // 180 days old
      createdAt:  new Date(NOW.getTime() - 180 * 24 * 3600_000),
    });
    const recentPref = fact({
      type: "preference",
      value: "trains in the evening",
      updatedAt: new Date(NOW.getTime() - 1 * 3600_000),  // 1 hour old
      createdAt:  new Date(NOW.getTime() - 1 * 3600_000),
    });
    const ranked = rank([recentPref, oldStruggle], "I feel like skipping today");
    expect(ranked[0]!.type).toBe("struggle");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// EXCLUDED TYPES
// Internal/operational memory types must never appear in results.
// ═══════════════════════════════════════════════════════════════════════════════

describe("Excluded types", () => {
  const EXCLUDED = ["onboarding_v2", "mentor_state", "intake_finalized", "commitment_record", "gym_signal"];

  test.each(EXCLUDED)('type "%s" is excluded from results', excludedType => {
    const facts = [
      fact({ type: excludedType, value: "some internal value" }),
      fact({ type: "struggle",   value: "relevant struggle" }),
    ];
    const ranked = rank(facts, "hello");
    expect(ranked.every(m => m.type !== excludedType)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// RETRIEVAL REASON
// Returned reason must match the detected bucket for each memory type.
// ═══════════════════════════════════════════════════════════════════════════════

describe("Retrieval reason", () => {
  test.each<[string, string]>([
    ["struggle",     "similar_struggle"],
    ["achievement",  "similar_achievement"],
    ["commitment",   "related_commitment"],
    ["promise",      "related_promise"],
    ["breakthrough", "related_breakthrough"],
    ["goal",         "goal_match"],
    ["preference",   "pattern_match"],
  ])('type "%s" → reason "%s"', (type, expectedReason) => {
    const facts = [fact({ type, value: "some memory content for retrieval" })];
    const [result] = rank(facts, "any message");
    expect(result!.reason).toBe(expectedReason);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// topK
// ═══════════════════════════════════════════════════════════════════════════════

describe("topK limiting", () => {
  test("returns at most topK results", () => {
    const facts = Array.from({ length: 20 }, (_, i) =>
      fact({ type: "anchor", value: `memory ${i}` })
    );
    const ranked = scoreAndRankFacts(facts, {
      message:     "anything",
      intent:      "general_chat",
      emotion:     "neutral",
      activeGoals: [],
      topK:        5,
    }, NOW);
    expect(ranked.length).toBe(5);
  });

  test("returns all facts when topK >= fact count", () => {
    const facts = [
      fact({ type: "struggle",    value: "missed workouts" }),
      fact({ type: "achievement", value: "hit a PR" }),
    ];
    const ranked = scoreAndRankFacts(facts, {
      message: "hello", intent: "general_chat", emotion: "neutral", activeGoals: [], topK: 10,
    }, NOW);
    expect(ranked.length).toBe(2);
  });

  test("empty fact list returns empty array", () => {
    const ranked = scoreAndRankFacts([], {
      message: "hello", intent: "general_chat", emotion: "neutral", activeGoals: [],
    }, NOW);
    expect(ranked).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCORES ARE SORTED DESCENDING
// ═══════════════════════════════════════════════════════════════════════════════

describe("Sort order", () => {
  test("results are sorted by score descending", () => {
    const facts = Array.from({ length: 10 }, (_, i) =>
      fact({ type: i % 3 === 0 ? "struggle" : i % 3 === 1 ? "achievement" : "preference", value: `value ${i}` })
    );
    const ranked = rank(facts, "I keep skipping gym", { intent: "failure_report" });
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1]!.score).toBeGreaterThanOrEqual(ranked[i]!.score);
    }
  });
});
