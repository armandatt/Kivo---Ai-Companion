/**
 * Nova, from a new account onward — real Postgres integration test.
 *
 * What it proves: a person who signs up and chooses Nova is one learner, with
 * one set of state, whether or not they ever connect Telegram; connecting
 * Telegram adds a channel to that learner and makes no second one; and the web
 * app and Telegram then read and write the same session, mastery, exams,
 * reality and plan.
 *
 * Telegram and both models are stood in. Everything between is the real code
 * against a real database.
 *
 *   NOVA_TEST_DATABASE_URL=postgresql://... npm run test:integration
 */

import "./test-database.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

process.env.TELEGRAM_BOT_TOKEN = "";          // nothing here may reach Telegram
process.env.GEMINI_API_KEY = "";              // or a model
process.env.OPENAI_API_KEY = "";

const { prisma }                    = await import("@repo/db/client");
const { resolveLearnerForAccount }  = await import("../product/learner-identity.js");
const { webLearnerId }              = await import("../product/learner-key.js");
const { handleNovaTelegramEvent }   = await import("../telegram/telegram-turn.js");
const { normalizeTelegramUpdate }   = await import("../telegram/telegram-event.js");
const { linkTelegramChat, linkTokenExpiry } = await import("../telegram/telegram-link.js");
const { parseUnderstandingResponse } = await import("../brains/understanding-parser.js");
const { runNovaOrchestrator }       = await import("../nova-orchestrator.js");
const { runNovaSessionCommand, loadNovaSession } = await import("../product/session.js");
// The status a session command left the session in, or why it did not run.
const statusAfter = (r: Awaited<ReturnType<typeof runNovaSessionCommand>>) => r.ok ? r.session?.status ?? null : r.error;
const { loadNovaToday }             = await import("../product/today.js");
const { loadNovaPlanner }           = await import("../product/planner.js");
const { loadNovaKnowledge }         = await import("../product/knowledge.js");
const { loadNovaProgress }          = await import("../product/progress.js");
const { loadNovaLearningDna, recordLearnerTimezone } = await import("../product/learning-dna.js");
const { addExam }                   = await import("../product/exams.js");
const { runNovaProactiveCron }      = await import("../proactive/nova-proactive-cron.js");
const { localHour, dayKey }         = await import("../engines/learner-calendar.js");
const { deleteAccount }             = await import("../../services/accountDeletion.service.js");
const { claimTelegramUpdate }       = await import("../../services/telegramTransport.service.js");
const { checkRateLimit }            = await import("../../services/rateLimit.service.js");

import type { InlineButton, SendResult, TelegramClient } from "../telegram/telegram.types.js";

const STAMP = Date.now();
const MIN   = 60_000;
let clock = new Date();
const tick = (minutes: number) => { clock = new Date(clock.getTime() + minutes * MIN); return clock; };

function zoneWhereHourIs(hour: number, at = clock): string {
  for (let offset = -11; offset <= 12; offset++) {
    const zone = `Etc/GMT${offset <= 0 ? "+" : "-"}${Math.abs(offset)}`;
    if (localHour(at, zone) === hour) return zone;
  }
  throw new Error(`no zone with local hour ${hour}`);
}

// ── Telegram and the models, stood in ─────────────────────────────────────────

interface Sent { chatId: string; text: string; buttons: InlineButton[][] }
function fakeTelegram() {
  const sent: Sent[] = [];
  let next: SendResult | null = null;
  let id = 5000;
  const client: TelegramClient = {
    async sendMessage(chatId, text, buttons) {
      const result = next ?? { ok: true as const, messageId: ++id };
      next = null;
      sent.push({ chatId, text, buttons: buttons ?? [] });
      return result;
    },
    async answerCallback() {}, async clearButtons() {}, async setChatCommands() {},
  };
  const to = (chat: string) => sent.filter(s => s.chatId === chat);
  return {
    client, sent, to,
    failNext: (result: SendResult) => { next = result; },
    data: (chat: string, label: string) => {
      const last = to(chat).at(-1)!;
      const button = last.buttons.flat().find(b => b.text === label);
      assert.ok(button?.callback_data, `no button "${label}" (${last.buttons.flat().map(b => b.text).join(", ")}) under: ${last.text}`);
      return button.callback_data;
    },
  };
}

const BASE = { intent: "general_chat", emotion: "neutral", topic: null, topicConfidence: 0, disclosureClass: "none", ambiguityScore: 0.1, routingSignal: "coaching_only", secondaryIntents: [], sessionIntent: "none", reality: [] };
const REQ  = { clarity: "clear", changeOfMind: false, action: "none", confidence: 0.9, promptAnswer: null, availableMinutes: null, sessionOutcome: null, deferUntil: null, struggleTopic: null, exam: null };
const respond = async () => ({ reply: "WORDED", reasoningMode: "direct" as const, confidence: 0.9, stateUpdates: undefined, investigationUpdate: null, followUpCheck: null });

let updateId = 900_000;
function telegram(chat: string, tg: ReturnType<typeof fakeTelegram>) {
  const run = (event: ReturnType<typeof normalizeTelegramUpdate>, model?: Record<string, unknown>) => {
    assert.notEqual(event.kind, "ignored");
    return handleNovaTelegramEvent(event as never, {
      client: tg.client, now: () => clock, webUrl: "https://nova.test", respond,
      understand: (async (text: string) => {
        assert.ok(model, `no model output given for "${text}"`);
        return parseUnderstandingResponse(JSON.stringify(model), text);
      }) as never,
    });
  };
  return {
    send: (text: string, model?: Record<string, unknown>) =>
      run(normalizeTelegramUpdate({ update_id: updateId++, message: { message_id: updateId, chat: { id: Number(chat), type: "private" }, from: { id: Number(chat) }, text } }), model),
    tap: (label: string) =>
      run(normalizeTelegramUpdate({ update_id: updateId++, callback_query: { id: `cb${updateId}`, data: tg.data(chat, label), from: { id: Number(chat) }, message: { message_id: 1, chat: { id: Number(chat), type: "private" } } } })),
    last: () => tg.to(chat).at(-1)!,
  };
}

// ── A new account that chose Nova ─────────────────────────────────────────────

const accounts: string[] = [];
const chats: string[] = [];
let n = 0;

// What signup plus the web onboarding quiz leave behind: a User, and a
// UserProfile whose companion is Nova. No Telegram.
async function newAccount(persona: string | null = "nova") {
  const user = await prisma.user.create({ data: { email: `life_${STAMP}_${++n}@test.local`, name: `Learner ${n}` }, select: { id: true } });
  accounts.push(user.id);
  await prisma.userProfile.create({ data: { userId: user.id, primaryPersona: persona, onboardingComplete: true, accountabilityStyle: "soft", secondaryDomains: [], aspirationWords: [] } });
  return user.id;
}

