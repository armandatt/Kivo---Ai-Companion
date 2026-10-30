/**
 * Billing — real Postgres integration test.
 *
 * What it proves: trials start once however many requests race; the daily
 * allowance holds under concurrent requests; webhooks are verified by the
 * real Polar SDK, forged ones refused, repeats applied once, and late or
 * out-of-order deliveries cannot undo newer state; a refund is read from the
 * provider's own record; checkout sells only Kivo's enabled plans to someone
 * not already paying; a Telegram learner gets their linked account's plan;
 * and losing Pro deletes nothing the learner made.
 *
 * The provider's network calls are a stand-in; signature checks are the real
 * SDK's. No real checkout or charge is ever made.
 *
 *   NOVA_TEST_DATABASE_URL=postgresql://... npx tsx --test src/billing/__integration__/billing.itest.ts
 */

import "../../nova/__integration__/test-database.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";

process.env.TELEGRAM_BOT_TOKEN = "";
process.env.GEMINI_API_KEY = "";
process.env.OPENAI_API_KEY = "";

const { prisma } = await import("@repo/db/client");
const { startTrial, startCheckout, openPortal, handleWebhook, billingView } = await import("../service.js");
const { entitlementForLearner, entitlementForUser } = await import("../entitlements.js");
const { spendAiRequest, withAiAllowance, usageToday } = await import("../usage.js");
const { reportLlmUsage } = await import("../../services/llm-usage.js");
const { polarProvider } = await import("../polar.js");
const { resolveLearnerForAccount } = await import("../../nova/product/learner-identity.js");
const { saveSetup } = await import("../../nova/product/setup.js");
const { createNote, resolveNoteLearner } = await import("../../nova/product/notes.js");

const STAMP = Date.now();
const accounts: string[] = [];
let n = 0;

async function account(name = "Asha") {
  const user = await prisma.user.create({ data: { email: `bill_${STAMP}_${++n}@test.local`, name }, select: { id: true, email: true } });
  accounts.push(user.id);
  return user;
}

after(async () => {
  await prisma.aiUsageDay.deleteMany({ where: { subjectKey: { in: [...accounts.map(id => `user:${id}`), ...accounts.map(id => `learner:tg_${id}`)] } } });
  await prisma.billingWebhookEvent.deleteMany({ where: { id: { startsWith: `evt_${STAMP}_` } } });
  await prisma.user.deleteMany({ where: { id: { in: accounts } } });
  await prisma.$disconnect();
});

// ── A provider: the real SDK's webhook verification, stand-in network calls ──
const SECRET_BYTES = randomBytes(24);
const config = {
  server: "sandbox" as const, accessToken: "test-token", webhookSecret: `whsec_${SECRET_BYTES.toString("base64")}`,
  products: { pro_monthly: "prod_monthly", pro_annual: "prod_annual" }, appUrl: "https://kivo.test",
};
const calls: Array<{ kind: string; body: unknown }> = [];
const remote = new Map<string, Record<string, unknown>>();   // the provider's own subscription records
const fakeClient = {
  checkouts: { create: async (body: unknown) => { calls.push({ kind: "checkout", body }); return { url: "https://sandbox.polar.test/checkout/abc" } } },
  customerSessions: { create: async (body: unknown) => { calls.push({ kind: "portal", body }); return { customer_portal_url: "https://sandbox.polar.test/portal/xyz" } } },
  subscriptions: { get: async (id: string) => { const r = remote.get(id); if (!r) throw new Error("not found"); return r } },
} as unknown as Parameters<typeof polarProvider>[1];
const provider = { provider: polarProvider(config, fakeClient), config };

let evt = 0;
function signed(type: string, data: Record<string, unknown>, opts: { id?: string; secret?: Buffer; ts?: number } = {}) {
  const id = opts.id ?? `evt_${STAMP}_${++evt}`;
  const ts = String(opts.ts ?? Math.floor(Date.now() / 1000));
  const rawBody = JSON.stringify({ type, timestamp: new Date().toISOString(), data });
  const sig = createHmac("sha256", opts.secret ?? SECRET_BYTES).update(`${id}.${ts}.${rawBody}`).digest("base64");
  return { id, rawBody, headers: { "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": `v1,${sig}` } };
}

