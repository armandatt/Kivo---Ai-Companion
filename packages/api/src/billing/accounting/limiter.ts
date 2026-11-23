// ─── Persistent rate limits (fair use and abuse) ─────────────────────────────
// A fixed-window counter in Postgres (RateLimitWindow, this file is its only
// reader and writer): one atomic upsert per hit, so a limit holds across
// restarts and across instances, unlike the in-memory limiters it sits
// behind. Used where a limit protects cost or the service: MCP calls per
// connection and per account, browser task starts, Build with Nova turns.
//
// A fault in the limiter allows the request (logged): a database hiccup must
// not take the product down. Its writes do not wake the scheduler.

import { prisma } from "@repo/db/client";
import { runWithoutWriteSignal } from "@repo/db/write-signal";
import { accountingFault } from "./targets";

export interface Hit { allowed: boolean; count: number; limit: number; retryAfterSeconds: number }

export async function hitLimit(key: string, limit: number, windowMs: number, now = new Date()): Promise<Hit> {
  const start = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const end = new Date(start.getTime() + windowMs);
  const retryAfterSeconds = Math.max(1, Math.ceil((end.getTime() - now.getTime()) / 1000));
  try {
    const rows = await runWithoutWriteSignal("usage-accounting", () => prisma.$queryRaw<{ count: number }[]>`
      INSERT INTO "RateLimitWindow" (key, "windowStart", count, "expiresAt") VALUES (${key}, ${start}, 1, ${end})
      ON CONFLICT (key, "windowStart") DO UPDATE SET count = "RateLimitWindow".count + 1
      RETURNING count`);
    const count = rows[0]?.count ?? 1;
    return { allowed: count <= limit, count, limit, retryAfterSeconds };
  } catch (err) {
    accountingFault("limiter", err);
    return { allowed: true, count: 0, limit, retryAfterSeconds };
  }
}

// How many hits a key has in the current window, without adding one.
export async function peekLimit(key: string, windowMs: number, now = new Date()): Promise<number> {
  const start = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  try {
    const rows = await prisma.$queryRaw<{ count: number }[]>`SELECT count FROM "RateLimitWindow" WHERE key = ${key} AND "windowStart" = ${start}`;
    return rows[0]?.count ?? 0;
  } catch { return 0; }
}

// Hourly housekeeping: windows that have ended (kept a day for review).
export async function purgeRateLimits(now = new Date()): Promise<number> {
  return runWithoutWriteSignal("usage-accounting", () => prisma.$executeRaw`
    DELETE FROM "RateLimitWindow" WHERE "expiresAt" < ${new Date(now.getTime() - 86_400_000)}`);
}
