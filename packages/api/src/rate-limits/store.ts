// ─── Counters: RateLimitWindow, through one interface ────────────────────────
// This file and leases.ts are the only code that reads or writes the
// rate-limit tables (billing's hitLimit calls in here).
//
// A window is counted in fixed buckets (`windowStart`), and a request is
// judged on a sliding estimate: this bucket's count plus the previous
// bucket's, weighted by how much of it still overlaps the window. That
// removes the double burst a fixed window allows at its edge without storing
// every request. All the windows a request touches (user, address, global…)
// are counted in one statement: one atomic upsert per key, one round trip.
//
// Postgres is the source of truth: the API runs as one Render instance and
// the limits must hold across restarts and deploys. A Redis store can replace
// `postgresStore` behind `CounterStore` when Kivo runs several instances:
// the counters need atomic increments shared by every instance (docs/RATE_LIMITS.md).

import { prisma } from "@repo/db/client";
import { runWithoutWriteSignal } from "@repo/db/write-signal";

export interface CounterHit { key: string; windowMs: number; weight: number; keepMs?: number }
export interface CounterResult { key: string; windowMs: number; current: number; previous: number; estimate: number }

export interface CounterStore {
  hit(hits: CounterHit[], now: Date): Promise<CounterResult[]>;
  peek(key: string, windowMs: number, now: Date): Promise<number>;
}

export function bucketOf(windowMs: number, now: Date) {
  const start = Math.floor(now.getTime() / windowMs) * windowMs;
  return { start, prev: start - windowMs, end: start + windowMs };
}

/** The sliding estimate: the previous bucket counts for the part of it still inside the window. */
export function slidingEstimate(current: number, previous: number, windowMs: number, now: Date): number {
  const { start } = bucketOf(windowMs, now);
  const elapsed = (now.getTime() - start) / windowMs;
  return current + previous * (1 - elapsed);
}

/**
 * Seconds until one more request would fit: the first moment the sliding
 * estimate, with that request added, is within the limit. Inside this bucket
 * that needs the previous one to slide out; after it ends, this bucket's
 * count (refused requests included) becomes the previous one and slides out
 * in turn. Never zero.
 */
export function retryAfter(limit: number, current: number, previous: number, windowMs: number, now: Date): number {
  const { start, end } = bucketOf(windowMs, now);
  const t0 = now.getTime();
  let t: number;
  const inThisBucket = current + 1 <= limit && previous > 0 ? start + windowMs * (1 - (limit - current - 1) / previous) : Infinity;
  if (current + 1 <= limit && previous === 0) t = t0;
  else if (inThisBucket < end) t = inThisBucket;
  else t = end + (current > limit - 1 ? windowMs * (1 - (limit - 1) / current) : 0);
  return Math.max(1, Math.ceil((Math.max(t, t0) - t0) / 1000));
}

// Several policies may count the same key in one call (never in practice,
// but an upsert may not touch a row twice): merge them.
function merged(hits: CounterHit[]): CounterHit[] {
  const by = new Map<string, CounterHit>();
  for (const h of hits) {
    const id = `${h.key}\u0000${h.windowMs}`;
    const had = by.get(id);
    by.set(id, had ? { ...had, weight: had.weight + h.weight, keepMs: Math.max(had.keepMs ?? 0, h.keepMs ?? 0) } : h);
  }
  return [...by.values()];
}

const iso = (ms: number) => new Date(ms).toISOString();

