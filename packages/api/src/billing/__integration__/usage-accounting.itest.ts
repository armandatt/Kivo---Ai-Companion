/**
 * Usage accounting — real Postgres integration test.
 *
 * What it proves: concurrent reservations never pass an enforced allowance
 * and shadow mode records exactly what enforcement would have refused; an
 * idempotency key reserves once; a reservation settles once; a Nova
 * interaction commits its measured cost in credits (Telegram's several calls
 * once, together), refunds on failure or no model call; Kivo-funded work
 * never touches Nova credits; a browser task is reserved once per start,
 * committed by its first completed step and refunded when none completes;
 * stale reservations are reconciled from the usage events; MCP calls count
 * on the lifetime balance, then the read-only one, with batch items and the
 * refusals enforcement would make; accounts and periods stay apart; a trial
 * is Plus; an account's rows go with it; the report covers the ledger.
 *
 *   NOVA_TEST_DATABASE_URL=postgresql://... npx tsx --test src/billing/__integration__/usage-accounting.itest.ts
 */

import "../../nova/__integration__/test-database.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";

process.env.TELEGRAM_BOT_TOKEN = "";
process.env.AI_USAGE_EVENTS_DISABLED = "";
delete process.env.USAGE_ACCOUNTING;

const { prisma } = await import("@repo/db/client");
const llm = await import("../../services/llm-usage.js");
const ledger = await import("../accounting/ledger.js");
const { reserveForInteraction } = await import("../accounting/nova.js");
const { reserveBrowserTask } = await import("../accounting/browser.js");
const { recordMcpCall } = await import("../accounting/mcp.js");
const { reconcileUsage } = await import("../accounting/reconcile.js");
const { shadowReport } = await import("../accounting/report.js");
const { targetFor, forgetTier } = await import("../accounting/targets.js");
const { writeUsageEvent } = await import("../usage-events.js");
const { monthlyPeriod } = await import("../accounting/rules.js");

const STAMP = Date.now();
const users: string[] = [];
const extraKeys: string[] = [];
let n = 0;

async function account() {
  const u = await prisma.user.create({ data: { email: `acct_${STAMP}_${++n}@test.local`, name: "Asha" }, select: { id: true } });
  users.push(u.id);
  return u.id;
}
const key = (id: string) => `user:${id}`;
const synthetic = () => { const k = `test:${STAMP}:${++n}`; extraKeys.push(k); return k; };
const allKeys = () => [...users.map(key), ...extraKeys];

