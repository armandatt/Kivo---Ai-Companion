/**
 * Rate limits on real Postgres: atomic counters under concurrency, the
 * sliding window across buckets, leases racing for the last slot, crash
 * recovery, account deletion, and billing's hitLimit on the same store.
 *
 *   NOVA_TEST_DATABASE_URL=postgresql://... npx tsx --test src/rate-limits/__integration__/rate-limits.itest.ts
 */

import "../../nova/__integration__/test-database.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";

const { prisma } = await import("@repo/db/client");
const { postgresStore, purgeWindows } = await import("../store.js");
const { postgresLeases, purgeLeases } = await import("../leases.js");
const { checkRate, acquireSlot, counterKey } = await import("../engine.js");
const { deleteRateLimitRows } = await import("../cleanup.js");
const { flushObservations, obsKey } = await import("../observe.js");
const { hitLimit } = await import("../../billing/accounting/limiter.js");
const { deleteAccountUsage } = await import("../../billing/accounting/ledger.js");

const RUN = `itest${Date.now()}`;
const ENFORCE = { RATE_LIMITS_MODE: "enforce" } as NodeJS.ProcessEnv;
const T0 = new Date(Math.ceil(Date.now() / 3_600_000) * 3_600_000 + 7 * 86_400_000); // a fresh hour, a week ahead
const at = (ms: number) => new Date(T0.getTime() + ms);
const user = (n: string) => `user:${RUN}${n}`;

after(async () => {
  await prisma.$executeRaw`DELETE FROM "RateLimitWindow" WHERE key LIKE ${`%${RUN}%`}`;
  await prisma.$executeRaw`DELETE FROM "RateLimitLease" WHERE key LIKE ${`%${RUN}%`}`;
  // Global slots this run took, dated a week ahead (T0): nothing real is.
  await prisma.$executeRaw`DELETE FROM "RateLimitLease" WHERE key LIKE '%:global:all' AND "expiresAt" > ${new Date(Date.now() + 2 * 86_400_000)}`;
  await prisma.$disconnect();
});

test("50 concurrent requests on one account: exactly the limit is admitted, the counter is exact", async () => {
  const u = user("burst");
  const decisions = await Promise.all(Array.from({ length: 50 }, () => checkRate("notes.tutor", { user: u }, { env: ENFORCE, now: at(1_000) })));
  assert.equal(decisions.filter(d => d.allowed).length, 10);
  const [row] = await prisma.$queryRaw<{ count: number }[]>`SELECT count FROM "RateLimitWindow" WHERE key = ${counterKey("notes.tutor", "user", 60_000, u)}`;
  assert.equal(Number(row!.count), 50);
});

test("several windows and dimensions in one round trip, each its own row", async () => {
  const u = user("multi");
  await checkRate("ai.account", { user: u, ip: `ip:${RUN}` }, { env: ENFORCE, now: at(2_000) });
  const rows = await prisma.$queryRaw<{ key: string; count: number }[]>`SELECT key, count FROM "RateLimitWindow" WHERE key LIKE ${`rl.ai.account.user.%:${u}`} ORDER BY key`;
  assert.deepEqual(rows.map(r => [r.key, Number(r.count)]), [[counterKey("ai.account", "user", 3_600_000, u), 1], [counterKey("ai.account", "user", 60_000, u), 1]]);
});

test("the sliding window carries the previous bucket across the boundary", async () => {
  const u = user("slide");
  for (let i = 0; i < 10; i++) assert.equal((await checkRate("notes.tutor", { user: u }, { env: ENFORCE, now: at(59_000) })).allowed, true);
  assert.equal((await checkRate("notes.tutor", { user: u }, { env: ENFORCE, now: at(61_000) })).allowed, false);
  assert.equal((await checkRate("notes.tutor", { user: u }, { env: ENFORCE, now: at(179_000) })).allowed, true);
});

test("weighted hits: a batch counts its items", async () => {
  const u = user("batch");
  assert.equal((await checkRate("mcp.items", { user: u }, { env: ENFORCE, now: at(0), weight: 599 })).allowed, true);
  assert.equal((await checkRate("mcp.items", { user: u }, { env: ENFORCE, now: at(0), weight: 2 })).allowed, false);
});

