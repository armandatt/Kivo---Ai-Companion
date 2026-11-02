// ─── What a model call cost ───────────────────────────────────────────────────
// Provider prices, versioned, and the cost of one call from the usage the
// provider reported. Only prices checked on the provider's own page are here:
// a model that is not listed is priced as unknown, never guessed.
//
// Cost states, for each usage event:
//   measured    reported usage × a listed price, nothing assumed
//   estimated   reported usage, but part of the price had to be assumed
//               (a cache write with no lifetime split, a tier or region the
//               table has no price for)
//   incomplete  part of the usage was not reported (an aborted stream): the
//               cost is a lower bound
//   unknown     no listed price for the model, or no usage at all
//
// Units: micros = USD × 1,000,000. A price per million tokens is then the
// micros per token, so cost = Σ tokens × price.

import type { LlmCall, NormalizedUsage } from "../services/llm-usage";

export type CostState = "measured" | "estimated" | "incomplete" | "unknown";

interface Rates { input: number; output: number; cacheWrite5m: number; cacheWrite1h: number; cacheRead: number }
interface PriceEntry {
  provider: LlmCall["provider"];
  model: string;              // a reported model matches it, or a dated snapshot of it ("<model>-2026…")
  version: string;
  effectiveFrom: string | null; // YYYY-MM-DD; null: from the start of the record
  source: string;
  // A request's prompt (input + cache writes + cache reads) above this many
  // tokens is billed at `long` for every category.
  longContextAbove: number | null;
  standard: Rates;
  long: Rates | null;
  // inference_geo values with a verified multiplier on every category.
  geoMultiplier: Record<string, number>;
}

// Claude Haiku 5.5, from https://platform.claude.com/docs/en/about-claude/pricing
// (checked 2026-11-03), USD per million tokens.
export const PRICES: PriceEntry[] = [
  {
    provider: "anthropic", model: "claude-haiku-5-5", version: "anthropic-haiku-5-5@2026-11-03", effectiveFrom: null,
    source: "platform.claude.com/docs/en/about-claude/pricing, checked 2026-11-03",
    longContextAbove: 100_000,
    standard: { input: 0.10, output: 0.50, cacheWrite5m: 0.125, cacheWrite1h: 0.20, cacheRead: 0.01 },
    long:     { input: 0.50, output: 2.50, cacheWrite5m: 0.625, cacheWrite1h: 1.00, cacheRead: 0.05 },
    geoMultiplier: { us: 1.1 },
  },
];

const matches = (entry: PriceEntry, provider: string, model: string) =>
  entry.provider === provider && (model === entry.model || model.startsWith(`${entry.model}-`));

export function priceFor(provider: string, model: string, at: Date): PriceEntry | null {
  const day = at.toISOString().slice(0, 10);
  const candidates = PRICES.filter(e => matches(e, provider, model) && (e.effectiveFrom === null || e.effectiveFrom <= day));
  // The latest entry in effect on that day.
  return candidates.sort((a, b) => (b.effectiveFrom ?? "").localeCompare(a.effectiveFrom ?? ""))[0] ?? null;
}

export interface CallCost { estimatedCostMicros: number | null; costState: CostState; pricingVersion: string | null }

export function costOf(call: Pick<LlmCall, "provider" | "model" | "usage" | "outcome" | "at">): CallCost {
  // Never sent: nothing was billed.
  if (call.outcome === "not_sent") return { estimatedCostMicros: 0, costState: "measured", pricingVersion: null };
  const u: NormalizedUsage = call.usage;
  const known = [u.inputTokens, u.outputTokens, u.cacheCreationInputTokens, u.cacheReadInputTokens].filter((n): n is number => n !== null);
  const entry = priceFor(call.provider, call.model, call.at);
  if (!entry || known.length === 0) return { estimatedCostMicros: null, costState: "unknown", pricingVersion: entry?.version ?? null };

  let state: CostState = "measured";
  const assume = () => { if (state === "measured") state = "estimated"; };

  const input = u.inputTokens ?? 0, output = u.outputTokens ?? 0, write = u.cacheCreationInputTokens ?? 0, read = u.cacheReadInputTokens ?? 0;
  const prompt = input + write + read;
  let rates = entry.standard;
  if (entry.longContextAbove !== null && prompt > entry.longContextAbove) {
    if (entry.long) rates = entry.long; else assume();
  }

  // Cache writes by lifetime when the provider split them; else all as the
  // 5-minute kind (the default, and the cheaper), which is an assumption.
  let writeMicros = 0;
  if (write > 0) {
    const w5 = u.cacheCreation5mTokens ?? null, w1 = u.cacheCreation1hTokens ?? null;
    if (w5 !== null && w1 !== null && w5 + w1 === write) writeMicros = w5 * rates.cacheWrite5m + w1 * rates.cacheWrite1h;
    else { writeMicros = write * rates.cacheWrite5m; assume(); }
  }

  let micros = input * rates.input + output * rates.output + read * rates.cacheRead + writeMicros;

  const geo = u.inferenceGeo ?? null;
  if (geo && geo !== "global") {
    const factor = entry.geoMultiplier[geo];
    if (factor) micros *= factor; else assume();
  }
  if ((u.serviceTier && u.serviceTier !== "standard") || (u.speed && u.speed !== "standard")) assume();

  // A count that is missing, or the provider's count stopped short.
  if (u.partial || known.length < 4 && (u.inputTokens === null || u.outputTokens === null)) state = "incomplete";

  return { estimatedCostMicros: Math.round(micros), costState: state, pricingVersion: entry.version };
}