export const postgresStore: CounterStore = {
  async hit(hits, now) {
    if (hits.length === 0) return [];
    const list = merged(hits);
    const keys: string[] = [], starts: string[] = [], prevs: string[] = [], incs: number[] = [], expires: string[] = [];
    for (const h of list) {
      const b = bucketOf(h.windowMs, now);
      keys.push(h.key); starts.push(iso(b.start)); prevs.push(iso(b.prev));
      incs.push(Math.max(0, Math.round(h.weight))); expires.push(iso(b.end + (h.keepMs ?? 0)));
    }
    // The table stores UTC wall time (timestamp without zone); a "Z" string cast
    // to it keeps the UTC clock reading, as Prisma writes it.
    const rows = await runWithoutWriteSignal("rate-limits", () => prisma.$queryRaw<{ key: string; ws: string; count: number; prev: number }[]>`
      WITH input AS (
        SELECT * FROM unnest(${keys}::text[], ${starts}::text[], ${prevs}::text[], ${incs}::int[], ${expires}::text[])
          AS t(key, ws, ps, inc, exp)
      ), up AS (
        INSERT INTO "RateLimitWindow" (key, "windowStart", count, "expiresAt")
        SELECT key, ws::timestamp(3), inc, exp::timestamp(3) FROM input
        ON CONFLICT (key, "windowStart") DO UPDATE SET count = "RateLimitWindow".count + EXCLUDED.count
        RETURNING key, "windowStart", count
      )
      SELECT i.key, i.ws, up.count, COALESCE(p.count, 0) AS prev
      FROM input i
      JOIN up ON up.key = i.key AND up."windowStart" = i.ws::timestamp(3)
      LEFT JOIN "RateLimitWindow" p ON p.key = i.key AND p."windowStart" = i.ps::timestamp(3)`);
    const found = new Map(rows.map(r => [`${r.key}\u0000${r.ws}`, r]));
    return hits.map(h => {
      const r = found.get(`${h.key}\u0000${iso(bucketOf(h.windowMs, now).start)}`);
      if (!r) throw new Error("rate-limit counter missing from the upsert's answer");
      const current = Number(r.count), previous = Number(r.prev);
      return { key: h.key, windowMs: h.windowMs, current, previous, estimate: slidingEstimate(current, previous, h.windowMs, now) };
    });
  },
  async peek(key, windowMs, now) {
    const b = bucketOf(windowMs, now);
    const rows = await prisma.$queryRaw<{ count: number }[]>`
      SELECT count FROM "RateLimitWindow" WHERE key = ${key} AND "windowStart" = ${iso(b.start)}::timestamp(3)`;
    return Number(rows[0]?.count ?? 0);
  },
};

/** For tests and local runs: the same arithmetic, in this process. Never used for production enforcement. */
export function memoryStore(): CounterStore & { rows: Map<string, number>; fail?: boolean } {
  const rows = new Map<string, number>();
  const s = {
    rows, fail: false,
    async hit(hits: CounterHit[], now: Date) {
      if (s.fail) throw new Error("store unavailable");
      for (const h of merged(hits)) {
        const id = `${h.key}@${bucketOf(h.windowMs, now).start}`;
        rows.set(id, (rows.get(id) ?? 0) + Math.max(0, Math.round(h.weight)));
      }
      return hits.map(h => {
        const b = bucketOf(h.windowMs, now);
        const current = rows.get(`${h.key}@${b.start}`) ?? 0, previous = rows.get(`${h.key}@${b.prev}`) ?? 0;
        return { key: h.key, windowMs: h.windowMs, current, previous, estimate: slidingEstimate(current, previous, h.windowMs, now) };
      });
    },
    async peek(key: string, windowMs: number, now: Date) {
      if (s.fail) throw new Error("store unavailable");
      return rows.get(`${key}@${bucketOf(windowMs, now).start}`) ?? 0;
    },
  };
  return s;
}

// Hourly housekeeping (the scheduler's purge job): windows that ended a day
// ago. Rows written with a longer keep (observe.ts) stay until theirs.
export async function purgeWindows(now = new Date()): Promise<number> {
  return runWithoutWriteSignal("rate-limits", () => prisma.$executeRaw`
    DELETE FROM "RateLimitWindow" WHERE "expiresAt" < ${new Date(now.getTime() - 86_400_000)}`);
}
