// ─── Which balance, at which allowance, enforced or not ──────────────────────
// The account behind a meter key, its tier and the day its allowances renew
// (billing/entitlements.ts), cached briefly so settling every AI call does not
// read billing each time; and the switch that says whether the allowances
// refuse anything.

import { entitlementForUser } from "../entitlements";
import { limitFor, periodFor, tierFor, type Product, type Tier } from "./rules";
import type { Mode, Target } from "./ledger";

export type AccountingMode = "off" | "shadow" | "enforce";

type Env = Record<string, string | undefined>;

// USAGE_ACCOUNTING:
//   off       records nothing; the daily meter (billing/usage.ts) alone decides (the emergency switch)
//   shadow    records every allowance beside the daily meter, refuses nothing (the default)
//   enforce   the allowances decide: Nova credits replace the daily meter's
//             limit (it still counts), and browser tasks, MCP and storage are enforced
// USAGE_ENFORCE (optional, with enforce): a comma list of the products to
// enforce (nova_credits, browser_tasks, mcp_calls, storage_bytes); the rest
// stay in shadow. Unset: all four.
export function accountingMode(env: Env = process.env): AccountingMode {
  const v = env.USAGE_ACCOUNTING?.trim();
  return v === "off" ? "off" : v === "enforce" ? "enforce" : "shadow";
}

const ENFORCEABLE = new Set(["nova_credits", "browser_tasks", "mcp_calls", "storage_bytes"]);
export function enforcing(product: Product, env: Env = process.env): boolean {
  if (accountingMode(env) !== "enforce") return false;
  const p = product === "mcp_read_only" ? "mcp_calls" : product;
  if (!ENFORCEABLE.has(p)) return false;
  const list = env.USAGE_ENFORCE?.trim();
  if (!list) return true;
  return list.split(",").map(x => x.trim()).includes(p);
}
export const modeFor = (product: Product, env: Env = process.env): Mode => (enforcing(product, env) ? "enforce" : "shadow");

const TIER_TTL_MS = 60_000;
interface AccountPlan { tier: Tier; anchorDay: number | null }
const cache = new Map<string, { plan: AccountPlan; at: number }>();

export async function planOf(accountKey: string, now = new Date()): Promise<AccountPlan> {
  if (!accountKey.startsWith("user:")) return { tier: "free", anchorDay: null };
  const hit = cache.get(accountKey);
  if (hit && now.getTime() - hit.at < TIER_TTL_MS) return hit.plan;
  const ent = await entitlementForUser(accountKey.slice(5), now);
  const plan = { tier: tierFor(ent), anchorDay: ent.anchorDay };
  if (cache.size > 5_000) cache.clear();
  cache.set(accountKey, { plan, at: now.getTime() });
  return plan;
}
export async function tierOf(accountKey: string, now = new Date()): Promise<Tier> {
  return (await planOf(accountKey, now)).tier;
}

// A plan change (a verified webhook) is seen at once on this instance.
export function forgetTier(accountKey?: string): void {
  if (accountKey) cache.delete(accountKey); else cache.clear();
}

export async function targetFor(accountKey: string, product: Product, now = new Date()): Promise<Target> {
  const { tier, anchorDay } = await planOf(accountKey, now);
  return { accountKey, product, period: periodFor(product, now, anchorDay ?? 1), tier, limit: limitFor(tier, product) };
}

// A fault in accounting is logged by kind, at most once a minute per place,
// and never reaches the learner.
const lastLog = new Map<string, number>();
export function accountingFault(where: string, err: unknown): void {
  const now = Date.now();
  if (now - (lastLog.get(where) ?? 0) < 60_000) return;
  lastLog.set(where, now);
  console.error(JSON.stringify({ layer: "usage_accounting", event: "fault", where, error: (err as Error)?.name ?? "error" }));
}
