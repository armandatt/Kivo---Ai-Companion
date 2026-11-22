/**
 * Usage enforcement (Phase 2) — real Postgres integration test.
 *
 * With USAGE_ACCOUNTING=enforce: Nova credits (Free 150 / Plus 1,000 / Pro
 * 3,500) admit or refuse before work runs, charge by measured cost, refund
 * failures, never overspend under concurrency and renew by period; browser
 * tasks (10 / 40 / 120) are counted once per task, never per step, never stop
 * a running task, refund a Kivo-side failure, and are fair-use limited; MCP
 * follows Free's 2,000 lifetime calls then 100 reads a month, refusing every
 * write path after the threshold, atomically at the boundary; storage admits
 * uploads within 500 MB / 2 GB / 15 GB, concurrently, and keeps everything
 * stored when over; Polar's lifecycle moves the tier (Plus, Pro, upgrade,
 * downgrade, past due, grace, cancel, revoke, refund, duplicates), annual
 * plans renew allowances monthly, and an existing Pro subscriber keeps Pro.
 *
 *   NOVA_TEST_DATABASE_URL=postgresql://... npx tsx --test src/billing/__integration__/usage-enforcement.itest.ts
 */

import "../../nova/__integration__/test-database.js";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";

process.env.TELEGRAM_BOT_TOKEN = "";
process.env.AI_USAGE_EVENTS_DISABLED = "";
process.env.USAGE_ACCOUNTING = "enforce";
delete process.env.USAGE_ENFORCE;
delete process.env.USAGE_ALLOWANCES;
delete process.env.BILLING_TRIAL_TIER;
const ROOMY = JSON.stringify({ browserStartsPer10Min: 10_000, browserOpenTasks: 10_000, mcpCallsPerMinute: 100_000, mcpCallsPerDay: 100_000, mcpItemsPerDay: 100_000, novaJobsPerMinute: 10_000 });
process.env.USAGE_FAIR_USE = ROOMY;

const { prisma } = await import("@repo/db/client");
const llm = await import("../../services/llm-usage.js");
const ledger = await import("../accounting/ledger.js");
const { reserveForInteraction, reserveNovaFor } = await import("../accounting/nova.js");
const { admitBrowserTask, refundBrowserTask, stepOfTask } = await import("../accounting/browser.js");
const { admitMcpCall, mcpAllowanceOf } = await import("../accounting/mcp.js");
const { admitStorage, measureStorage } = await import("../accounting/storage.js");
const { usageViewFor } = await import("../accounting/summary.js");
const { shadowReport } = await import("../accounting/report.js");
const { targetFor, forgetTier } = await import("../accounting/targets.js");
const { monthlyPeriod } = await import("../accounting/rules.js");
const { withAiAllowance } = await import("../usage.js");
const { entitlementForUser } = await import("../entitlements.js");
const { handleWebhook } = await import("../service.js");
const { polarProvider } = await import("../polar.js");

const STAMP = Date.now();
const users: string[] = [];
let n = 0;

async function account(): Promise<string> {
  const u = await prisma.user.create({ data: { email: `enf_${STAMP}_${++n}@test.local`, name: "Asha" }, select: { id: true } });
  users.push(u.id);
  return u.id;
}
const key = (id: string) => `user:${id}`;

beforeEach(() => { process.env.USAGE_FAIR_USE = ROOMY; delete process.env.USAGE_ALLOWANCES; forgetTier(); });

