// ─── What upgrading would change ─────────────────────────────────────────────
// One place that answers "which plan could this account move to, right now,
// and what would it get". A plan is offered only when it can be bought now
// (config.ts purchasable: its switch and its provider product), so no page and
// no refusal message points at a checkout that is not open. The allowances
// are the accounting rules' own table, overrides included: nothing is copied.

import { allowances, type TierAllowance } from "./accounting/rules";
import { providerConfig, purchasable } from "./config";
import { PAID_PLANS, PLANS, formatPrice, type PlanKey, type Tier } from "./plans";

type Env = Record<string, string | undefined>;

const ORDER: Tier[] = ["free", "plus", "pro"];
// The monthly plan that sells each paid tier.
const MONTHLY: Record<Tier, PlanKey | null> = { free: null, plus: "plus_monthly", pro: "pro_monthly" };

export interface Offer { plan: PlanKey; tier: Tier; name: string; price: string; interval: string | null; allowance: TierAllowance }

// The plans that can be bought now. No provider configured: none.
export function sellablePlans(env: Env = process.env): PlanKey[] {
  const cfg = providerConfig(env);
  return cfg.ok ? PAID_PLANS.filter(p => purchasable(p, cfg.config, env)) : [];
}

// The nearest tier above this one that is on sale now, or null (on Pro, or
// nothing above is sold). Free skips a Plus that is not on sale and is offered Pro.
export function nextOffer(tier: Tier, env: Env = process.env, sellable: PlanKey[] = sellablePlans(env)): Offer | null {
  const table = allowances(env).table;
  for (const t of ORDER.slice(ORDER.indexOf(tier) + 1)) {
    const key = MONTHLY[t];
    if (key && sellable.includes(key)) {
      const plan = PLANS[key];
      return { plan: key, tier: t, name: plan.name, price: formatPrice(plan), interval: plan.interval, allowance: table[t] };
    }
  }
  return null;
}

const size = (b: number) => b >= 1_000_000_000 ? `${(b / 1_000_000_000).toLocaleString("en-US", { maximumFractionDigits: 1 })} GB` : `${Math.round(b / 1_000_000).toLocaleString("en-US")} MB`;

// One sentence, with a leading space, for the end of a refusal: what the next
// plan on sale holds of this allowance. "" when nothing is on sale above.
export function upgradeLine(tier: Tier, what: "nova" | "browser" | "storage" | "mcp", env: Env = process.env, sellable?: PlanKey[]): string {
  const o = nextOffer(tier, env, sellable);
  if (!o) return "";
  const a = o.allowance;
  if (what === "nova") return ` ${o.name} has ${a.novaCredits.toLocaleString("en-US")} a month.`;
  if (what === "browser") return ` ${o.name} has ${a.browserTasks.toLocaleString("en-US")} a month.`;
  if (what === "storage") return ` ${o.name} has ${size(a.storageBytes)}.`;
  return a.mcpLifetime === null ? ` ${o.name} has no fixed limit (fair use).` : ` ${o.name} has ${a.mcpLifetime.toLocaleString("en-US")} calls.`;
}

// Every tier's allowances, for pages that compare plans.
export function planCatalog(env: Env = process.env): Record<Tier, TierAllowance> {
  return allowances(env).table;
}
