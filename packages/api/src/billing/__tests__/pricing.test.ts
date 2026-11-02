// ─── The cost of one model call, from reported usage and listed prices ───────
import { costOf, priceFor, PRICES } from "../pricing";
import type { LlmCall, NormalizedUsage } from "../../services/llm-usage";

const AT = new Date("2026-11-03T12:00:00Z");
const usage = (over: Partial<NormalizedUsage> = {}): NormalizedUsage => ({ inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, ...over });
const haiku = (u: NormalizedUsage, over: Partial<LlmCall> = {}) => costOf({ provider: "anthropic", model: "claude-haiku-5-5", usage: u, outcome: "success", at: AT, ...over });

describe("Claude Haiku 5.5 (checked on Anthropic's pricing page, 2026-11-03)", () => {
  it("is listed with the verified rates, and only that: no other model has a price", () => {
    expect(PRICES.map(p => `${p.provider}/${p.model}`)).toEqual(["anthropic/claude-haiku-5-5"]);
    expect(PRICES[0]!.standard).toEqual({ input: 0.10, output: 0.50, cacheWrite5m: 0.125, cacheWrite1h: 0.20, cacheRead: 0.01 });
    expect(PRICES[0]!.long).toEqual({ input: 0.50, output: 2.50, cacheWrite5m: 0.625, cacheWrite1h: 1.00, cacheRead: 0.05 });
  });

  it("prices a call in micros: 5,335 in and 1,084 out is $0.00108 (the measured mean request)", () => {
    expect(haiku(usage({ inputTokens: 5_335, outputTokens: 1_084 }))).toEqual({ estimatedCostMicros: 1076, costState: "measured", pricingVersion: PRICES[0]!.version });
  });

  it("a prompt over 100,000 tokens pays the long-context rate on every category, cache tokens counted toward it", () => {
    const at = haiku(usage({ inputTokens: 100_000, outputTokens: 1_000 }));
    expect(at.estimatedCostMicros).toBe(Math.round(100_000 * 0.10 + 1_000 * 0.50));
    const over = haiku(usage({ inputTokens: 99_999, cacheReadInputTokens: 2, outputTokens: 1_000 }));
    expect(over.estimatedCostMicros).toBe(Math.round(99_999 * 0.50 + 2 * 0.05 + 1_000 * 2.50));
    const cacheWrite = haiku(usage({ inputTokens: 1, cacheCreationInputTokens: 100_000, cacheCreation5mTokens: 100_000, cacheCreation1hTokens: 0 }));
    expect(cacheWrite.estimatedCostMicros).toBe(Math.round(1 * 0.50 + 100_000 * 0.625));
  });

  it("cache writes are priced by lifetime when split; unsplit writes are assumed 5-minute and say so", () => {
    const split = haiku(usage({ inputTokens: 10, cacheCreationInputTokens: 3_000, cacheCreation5mTokens: 1_000, cacheCreation1hTokens: 2_000, cacheReadInputTokens: 4_000 }));
    expect(split).toMatchObject({ estimatedCostMicros: Math.round(10 * 0.10 + 1_000 * 0.125 + 2_000 * 0.20 + 4_000 * 0.01), costState: "measured" });
    const unsplit = haiku(usage({ inputTokens: 10, cacheCreationInputTokens: 3_000 }));
    expect(unsplit).toMatchObject({ estimatedCostMicros: Math.round(10 * 0.10 + 3_000 * 0.125), costState: "estimated" });
  });

  it("a dated snapshot of the model is the same price; another model is unknown, never guessed", () => {
    expect(haiku(usage({ inputTokens: 1_000 }), { model: "claude-haiku-5-5-20261015" }).costState).toBe("measured");
    for (const [provider, model] of [["anthropic", "claude-sonnet-5-5"], ["anthropic", "claude-haiku-5"], ["gemini", "gemini-3.5-flash"], ["openai", "gpt-4o"]] as const) {
      expect(costOf({ provider, model, usage: usage({ inputTokens: 1_000, outputTokens: 10 }), outcome: "success", at: AT })).toEqual({ estimatedCostMicros: null, costState: "unknown", pricingVersion: null });
    }
    expect(priceFor("anthropic", "claude-haiku-5-55", AT)).toBeNull();
  });

  it("missing usage is unknown, a partial count is incomplete (a lower bound), and nothing sent costs nothing", () => {
    expect(haiku({ inputTokens: null, outputTokens: null, cacheCreationInputTokens: null, cacheReadInputTokens: null })).toMatchObject({ estimatedCostMicros: null, costState: "unknown" });
    expect(haiku(usage({ inputTokens: 2_000, outputTokens: 40, partial: true }))).toMatchObject({ estimatedCostMicros: 220, costState: "incomplete" });
    expect(haiku({ inputTokens: 2_000, outputTokens: null, cacheCreationInputTokens: null, cacheReadInputTokens: null })).toMatchObject({ estimatedCostMicros: 200, costState: "incomplete" });
    expect(haiku(usage(), { outcome: "not_sent" })).toEqual({ estimatedCostMicros: 0, costState: "measured", pricingVersion: null });
  });

  it("US-only inference is 1.1×; a region, tier or speed without a listed price is an estimate at the base rate", () => {
    expect(haiku(usage({ inputTokens: 10_000, inferenceGeo: "us" }))).toMatchObject({ estimatedCostMicros: 1_100, costState: "measured" });
    expect(haiku(usage({ inputTokens: 10_000, inferenceGeo: "global" }))).toMatchObject({ estimatedCostMicros: 1_000, costState: "measured" });
    expect(haiku(usage({ inputTokens: 10_000, inferenceGeo: "eu" }))).toMatchObject({ estimatedCostMicros: 1_000, costState: "estimated" });
    expect(haiku(usage({ inputTokens: 10_000, serviceTier: "priority" })).costState).toBe("estimated");
    expect(haiku(usage({ inputTokens: 10_000, serviceTier: "standard", speed: "standard" })).costState).toBe("measured");
  });
});