const subscriptionRecord = (userId: string, over: Record<string, unknown> = {}) => ({
  id: `sub_${userId}`, status: "active", created_at: "2026-11-01T00:00:00Z", modified_at: "2026-11-05T00:00:00Z",
  product_id: "prod_monthly", customer_id: `cus_${userId}`, currency: "usd", recurring_interval: "month",
  current_period_start: new Date(Date.now() - 2 * 86_400_000).toISOString(), current_period_end: new Date(Date.now() + 28 * 86_400_000).toISOString(),
  cancel_at_period_end: false, canceled_at: null, ended_at: null, customer: { external_id: userId }, metadata: { kivo_user_id: userId },
  ...over,
});

const deliver = (type: string, data: Record<string, unknown>, opts?: Parameters<typeof signed>[2]) => {
  const e = signed(type, data, opts);
  return handleWebhook({ rawBody: e.rawBody, headers: e.headers, provider }).then(r => ({ ...r, id: e.id }));
};

// ── Trials ──

test("the trial starts once, however many requests race, and gives Pro until it ends", async () => {
  const u = await account();
  const now = new Date();
  const results = await Promise.all(Array.from({ length: 8 }, () => startTrial(u.id, now)));
  assert.ok(results.every(r => r.ok));
  assert.equal(results.filter(r => r.ok && r.created).length, 1);
  assert.equal(await prisma.billingTrial.count({ where: { userId: u.id } }), 1);
  const ends = results[0]!.ok ? results[0]!.endsAt : "";
  assert.ok(results.every(r => r.ok && r.endsAt === ends), "every caller sees the same trial");

  const ent = await entitlementForUser(u.id, now);
  assert.equal(ent.plan, "pro"); assert.equal(ent.source, "trial"); assert.equal(ent.trialEligible, false);
  // After it ends: Free, and a second trial is refused.
  const later = new Date(now.getTime() + 8 * 86_400_000);
  assert.equal((await entitlementForUser(u.id, later)).plan, "free");
  const again = await startTrial(u.id, later);
  assert.ok(again.ok && !again.created, "the same, ended trial comes back; no new one");
});

test("an account that has subscribed is not offered a trial", async () => {
  const u = await account();
  assert.equal((await deliver("subscription.active", subscriptionRecord(u.id))).status, 200);
  const t = await startTrial(u.id);
  assert.ok(!t.ok && t.error === "not_eligible");
});

// ── The daily allowance ──

test("the daily allowance holds under concurrent requests, and tokens are metered", async () => {
  const u = await account();
  const ent = { usageKey: `user:${u.id}`, plan: "free" as const, allowance: { dailyRequests: 5, telegramFactor: 1 } };
  const spends = await Promise.all(Array.from({ length: 20 }, () => spendAiRequest(ent)));
  assert.equal(spends.filter(s => s.ok).length, 5, "exactly the allowance passes");
  assert.equal((await usageToday(ent.usageKey)).requests, 5);

  const u2 = await account();
  const ent2 = { ...ent, usageKey: `user:${u2.id}` };
  const run = await withAiAllowance(ent2, async () => { reportLlmUsage({ provider: "gemini", model: "m", inputTokens: 120, outputTokens: 30 }); reportLlmUsage({ provider: "gemini", model: "m", inputTokens: 80, outputTokens: null }); return "done" });
  assert.deepEqual(run, { ok: true, value: "done" });
  assert.deepEqual(await usageToday(ent2.usageKey), { requests: 1, inputTokens: 200, outputTokens: 30 });

  const capped = { ...ent2, allowance: { dailyRequests: 1, telegramFactor: 1 } };
  let ran = false;
  const refused = await withAiAllowance(capped, async () => { ran = true; return "no" });
  assert.equal(refused.ok, false); assert.equal(ran, false, "refused work never runs");
});

