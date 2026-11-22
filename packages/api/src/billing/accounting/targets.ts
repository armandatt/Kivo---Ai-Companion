// ─── Which balance, at which allowance ────────────────────────────────────────
// The account behind a meter key and its shadow tier (rules.ts shadowTier
// over billing/access.ts), cached briefly so that settling every AI call does
// not read billing each time. Nothing here changes access.

import { entitlementForUser } from "../entitlements";
import { limitFor, periodFor, shadowTier, type Product, type Tier } from "./rules";
import type { Target } from "./ledger";

export type AccountingMode = "shadow" | "off";

// USAGE_ACCOUNTING: "shadow" (default) records every allowance beside the
// daily meter; "off" records nothing (the emergency switch). There is no
// enforcing mode in Phase 1.
export function accountingMode(env: Record<string, string | undefined> = process.env): AccountingMode {
  return env.USAGE_ACCOUNTING === "off" ? "off" : "shadow";
}

const TIER_TTL_MS = 60_000;
const tiers = new Map<string, { tier: Tier; at: number }>();

export async function tierOf(accountKey: string, now = new Date()): Promise<Tier> {
  if (!accountKey.startsWith("user:")) return "free";
  const hit = tiers.get(accountKey);
  if (hit && now.getTime() - hit.at < TIER_TTL_MS) return hit.tier;
  const ent = await entitlementForUser(accountKey.slice(5), now);
  const tier = shadowTier(ent);
  if (tiers.size > 5_000) tiers.clear();
  tiers.set(accountKey, { tier, at: now.getTime() });
  return tier;
}

export function forgetTier(accountKey?: string): void {
  if (accountKey) tiers.delete(accountKey); else tiers.clear();
}

export async function targetFor(accountKey: string, product: Product, now = new Date()): Promise<Target> {
  const tier = await tierOf(accountKey, now);
  return { accountKey, product, period: periodFor(product, now), tier, limit: limitFor(tier, product) };
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
