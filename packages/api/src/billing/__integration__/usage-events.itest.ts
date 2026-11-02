/**
 * Usage events — real Postgres integration test.
 *
 * What it proves: a model call becomes one AiUsageEvent row with who it was
 * for (an account, an unlinked chat, a profile's learner, or the system), its
 * feature, tokens as reported (null stays null) and its cost; calls in one
 * metered request share an interaction and say the allowance counted it;
 * background work is recorded without touching the allowance; and the daily
 * meter (AiUsageDay) counts exactly what it counted before.
 *
 *   NOVA_TEST_DATABASE_URL=postgresql://... npx tsx --test src/billing/__integration__/usage-events.itest.ts
 */

import "../../nova/__integration__/test-database.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";

process.env.TELEGRAM_BOT_TOKEN = "";
process.env.GEMINI_API_KEY = "";
process.env.OPENAI_API_KEY = "";
process.env.AI_USAGE_EVENTS_DISABLED = "";

const { prisma } = await import("@repo/db/client");
const { writeUsageEvent, usageKeysFor } = await import("../usage-events.js");
const { withAiAllowance, usageToday } = await import("../usage.js");
const { entitlementForUser } = await import("../entitlements.js");
const llm = await import("../../services/llm-usage.js");

const STAMP = Date.now();
const users: string[] = [];
const chats: string[] = [];
let n = 0;

async function account() {
  const user = await prisma.user.create({ data: { email: `usage_${STAMP}_${++n}@test.local`, name: "Asha" }, select: { id: true } });
  users.push(user.id);
  return user.id;
}
async function chatLearner(chat: string) {
  chats.push(chat);
  const m = await prisma.messengerUser.create({ data: { platform: "telegram", platformChatId: chat, persona: "nova" }, select: { id: true } });
  return (await prisma.novaAcademicProfile.create({ data: { userId: m.id }, select: { id: true } })).id;
}
const keysOfTest = async () => [...users.map(id => `user:${id}`), ...chats.map(c => `learner:${c}`)];