// ── Webhooks ──

test("a forged or tampered delivery is refused and changes nothing", async () => {
  const u = await account();
  const forged = await deliver("subscription.active", subscriptionRecord(u.id), { secret: randomBytes(24) });
  assert.equal(forged.status, 403);
  const e = signed("subscription.active", subscriptionRecord(u.id));
  const tampered = await handleWebhook({ rawBody: e.rawBody.replace("active", "trialing"), headers: e.headers, provider });
  assert.equal(tampered.status, 403);
  const stale = await deliver("subscription.active", subscriptionRecord(u.id), { ts: Math.floor(Date.now() / 1000) - 3600 });
  assert.equal(stale.status, 403, "a replay outside the time tolerance is refused");
  assert.equal(await prisma.billingSubscription.count({ where: { userId: u.id } }), 0);
  assert.equal((await entitlementForUser(u.id)).plan, "free");
});

test("a verified event gives Pro; the same delivery again is applied once", async () => {
  const u = await account();
  const e = signed("subscription.active", subscriptionRecord(u.id));
  const first = await handleWebhook({ rawBody: e.rawBody, headers: e.headers, provider });
  assert.deepEqual([first.status, first.body.outcome], [200, "applied"]);
  const repeat = await handleWebhook({ rawBody: e.rawBody, headers: e.headers, provider });
  assert.deepEqual([repeat.status, repeat.body.duplicate], [200, true]);
  const row = await prisma.billingWebhookEvent.findUniqueOrThrow({ where: { id: e.id } });
  assert.equal(row.status, "processed");
  const ent = await entitlementForUser(u.id);
  assert.equal(ent.plan, "pro"); assert.equal(ent.source, "subscription"); assert.equal(ent.planKey, "pro_monthly");
});

test("a delivery being handled is not applied twice at once; a failed one is applied on the retry", async () => {
  const u = await account();
  const e = signed("subscription.active", subscriptionRecord(u.id));
  const all = await Promise.all(Array.from({ length: 4 }, () => handleWebhook({ rawBody: e.rawBody, headers: e.headers, provider })));
  assert.equal(all.filter(r => r.body.outcome === "applied").length, 1, "applied once");
  assert.ok(all.every(r => r.status === 200 || r.status === 409));

  // The provider retries after its timeout while the first is still running.
  const busy = signed("subscription.updated", subscriptionRecord(u.id, { modified_at: "2026-11-06T00:00:00Z" }));
  await prisma.billingWebhookEvent.create({ data: { id: busy.id, provider: "polar", type: "subscription.updated", status: "received" } });
  assert.equal((await handleWebhook({ rawBody: busy.rawBody, headers: busy.headers, provider })).status, 409);
  // A handler that stopped without finishing: the next retry takes it.
  await prisma.billingWebhookEvent.update({ where: { id: busy.id }, data: { receivedAt: new Date(Date.now() - 10 * 60_000) } });
  assert.equal((await handleWebhook({ rawBody: busy.rawBody, headers: busy.headers, provider })).body.outcome, "applied");

  // Fails (the provider's record can't be read), then succeeds on the retry.
  const subId = `sub_retry_${u.id}`;
  const order = signed("order.paid", { id: `ord_${u.id}`, subscription_id: subId });
  assert.equal((await handleWebhook({ rawBody: order.rawBody, headers: order.headers, provider })).status, 500);
  assert.equal((await prisma.billingWebhookEvent.findUniqueOrThrow({ where: { id: order.id } })).status, "failed");
  remote.set(subId, subscriptionRecord(u.id, { id: subId, modified_at: "2026-11-07T00:00:00Z" }));
  const retry = await handleWebhook({ rawBody: order.rawBody, headers: order.headers, provider });
  assert.deepEqual([retry.status, retry.body.outcome], [200, "applied"]);
  const row = await prisma.billingWebhookEvent.findUniqueOrThrow({ where: { id: order.id } });
  assert.deepEqual([row.status, row.attempts], ["processed", 2]);
});