// What Nova's setup conversation leaves behind (it needs a model, so its
// result is written here): a profile with a subject and two topics.
async function finishSetup(learnerId: string, timezone: string | null = "Asia/Kolkata") {
  const row = await prisma.messengerUser.findFirstOrThrow({ where: { platformChatId: learnerId }, select: { id: true } });
  const profile = await prisma.novaAcademicProfile.create({
    data: { userId: row.id, onboardingComplete: true, timezone, preferredStudyTime: "evening", subjects: { create: { name: "Operating Systems", code: "OS" } } },
    select: { id: true, subjects: { select: { id: true } } },
  });
  const subjectId = profile.subjects[0]!.id;
  const longAgo = new Date(clock.getTime() - 5 * 86_400_000);
  const deadlocks = await prisma.novaTopicMastery.create({ data: { subjectId, name: "Deadlocks", masteryProbability: 0.45, confidenceReported: 0.5, reviewCount: 2, lastStudiedAt: longAgo, nextReviewAt: new Date(clock.getTime() - 86_400_000) } });
  await prisma.novaTopicMastery.create({ data: { subjectId, name: "Paging", masteryProbability: 0.7, confidenceReported: 0.7, reviewCount: 3, lastStudiedAt: longAgo, nextReviewAt: new Date(clock.getTime() + 6 * 86_400_000) } });
  return { messengerId: row.id, profileId: profile.id, subjectId, deadlocksId: deadlocks.id };
}

const token = (k: number) => `${STAMP}`.padStart(16, "0") + `${k}`.padStart(16, "b");
async function issueToken(userId: string, k: number) {
  await prisma.userProfile.update({ where: { userId }, data: { telegramConnectToken: token(k), telegramConnectTokenExpiresAt: linkTokenExpiry(clock) } });
  return token(k);
}
const newChat = () => { const chat = `${STAMP}${50 + chats.length}`; chats.push(chat); return chat; };
// The row the webhook makes for any chat that writes to the bot, before linking.
const chatSeenByBot = (chat: string, data: Record<string, unknown> = {}) =>
  prisma.messengerUser.create({ data: { platform: "telegram", platformChatId: chat, displayName: "Tg Name", username: "tg_user", ...data }, select: { id: true } });

before(async () => { await prisma.$queryRaw`SELECT 1`; });
after(async () => {
  await prisma.messengerUser.deleteMany({ where: { OR: [{ platformChatId: { in: chats } }, { platformChatId: { startsWith: `${STAMP}` } }, { platformChatId: { in: accounts.map(a => webLearnerId(a)) } }] } });
  await prisma.user.deleteMany({ where: { id: { in: accounts } } });
  await prisma.$disconnect();
});

// ══════════════════════════════════════════════════════════════════════════════
// 1. A learner without Telegram
// ══════════════════════════════════════════════════════════════════════════════

test("a new Nova account is a learner at once, with no Telegram, and is the same learner on every request", async () => {
  const userId = await newAccount();
  const first = await resolveLearnerForAccount(userId, "Asha");
  assert.deepEqual(first, { kind: "learner", platformChatId: webLearnerId(userId), channel: "web", onboardingDone: false });

  // A refresh, a second tab and a re-login, some of them at the same moment.
  const again = await Promise.all(Array.from({ length: 6 }, () => resolveLearnerForAccount(userId, "Asha")));
  for (const r of again) assert.deepEqual(r, first);
  const rows = await prisma.messengerUser.findMany({ where: { platformChatId: webLearnerId(userId) } });
  assert.equal(rows.length, 1, "one learner row, however many times it is asked for");
  assert.deepEqual([rows[0]!.platform, rows[0]!.persona, rows[0]!.displayName], ["web", "nova", "Asha"]);

  // The limiter counts against that row and makes no Telegram one.
  assert.equal((await checkRateLimit(webLearnerId(userId), "web")).allowed, true);
  assert.equal(await prisma.messengerUser.count({ where: { platform: "telegram", platformChatId: webLearnerId(userId) } }), 0);
});

test("companion assignment decides who is a learner: Rex and undecided accounts get no Nova row", async () => {
  const rex = await newAccount("rex");
  assert.deepEqual(await resolveLearnerForAccount(rex), { kind: "not_nova" });
  const undecided = await newAccount(null);
  assert.deepEqual(await resolveLearnerForAccount(undecided), { kind: "not_connected" });
  assert.equal(await prisma.messengerUser.count({ where: { platformChatId: { in: [webLearnerId(rex), webLearnerId(undecided)] } } }), 0);
});

