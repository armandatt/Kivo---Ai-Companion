// ─── The account behind a learner, for rate limits ───────────────────────────
// Every surface names a learner by platformChatId (a Telegram chat, or
// `web:<userId>`); billing knows the account behind it (`user:<id>`) and its
// plan tier. Rate limits count per account, so the web, the extension,
// Telegram and every MCP client share one count. Cached a minute per process:
// a tier change reaches limits within a minute. If the account cannot be
// read, the learner key is used: a limit is never skipped for want of one.

import { entitlementForLearner } from "../billing/entitlements";
import { accountSubject, safeSubject } from "./identity";
import type { Tier } from "./policies";
import type { Who } from "./engine";

const TTL_MS = 60_000;
const cache = new Map<string, { user: string | null; tier: Tier | null; at: number }>();

export async function accountOf(platformChatId: string): Promise<{ user: string | null; tier: Tier | null }> {
  const now = Date.now();
  const hit = cache.get(platformChatId);
  if (hit && now - hit.at < TTL_MS) return hit;
  let user: string | null = null;
  let tier: Tier | null = null;
  try {
    const ent = await entitlementForLearner(platformChatId);
    user = accountSubject(ent.usageKey);
    tier = (ent.tier ?? null) as Tier | null;
  } catch (err) {
    console.error(JSON.stringify({ layer: "rate_limit", event: "account_lookup_failed", error: (err as Error).name }));
  }
  user ??= safeSubject("learner", platformChatId);
  const row = { user, tier, at: now };
  cache.set(platformChatId, row);
  if (cache.size > 5_000) for (const [k, v] of cache) if (now - v.at >= TTL_MS) cache.delete(k);
  return row;
}

export async function learnerWho(platformChatId: string): Promise<Who> {
  const a = await accountOf(platformChatId);
  return { user: a.user, tier: a.tier, authenticated: Boolean(a.user) };
}