after(async () => {
  const keys = await keysOfTest();
  await prisma.aiUsageEvent.deleteMany({ where: { OR: [{ subjectKey: { in: keys } }, { requestId: { startsWith: `t${STAMP}` } }] } });
  await prisma.aiUsageDay.deleteMany({ where: { subjectKey: { in: keys } } });
  await prisma.messengerUser.deleteMany({ where: { platformChatId: { in: chats } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

const AT = new Date();
const ctx = (over: Partial<import("../../services/llm-usage.js").UsageContext> = {}) => ({
  feature: "other" as const, surface: "web" as const, interactionId: `i_${STAMP}_${++n}`, requestId: `t${STAMP}_${n}`,
  usageKey: null, learner: null, profileId: null, isBackground: false, isAllowanceCounted: false, ...over,
});
const call = (over: Partial<import("../../services/llm-usage.js").LlmCall> = {}) => ({
  provider: "anthropic" as const, model: "claude-haiku-5-5", attempts: null, outcome: "success" as const, failureCategory: null, latencyMs: 42, at: AT,
  usage: { inputTokens: 5335, outputTokens: 1084, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }, ...over,
});

test("who a call was for: the meter key given, an account behind a learner, an unlinked chat, a profile's learner, else the system", async () => {
  const userId = await account();
  assert.deepEqual(await usageKeysFor(ctx({ usageKey: `user:${userId}`, learner: `web:${userId}` })), { subjectKey: `user:${userId}`, attributedKey: `web:${userId}` });
  assert.deepEqual(await usageKeysFor(ctx({ learner: `web:${userId}` })), { subjectKey: `user:${userId}`, attributedKey: `web:${userId}` });

  const linked = await account();
  const chat = `tg_${STAMP}_linked`;
  await prisma.userProfile.create({ data: { userId: linked, primaryPersona: "nova", onboardingComplete: true, telegramChatId: chat, secondaryDomains: [], aspirationWords: [] } });
  assert.equal((await usageKeysFor(ctx({ learner: chat }))).subjectKey, `user:${linked}`, "a linked chat is its account, as the meter counts it");

  const lonely = `tg_${STAMP}_alone`;
  const profileId = await chatLearner(lonely);
  assert.deepEqual(await usageKeysFor(ctx({ learner: lonely })), { subjectKey: `learner:${lonely}`, attributedKey: lonely });
  assert.deepEqual(await usageKeysFor(ctx({ profileId, surface: "background" })), { subjectKey: `learner:${lonely}`, attributedKey: lonely });
  assert.deepEqual(await usageKeysFor(ctx({ surface: "background" })), { subjectKey: "system:background", attributedKey: null });
});

test("one row per call: tokens as reported, null kept null, the cost and its state, the UTC day", async () => {
  const userId = await account();
  await writeUsageEvent({ ...call(), context: ctx({ usageKey: `user:${userId}`, feature: "notes_tutor", isAllowanceCounted: true }) });
  await writeUsageEvent({ ...call({ outcome: "failed", failureCategory: "rate_limited", usage: { inputTokens: null, outputTokens: null, cacheCreationInputTokens: null, cacheReadInputTokens: null } }), context: ctx({ usageKey: `user:${userId}` }) });
  await writeUsageEvent({ ...call({ provider: "gemini", model: "gemini-3.5-flash" }), context: ctx({ usageKey: `user:${userId}` }) });
  const rows = await prisma.aiUsageEvent.findMany({ where: { subjectKey: `user:${userId}` }, orderBy: { createdAt: "asc" } });
  assert.equal(rows.length, 3);
  const [ok, failed, gemini] = [rows.find(r => r.outcome === "success" && r.provider === "anthropic")!, rows.find(r => r.outcome === "failed")!, rows.find(r => r.provider === "gemini")!];
  assert.deepEqual([ok.feature, ok.inputTokens, ok.outputTokens, ok.estimatedCostMicros, ok.costState, ok.isAllowanceCounted, ok.day], ["notes_tutor", 5335, 1084, 1076, "measured", true, AT.toISOString().slice(0, 10)]);
  assert.deepEqual([failed.failureCategory, failed.inputTokens, failed.outputTokens, failed.estimatedCostMicros, failed.costState], ["rate_limited", null, null, null, "unknown"]);
  assert.deepEqual([gemini.estimatedCostMicros, gemini.costState], [null, "unknown"], "no listed price, no guessed cost");
});

test("a metered request: one count on the daily meter as before, every model call an event of one interaction", async () => {
  const userId = await account();
  const ent = await entitlementForUser(userId);
  llm.setLlmCallSink("database");
  const run = await withAiAllowance(ent, async () => {
    for (const tokens of [[900, 120], [4000, 700]]) {
      llm.reportLlmUsage({ provider: "anthropic", model: "claude-haiku-5-5", inputTokens: tokens[0]!, outputTokens: tokens[1]! });
      llm.emitLlmCall(call({ usage: { inputTokens: tokens[0]!, outputTokens: tokens[1]!, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 } }));
    }
    return "done";
  }, new Date(), { feature: "build_with_nova", surface: "web", learner: `web:${userId}` });
  await llm.flushLlmCalls();
  assert.equal(run.ok && run.value, "done");
  assert.deepEqual(await usageToday(`user:${userId}`), { requests: 1, inputTokens: 4900, outputTokens: 820 }, "the meter is unchanged");
  const rows = await prisma.aiUsageEvent.findMany({ where: { subjectKey: `user:${userId}` } });
  assert.equal(rows.length, 2);
  assert.equal(new Set(rows.map(r => r.interactionId)).size, 1);
  assert.ok(rows.every(r => r.feature === "build_with_nova" && r.isAllowanceCounted && !r.isBackground && r.attributedKey === `web:${userId}`));
});

test("background work is recorded for its learner and leaves the allowance alone", async () => {
  const chat = `tg_${STAMP}_bg`;
  const profileId = await chatLearner(chat);
  llm.setLlmCallSink("database");
  await llm.startInteraction({ feature: "saved_page_processing", surface: "background", profileId, requestId: `t${STAMP}_bg`, isBackground: true }, async () => {
    llm.emitLlmCall(call({ usage: { inputTokens: 1500, outputTokens: 200, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 } }));
  });
  await llm.flushLlmCalls();
  const row = await prisma.aiUsageEvent.findFirstOrThrow({ where: { requestId: `t${STAMP}_bg` } });
  assert.deepEqual([row.subjectKey, row.attributedKey, row.isBackground, row.isAllowanceCounted, row.feature], [`learner:${chat}`, chat, true, false, "saved_page_processing"]);
  assert.equal(await prisma.aiUsageDay.count({ where: { subjectKey: `learner:${chat}` } }), 0, "no allowance row was made or counted");
});

test("a refused request runs nothing, so it records nothing", async () => {
  const userId = await account();
  const ent = await entitlementForUser(userId);
  const capped = { ...ent, allowance: { ...ent.allowance, dailyRequests: 0 } };
  llm.setLlmCallSink("database");
  const run = await withAiAllowance(capped, async () => { llm.emitLlmCall(call()); return "no"; }, new Date(), { feature: "nova_chat", surface: "web" });
  await llm.flushLlmCalls();
  assert.equal(run.ok, false);
  assert.equal(await prisma.aiUsageEvent.count({ where: { subjectKey: `user:${userId}` } }), 0);
});