test("the whole study loop works on the web alone: plan, session, outcome, mastery, progress, Learning DNA, exam", async () => {
  const userId = await newAccount();
  const me = (await resolveLearnerForAccount(userId)) as { platformChatId: string };
  const id = me.platformChatId;

  // Before setup: every page says so, and nothing can be started.
  assert.equal((await loadNovaToday(id, { now: clock })).status, "onboarding_incomplete");
  assert.equal((await runNovaSessionCommand(id, { action: "start", topicName: "Deadlocks", subjectName: null, plannedMinutes: 25 }, clock, "web")).ok, false);

  const l = await finishSetup(id, null);
  assert.equal(((await resolveLearnerForAccount(userId)) as { onboardingDone: boolean }).onboardingDone, true);

  // The device reports the timezone once.
  assert.equal((await recordLearnerTimezone(id, "Asia/Kolkata")).ok, true);

  const today = await loadNovaToday(id, { now: clock });
  assert.ok(today.status === "ready" && today.recommendation?.topicName === "Deadlocks", "the due topic is recommended");
  const planner = await loadNovaPlanner(id, { now: clock });
  assert.equal(planner.status, "ready");

  // Start, pause, resume, end with an outcome.
  const started = await runNovaSessionCommand(id, { action: "start", topicName: "Deadlocks", subjectName: "Operating Systems", plannedMinutes: 25 }, clock, "web");
  assert.ok(started.ok && started.session?.status === "in_progress");
  tick(10);
  assert.equal(statusAfter(await runNovaSessionCommand(id, { action: "pause" }, clock, "web")), "paused");
  tick(5);
  assert.equal(statusAfter(await runNovaSessionCommand(id, { action: "resume" }, clock, "web")), "in_progress");
  tick(12);
  const ended = await runNovaSessionCommand(id, { action: "end", outcome: "struggled" }, clock, "web");
  assert.ok(ended.ok && ended.ended);

  const [row] = await prisma.novaStudySession.findMany({ where: { profileId: l.profileId } });
  assert.deepEqual([row!.status, row!.durationMinutes, row!.totalPausedSeconds, row!.plannedDurationMinutes], ["completed", 22, 300, 25], "paused time is not study time");
  const topic = await prisma.novaTopicMastery.findUniqueOrThrow({ where: { id: l.deadlocksId } });
  assert.deepEqual([topic.reviewCount, topic.intervalDays], [3, 1], "Struggled: counted once, back tomorrow");
  assert.equal(await prisma.novaTopicMasterySnapshot.count({ where: { topicId: l.deadlocksId, sessionId: row!.id } }), 1);
  assert.equal(await prisma.novaLearningDNA.count({ where: { profileId: l.profileId } }), 1, "the session reached Learning DNA's own writer");

  const knowledge = await loadNovaKnowledge(id, { now: clock });
  assert.ok(knowledge.status === "ready" && JSON.stringify(knowledge).includes("Deadlocks"));
  const progress = await loadNovaProgress(id, { now: clock });
  assert.ok(progress.status === "ready" && progress.overview.sessions === 1, JSON.stringify(progress.status === "ready" ? progress.overview : progress));
  assert.equal((await loadNovaLearningDna(id, { now: clock })).status, "ready");

  // An exam, and the plan knows.
  const day = dayKey(new Date(clock.getTime() + 2 * 86_400_000), "Asia/Kolkata");
  assert.equal((await addExam(id, { title: "OS midterm", subjectName: "Operating Systems", date: day }, clock)).status, "added");
  const after = await loadNovaToday(id, { now: clock });
  assert.ok(after.status === "ready" && after.nextDeadline?.title === "OS midterm" && after.nextDeadline.daysUntil === 2);

  // Nova never messages a learner it has no chat for, and makes no outbox row trying.
  const tg = fakeTelegram();
  await prisma.novaAcademicProfile.update({ where: { id: l.profileId }, data: { timezone: zoneWhereHourIs(18) } });
  await runNovaProactiveCron(clock, { client: tg.client, word: (async () => ({ text: "NUDGE", generated: true })) as never });
  assert.equal(tg.to(id).length, 0);
  assert.equal(await prisma.novaProactiveMessage.count({ where: { profileId: l.profileId } }), 0);
  assert.equal(await prisma.novaTelegramChannel.count({ where: { profileId: l.profileId } }), 0);
});