test("out of order: an older 'created' after a newer 'active' leaves Pro in place", async () => {
  const u = await account();
  await deliver("subscription.active", subscriptionRecord(u.id, { modified_at: "2026-11-05T00:00:10Z" }));
  const late = await deliver("subscription.created", subscriptionRecord(u.id, { status: "incomplete", modified_at: "2026-11-05T00:00:00Z" }));
  assert.deepEqual([late.status, late.body.outcome], [200, "ignored"]);
  assert.equal((await prisma.billingSubscription.findUniqueOrThrow({ where: { userId: u.id } })).status, "active");
});

test("cancel, then the period ends, then revoked: Pro until the end, then Free; nothing made is lost", async () => {
  const u = await account();
  const web = (await resolveLearnerForAccount(u.id, "Asha")) as { platformChatId: string };
  await prisma.userProfile.create({ data: { userId: u.id, primaryPersona: "nova", onboardingComplete: true, secondaryDomains: [], aspirationWords: [] } });
  const learner = (await resolveLearnerForAccount(u.id, "Asha")) as { platformChatId: string };
  await saveSetup(learner.platformChatId, { subjects: [{ name: "Operating Systems", topics: ["Deadlocks"] }], exams: [], dailyMinutes: null, studyTime: null }, new Date());
  const notes = await resolveNoteLearner(learner.platformChatId);
  assert.equal(notes.status, "ready");
  const profileId = notes.status === "ready" ? notes.profileId : "";
  await createNote(profileId, { title: "My deadlock notes", body: "Four conditions." });
  void web;

  await deliver("subscription.active", subscriptionRecord(u.id, { modified_at: "2026-11-05T00:00:00Z" }));
  await deliver("subscription.canceled", subscriptionRecord(u.id, { status: "active", cancel_at_period_end: true, canceled_at: "2026-11-06T00:00:00Z", modified_at: "2026-11-06T00:00:00Z" }));
  const ending = await entitlementForUser(u.id);
  assert.equal(ending.plan, "pro", "Pro stays on until the period ends");
  const view = await billingView(u.id, new Date(), {});
  assert.equal(view.subscription?.cancelAtPeriodEnd, true);

  await deliver("subscription.revoked", subscriptionRecord(u.id, { status: "canceled", ended_at: "2026-11-07T00:00:00Z", modified_at: "2026-11-07T00:00:00Z" }));
  assert.equal((await entitlementForUser(u.id)).plan, "free");
  assert.equal(await prisma.novaNote.count({ where: { profileId } }), 1, "the note is still there");
  assert.equal(await prisma.novaSubject.count({ where: { profileId } }), 1, "the subjects are still there");
});

test("a past-due subscription keeps Pro for the grace, then Free", async () => {
  const u = await account();
  const ended = new Date(Date.now() - 86_400_000).toISOString();
  await deliver("subscription.past_due", subscriptionRecord(u.id, { status: "past_due", current_period_end: ended, past_due_at: ended }));
  assert.equal((await entitlementForUser(u.id)).source, "grace");
  assert.equal((await entitlementForUser(u.id, new Date(Date.now() + 4 * 86_400_000))).plan, "free");
});

test("a refund is read from the provider's own record of the subscription", async () => {
  const u = await account();
  await deliver("subscription.active", subscriptionRecord(u.id));
  remote.set(`sub_${u.id}`, subscriptionRecord(u.id, { status: "canceled", ended_at: "2026-11-08T00:00:00Z", modified_at: "2026-11-08T00:00:00Z" }));
  const refund = await deliver("order.refunded", { id: `ord_${u.id}`, subscription_id: `sub_${u.id}`, status: "refunded" });
  assert.deepEqual([refund.status, refund.body.outcome], [200, "applied"]);
  assert.equal((await prisma.billingSubscription.findUniqueOrThrow({ where: { userId: u.id } })).status, "revoked");
  assert.equal((await entitlementForUser(u.id)).plan, "free");
});