after(async () => {
  await llm.flushLlmCalls();
  await prisma.$transaction(tx => ledger.deleteAccountUsage(tx, users.map(key)));
  await prisma.$executeRawUnsafe(`DELETE FROM "RateLimitWindow" WHERE key LIKE '%${STAMP}%' OR ${users.map(u => `key LIKE '%${u}%'`).join(" OR ") || "false"}`);
  await prisma.billingWebhookEvent.deleteMany({ where: { id: { startsWith: `evt_${STAMP}_` } } });
  await prisma.messengerUser.deleteMany({ where: { platformChatId: { in: users.map(u => `web:${u}`) } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

const call = (inputTokens: number, outputTokens = 0, over: Partial<import("../../services/llm-usage.js").LlmCall> = {}) => ({
  provider: "anthropic" as const, model: "claude-haiku-5-5", attempts: 1, outcome: "success" as const, failureCategory: null, latencyMs: 10, at: new Date(),
  usage: { inputTokens, outputTokens, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }, ...over,
});
// A balance's committed + reserved (what is not available).
async function held(accountKey: string, product: string, periodKey?: string) {
  const t = await targetFor(accountKey, product as never);
  const b = await ledger.balancesOf(accountKey, [{ product: product as never, periodKey: periodKey ?? t.period.key }]);
  const row = b.get(`${product}|${periodKey ?? t.period.key}`);
  return { committed: row?.committed ?? 0, reserved: row?.reserved ?? 0, limit: row?.limit ?? null };
}
async function seed(accountKey: string, product: "nova_credits" | "browser_tasks" | "mcp_calls" | "mcp_read_only", units: number, now = new Date()) {
  await ledger.record(await targetFor(accountKey, product, now), { units, key: `seed:${product}:${units}:${now.getTime()}`, reason: "test_seed", shadowRefusal: null });
}
async function ask(userId: string, cost: { input: number } = { input: 5_000 }, work?: () => Promise<void>) {
  const ent = await entitlementForUser(userId);
  return withAiAllowance(ent, async () => { llm.emitLlmCall(call(cost.input)); if (work) await work(); return "done"; }, new Date(), { feature: "today_copilot", surface: "web" });
}

// ── Nova credits ─────────────────────────────────────────────────────────────

test("Nova: Free, Plus and Pro allowances are 150, 1,000 and 3,500 a month; a trial keeps Pro by default", async () => {
  const free = await account();
  const plus = await account(); await prisma.billingSubscription.create({ data: subRow(plus, "plus_monthly") });
  const pro = await account(); await prisma.billingSubscription.create({ data: subRow(pro, "pro_monthly") });
  const trial = await account(); await prisma.billingTrial.create({ data: { userId: trial, planKey: "pro_monthly", startedAt: new Date(Date.now() - 86_400_000), endsAt: new Date(Date.now() + 6 * 86_400_000) } });
  for (const [id, limit] of [[free, 150], [plus, 1_000], [pro, 3_500], [trial, 3_500]] as const) {
    assert.equal((await targetFor(key(id), "nova_credits")).limit, limit);
  }
  process.env.BILLING_TRIAL_TIER = "plus"; forgetTier();
  try { assert.equal((await targetFor(key(trial), "nova_credits")).limit, 1_000, "configurable to Plus"); } finally { delete process.env.BILLING_TRIAL_TIER; }
});

test("Nova: a request is charged its measured cost in credits; a costlier one more", async () => {
  const id = await account();
  assert.ok((await ask(id, { input: 5_000 })).ok);          // $0.0005 → 1
  assert.ok((await ask(id, { input: 62_000 })).ok);         // $0.0062 → 7
  await llm.flushLlmCalls();
  const b = await held(key(id), "nova_credits");
  assert.deepEqual([b.committed, b.reserved], [8, 0]);
});

test("Nova: at the limit the next request is refused before it runs, with the allowance named and its renewal", async () => {
  const id = await account();
  await seed(key(id), "nova_credits", 149);
  let ran = 0;
  assert.ok((await ask(id, undefined, async () => { ran++; })).ok);
  await llm.flushLlmCalls();
  const r = await ask(id, undefined, async () => { ran++; });
  assert.equal(r.ok, false);
  assert.equal(ran, 1, "the refused work never ran");
  const credits = !r.ok ? r.spend.credits! : null;
  assert.equal(credits?.code, "nova_allowance_exhausted");
  assert.deepEqual([credits?.used, credits?.limit, credits?.tier], [150, 150, "free"]);
  assert.equal(credits?.resetsAt, monthlyPeriod(new Date()).end!.toISOString());
});

test("Nova: concurrent requests never overspend", async () => {
  const id = await account();
  await seed(key(id), "nova_credits", 140);
  const results = await Promise.all(Array.from({ length: 30 }, () => ask(id)));
  await llm.flushLlmCalls();
  assert.equal(results.filter(r => r.ok).length, 10);
  const b = await held(key(id), "nova_credits");
  assert.deepEqual([b.committed, b.reserved], [150, 0]);
});

test("Nova: work that fails is refunded; secondary calls in one request settle together", async () => {
  const id = await account();
  const ent = await entitlementForUser(id);
  await assert.rejects(withAiAllowance(ent, async () => { llm.emitLlmCall(call(10_000, 0, { outcome: "failed", failureCategory: "timeout" })); throw new Error("provider down"); }, new Date(), { feature: "today_copilot", surface: "web" }));
  const ok = await withAiAllowance(ent, async () => {
    // A reading and a wording, one request: $0.0006 + $0.0006 → 2 credits, once.
    await llm.withUsageContext({ feature: "notes_tutor" }, async () => llm.emitLlmCall(call(6_000)));
    await llm.withUsageContext({ feature: "notes_editor" }, async () => llm.emitLlmCall(call(6_000)));
    return 1;
  }, new Date(), { feature: "today_copilot", surface: "web" });
  assert.ok(ok.ok);
  await llm.flushLlmCalls();
  const b = await held(key(id), "nova_credits");
  assert.deepEqual([b.committed, b.reserved], [2, 0]);
});

test("Nova: Telegram's turn is refused once the month's credits are used", async () => {
  const id = await account();
  await seed(key(id), "nova_credits", 150);
  let admitted: Awaited<ReturnType<typeof reserveForInteraction>> | null = null;
  await llm.startInteraction({ feature: "rex", surface: "telegram", usageKey: key(id) }, async () => {
    admitted = await reserveForInteraction({ feature: "telegram_understanding", idempotencyKey: `telegram:${STAMP}:1` });
  });
  assert.equal(admitted!.refused?.code, "nova_allowance_exhausted");
});

test("Nova: a duplicate job submission reserves once; a new month starts fresh", async () => {
  const id = await account();
  await prisma.messengerUser.create({ data: { platform: "web", platformChatId: `web:${id}`, persona: "nova" } });
  const a = await reserveNovaFor(`web:${id}`, { feature: "build_with_nova", idempotencyKey: `builder-turn:${STAMP}:dup` });
  const b = await reserveNovaFor(`web:${id}`, { feature: "build_with_nova", idempotencyKey: `builder-turn:${STAMP}:dup` });
  assert.ok(a.reservationId && a.reservationId === b.reservationId);
  assert.equal((await held(key(id), "nova_credits")).reserved, 8);

  await seed(key(id), "nova_credits", 150);
  const next = new Date(monthlyPeriod(new Date()).end!.getTime() + 1_000);
  const t = await targetFor(key(id), "nova_credits", next);
  assert.notEqual(t.period.key, monthlyPeriod(new Date()).key);
  const r = await ledger.reserve(t, { units: 1, idempotencyKey: "next-month", mode: "enforce", now: next });
  assert.ok(r.ok, "the new month's allowance is untouched by this month's");
});

// ── Browser tasks ────────────────────────────────────────────────────────────

const chatOf = async (id: string) => {
  await prisma.messengerUser.upsert({ where: { platform_platformChatId: { platform: "web", platformChatId: `web:${id}` } }, create: { platform: "web", platformChatId: `web:${id}`, persona: "nova" }, update: {} });
  return `web:${id}`;
};
const taskId = () => randomBytes(12).toString("hex");

test("Browser: Free has 10 tasks, Plus 40, Pro 120; the next start is refused", async () => {
  const free = await account();
  const plus = await account(); await prisma.billingSubscription.create({ data: subRow(plus, "plus_monthly") });
  const pro = await account(); await prisma.billingSubscription.create({ data: subRow(pro, "pro_monthly") });
  const freeChat = await chatOf(free);
  const starts = await Promise.all(Array.from({ length: 10 }, () => admitBrowserTask({ platformChatId: freeChat, taskId: taskId() })));
  assert.ok(starts.every(s => !s.refused));
  const eleventh = await admitBrowserTask({ platformChatId: await chatOf(free), taskId: taskId() });
  assert.equal(eleventh.refused?.code, "browser_allowance_exhausted");
  for (const [id, limit] of [[plus, 40], [pro, 120]] as const) {
    await seed(key(id), "browser_tasks", limit - 1);
    assert.ok(!(await admitBrowserTask({ platformChatId: await chatOf(id), taskId: taskId() })).refused);
    const over = await admitBrowserTask({ platformChatId: await chatOf(id), taskId: taskId() });
    assert.deepEqual([over.refused?.code, over.refused && "limit" in over.refused ? over.refused.limit : null], ["browser_allowance_exhausted", limit]);
  }
});

test("Browser: concurrent starts never pass the allowance; a duplicate start is one task", async () => {
  const id = await account();
  const chat = await chatOf(id);
  const results = await Promise.all(Array.from({ length: 25 }, () => admitBrowserTask({ platformChatId: chat, taskId: taskId() })));
  assert.equal(results.filter(r => !r.refused).length, 10);
  const other = await account();
  const c2 = await chatOf(other);
  const a = await admitBrowserTask({ platformChatId: c2, taskId: taskId(), clientKey: `ck-${STAMP}-dup` });
  const b = await admitBrowserTask({ platformChatId: c2, taskId: taskId(), clientKey: `ck-${STAMP}-dup` });
  assert.ok(a.task && b.task && b.task.duplicate && b.task.taskId === a.task.taskId);
  assert.equal((await held(key(other), "browser_tasks")).reserved, 1);
});

test("Browser: steps never use tasks, the step cap holds, and a running task is not stopped at the quota", async () => {
  const id = await account();
  const chat = await chatOf(id);
  await seed(key(id), "browser_tasks", 9);
  const t = await admitBrowserTask({ platformChatId: chat, taskId: taskId() });
  assert.ok(t.task);
  // The month is now used up …
  assert.equal((await admitBrowserTask({ platformChatId: chat, taskId: taskId() })).refused?.code, "browser_allowance_exhausted");
  // … and the running task still takes its steps, up to its cap only.
  const steps = [];
  for (let i = 0; i < 4; i++) steps.push(await stepOfTask(t.task!.taskId, 3));
  assert.deepEqual(steps.map(s => s?.allowed), [true, true, true, false]);
  const b = await held(key(id), "browser_tasks");
  assert.equal(b.committed + b.reserved, 10, "steps added no task");
});

test("Browser: a Kivo-side failure before the task began is refunded; a task with work is kept", async () => {
  const id = await account();
  const chat = await chatOf(id);
  const failed = await admitBrowserTask({ platformChatId: chat, taskId: taskId() });
  await refundBrowserTask(failed.task!.reservationId, "kivo_failed_before_start");
  const worked = await admitBrowserTask({ platformChatId: chat, taskId: taskId() });
  await llm.startInteraction({ feature: "extension_agent", surface: "extension", usageKey: key(id), requestId: worked.task!.taskId }, async () => { llm.emitLlmCall(call(10_000)); });
  await llm.flushLlmCalls();
  const b = await held(key(id), "browser_tasks");
  assert.deepEqual([b.committed, b.reserved], [1, 0]);
  const r = await ledger.reservationById(worked.task!.reservationId);
  assert.equal(r?.state, "committed");
  assert.equal(r?.costMicros, 1_000);
});

test("Browser: actual task cost is recorded and tasks over the $0.03 target are reported", async () => {
  const id = await account();
  const chat = await chatOf(id);
  const t = await admitBrowserTask({ platformChatId: chat, taskId: taskId() });
  for (let i = 0; i < 4; i++) {
    await llm.startInteraction({ feature: "extension_agent", surface: "extension", usageKey: key(id), requestId: t.task!.taskId }, async () => { llm.emitLlmCall(call(100_000)); }); // $0.01 a step
  }
  await llm.flushLlmCalls();
  assert.equal((await ledger.reservationById(t.task!.reservationId))?.costMicros, 40_000);
  const report = await shadowReport(new Date(Date.now() - 3_600_000), new Date(Date.now() + 3_600_000));
  assert.ok(report.browser.overTarget >= 1);
  assert.equal(report.browser.costTargetUsd, 0.03);
});

test("Browser: fair use limits starts and tasks running at once", async () => {
  process.env.USAGE_FAIR_USE = JSON.stringify({ browserStartsPer10Min: 1_000, browserOpenTasks: 2 });
  const id = await account();
  const chat = await chatOf(id);
  await admitBrowserTask({ platformChatId: chat, taskId: taskId() });
  await admitBrowserTask({ platformChatId: chat, taskId: taskId() });
  assert.equal((await admitBrowserTask({ platformChatId: chat, taskId: taskId() })).refused?.code, "browser_too_many_open");
  process.env.USAGE_FAIR_USE = JSON.stringify({ browserStartsPer10Min: 1, browserOpenTasks: 1_000 });
  const other = await account();
  const c2 = await chatOf(other);
  assert.ok(!(await admitBrowserTask({ platformChatId: c2, taskId: taskId() })).refused);
  assert.equal((await admitBrowserTask({ platformChatId: c2, taskId: taskId() })).refused?.code, "browser_rate_limited");
});

// ── MCP ──────────────────────────────────────────────────────────────────────

const mcp = (userId: string, tool: string, args: Record<string, unknown> = {}, now?: Date) => admitMcpCall({ userId, grantId: `g-${STAMP}-${userId}`, tool, args, now });

test("MCP Free: writes run below 2,000 lifetime calls; the 2,000th is the last write; later writes are refused and not counted", async () => {
  const id = await account();
  await seed(key(id), "mcp_calls", 1_998);
  assert.ok((await mcp(id, "create_note", { title: "a", text: "b" })).admitted);
  const last = await mcp(id, "create_note", { title: "a", text: "b" });
  assert.ok(last.admitted);
  assert.equal(last.allowance.lifetimeUsed, 2_000);
  const refused = await mcp(id, "update_note", { noteId: "x", appendText: "y", baseUpdatedAt: "z" });
  assert.deepEqual([refused.admitted, refused.refusal], [false, "mcp_lifetime_exhausted"]);
  assert.equal((await held(key(id), "mcp_calls", "lifetime")).committed, 2_000, "a refused call counts nothing");
});

test("MCP Free: no write path survives the threshold: batches, previews, plans, captures, unknown tools", async () => {
  const id = await account();
  await seed(key(id), "mcp_calls", 2_000);
  for (const [tool, args] of [
    ["execute_knowledge_changes", { planId: "a".repeat(32), expiresAt: "x", changes: [{}, {}] }],
    ["preview_knowledge_changes", { changes: [{}] }],
    ["capture_knowledge", { mode: "preview", items: [{}] }],
    ["build_knowledge_map", { mode: "preview", outline: [{ name: "A" }] }],
    ["add_knowledge_node", { type: "topics", topics: ["a", "b"] }],
    ["save_page", { url: "https://example.com" }],
    ["link_notes", { fromNoteId: "x" }],
    ["delete_note", { noteId: "x" }],
    ["a_tool_added_later", {}],
  ] as const) {
    const r = await mcp(id, tool, args as Record<string, unknown>);
    assert.equal(r.refusal, "mcp_lifetime_exhausted", tool);
  }
  const read = await mcp(id, "search_notes", { query: "x" });
  assert.ok(read.admitted && read.allowance.readOnly);
  assert.equal(read.allowance.readOnlyUsed, 1);
});

test("MCP Free: 100 read-only calls a month, then refused; a new month renews them and never the lifetime count", async () => {
  const id = await account();
  await seed(key(id), "mcp_calls", 2_000);
  await seed(key(id), "mcp_read_only", 99);
  assert.ok((await mcp(id, "get_note", { noteId: "n" })).admitted);
  const r = await mcp(id, "get_note", { noteId: "n" });
  assert.deepEqual([r.admitted, r.refusal], [false, "mcp_read_only_allowance_exhausted"]);
  assert.equal(r.allowance.readOnlyLimit, 100);
  const next = new Date(monthlyPeriod(new Date()).end!.getTime() + 1_000);
  const renewed = await mcp(id, "get_note", { noteId: "n" }, next);
  assert.ok(renewed.admitted);
  assert.equal(renewed.allowance.readOnlyUsed, 1);
  assert.equal(renewed.allowance.lifetimeUsed, 2_002, "the lifetime counter never resets");
  const view = await mcpAllowanceOf(id);
  assert.equal(view.readOnly, true);
});

test("MCP: concurrent calls at the boundary admit exactly the writes that fit", async () => {
  const id = await account();
  await seed(key(id), "mcp_calls", 1_995);
  const results = await Promise.all(Array.from({ length: 12 }, () => mcp(id, "create_note", { title: "a", text: "b" })));
  assert.equal(results.filter(r => r.admitted).length, 5);
  assert.ok(results.filter(r => !r.admitted).every(r => r.refusal === "mcp_lifetime_exhausted"));
  assert.equal((await held(key(id), "mcp_calls", "lifetime")).committed, 2_000);
});

test("MCP: a retried call with the same idempotency key counts once", async () => {
  const id = await account();
  await mcp(id, "create_note", { title: "a", text: "b", idempotencyKey: `idem-${STAMP}` });
  const again = await mcp(id, "create_note", { title: "a", text: "b", idempotencyKey: `idem-${STAMP}` });
  assert.ok(again.admitted && again.duplicate);
  assert.equal((await held(key(id), "mcp_calls", "lifetime")).committed, 1);
});

test("MCP Plus/Pro: no fixed quota, but fair use per connection", async () => {
  const id = await account();
  await prisma.billingSubscription.create({ data: subRow(id, "plus_monthly") });
  await seed(key(id), "mcp_calls", 50_000);
  assert.ok((await mcp(id, "create_note", { title: "a", text: "b" })).admitted);
  process.env.USAGE_FAIR_USE = JSON.stringify({ mcpCallsPerMinute: 3 });
  const pro = await account();
  await prisma.billingSubscription.create({ data: subRow(pro, "pro_monthly") });
  const results = [];
  for (let i = 0; i < 5; i++) results.push(await mcp(pro, "search_notes", {}));
  assert.deepEqual(results.map(r => r.refusal), [null, null, null, "mcp_rate_limited", "mcp_rate_limited"]);
});

// ── Storage ──────────────────────────────────────────────────────────────────

async function learnerWithImages(id: string, imageBytes: number[]) {
  const m = await prisma.messengerUser.create({ data: { platform: "web", platformChatId: `web:${id}`, persona: "nova" }, select: { id: true } });
  const p = await prisma.novaAcademicProfile.create({ data: { userId: m.id }, select: { id: true } });
  const note = await prisma.novaNote.create({ data: { profileId: p.id, title: "N", body: "b" }, select: { id: true } });
  for (const [i, b] of imageBytes.entries()) {
    await prisma.novaNoteImage.create({ data: { profileId: p.id, noteId: note.id, mimeType: "image/png", bytes: Buffer.alloc(b), width: 1, height: 1, clientKey: `k${i}` } });
  }
  return { platformChatId: `web:${id}`, profileId: p.id };
}

test("Storage: uploads within the allowance are admitted; one that would pass it is refused", async () => {
  process.env.USAGE_ALLOWANCES = JSON.stringify({ free: { storageBytes: 3_000_000 } });
  const id = await account();
  const who = await learnerWithImages(id, [1_500_000]);
  const ok = await admitStorage({ ...who, bytes: 1_000_000 });
  assert.equal(ok.refused, null);
  await ok.release();
  const over = await admitStorage({ ...who, bytes: 2_000_000 });
  assert.deepEqual([over.refused?.code, over.refused?.usedBytes, over.refused?.limitBytes], ["storage_allowance_exhausted", 1_500_000, 3_000_000]);
});

test("Storage: concurrent uploads cannot pass the allowance together", async () => {
  process.env.USAGE_ALLOWANCES = JSON.stringify({ free: { storageBytes: 3_000_000 } });
  const id = await account();
  const who = await learnerWithImages(id, []);
  const gates = await Promise.all(Array.from({ length: 4 }, () => admitStorage({ ...who, bytes: 1_200_000 })));
  assert.equal(gates.filter(g => g.refused === null).length, 2);
  await Promise.all(gates.map(g => g.release()));
});

test("Storage: over a lower allowance after a downgrade, nothing stored is touched; only new uploads wait", async () => {
  const id = await account();
  await prisma.billingSubscription.create({ data: subRow(id, "pro_monthly") });
  const who = await learnerWithImages(id, [2_000_000, 2_000_000]);
  process.env.USAGE_ALLOWANCES = JSON.stringify({ pro: { storageBytes: 10_000_000 }, free: { storageBytes: 3_000_000 } });
  assert.equal((await admitStorage({ ...who, bytes: 100 })).refused, null);
  // Downgraded: the subscription has ended.
  await prisma.billingSubscription.update({ where: { userId: id }, data: { status: "revoked", endedAt: new Date() } });
  forgetTier();
  const m = await measureStorage(who);
  assert.deepEqual([m?.bytes, m?.over], [4_000_000, true]);
  assert.equal((await admitStorage({ ...who, bytes: 100 })).refused?.code, "storage_allowance_exhausted");
  assert.equal(await prisma.novaNoteImage.count({ where: { profileId: who.profileId } }), 2, "every image is still there");
  const view = await usageViewFor(id);
  assert.deepEqual([view.tier, view.storage.usedBytes, view.storage.limitBytes], ["free", 4_000_000, 3_000_000]);
});

// ── Polar lifecycle ──────────────────────────────────────────────────────────

const SECRET = randomBytes(24);
const config = {
  server: "sandbox" as const, accessToken: "t", webhookSecret: `whsec_${SECRET.toString("base64")}`,
  products: { pro_monthly: "prod_pro", pro_annual: "prod_annual", plus_monthly: "prod_plus" }, appUrl: "https://kivo.test",
};
const remote = new Map<string, Record<string, unknown>>();
const fakeClient = { subscriptions: { get: async (id: string) => { const r = remote.get(id); if (!r) throw new Error("not found"); return r } } } as unknown as Parameters<typeof polarProvider>[1];
const provider = { provider: polarProvider(config, fakeClient), config };
let evt = 0, mod = 0;
function deliver(type: string, data: Record<string, unknown>, id = `evt_${STAMP}_${++evt}`) {
  const ts = String(Math.floor(Date.now() / 1000));
  const rawBody = JSON.stringify({ type, timestamp: new Date().toISOString(), data });
  const sig = createHmac("sha256", SECRET).update(`${id}.${ts}.${rawBody}`).digest("base64");
  return handleWebhook({ rawBody, headers: { "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": `v1,${sig}` }, provider });
}
const record = (userId: string, over: Record<string, unknown> = {}) => ({
  id: `sub_${userId}`, status: "active", created_at: "2026-11-01T00:00:00Z", modified_at: new Date(Date.UTC(2026, 10, 1, 0, 0, ++mod)).toISOString(),
  product_id: "prod_plus", customer_id: `cus_${userId}`, currency: "inr", recurring_interval: "month",
  current_period_start: new Date(Date.now() - 2 * 86_400_000).toISOString(), current_period_end: new Date(Date.now() + 28 * 86_400_000).toISOString(),
  cancel_at_period_end: false, canceled_at: null, ended_at: null, customer: { external_id: userId }, metadata: { kivo_user_id: userId }, ...over,
});
function subRow(userId: string, planKey: string, over: Record<string, unknown> = {}) {
  return { userId, provider: "polar", providerCustomerId: `cus_${userId}`, providerSubscriptionId: `sub_${userId}_seed`, planKey, status: "active",
    currentPeriodStart: new Date(Date.now() - 86_400_000), currentPeriodEnd: new Date(Date.now() + 29 * 86_400_000), cancelAtPeriodEnd: false, providerModifiedAt: new Date(), ...over };
}
const tierNow = async (id: string) => { forgetTier(); return (await targetFor(key(id), "nova_credits")).tier; };

test("Polar: a verified Plus subscription grants Plus; a duplicate delivery changes nothing", async () => {
  const id = await account();
  const first = await deliver("subscription.active", record(id), `evt_${STAMP}_dup`);
  assert.equal(first.status, 200);
  assert.equal(await tierNow(id), "plus");
  const again = await deliver("subscription.active", record(id), `evt_${STAMP}_dup`);
  assert.deepEqual(again.body, { duplicate: true });
  assert.equal((await targetFor(key(id), "browser_tasks")).limit, 40);
});

test("Polar: upgrade to Pro and downgrade to Plus move the tier, a late event changes nothing", async () => {
  const id = await account();
  await deliver("subscription.active", record(id));
  await deliver("subscription.updated", record(id, { product_id: "prod_pro", currency: "usd" }));
  assert.equal(await tierNow(id), "pro");
  const late = record(id, { product_id: "prod_plus", modified_at: "2026-10-01T00:00:00Z" });
  await deliver("subscription.updated", late);
  assert.equal(await tierNow(id), "pro", "an older event is stale");
  await deliver("subscription.updated", record(id, { product_id: "prod_plus" }));
  assert.equal(await tierNow(id), "plus");
});

test("Polar: failed payment keeps the tier through the 3-day grace, then Free; cancellation keeps it to the period end; revocation and refund end it", async () => {
  const a = await account();
  await deliver("subscription.active", record(a));
  await deliver("subscription.updated", record(a, { status: "past_due", current_period_end: new Date(Date.now() - 86_400_000).toISOString() }));
  assert.equal(await tierNow(a), "plus", "in grace");
  await deliver("subscription.updated", record(a, { status: "past_due", current_period_end: new Date(Date.now() - 5 * 86_400_000).toISOString() }));
  assert.equal(await tierNow(a), "free", "grace over");

  const b = await account();
  await deliver("subscription.active", record(b, { product_id: "prod_pro" }));
  await deliver("subscription.canceled", record(b, { product_id: "prod_pro", status: "canceled", cancel_at_period_end: true, canceled_at: new Date().toISOString() }));
  assert.equal(await tierNow(b), "pro", "paid to the period end");
  await deliver("subscription.revoked", record(b, { product_id: "prod_pro", status: "canceled", ended_at: new Date().toISOString() }));
  assert.equal(await tierNow(b), "free");

  const c = await account();
  await deliver("subscription.active", record(c));
  remote.set(`sub_${c}`, record(c, { status: "canceled", ended_at: new Date().toISOString() }));
  await deliver("order.refunded", { id: `ord_${c}`, subscription_id: `sub_${c}` });
  assert.equal(await tierNow(c), "free", "a refunded order's subscription, as the provider now has it");
});

test("Polar: an annual plan renews its allowances monthly on the subscription's day, never a year at once", async () => {
  const id = await account();
  const start = new Date(Date.now() - 10 * 86_400_000);
  await deliver("subscription.active", record(id, { product_id: "prod_annual", recurring_interval: "year", current_period_start: start.toISOString(), current_period_end: new Date(start.getTime() + 365 * 86_400_000).toISOString() }));
  const t = await targetFor(key(id), "nova_credits");
  const anchored = monthlyPeriod(new Date(), Math.min(28, start.getUTCDate()));
  assert.deepEqual([t.tier, t.limit, t.period.key], ["pro", 3_500, anchored.key]);
  const days = (t.period.end!.getTime() - t.period.start!.getTime()) / 86_400_000;
  assert.ok(days >= 28 && days <= 31, "a month's allowance");
});

test("Existing Pro subscribers keep Pro, and their usage history is untouched", async () => {
  const id = await account();
  await prisma.billingSubscription.create({ data: subRow(id, "pro_monthly") });
  await prisma.aiUsageDay.create({ data: { subjectKey: key(id), day: "2026-11-01", requests: 42 } });
  const ent = await entitlementForUser(id);
  assert.deepEqual([ent.plan, ent.tier, ent.source], ["pro", "pro", "subscription"]);
  assert.equal((await targetFor(key(id), "nova_credits")).limit, 3_500);
  assert.equal((await targetFor(key(id), "browser_tasks")).limit, 120);
  assert.equal((await prisma.aiUsageDay.findFirst({ where: { subjectKey: key(id) } }))?.requests, 42);
  await prisma.aiUsageDay.deleteMany({ where: { subjectKey: key(id) } });
});