after(async () => {
  await llm.flushLlmCalls();
  await prisma.$transaction(tx => ledger.deleteAccountUsage(tx, allKeys()));
  await prisma.aiUsageEvent.deleteMany({ where: { subjectKey: { in: allKeys() } } });
  await prisma.billingTrial.deleteMany({ where: { userId: { in: users } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

const call = (inputTokens: number, outputTokens: number, over: Partial<import("../../services/llm-usage.js").LlmCall> = {}) => ({
  provider: "anthropic" as const, model: "claude-haiku-5-5", attempts: 1, outcome: "success" as const, failureCategory: null, latencyMs: 10, at: new Date(),
  usage: { inputTokens, outputTokens, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }, ...over,
});

async function balance(accountKey: string, product: string, periodKey?: string) {
  const rows = await prisma.usageBalance.findMany({ where: { accountKey, product, ...(periodKey ? { periodKey } : {}) } });
  return rows.map(r => ({ periodKey: r.periodKey, tier: r.tier, limit: r.limitUnits === null ? null : Number(r.limitUnits), reserved: Number(r.reservedUnits), committed: Number(r.committedUnits), refunded: Number(r.refundedUnits), cost: Number(r.costMicros), items: Number(r.items), refusals: r.shadowRefusals }));
}
const plainTarget = (accountKey: string, limit: number | null, now = new Date()) =>
  ({ accountKey, product: "nova_credits" as const, period: monthlyPeriod(now), tier: "free" as const, limit });

// ── Atomic reservations ──

test("concurrent enforced reservations never pass the allowance", async () => {
  const k = synthetic();
  const results = await Promise.all(Array.from({ length: 40 }, (_, i) => ledger.reserve(plainTarget(k, 10), { units: 1, idempotencyKey: `c${i}`, mode: "enforce" })));
  assert.equal(results.filter(r => r.ok).length, 10);
  const refused = results.filter(r => !r.ok) as Array<{ ok: false; refusal: string }>;
  assert.equal(refused.length, 30);
  assert.ok(refused.every(r => r.refusal === "nova_allowance_exhausted"));
  const [b] = await balance(k, "nova_credits");
  assert.equal(b!.reserved, 10);
  assert.equal(await prisma.usageReservation.count({ where: { accountKey: k } }), 10, "a refused reservation leaves no row");
});

test("shadow reservations are never refused and record exactly what enforcement would have refused", async () => {
  const k = synthetic();
  const results = await Promise.all(Array.from({ length: 25 }, (_, i) => ledger.reserve(plainTarget(k, 10), { units: 1, idempotencyKey: `s${i}` })));
  assert.ok(results.every(r => r.ok));
  assert.equal(results.filter(r => r.ok && r.shadowRefusal === "nova_allowance_exhausted").length, 15);
  const [b] = await balance(k, "nova_credits");
  assert.equal(b!.reserved, 25);
  assert.equal(b!.refusals, 15);
});

test("one idempotency key reserves once, however many times and however concurrently it is sent", async () => {
  const k = synthetic();
  const results = await Promise.all(Array.from({ length: 10 }, () => ledger.reserve(plainTarget(k, 10), { units: 3, idempotencyKey: "same" })));
  const ids = new Set(results.map(r => r.ok ? r.reservationId : "x"));
  assert.equal(ids.size, 1);
  assert.equal(results.filter(r => r.ok && !r.duplicate).length, 1);
  const [b] = await balance(k, "nova_credits");
  assert.equal(b!.reserved, 3);
  assert.equal(await prisma.usageLedger.count({ where: { accountKey: k, entry: "reserve" } }), 1);
});

test("a reservation is settled once: concurrent commits apply one, a later refund applies none", async () => {
  const k = synthetic();
  const r = await ledger.reserve(plainTarget(k, 10), { units: 2, idempotencyKey: "one" });
  assert.ok(r.ok);
  const commits = await Promise.all([1, 2, 3].map(() => ledger.commit(r.reservationId, { units: 4, costMicros: 3_500, reason: "committed" })));
  assert.equal(commits.filter(c => c.applied).length, 1);
  const late = await ledger.refund(r.reservationId, { reason: "too_late" });
  assert.deepEqual(late, { applied: false, state: "committed" });
  const [b] = await balance(k, "nova_credits");
  assert.deepEqual({ reserved: b!.reserved, committed: b!.committed, refunded: b!.refunded, cost: b!.cost }, { reserved: 0, committed: 4, refunded: 0, cost: 3_500 });
});

test("accounts and periods keep separate balances", async () => {
  const a = synthetic(), b = synthetic();
  await Promise.all([
    ...Array.from({ length: 5 }, (_, i) => ledger.reserve(plainTarget(a, 10), { units: 1, idempotencyKey: `a${i}` })),
    ...Array.from({ length: 3 }, (_, i) => ledger.reserve(plainTarget(b, 10), { units: 1, idempotencyKey: `b${i}` })),
  ]);
  assert.equal((await balance(a, "nova_credits"))[0]!.reserved, 5);
  assert.equal((await balance(b, "nova_credits"))[0]!.reserved, 3);

  const c = synthetic();
  const before = new Date("2026-11-30T23:59:59.999Z"), afterMidnight = new Date("2026-12-01T00:00:00.001Z");
  await ledger.reserve(plainTarget(c, 10, before), { units: 1, idempotencyKey: "nov", now: before });
  await ledger.reserve(plainTarget(c, 10, afterMidnight), { units: 1, idempotencyKey: "dec", now: afterMidnight });
  const rows = await balance(c, "nova_credits");
  assert.deepEqual(rows.map(r => r.periodKey).sort(), ["2026-11", "2026-12"]);
  assert.ok(rows.every(r => r.reserved === 1));
});

// ── Nova interactions ──

async function novaRun(usageKey: string, feature: "notes_tutor" | "today_copilot", body: () => Promise<void>, opts: { idempotencyKey?: string } = {}) {
  await llm.startInteraction({ feature, surface: "web", usageKey }, async () => {
    await reserveForInteraction(opts);
    await body();
  }).catch(() => undefined);
  await llm.flushLlmCalls();
}
const reservationsOf = (accountKey: string) => prisma.usageReservation.findMany({ where: { accountKey, product: "nova_credits" }, orderBy: { createdAt: "asc" } });

test("a Nova request commits its measured cost in credits", async () => {
  const id = await account();
  // 50,000 in × $0.10/M + 2,000 out × $0.50/M = $0.006 → 6 credits
  await novaRun(key(id), "notes_tutor", async () => { llm.emitLlmCall(call(50_000, 2_000)); });
  const [r] = await reservationsOf(key(id));
  assert.equal(r!.state, "committed");
  assert.equal(Number(r!.reservedUnits), 3, "notes_tutor reserves its estimate");
  assert.equal(Number(r!.committedUnits), 6);
  assert.equal(Number(r!.costMicros), 6_000);
  const [b] = await balance(key(id), "nova_credits");
  assert.deepEqual({ reserved: b!.reserved, committed: b!.committed, limit: b!.limit, tier: b!.tier }, { reserved: 0, committed: 6, limit: 150, tier: "free" });
});

test("Telegram: one update's reading, wording and rewording settle once, together", async () => {
  const id = await account();
  await llm.startInteraction({ feature: "rex", surface: "telegram", usageKey: key(id) }, async () => {
    await reserveForInteraction({ feature: "telegram_understanding", idempotencyKey: `telegram:chat:${STAMP}` });
    // Each call $0.0006: alone each would round up to 1 credit; together $0.0018 → 2.
    await llm.withUsageContext({ feature: "telegram_understanding" }, async () => llm.emitLlmCall(call(6_000, 0)));
    await llm.withUsageContext({ feature: "telegram_reply" }, async () => llm.emitLlmCall(call(6_000, 0)));
    await llm.withUsageContext({ feature: "telegram_rewording" }, async () => llm.emitLlmCall(call(6_000, 0)));
  });
  await llm.flushLlmCalls();
  const rs = await reservationsOf(key(id));
  assert.equal(rs.length, 1);
  assert.equal(rs[0]!.state, "committed");
  assert.equal(Number(rs[0]!.committedUnits), 2);
  assert.equal(await prisma.usageLedger.count({ where: { accountKey: key(id), product: "nova_credits", entry: "commit" } }), 1);
});

test("a provider failure refunds, keeping the provider's cost on record", async () => {
  const id = await account();
  await novaRun(key(id), "notes_tutor", async () => {
    llm.emitLlmCall(call(10_000, 0, { outcome: "failed", failureCategory: "timeout", usage: { inputTokens: 10_000, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, partial: true } }));
    throw new Error("timeout");
  });
  const [r] = await reservationsOf(key(id));
  assert.equal(r!.state, "refunded");
  assert.equal(r!.reason, "work_failed_after_model_call");
  assert.equal(Number(r!.costMicros), 1_000);
  const [b] = await balance(key(id), "nova_credits");
  assert.deepEqual({ reserved: b!.reserved, committed: b!.committed, refunded: b!.refunded }, { reserved: 0, committed: 0, refunded: 3 });
});

test("work that never reached the model is refunded", async () => {
  const id = await account();
  await novaRun(key(id), "today_copilot", async () => undefined);
  const [r] = await reservationsOf(key(id));
  assert.equal(r!.state, "refunded");
  assert.equal(r!.reason, "no_model_call");
});

test("partial output: only the calls that succeeded are charged", async () => {
  const id = await account();
  await novaRun(key(id), "today_copilot", async () => {
    llm.emitLlmCall(call(20_000, 0));                                                  // $0.002 → billed
    llm.emitLlmCall(call(30_000, 0, { outcome: "failed", failureCategory: "invalid_response" })); // $0.003, not billed
  });
  const [r] = await reservationsOf(key(id));
  assert.equal(r!.state, "committed");
  assert.equal(r!.reason, "committed_partial");
  assert.equal(Number(r!.committedUnits), 2);
  assert.equal(Number(r!.costMicros), 5_000);
});

test("a retried request with the same key is charged once", async () => {
  const id = await account();
  await novaRun(key(id), "notes_tutor", async () => { llm.emitLlmCall(call(30_000, 0)); }, { idempotencyKey: "builder:job-1" });
  await novaRun(key(id), "notes_tutor", async () => { llm.emitLlmCall(call(30_000, 0)); }, { idempotencyKey: "builder:job-1" });
  const rs = await reservationsOf(key(id));
  assert.equal(rs.length, 1);
  const [b] = await balance(key(id), "nova_credits");
  assert.equal(b!.committed, 3);
});

test("Kivo-funded work is recorded against the account and never touches Nova credits", async () => {
  const id = await account();
  await llm.startInteraction({ feature: "scheduled_nova_message", surface: "telegram", usageKey: key(id), isBackground: true }, async () => {
    await reserveForInteraction();       // not the learner's: reserves nothing
    llm.emitLlmCall(call(4_000, 100));
  });
  await llm.flushLlmCalls();
  assert.equal((await balance(key(id), "nova_credits")).length, 0);
  const [k] = await balance(key(id), "kivo_funded");
  assert.equal(k!.cost, 450);
  assert.equal(k!.limit, null);
});

// ── Browser tasks ──

test("a browser task is reserved once per start, committed by its first completed step, its steps' cost added", async () => {
  const id = await account();
  const chat = `web:${id}`;
  const first = await reserveBrowserTask({ platformChatId: chat, taskId: `t${STAMP}a`.padEnd(24, "0"), clientKey: `client-${STAMP}` });
  const retry = await reserveBrowserTask({ platformChatId: chat, taskId: `t${STAMP}b`.padEnd(24, "0"), clientKey: `client-${STAMP}` });
  assert.ok(first && retry);
  assert.equal(retry.duplicate, true);
  assert.equal(retry.taskId, first.taskId, "a retried start gets its first task back");
  const step = (outcome: "success" | "failed") => llm.startInteraction({ feature: "extension_agent", surface: "extension", usageKey: key(id), requestId: first.taskId }, async () => {
    llm.emitLlmCall(call(10_000, 0, outcome === "failed" ? { outcome, failureCategory: "timeout" } : {}));
  });
  await step("failed"); await llm.flushLlmCalls();
  let r = await prisma.usageReservation.findUniqueOrThrow({ where: { id: first.reservationId } });
  assert.equal(r.state, "reserved", "a failed step is not meaningful work");
  await step("success"); await step("success"); await llm.flushLlmCalls();
  r = await prisma.usageReservation.findUniqueOrThrow({ where: { id: first.reservationId } });
  assert.equal(r.state, "committed");
  assert.equal(Number(r.committedUnits), 1);
  assert.equal(Number(r.costMicros), 3_000, "every step's cost, failed or not");
  const [b] = await balance(key(id), "browser_tasks");
  assert.deepEqual({ committed: b!.committed, reserved: b!.reserved, limit: b!.limit }, { committed: 1, reserved: 0, limit: 10 });
  assert.equal((await balance(key(id), "nova_credits")).length, 0, "browser steps never use Nova credits");
});

test("a task with no completed step is refunded when its ticket has expired", async () => {
  const id = await account();
  const t = await reserveBrowserTask({ platformChatId: `web:${id}`, taskId: `x${STAMP}`.padEnd(24, "0") });
  assert.ok(t);
  await reconcileUsage(new Date(Date.now() + 2 * 3_600_000));
  const r = await prisma.usageReservation.findUniqueOrThrow({ where: { id: t.reservationId } });
  assert.equal(r.state, "refunded");
  assert.equal(r.reason, "no_meaningful_work");
});

// ── Reconciliation after a crash ──

test("a Nova reservation left open is committed from its usage events, or refunded with none", async () => {
  const id = await account();
  const t = await targetFor(key(id), "nova_credits");
  const withWork = await ledger.reserve(t, { units: 1, idempotencyKey: "crash-1", feature: "notes_tutor", ref: `int-${STAMP}-1` });
  const without = await ledger.reserve(t, { units: 1, idempotencyKey: "crash-2", feature: "notes_tutor", ref: `int-${STAMP}-2` });
  assert.ok(withWork.ok && without.ok);
  await writeUsageEvent({ ...call(25_000, 0), context: { feature: "notes_tutor", surface: "web", interactionId: `int-${STAMP}-1`, requestId: null, usageKey: key(id), learner: null, profileId: null, isBackground: false, isAllowanceCounted: true } });
  const out = await reconcileUsage(new Date(Date.now() + 3_600_000));
  assert.ok(out && out.committed >= 1 && out.refunded >= 1);
  const a = await prisma.usageReservation.findUniqueOrThrow({ where: { id: withWork.reservationId } });
  const b = await prisma.usageReservation.findUniqueOrThrow({ where: { id: without.reservationId } });
  assert.deepEqual([a.state, a.reason, Number(a.committedUnits)], ["committed", "reconciled_after_interruption", 3]);
  assert.deepEqual([b.state, b.reason], ["refunded", "stale_no_usage"]);
  const again = await reconcileUsage(new Date(Date.now() + 3_600_000));
  assert.equal(await prisma.usageReservation.count({ where: { accountKey: key(id), state: "reserved" } }), 0);
  assert.ok(again);
});

// ── MCP ──

test("MCP calls count on the lifetime balance, then reads on the read-only one, with the refusals enforcement would make", async () => {
  const id = await account();
  const life = await targetFor(key(id), "mcp_calls");
  await ledger.record(life, { units: 1_999, key: "seed", reason: "test_seed", shadowRefusal: null });
  const rec = (tool: string, args: Record<string, unknown> = {}) => recordMcpCall({ userId: id, grantId: "g1", tool, args, outcome: "ok" });

  const w1 = await rec("create_note", { title: "a", text: "b" });
  assert.deepEqual([w1!.lifetime, w1!.shadowRefusal], [2_000, null]);
  const w2 = await rec("create_note", { title: "a", text: "b" });
  assert.equal(w2!.shadowRefusal, "mcp_lifetime_exhausted");
  const pv = await rec("preview_knowledge_changes", { changes: [{}, {}] });
  assert.equal(pv!.shadowRefusal, "mcp_lifetime_exhausted", "a preview is a write in read-only mode");
  const r1 = await rec("search_notes", { query: "x" });
  assert.deepEqual([r1!.kind, r1!.readOnly, r1!.shadowRefusal], ["read", 1, null]);

  const ro = await targetFor(key(id), "mcp_read_only");
  await ledger.record(ro, { units: 99, key: "seed-ro", reason: "test_seed", shadowRefusal: null });
  const r2 = await rec("get_note", { noteId: "n" });
  assert.equal(r2!.shadowRefusal, "mcp_read_only_allowance_exhausted");

  const [lb] = await balance(key(id), "mcp_calls");
  assert.equal(lb!.committed, 1_999 + 5);
  assert.equal(lb!.refusals, 2);
});

test("MCP batch calls are one call each, their items counted beside; concurrent calls all count", async () => {
  const id = await account();
  const outline = [{ name: "A", children: [{ name: "A1" }] }, { name: "B" }];
  await Promise.all([
    recordMcpCall({ userId: id, grantId: "g", tool: "build_knowledge_map", args: { mode: "apply", outline }, outcome: "ok" }),
    ...Array.from({ length: 19 }, () => recordMcpCall({ userId: id, grantId: "g", tool: "search_notes", args: {}, outcome: "ok" })),
  ]);
  const [b] = await balance(key(id), "mcp_calls");
  assert.equal(b!.committed, 20);
  assert.equal(b!.items, 3 + 19);
  const unknown = await recordMcpCall({ userId: id, grantId: "g", tool: "not_a_tool", args: {}, outcome: "ok" });
  assert.deepEqual([unknown!.kind, unknown!.classified], ["write", false]);
});

test("a Plus/Pro account has no fixed MCP quota; a trial keeps Pro by default, Plus when configured", async () => {
  const id = await account();
  await prisma.billingTrial.create({ data: { userId: id, planKey: "pro_monthly", startedAt: new Date(Date.now() - 86_400_000), endsAt: new Date(Date.now() + 6 * 86_400_000) } });
  forgetTier(key(id));
  const t = await targetFor(key(id), "nova_credits");
  assert.deepEqual([t.tier, t.limit], ["pro", 3_500], "the existing trial: Pro");
  process.env.BILLING_TRIAL_TIER = "plus"; forgetTier(key(id));
  try { assert.deepEqual([(await targetFor(key(id), "nova_credits")).tier], ["plus"]); } finally { delete process.env.BILLING_TRIAL_TIER; forgetTier(key(id)); }
  const life = await targetFor(key(id), "mcp_calls");
  await ledger.record(life, { units: 50_000, key: "seed", reason: "test_seed", shadowRefusal: null });
  const w = await recordMcpCall({ userId: id, grantId: "g", tool: "create_note", args: {}, outcome: "ok" });
  assert.equal(w!.shadowRefusal, null);
});

// ── Report and deletion ──

test("the shadow report covers the ledger and names no account", async () => {
  const report = await shadowReport(new Date(Date.now() - 3_600_000), new Date(Date.now() + 3_600_000));
  assert.ok(report.nova.accounts > 0);
  assert.ok(report.coverage.ledgerCostUsd > 0);
  const text = JSON.stringify(report);
  for (const id of users) assert.ok(!text.includes(id), "no account id in the report");
});

test("an account's usage rows go with it", async () => {
  const id = await account();
  await novaRun(key(id), "notes_tutor", async () => { llm.emitLlmCall(call(1_000, 0)); });
  assert.ok((await prisma.usageLedger.count({ where: { accountKey: key(id) } })) > 0);
  await prisma.$transaction(tx => ledger.deleteAccountUsage(tx, [key(id)]));
  assert.equal(await prisma.usageLedger.count({ where: { accountKey: key(id) } }), 0);
  assert.equal(await prisma.usageReservation.count({ where: { accountKey: key(id) } }), 0);
  assert.equal(await prisma.usageBalance.count({ where: { accountKey: key(id) } }), 0);
});
