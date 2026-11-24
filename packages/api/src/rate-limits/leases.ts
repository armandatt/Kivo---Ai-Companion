// ─── Concurrency leases: "at most N of these at once" ────────────────────────
// The only reader and writer of RateLimitLease. A lease is one running
// operation; `holder` names it (a task id, an import job id, a request id).
//
// Admission is atomic: a short transaction takes a transaction-scoped
// advisory lock on the key, drops that key's expired leases, counts the
// rest and inserts only below the limit. Two requests racing for the last
// slot are serialised by the lock, so exactly one gets it. The lock is held
// for those three statements only, never while the work runs.
//
// Taking a lease the holder already has renews it and takes no second slot
// (a retried request is the same operation). Giving one back is a delete by
// (key, holder): a second release, or one after expiry, changes nothing. A
// process that dies leaves its lease to expire at `expiresAt`; the next
// admission on that key, or the hourly purge, clears it.

import { prisma } from "@repo/db/client";
import { runWithoutWriteSignal } from "@repo/db/write-signal";

export interface LeaseRequest { key: string; holder: string; max: number; ttlMs: number }
export interface LeaseResult { acquired: boolean; held: number; reused: boolean; expiredCleared: number }

export interface LeaseStore {
  acquire(r: LeaseRequest, now: Date): Promise<LeaseResult>;
  release(key: string, holder: string): Promise<boolean>;
  renew(key: string, holder: string, ttlMs: number, now: Date): Promise<boolean>;
}

export const postgresLeases: LeaseStore = {
  async acquire({ key, holder, max, ttlMs }, now) {
    const expiresAt = new Date(now.getTime() + ttlMs);
    return runWithoutWriteSignal("rate-limits", () => prisma.$transaction(async tx => {
      // The lock function returns void, which the driver cannot read: select a constant beside it.
      await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended(${`kivo-lease|${key}`}, 0))) AS l`;
      const expiredCleared = await tx.$executeRaw`DELETE FROM "RateLimitLease" WHERE key = ${key} AND "expiresAt" <= ${now}`;
      const renewed = await tx.$executeRaw`UPDATE "RateLimitLease" SET "expiresAt" = ${expiresAt} WHERE key = ${key} AND holder = ${holder}`;
      const rows = await tx.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM "RateLimitLease" WHERE key = ${key}`;
      const n = Number(rows[0]?.n ?? 0);
      if (renewed > 0) return { acquired: true, held: n, reused: true, expiredCleared };
      if (n >= max) return { acquired: false, held: n, reused: false, expiredCleared };
      await tx.$executeRaw`INSERT INTO "RateLimitLease" (key, holder, "expiresAt", "createdAt") VALUES (${key}, ${holder}, ${expiresAt}, ${now})`;
      return { acquired: true, held: n + 1, reused: false, expiredCleared };
    }, { timeout: 10_000, maxWait: 5_000 }));
  },
  async release(key, holder) {
    const n = await runWithoutWriteSignal("rate-limits", () => prisma.$executeRaw`DELETE FROM "RateLimitLease" WHERE key = ${key} AND holder = ${holder}`);
    return n > 0;
  },
  async renew(key, holder, ttlMs, now) {
    const n = await runWithoutWriteSignal("rate-limits", () => prisma.$executeRaw`
      UPDATE "RateLimitLease" SET "expiresAt" = ${new Date(now.getTime() + ttlMs)} WHERE key = ${key} AND holder = ${holder} AND "expiresAt" > ${now}`);
    return n > 0;
  },
};

/** Same rules in this process, for tests. */
export function memoryLeases(): LeaseStore & { rows: Map<string, Map<string, number>>; fail?: boolean } {
  const rows = new Map<string, Map<string, number>>();
  const s = {
    rows, fail: false,
    async acquire({ key, holder, max, ttlMs }: LeaseRequest, now: Date) {
      if (s.fail) throw new Error("store unavailable");
      const m = rows.get(key) ?? new Map<string, number>();
      rows.set(key, m);
      let expiredCleared = 0;
      for (const [h, exp] of m) if (exp <= now.getTime()) { m.delete(h); expiredCleared++; }
      if (m.has(holder)) { m.set(holder, now.getTime() + ttlMs); return { acquired: true, held: m.size, reused: true, expiredCleared }; }
      if (m.size >= max) return { acquired: false, held: m.size, reused: false, expiredCleared };
      m.set(holder, now.getTime() + ttlMs);
      return { acquired: true, held: m.size, reused: false, expiredCleared };
    },
    async release(key: string, holder: string) { return rows.get(key)?.delete(holder) ?? false; },
    async renew(key: string, holder: string, ttlMs: number, now: Date) {
      const m = rows.get(key);
      const exp = m?.get(holder);
      if (!m || exp === undefined || exp <= now.getTime()) return false;
      m.set(holder, now.getTime() + ttlMs);
      return true;
    },
  };
  return s;
}

/** Hourly housekeeping: leases whose holder never gave them back. Returns how many. */
export async function purgeLeases(now = new Date()): Promise<number> {
  return runWithoutWriteSignal("rate-limits", () => prisma.$executeRaw`DELETE FROM "RateLimitLease" WHERE "expiresAt" <= ${now}`);
}
