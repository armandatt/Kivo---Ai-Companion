// ─── An account's rate-limit rows, removed with the account ──────────────────
// Every counter and lease key is `<name>:<subject>`, the name holding no
// colon, so a subject is everything after the first colon. Called from
// billing's deleteAccountUsage inside the deletion's transaction, with the
// account's usage keys (`user:<id>`, `learner:<chat>`). Rows keyed by an
// address, a connection or a task name nobody and expire within a day; the
// hourly purge removes them.

import type { prisma } from "@repo/db/client";

type Tx = Pick<typeof prisma, "$queryRaw" | "$executeRaw">;

export async function deleteRateLimitRows(tx: Tx, subjects: string[]): Promise<void> {
  if (subjects.length === 0) return;
  const [has] = await tx.$queryRaw<{ windows: boolean; leases: boolean }[]>`
    SELECT to_regclass('"RateLimitWindow"') IS NOT NULL AS windows, to_regclass('"RateLimitLease"') IS NOT NULL AS leases`;
  if (has?.windows) await tx.$executeRaw`DELETE FROM "RateLimitWindow" WHERE substring(key from strpos(key, ':') + 1) = ANY(${subjects})`;
  if (has?.leases) await tx.$executeRaw`DELETE FROM "RateLimitLease" WHERE substring(key from strpos(key, ':') + 1) = ANY(${subjects})`;
}