test("a learner fresh from setup, with subjects and no topics, can start their first session on either surface", async () => {
  // What setup leaves: subjects, and nothing studied yet.
  const userId = await newAccount();
  const id = ((await resolveLearnerForAccount(userId)) as { platformChatId: string }).platformChatId;
  const row = await prisma.messengerUser.findFirstOrThrow({ where: { platformChatId: id }, select: { id: true } });
  const profile = await prisma.novaAcademicProfile.create({
    data: { userId: row.id, onboardingComplete: true, timezone: "Asia/Kolkata", goals: ["Pass OS"], subjects: { create: [{ name: "Operating Systems", code: "OS" }, { name: "Databases" }] } },
    select: { id: true, subjects: { select: { id: true, name: true } } },
  });
  const os = profile.subjects.find(x => x.name === "Operating Systems")!.id;
  const db = profile.subjects.find(x => x.name === "Databases")!.id;

  const empty = await loadNovaToday(id, { now: clock });
  assert.ok(empty.status === "ready" && empty.recommendation === null && empty.emptyReason === "no_topics");
  assert.deepEqual(empty.status === "ready" && empty.subjects.sort(), ["Databases", "Operating Systems"]);

  // Web: the first-session form sends the ordinary start, with the subject the learner chose.
  await runNovaSessionCommand(id, { action: "start", topicName: "Deadlocks", subjectName: "Operating Systems", plannedMinutes: 25 }, clock, "web");
  tick(25);
  await runNovaSessionCommand(id, { action: "end", outcome: "okay" }, clock, "web");
  const first = await prisma.novaTopicMastery.findMany({ where: { subject: { profileId: profile.id } }, select: { name: true, subjectId: true, reviewCount: true } });
  assert.deepEqual(first, [{ name: "Deadlocks", subjectId: os, reviewCount: 1 }], "the session made the topic, under the chosen subject");
  const next = await loadNovaToday(id, { now: new Date(clock.getTime() + 3 * 86_400_000) });
  assert.ok(next.status === "ready" && next.emptyReason !== "no_topics", "Nova now has something to plan from");

  // Telegram: a topic Nova has never seen is offered under a subject the learner picks.
  const chat = newChat();
  await linkTelegramChat(await issueToken(userId, 9), { id: chat, type: "private" }, clock);
  const tg = fakeTelegram();
  const t = telegram(chat, tg);
  await t.send("/focus normalization");
  assert.equal(t.last().text, "normalization\nNot on today's plan yet. Which subject is it part of?");
  assert.deepEqual(t.last().buttons.flat().map(b => b.text), ["Operating Systems · 25 min", "Databases · 25 min", "Later"]);
  assert.equal(await prisma.novaStudySession.count({ where: { profileId: profile.id, status: "in_progress" } }), 0, "asking is not starting");
  await t.tap("Databases · 25 min");
  tick(20);
  await t.send("/done");
  await t.tap("Good");
  const topics = await prisma.novaTopicMastery.findMany({ where: { subject: { profileId: profile.id } }, orderBy: { name: "asc" }, select: { name: true, subjectId: true, reviewCount: true } });
  assert.deepEqual(topics, [{ name: "Deadlocks", subjectId: os, reviewCount: 1 }, { name: "normalization", subjectId: db, reviewCount: 1 }]);

  // A name that says its subject needs no question.
  await t.send("/focus OS paging");
  assert.equal(t.last().text, "OS paging (Operating Systems)\nNot on today's plan, but it's yours to pick.");
  assert.deepEqual(t.last().buttons.flat().map(b => b.text), ["Start 25 min", "Later"]);
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. Connecting Telegram
// ══════════════════════════════════════════════════════════════════════════════

test("connecting Telegram keeps the learner: same row, same history, and the chat now reaches it", async () => {
  const userId = await newAccount();
  const id = ((await resolveLearnerForAccount(userId)) as { platformChatId: string }).platformChatId;
  const l = await finishSetup(id);
  await runNovaSessionCommand(id, { action: "start", topicName: "Deadlocks", subjectName: "Operating Systems", plannedMinutes: 25 }, clock, "web");
  tick(20);
  await runNovaSessionCommand(id, { action: "end", outcome: "good" }, clock, "web");

  // The chat has written to the bot, so the webhook already made it a row.
  const chat = newChat();
  const placeholder = await chatSeenByBot(chat);
  const link = await linkTelegramChat(await issueToken(userId, 1), { id: chat, type: "private" }, clock);
  assert.deepEqual([link.status, (link as { companion?: string }).companion, (link as { onboarded?: boolean }).onboarded], ["linked", "nova", true]);

  // The learner's row is now the chat's row. Nothing was copied.
  const row = await prisma.messengerUser.findUniqueOrThrow({ where: { platform_platformChatId: { platform: "telegram", platformChatId: chat } }, select: { id: true, persona: true, displayName: true, username: true, novaAcademicProfile: { select: { id: true } } } });
  assert.deepEqual([row.id, row.persona, row.novaAcademicProfile?.id, row.username], [l.messengerId, "nova", l.profileId, "tg_user"]);
  assert.equal(await prisma.messengerUser.count({ where: { platformChatId: id } }), 0, "the account-keyed name is gone, not duplicated");
  assert.equal(await prisma.novaAcademicProfile.count({ where: { user: { OR: [{ platformChatId: chat }, { platformChatId: id }] } } }), 1, "one Nova profile");
  // The placeholder was set aside, not deleted and not left answering for the chat.
  assert.deepEqual((await prisma.messengerUser.findUniqueOrThrow({ where: { id: placeholder.id } })).platform, "telegram_replaced");

  // The account now resolves to the chat, and it is the same learner with the same history.
  assert.deepEqual(await resolveLearnerForAccount(userId), { kind: "learner", platformChatId: chat, channel: "telegram", onboardingDone: true });
  const progress = await loadNovaProgress(chat, { now: clock });
  assert.ok(progress.status === "ready" && progress.overview.sessions === 1);
  assert.equal(await prisma.messengerUser.count({ where: { platformChatId: webLearnerId(userId) } }), 0, "asking again makes no second web learner");

  // Telegram answers from that state.
  const tg = fakeTelegram();
  const t = telegram(chat, tg);
  await t.send("/status");
  assert.ok(t.last().text.includes("This week: 1 session."), t.last().text);

  // The token is spent.
  assert.equal((await linkTelegramChat(token(1), { id: chat, type: "private" }, clock)).status, "invalid");
});

test("connecting with no chat row yet, and a second attempt with the same token", async () => {
  const userId = await newAccount();
  const id = ((await resolveLearnerForAccount(userId)) as { platformChatId: string }).platformChatId;
  const l = await finishSetup(id);
  const chat = newChat();
  const t = await issueToken(userId, 2);
  const results = await Promise.all([linkTelegramChat(t, { id: chat, type: "private" }, clock), linkTelegramChat(t, { id: chat, type: "private" }, clock)].map(p => p.catch(e => ({ status: `threw:${(e as { code?: string }).code}` }))));
  assert.equal(results.filter(r => r.status === "linked").length, 1, JSON.stringify(results));
  assert.equal((await prisma.messengerUser.findUniqueOrThrow({ where: { platform_platformChatId: { platform: "telegram", platformChatId: chat } } })).id, l.messengerId);
  assert.equal(await prisma.messengerUser.count({ where: { platformChatId: { in: [chat, id] } } }), 1);
});

test("a chat that already holds a learner, or a finished Rex setup, is refused and nothing on either side changes", async () => {
  // The chat already has its own Nova learner.
  const userId = await newAccount();
  const id = ((await resolveLearnerForAccount(userId)) as { platformChatId: string }).platformChatId;
  const mine = await finishSetup(id);
  const taken = newChat();
  await prisma.messengerUser.create({ data: { platform: "telegram", platformChatId: taken, persona: "nova", novaAcademicProfile: { create: { onboardingComplete: true } } } });
  assert.equal((await linkTelegramChat(await issueToken(userId, 3), { id: taken, type: "private" }, clock)).status, "chat_has_learner");

  // The chat is a finished Rex chat.
  const rexChat = newChat();
  const rex = await chatSeenByBot(rexChat, { persona: "rex", intakeComplete: true });
  await prisma.companionMessage.create({ data: { userId: rex.id, role: "user", text: "logged squats" } });
  assert.equal((await linkTelegramChat(await issueToken(userId, 4), { id: rexChat, type: "private" }, clock)).status, "chat_is_rex");

  // Both refusals left everything where it was.
  assert.deepEqual(await resolveLearnerForAccount(userId), { kind: "learner", platformChatId: id, channel: "web", onboardingDone: true });
  assert.equal((await prisma.novaAcademicProfile.findUniqueOrThrow({ where: { id: mine.profileId } })).userId, mine.messengerId);
  const rexRow = await prisma.messengerUser.findUniqueOrThrow({ where: { id: rex.id } });
  assert.deepEqual([rexRow.platform, rexRow.platformChatId, rexRow.persona], ["telegram", rexChat, "rex"]);
  assert.equal(await prisma.companionMessage.count({ where: { userId: rex.id } }), 1, "Rex's history is untouched");
  assert.equal((await prisma.userProfile.findUniqueOrThrow({ where: { userId } })).telegramChatId, null);
});

test("deleting the account removes a web-only learner and everything Nova kept for it", async () => {
  const userId = await newAccount();
  const id = ((await resolveLearnerForAccount(userId)) as { platformChatId: string }).platformChatId;
  const l = await finishSetup(id);
  await runNovaSessionCommand(id, { action: "start", topicName: "Deadlocks", subjectName: "Operating Systems", plannedMinutes: 25 }, clock, "web");
  const result = await deleteAccount(userId);
  assert.deepEqual([result.deleted, result.novaProfileRemoved], [true, true]);
  assert.equal(await prisma.messengerUser.count({ where: { id: l.messengerId } }), 0);
  assert.equal(await prisma.novaStudySession.count({ where: { profileId: l.profileId } }), 0);
  assert.equal(await prisma.novaTopicMastery.count({ where: { id: l.deadlocksId } }), 0);
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. One state, two channels
// ══════════════════════════════════════════════════════════════════════════════

test("web and Telegram are two views of one learner (cases A to M)", async () => {
  const userId = await newAccount();
  const webId = ((await resolveLearnerForAccount(userId)) as { platformChatId: string }).platformChatId;
  const l = await finishSetup(webId);
  const chat = newChat();
  await chatSeenByBot(chat);
  await linkTelegramChat(await issueToken(userId, 5), { id: chat, type: "private" }, clock);
  // The web app always asks who the account is; this is what its routes get.
  const web = async () => ((await resolveLearnerForAccount(userId)) as { platformChatId: string }).platformChatId;
  const tg = fakeTelegram();
  const t = telegram(chat, tg);
  const rows = () => prisma.novaStudySession.findMany({ where: { profileId: l.profileId }, orderBy: { sessionDate: "asc" } });

  // A. Telegram starts; the web's Focus shows that session.
  await t.send("/today");
  await t.tap("Start 25 min");
  const a = await loadNovaSession(await web(), clock);
  assert.ok(a && a.status === "in_progress" && a.topicName === "Deadlocks" && a.plannedDurationMinutes === 25);
  assert.equal((await rows()).length, 1);

  // C. Telegram pauses; the web sees it paused.
  tick(8);
  await t.send("/status");
  await t.tap("Pause");
  assert.equal((await loadNovaSession(await web(), clock))?.status, "paused");

  // D. The web resumes; Telegram sees it running, with the pause not counted.
  tick(4);
  assert.equal(statusAfter(await runNovaSessionCommand(await web(), { action: "resume" }, clock, "web")), "in_progress");
  tick(10);
  await t.send("/status");
  assert.ok(t.last().text.startsWith("Running: Deadlocks, 18 of 25 min."), t.last().text);

  // Both channels press at once: pause from the web, pause from Telegram.
  await Promise.all([runNovaSessionCommand(await web(), { action: "pause" }, clock, "web"), t.tap("Pause")]);
  tick(3);
  await Promise.all([runNovaSessionCommand(await web(), { action: "resume" }, clock, "web"), runNovaSessionCommand(chat, { action: "resume" }, clock, "telegram")]);
  assert.equal((await rows())[0]!.totalPausedSeconds, 4 * 60 + 3 * 60, "two presses are one pause");

  // E + G. Telegram ends with an outcome; the web's Knowledge and Progress show it.
  await t.send("/done");
  await t.tap("Struggled");
  assert.equal(await loadNovaSession(await web(), clock), null);
  const first = (await rows())[0]!;
  assert.deepEqual([first.status, (first.executionReport as { outcome: string }).outcome], ["completed", "struggled"]);
  assert.equal(await prisma.novaTopicMasterySnapshot.count({ where: { topicId: l.deadlocksId } }), 1);
  const progress = await loadNovaProgress(await web(), { now: clock });
  assert.ok(progress.status === "ready" && progress.overview.sessions === 1);
  // M. …and Learning DNA's own writer got it.
  assert.equal(await prisma.novaLearningDNA.count({ where: { profileId: l.profileId } }), 1);

  // B. The web starts; Telegram's /status shows that session and offers no second start.
  tick(60);
  await runNovaSessionCommand(await web(), { action: "start", topicName: "Paging", subjectName: "Operating Systems", plannedMinutes: 15 }, clock, "web");
  await t.send("/status");
  assert.ok(t.last().text.startsWith("Running: Paging"), t.last().text);
  await t.send("/focus");
  assert.ok(t.last().text.startsWith("You already have one going."), t.last().text);
  assert.equal((await rows()).length, 2);

  // F + H. The web ends with an outcome; Telegram has nothing left running and one report exists.
  tick(15);
  const [w, dup] = await Promise.all([
    runNovaSessionCommand(await web(), { action: "end", outcome: "good" }, clock, "web"),
    runNovaSessionCommand(await web(), { action: "end", outcome: "crushed_it" }, clock, "web"),   // a double click
  ]);
  assert.equal([w, dup].filter(r => r.ok && r.ended).length, 1, "a double click ends it once");
  await t.send("/done");
  assert.equal(t.last().text, "Nothing is running. Tell me what you want to study and I'll set it up.");
  const paging = await prisma.novaTopicMastery.findFirstOrThrow({ where: { subjectId: l.subjectId, name: "Paging" } });
  assert.equal(await prisma.novaTopicMasterySnapshot.count({ where: { topicId: paging.id } }), 1, "one outcome, one mastery record");
  await t.send("/status");
  assert.ok(t.last().text.includes("This week: 2 sessions."), t.last().text);

  // I. An exam confirmed on Telegram is on the web's Today and Planner.
  const friday = dayKey(new Date(clock.getTime() + 3 * 86_400_000), "Asia/Kolkata");
  await t.send("I have my OS exam Friday", { ...BASE, intent: "exam_anxiety", request: { ...REQ, exam: { title: "OS", date: friday } } });
  assert.equal(await prisma.novaExam.count({ where: { profileId: l.profileId } }), 0);
  await t.tap(`Add exam (${friday})`);
  const today = await loadNovaToday(await web(), { now: clock });
  assert.ok(today.status === "ready" && today.upcoming.some(e => e.title === "OS" && e.daysUntil === 3), JSON.stringify(today.status === "ready" ? today.upcoming : today));
  assert.equal((await loadNovaPlanner(await web(), { now: clock })).status, "ready");

  // J. An exam added on the web is what Telegram reports next, and it is added once.
  const soon = dayKey(new Date(clock.getTime() + 86_400_000), "Asia/Kolkata");
  assert.equal((await addExam(await web(), { title: "OS quiz", subjectName: "Operating Systems", date: soon }, clock)).status, "added");
  assert.equal((await addExam(await web(), { title: "Operating Systems test", subjectName: null, date: soon }, clock)).status, "exists", "the same subject on the same day is the same exam, whatever it is called");
  assert.equal(await prisma.novaExam.count({ where: { profileId: l.profileId } }), 2);
  await t.send("/status");
  assert.ok(t.last().text.includes("Next: OS quiz, tomorrow."), t.last().text);
  // "Tomorrow" is the learner's calendar, on both surfaces, at any hour of the day.
  const withQuiz = await loadNovaToday(await web(), { now: clock });
  assert.ok(withQuiz.status === "ready" && withQuiz.nextDeadline?.daysUntil === 1);
  const planned = await loadNovaPlanner(await web(), { now: clock });
  assert.ok(planned.status === "ready" && JSON.stringify(planned).includes('"daysUntil":1'));

  // K. A constraint told to Telegram reaches the web's plan through consolidation.
  const text = "I can't study tonight, family stuff came up";
  await t.send(text, {
    ...BASE, intent: "life_disclosure", emotion: "overwhelmed", disclosureClass: "life_event", routingSignal: "reality_extraction",
    reality: [{ about: "self", category: "life_constraint", subtype: "family", claim: "Student has a family matter tonight", status: "active", persistence: "temporary", expectedDurationHours: 12, confidence: 0.9 }],
    request: { ...REQ, action: "not_now", deferUntil: "tomorrow" },
  });
  const reality = await prisma.userReality.findMany({ where: { userId: l.messengerId } });
  assert.deepEqual(reality.map(r => [r.category, r.subtype, r.isActive, r.resolvedAt, r.expiresAt > clock]), [["life_constraint", "family", true, null, true]]);
  const constrained = await loadNovaToday(await web(), { now: clock });
  assert.ok(constrained.status === "ready" && constrained.constraints.some(c => c.category === "life_constraint"));
  assert.equal(await prisma.userFact.count({ where: { userId: l.messengerId } }) + await prisma.behavioralPattern.count({ where: { userId: l.messengerId } }), 0, "a circumstance, not a belief");
});

test("a duplicate Telegram update is admitted once", async () => {
  const id = 7_000_000_000 + (STAMP % 1_000_000);
  assert.equal(await claimTelegramUpdate(id), "claimed");
  assert.equal(await claimTelegramUpdate(id), "duplicate");
  const racing = await Promise.all([claimTelegramUpdate(id + 1), claimTelegramUpdate(id + 1), claimTelegramUpdate(id + 1)]);
  assert.deepEqual(racing.sort(), ["claimed", "duplicate", "duplicate"]);
  await prisma.processedTelegramUpdate.deleteMany({ where: { updateId: { in: [BigInt(id), BigInt(id + 1)] } } });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. Web chat: a sentence is not a button
// ══════════════════════════════════════════════════════════════════════════════

test("on the web, a sentence the model reads as 'start' or 'done' runs no session command; a typed command does", async () => {
  const userId = await newAccount();
  const id = ((await resolveLearnerForAccount(userId)) as { platformChatId: string }).platformChatId;
  const l = await finishSetup(id);
  const rows = () => prisma.novaStudySession.findMany({ where: { profileId: l.profileId } });
  const reading = (text: string, model: Record<string, unknown>) => parseUnderstandingResponse(JSON.stringify(model), text);
  let prompt = "";
  const capture = async (_d: string, p: string) => { prompt = p; return respond(); };

  // "maybe I should study deadlocks", read by the model as a start. This is
  // what entry.ts hands the turn for a message with no command.
  const maybe = "maybe I should study deadlocks";
  await runNovaOrchestrator({
    platformChatId: id, text: maybe, timestamp: clock, awaitPersistence: true, respond: capture,
    understanding: reading(maybe, { ...BASE, intent: "commitment_made", topic: "Deadlocks", topicConfidence: 0.9, sessionIntent: "start", request: { ...REQ, action: "start_session", confidence: 0.95 } }),
    sessionCommands: "surface", directive: "This message did not start, pause, resume or end a study session.",
  });
  assert.equal((await rows()).length, 0, "nothing started");
  assert.ok(prompt.includes("did not start, pause, resume or end a study session"), "the Response Brain is told so");
  assert.equal(await prisma.companionMessage.count({ where: { userId: l.messengerId, role: "user", text: maybe } }), 1, "the message is still logged");

  // The Start button, then a sentence the model reads as finishing.
  await runNovaSessionCommand(id, { action: "start", topicName: "Deadlocks", subjectName: "Operating Systems", plannedMinutes: 25 }, clock, "web");
  tick(12);
  const done = "ok I think I'm done with this bit";
  await runNovaOrchestrator({
    platformChatId: id, text: done, timestamp: clock, awaitPersistence: true, respond,
    understanding: reading(done, { ...BASE, intent: "study_report", topic: "Deadlocks", sessionIntent: "break", request: { ...REQ, action: "finish_session" } }),
    sessionCommands: "surface",
  });
  const open = (await rows())[0]!;
  assert.deepEqual([open.status, open.executionReport, open.pausedAt], ["in_progress", null, null], "not ended, not paused, no unreported end");
  assert.equal(await prisma.novaTopicMasterySnapshot.count({ where: { topicId: l.deadlocksId } }), 0);

  // The End button with an outcome is what ends it.
  await runNovaSessionCommand(id, { action: "end", outcome: "okay" }, clock, "web");
  assert.equal((await rows())[0]!.status, "completed");

  // A typed command is protocol: /study starts.
  tick(30);
  await runNovaOrchestrator({
    platformChatId: id, text: "Paging", timestamp: clock, awaitPersistence: true, respond, command: "study",
    understanding: reading("Paging", { ...BASE, topic: "Paging", topicConfidence: 0.9, request: { ...REQ } }),
  });
  const started = (await rows()).filter(r => r.status === "in_progress");
  assert.deepEqual(started.map(r => r.topicName), ["Paging"]);
  await runNovaSessionCommand(id, { action: "end", outcome: "okay" }, clock, "web");
});

test("ten unclear things typed on the web, each read the worst way a model could, change no session, mastery or exam", async () => {
  const phrases = ["maybe I should study deadlocks", "should probably study", "do it", "yeah", "20 minutes", "actually no", "never mind", "help me with OS", "start deadlocks", "done"];
  // Confidently wrong in every direction: a start, a finish, a break, a
  // mastery claim, an exam, minutes and an outcome, all marked clear.
  const worst = [
    { ...BASE, intent: "commitment_made", topic: "Deadlocks", topicConfidence: 1, sessionIntent: "start", request: { ...REQ, action: "start_session", confidence: 1, availableMinutes: 20 } },
    { ...BASE, intent: "study_report", topic: "Deadlocks", topicConfidence: 1, sessionIntent: "break", secondaryIntents: ["mastery_claim"], request: { ...REQ, action: "finish_session", confidence: 1, sessionOutcome: "crushed_it" } },
    { ...BASE, intent: "mastery_claim", topic: "Deadlocks", topicConfidence: 1, sessionIntent: "break", request: { ...REQ, action: "pause_session", confidence: 1, exam: { title: "OS", date: dayKey(new Date(clock.getTime() + 3 * 86_400_000), "Asia/Kolkata") } } },
  ];
  const directive = "This message did not start, pause, resume or end a study session.";
  for (const running of [false, true]) {
    const userId = await newAccount();
    const id = ((await resolveLearnerForAccount(userId)) as { platformChatId: string }).platformChatId;
    const l = await finishSetup(id);
    if (running) await runNovaSessionCommand(id, { action: "start", topicName: "Paging", subjectName: "Operating Systems", plannedMinutes: 25 }, clock, "web");
    const canonical = async () => JSON.stringify({
      // A reported study session ("I studied X") is evidence consolidation may record; the timed ones are what must not move.
      timed:   (await prisma.novaStudySession.findMany({ where: { profileId: l.profileId, activityType: { not: "self_reported" } }, orderBy: { createdAt: "asc" }, select: { id: true, status: true, pausedAt: true, totalPausedSeconds: true, executionReport: true } })),
      mastery: await prisma.novaTopicMastery.findMany({ where: { subjectId: l.subjectId }, orderBy: { name: "asc" }, select: { name: true, reviewCount: true, intervalDays: true, nextReviewAt: true } }),
      history: await prisma.novaTopicMasterySnapshot.count({ where: { topic: { subjectId: l.subjectId }, source: "session_report" } }),
      exams:   await prisma.novaExam.count({ where: { profileId: l.profileId } }),
      dna:     await prisma.novaLearningDNA.count({ where: { profileId: l.profileId } }),
      stated:  (await prisma.novaAcademicProfile.findUniqueOrThrow({ where: { id: l.profileId }, select: { statedMinutes: true } })).statedMinutes,
    });
    const before = await canonical();
    for (const text of phrases) {
      for (const model of worst) {
        // Exactly what nova/entry.ts passes for a message with no typed command.
        await runNovaOrchestrator({
          platformChatId: id, text, timestamp: clock, awaitPersistence: true, respond,
          understanding: parseUnderstandingResponse(JSON.stringify(model), text),
          sessionCommands: "surface", directive,
        });
        tick(1);
      }
    }
    assert.equal(await canonical(), before, `${running ? "session running" : "no session"}: nothing consequential moved in ${phrases.length * worst.length} turns`);
    // What consolidation did keep, by its own rules, from readings that were
    // marked clear: a record that the learner SAID something (a commitment, a
    // claim), each with its source message, and at most an "emerging" pattern.
    // Nothing is established, and nothing above moved because of them. That a
    // confidently wrong reading can leave a false "you said" is a known limit
    // of consolidation, not of the web surface.
    const facts = await prisma.userFact.findMany({ where: { userId: l.messengerId }, select: { type: true, sourceMessageId: true } });
    assert.deepEqual([...new Set(facts.map(f => f.type))].sort().filter(t => t !== "commitment" && t !== "mastery_claim"), []);
    assert.ok(facts.every(f => f.sourceMessageId !== null), "every record names the message it came from");
    const patterns = await prisma.behavioralPattern.findMany({ where: { userId: l.messengerId }, select: { status: true } });
    assert.ok(patterns.every(p => p.status === "emerging"), "no pattern is established by a burst of messages");
    if (running) await runNovaSessionCommand(id, { action: "end", outcome: "okay" }, clock, "web");
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. Proactive: a learner's evening, tick by tick
// ══════════════════════════════════════════════════════════════════════════════

test("exam in two days, a review due, yesterday missed: what Nova sends, withholds, retries and never repeats", async () => {
  const userId = await newAccount();
  const webId = ((await resolveLearnerForAccount(userId)) as { platformChatId: string }).platformChatId;
  const zone = zoneWhereHourIs(18);
  const l = await finishSetup(webId, zone);
  const chat = newChat();
  await linkTelegramChat(await issueToken(userId, 6), { id: chat, type: "private" }, clock);
  // Last studied two local days ago; an exam the day after tomorrow.
  await prisma.novaStudySession.create({ data: { profileId: l.profileId, subjectId: l.subjectId, topicName: "Paging", sessionDate: new Date(clock.getTime() - 2 * 86_400_000), status: "completed", durationMinutes: 30, plannedDurationMinutes: 30, activityType: "practice" } });
  assert.equal((await addExam(chat, { title: "OS final", subjectName: "Operating Systems", date: dayKey(new Date(clock.getTime() + 2 * 86_400_000), zone) }, clock)).status, "added");

  const tg = fakeTelegram();
  const asked: string[] = [];
  const word = (async (input: { studentName: string | null; type: string; facts: string[]; register: string }) => {
    if (input.studentName === "Learner " + n) asked.push(`${input.type}|${input.register}|${input.facts.join(" / ")}`);
    return { text: `NUDGE:${input.type}`, generated: true };
  }) as never;
  const run = () => runNovaProactiveCron(clock, { client: tg.client, word });
  const outbox = () => prisma.novaProactiveMessage.findMany({ where: { profileId: l.profileId }, orderBy: { createdAt: "asc" } });
  const sentTo = () => tg.to(chat).map(s => s.text);
  await prisma.messengerUser.update({ where: { id: l.messengerId }, data: { displayName: "Learner " + n } });

  // 1. Three reasons hold. The exam outranks the others, in the serious register, with its reason.
  await run();
  assert.deepEqual(sentTo(), ["NUDGE:exam_countdown"]);
  assert.ok(asked[0]!.startsWith("exam_countdown|serious|OS final in 2 days / Recommended now: Deadlocks (Operating Systems)"), asked[0]);
  assert.deepEqual((await outbox()).map(r => [r.eventType, r.status]), [["exam_countdown", "sent"]]);

  // 2. Minutes later: nothing more. Spacing holds, and nothing is written for the withheld reasons.
  tick(10); await run();
  assert.deepEqual(sentTo().length, 1);
  assert.equal((await outbox()).length, 1, "a withheld reason leaves no occurrence behind: " + JSON.stringify((await outbox()).map(r => [r.eventType, r.status, r.occurrenceKey, r.localDay, r.firedAt, r.sentAt, r.lastError])));

  // 3. The next evening, with a session running (started on the web): silence.
  tick(24 * 60 - 10);
  await runNovaSessionCommand(chat, { action: "start", topicName: "Deadlocks", subjectName: "Operating Systems", plannedMinutes: 25 }, clock, "web");
  await run();
  assert.equal(sentTo().length, 1, "no nudge during a session started on the web");

  // 4. The session ends. Minutes later Nova still says nothing: they were just here.
  tick(20);
  await runNovaSessionCommand(chat, { action: "end", outcome: "good" }, clock, "web");
  tick(5); await run();
  assert.equal(sentTo().length, 1, "no message right after a finished session");
  assert.equal((await outbox()).length, 1);
  // Later that evening the exam, now tomorrow, is worth one line. Nothing presses them to study: they have.
  tick(40); await run();
  assert.deepEqual(sentTo(), ["NUDGE:exam_countdown", "NUDGE:exam_countdown"]);
  assert.ok(asked[1]!.startsWith("exam_countdown|serious|OS final is tomorrow"), asked[1]);
  tick(30); await run();
  assert.equal(sentTo().length, 2, "one exam line a day, and no study nudge on a day they studied");

  // 5. The day after at six: a review is due. The send fails on the network.
  tick(23 * 60 - 35);
  assert.equal(localHour(clock, zone), 18);
  await prisma.novaTopicMastery.update({ where: { id: l.deadlocksId }, data: { nextReviewAt: new Date(clock.getTime() - 3_600_000) } });
  await prisma.novaExam.deleteMany({ where: { profileId: l.profileId } });
  tg.failNext({ ok: false, kind: "server", detail: "502 bad gateway" });
  await run();
  let rows = await outbox();
  const pending = rows.at(-1)!;
  assert.deepEqual([pending.eventType, pending.status, pending.attempts, pending.lastError, pending.text !== null], ["review_due", "failed", 1, "502 bad gateway", true], "the failure is on record, with the worded text kept");
  assert.equal(tg.to(chat).filter(s => s.text === pending.text).length, 1, "one attempt was made");

  // 6. Before the retry, they say something real came up. The retry is held, not sent.
  await prisma.userReality.create({ data: { userId: l.messengerId, category: "health", subtype: "illness", fact: "Student has the flu", confidence: 0.9, expiresAt: new Date(clock.getTime() + 48 * 3_600_000) } });
  tick(5); await run();
  assert.equal(tg.to(chat).filter(s => s.text === pending.text).length, 1, "a message approved before they fell ill is not sent after");
  assert.equal((await outbox()).at(-1)!.status, "failed");

  // 7. Recovered; the process restarts; the stored text goes out once, and never again.
  await prisma.userReality.updateMany({ where: { userId: l.messengerId }, data: { isActive: false, resolvedAt: clock } });
  tick(5); await run();
  rows = await outbox();
  assert.deepEqual([rows.at(-1)!.status, rows.at(-1)!.attempts], ["sent", 2]);
  assert.equal(tg.to(chat).filter(s => s.text === pending.text).length, 2);
  for (let i = 0; i < 4; i++) { tick(5); await run(); }
  assert.equal(tg.to(chat).filter(s => s.text === pending.text).length, 2, "later ticks and restarts send nothing more");
  assert.equal((await outbox()).length, rows.length);

  // 8. A bot the learner has blocked is noticed, recorded, and left alone.
  tick(24 * 60 - 30);
  await prisma.novaTopicMastery.update({ where: { id: l.deadlocksId }, data: { nextReviewAt: new Date(clock.getTime() - 3_600_000) } });
  tg.failNext({ ok: false, kind: "blocked", detail: "403 Forbidden: bot was blocked by the user" });
  const before = tg.to(chat).length;
  await run();
  assert.deepEqual([(await outbox()).at(-1)!.status, (await outbox()).at(-1)!.lastError], ["abandoned", "403 Forbidden: bot was blocked by the user"]);
  assert.notEqual((await prisma.novaTelegramChannel.findUniqueOrThrow({ where: { profileId: l.profileId } })).undeliverableSince, null);
  tick(5); await run(); tick(5); await run();
  assert.equal(tg.to(chat).length, before + 1, "no further attempts at a chat that refused");
});

test("an exam two days out reaches a learner as their life allows: in full, as a date only, or not at all", async () => {
  const zone = zoneWhereHourIs(18);
  const seed = async (reality: { category: string; subtype: string; fact: string; days: number } | null) => {
    const userId = await newAccount();
    const webId = ((await resolveLearnerForAccount(userId)) as { platformChatId: string }).platformChatId;
    const l = await finishSetup(webId, zone);
    const chat = newChat();
    await linkTelegramChat(await issueToken(userId, 20 + chats.length), { id: chat, type: "private" }, clock);
    await prisma.messengerUser.update({ where: { id: l.messengerId }, data: { displayName: `Exam ${chat}` } });
    assert.equal((await addExam(chat, { title: "OS final", subjectName: "Operating Systems", date: dayKey(new Date(clock.getTime() + 2 * 86_400_000), zone) }, clock)).status, "added");
    if (reality) await prisma.userReality.create({ data: { userId: l.messengerId, category: reality.category, subtype: reality.subtype, fact: reality.fact, confidence: 0.9, expiresAt: new Date(clock.getTime() + reality.days * 86_400_000) } });
    return { chat, name: `Exam ${chat}`, profileId: l.profileId };
  };
  const normal   = await seed(null);
  const family   = await seed({ category: "life_constraint", subtype: "family", fact: "Student has a family matter this week", days: 3 });
  const grieving = await seed({ category: "emotional", subtype: "grief", fact: "Student lost a grandparent", days: 2 });
  const ill      = await seed({ category: "health", subtype: "illness", fact: "Student has the flu", days: 2 });
  const job      = await seed({ category: "life_constraint", subtype: "work", fact: "Student works evenings", days: 180 });   // standing
  const studying = await seed(null);
  await runNovaSessionCommand(studying.chat, { action: "start", topicName: "Deadlocks", subjectName: "Operating Systems", plannedMinutes: 25 }, clock, "web");

  const tg = fakeTelegram();
  const asked = new Map<string, { type: string; informOnly: boolean; facts: string[] }>();
  await runNovaProactiveCron(clock, { client: tg.client, word: (async (input: { studentName: string | null; type: string; facts: string[]; informOnly?: boolean }) => {
    asked.set(input.studentName ?? "", { type: input.type, informOnly: input.informOnly === true, facts: input.facts });
    return { text: `SAID:${input.type}`, generated: true };
  }) as never });
  const got = (l: { chat: string }) => tg.to(l.chat).map(m => [m.text, m.buttons.flat().map(b => b.text).join(",")]);

  // Nothing in the way: the countdown, with what to do and a way to start.
  assert.deepEqual(got(normal), [["SAID:exam_countdown", "Start 15 min,Start 25 min,Start 45 min,Later,Not today"]]);
  assert.equal(asked.get(normal.name)!.informOnly, false);
  assert.ok(asked.get(normal.name)!.facts.some(f => f.startsWith("Recommended now:")));
  // A family matter: the date, and nothing that asks them to study.
  assert.deepEqual(got(family), [["SAID:exam_countdown", ""]]);
  assert.deepEqual([asked.get(family.name)!.informOnly, asked.get(family.name)!.facts], [true, ["OS final in 2 days"]]);
  // Grief, or illness: silence, and nothing recorded as sent or owed.
  for (const l of [grieving, ill]) {
    assert.deepEqual(got(l), []);
    assert.equal(await prisma.novaProactiveMessage.count({ where: { profileId: l.profileId } }), 0);
  }
  // A standing arrangement is not a reason for months of silence.
  assert.deepEqual(got(job), [["SAID:exam_countdown", "Start 15 min,Start 25 min,Start 45 min,Later,Not today"]]);
  // A session in progress: silence.
  assert.deepEqual(got(studying), []);
  await runNovaSessionCommand(studying.chat, { action: "end", outcome: "okay" }, clock, "web");
});