test("an event for another seller's product, or for no Kivo account, grants nothing", async () => {
  const u = await account();
  assert.equal((await deliver("subscription.active", subscriptionRecord(u.id, { product_id: "prod_not_ours" }))).body.outcome, "ignored");
  assert.equal((await deliver("subscription.active", subscriptionRecord("user_does_not_exist"))).body.outcome, "ignored");
  assert.equal((await entitlementForUser(u.id)).plan, "free");
});

// ── Checkout and portal ──

test("checkout: only Kivo's enabled plans, the server's product, the signed-in account; never for someone paying already", async () => {
  const u = await account();
  calls.length = 0;
  const bad = await startCheckout({ userId: u.id, plan: "free", ip: null, provider });
  assert.ok(!bad.ok && bad.error === "invalid_plan");
  const injected = await startCheckout({ userId: u.id, plan: { product: "prod_attacker" }, ip: null, provider });
  assert.ok(!injected.ok && injected.error === "invalid_plan");
  const annual = await startCheckout({ userId: u.id, plan: "pro_annual", ip: null, provider });
  assert.ok(!annual.ok && annual.error === "plan_unavailable", "the yearly plan is off");
  const none = await startCheckout({ userId: u.id, plan: "pro_monthly", ip: null, provider: null });
  assert.ok(!none.ok && none.error === "not_configured");

  const good = await startCheckout({ userId: u.id, plan: "pro_monthly", ip: "203.0.113.9", provider });
  assert.ok(good.ok && good.url.startsWith("https://sandbox.polar.test/"));
  const body = calls.find(c => c.kind === "checkout")!.body as Record<string, unknown>;
  assert.deepEqual(body.products, ["prod_monthly"]);
  assert.equal(body.external_customer_id, u.id);
  assert.equal(body.customer_email, u.email);
  assert.equal(body.allow_trial, false);
  assert.match(String(body.success_url), /\/settings\/billing\?checkout=success$/);
  // Visiting the success page grants nothing: only the webhook does.
  assert.equal((await entitlementForUser(u.id)).plan, "free");

  await deliver("subscription.active", subscriptionRecord(u.id));
  const twice = await startCheckout({ userId: u.id, plan: "pro_monthly", ip: null, provider });
  assert.ok(!twice.ok && twice.error === "already_subscribed");
  const portal = await openPortal({ userId: u.id, provider });
  assert.ok(portal.ok && portal.url.includes("/portal/"));
  assert.equal((calls.find(c => c.kind === "portal")!.body as Record<string, unknown>).external_customer_id, u.id);
});

test("the portal is refused to an account with no subscription", async () => {
  const u = await account();
  const portal = await openPortal({ userId: u.id, provider });
  assert.ok(!portal.ok && portal.error === "no_subscription");
});

// ── Across surfaces ──

test("a Telegram learner has their linked account's plan; an unlinked chat is Free on its own meter", async () => {
  const u = await account();
  const chat = `tg_${u.id}`;
  await prisma.userProfile.create({ data: { userId: u.id, primaryPersona: "nova", onboardingComplete: true, telegramChatId: chat, secondaryDomains: [], aspirationWords: [] } });
  await deliver("subscription.active", subscriptionRecord(u.id));
  const viaTelegram = await entitlementForLearner(chat);
  const viaWeb = await entitlementForUser(u.id);
  assert.equal(viaTelegram.plan, "pro");
  assert.equal(viaTelegram.usageKey, viaWeb.usageKey, "one meter for one person, whatever the surface");
  assert.equal(viaTelegram.allowance.telegramFactor, 4);

  const lonely = await entitlementForLearner(`tg_unlinked_${STAMP}`);
  assert.equal(lonely.plan, "free");
  assert.equal(lonely.usageKey, `learner:tg_unlinked_${STAMP}`);
});