test("20 requests race for 3 slots: exactly 3 win; release frees one; a second release changes nothing", async () => {
  const u = user("race");
  const slots = await Promise.all(Array.from({ length: 20 }, (_, i) => acquireSlot("ai.account", { user: u }, `r${i}`, { env: ENFORCE, now: at(0) })));
  const won = slots.filter(s => s.decision.allowed);
  assert.equal(won.length, 3);
  const [{ n }] = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM "RateLimitLease" WHERE key = ${`rl.ai.account.conc-user:${u}`}`;
  assert.equal(n, 3);
  await won[0]!.release(); await won[0]!.release();
  assert.equal((await acquireSlot("ai.account", { user: u }, "late", { env: ENFORCE, now: at(0) })).decision.allowed, true);
  assert.equal((await acquireSlot("ai.account", { user: u }, "later", { env: ENFORCE, now: at(0) })).decision.allowed, false);
  for (const s of won.slice(1)) await s.release();
});

test("a holder that crashed: its lease expires, the next admission clears it, the purge counts it", async () => {
  const u = user("crash");
  const ttl = 15 * 60_000;
  const dead = await acquireSlot("portable.import", { user: u }, "job:dead", { env: ENFORCE, now: at(0) });
  assert.equal(dead.decision.allowed, true);
  assert.equal((await acquireSlot("portable.import", { user: u }, "job:next", { env: ENFORCE, now: at(ttl - 1_000) })).decision.allowed, false);
  assert.equal((await acquireSlot("portable.import", { user: u }, "job:next", { env: ENFORCE, now: at(ttl + 1_000) })).decision.allowed, true);
  await postgresLeases.acquire({ key: `rl.test.${RUN}:x`, holder: "h", max: 1, ttlMs: 1 }, at(0));
  assert.ok((await purgeLeases(at(10_000))) >= 1);
});

test("the same holder retried keeps one slot; renew extends it; renew after expiry does not revive it", async () => {
  const key = `rl.test.${RUN}.renew:${user("renew")}`;
  assert.equal((await postgresLeases.acquire({ key, holder: "a", max: 1, ttlMs: 1_000 }, at(0))).acquired, true);
  assert.equal((await postgresLeases.acquire({ key, holder: "a", max: 1, ttlMs: 1_000 }, at(0))).reused, true);
  assert.equal(await postgresLeases.renew(key, "a", 60_000, at(500)), true);
  assert.equal((await postgresLeases.acquire({ key, holder: "b", max: 1, ttlMs: 1_000 }, at(30_000))).acquired, false);
  assert.equal(await postgresLeases.renew(key, "a", 1_000, at(120_000)), false);
});

test("account deletion removes the account's counters and leases, and nobody else's", async () => {
  const gone = user("gone"), stays = user("stays");
  await checkRate("ai.account", { user: gone }, { env: ENFORCE, now: at(0) });
  await checkRate("ai.account", { user: stays }, { env: ENFORCE, now: at(0) });
  await acquireSlot("ai.account", { user: gone }, "g", { env: ENFORCE, now: at(0) });
  await hitLimit(`mcp-day:${gone}`, 10, 86_400_000, at(0));
  await prisma.$transaction(async tx => deleteAccountUsage(tx, [gone]));
  const left = await prisma.$queryRaw<{ key: string }[]>`SELECT key FROM "RateLimitWindow" WHERE key LIKE ${`%${RUN}%`} AND (key LIKE ${`%${gone}`} OR key LIKE ${`%${stays}`})`;
  assert.ok(left.every(r => r.key.endsWith(stays)), JSON.stringify(left));
  assert.ok(left.length >= 2);
  const leases = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM "RateLimitLease" WHERE key LIKE ${`%${gone}`}`;
  assert.equal(leases[0]!.n, 0);
  await deleteRateLimitRows(prisma, []);
});

test("billing's hitLimit counts on the same store, exactly", async () => {
  const k = `mcp-grant:${RUN}`;
  const hits = await Promise.all(Array.from({ length: 12 }, () => hitLimit(k, 10, 60_000, at(5_000))));
  assert.equal(hits.filter(h => h.allowed).length, 10);
  assert.equal(Math.max(...hits.map(h => h.count)), 12);
});

test("observations land as hourly rows kept for two weeks; the purge keeps them, drops old windows", async () => {
  const key = obsKey("refused", `test.${RUN}`, "user");
  await postgresStore.hit([{ key, windowMs: 3_600_000, weight: 3, keepMs: 13 * 86_400_000 }], at(0));
  await postgresStore.hit([{ key: `rl.test.${RUN}.old:x`, windowMs: 60_000, weight: 1 }], at(0));
  await purgeWindows(at(2 * 86_400_000));
  const rows = await prisma.$queryRaw<{ key: string; count: number }[]>`SELECT key, count FROM "RateLimitWindow" WHERE key IN (${key}, ${`rl.test.${RUN}.old:x`})`;
  assert.deepEqual(rows.map(r => [r.key, Number(r.count)]), [[key, 3]]);
  await flushObservations(postgresStore, at(0));
});

test("a broken database: closed policies refuse with 503, open ones admit", async () => {
  const broken = { hit: async () => { throw new Error("connection refused"); }, peek: async () => 0 };
  assert.deepEqual(await checkRate("notes.tutor", { user: user("x") }, { env: ENFORCE, store: broken }), { allowed: false, kind: "unavailable", status: 503, policy: "notes.tutor", retryAfterSeconds: 5 });
  assert.deepEqual(await checkRate("base.read", { user: user("x") }, { env: ENFORCE, store: broken }), { allowed: true });
});
