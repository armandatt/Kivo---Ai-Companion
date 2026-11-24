// ─── Billing's fair-use counters ─────────────────────────────────────────────
// A fixed-window count per key, used by usage accounting's fair-use limits
// (MCP calls per connection and per account, browser task starts, Build with
// Nova turns). The counting itself is the rate-limit engine's store
// (rate-limits/store.ts), the one writer of RateLimitWindow: one atomic
// upsert per hit, held across restarts.
//
// A fault here allows the request (logged): these limits sit behind the
// rate-limit policies, which decide what a limiter outage refuses.

import { bucketOf, postgresStore, purgeWindows } from "../../rate-limits/store";
import { purgeLeases } from "../../rate-limits/leases";
import { accountingFault } from "./targets";

export interface Hit { allowed: boolean; count: number; limit: number; retryAfterSeconds: number }

export async function hitLimit(key: string, limit: number, windowMs: number, now = new Date()): Promise<Hit> {
  const { end } = bucketOf(windowMs, now);
  const retryAfterSeconds = Math.max(1, Math.ceil((end - now.getTime()) / 1000));
  try {
    const [r] = await postgresStore.hit([{ key, windowMs, weight: 1 }], now);
    const count = r?.current ?? 1;
    return { allowed: count <= limit, count, limit, retryAfterSeconds };
  } catch (err) {
    accountingFault("limiter", err);
    return { allowed: true, count: 0, limit, retryAfterSeconds };
  }
}

// How many hits a key has in the current window, without adding one.
export async function peekLimit(key: string, windowMs: number, now = new Date()): Promise<number> {
  try { return await postgresStore.peek(key, windowMs, now); } catch { return 0; }
}

// Hourly housekeeping: windows that have ended (kept a day for review, the
// rate-limit report's rows two weeks) and leases nobody gave back.
export async function purgeRateLimits(now = new Date()): Promise<number> {
  const windows = await purgeWindows(now);
  const leases = await purgeLeases(now).catch(() => 0);
  return windows + leases;
}
