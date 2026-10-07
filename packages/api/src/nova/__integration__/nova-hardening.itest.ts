/**
 * Telegram hardening — real Postgres integration test.
 *
 * What it proves, from behaviour seen in real use:
 *   - a reminder request creates nothing and is told so, never "I'll remind you"
 *   - one update gets one reply, whatever path the turn takes
 *   - noise and a model that is down each get one plain line and change nothing
 *   - a session stopped after seconds can be ended and rated, is kept, and
 *     moves no mastery and no Progress number
 *   - double taps on Start, Pause, Resume, End and an outcome write once
 *   - the reply is sent before the turn is recorded, commands and buttons call
 *     no model, and every update reports where its time went
 * Telegram and both models are stood in. Everything between is the real code
 * against a real database.
 *
 *   NOVA_TEST_DATABASE_URL=postgresql://... npm run test:integration
 */

import "./test-database.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

process.env.TELEGRAM_BOT_TOKEN = "";
process.env.GEMINI_API_KEY = "";
process.env.OPENAI_API_KEY = "";

const { prisma }                     = await import("@repo/db/client");
const { handleNovaTelegramEvent }    = await import("../telegram/telegram-turn.js");
const { normalizeTelegramUpdate }    = await import("../telegram/telegram-event.js");
const { parseUnderstandingResponse } = await import("../brains/understanding-parser.js");
const { linkTelegramChat, linkTokenExpiry } = await import("../telegram/telegram-link.js");
const { resolveLearnerForAccount }   = await import("../product/learner-identity.js");
const { saveSetup }                  = await import("../product/setup.js");
const { loadNovaSession }            = await import("../product/session.js");
const { loadNovaProgress }           = await import("../product/progress.js");
const { loadNovaToday }              = await import("../product/today.js");
const { TEXT }                       = await import("../telegram/telegram-replies.js");

import type { InlineButton, TelegramClient, TurnTrace } from "../telegram/telegram.types.js";

const STAMP = Date.now();
// A clock the tests move. Sessions are timed by it.
let clock = new Date(Date.now() - 6 * 3_600_000);
const forward = (minutes: number) => { clock = new Date(clock.getTime() + minutes * 60_000); };

// ── Telegram and the models, stood in ─────────────────────────────────────────

interface Sent { chatId: string; text: string; buttons: InlineButton[][]; loggedUserMessages: number }
const sent: Sent[] = [];
let repliedSignals = 0;
let messageId = 31_000;
let watch: string | null = null;   // a MessengerUser id whose log is counted at send time
const client: TelegramClient = {
  async sendMessage(chatId, text, buttons) {
    const loggedUserMessages = watch ? await prisma.companionMessage.count({ where: { userId: watch, role: "user" } }) : -1;
    sent.push({ chatId, text, buttons: buttons ?? [], loggedUserMessages });
    return { ok: true as const, messageId: ++messageId };
  },
  async answerCallback() {}, async clearButtons() {}, async setChatCommands() {},
};
const to     = (chat: string) => sent.filter(s => s.chatId === chat);
const lastTo = (chat: string) => to(chat).at(-1)!;
const labels = (chat: string) => lastTo(chat).buttons.flat().map(b => b.text);

let responses = 0;
let respondFails = false;
const respond = async () => {
  responses++;
  if (respondFails) throw new Error("model unavailable");
  return { reply: "WORDED", reasoningMode: "direct" as const, confidence: 0.9, stateUpdates: undefined, investigationUpdate: null, followUpCheck: null };
};

const BASE = { intent: "general_chat", emotion: "neutral", topic: null, topicConfidence: 0, disclosureClass: "none", ambiguityScore: 0.1, routingSignal: "coaching_only", secondaryIntents: [], sessionIntent: "none", reality: [] };
const REQ  = { clarity: "clear", changeOfMind: false, action: "none", confidence: 0.9, promptAnswer: null, availableMinutes: null, availableMinutesMax: null, sessionOutcome: null, deferUntil: null, struggleTopic: null, exam: null, asks: "none", setup: null };
const reading = (request: Record<string, unknown>, base: Record<string, unknown> = {}) => ({ ...BASE, ...base, request: { ...REQ, ...request } });
const NOISE = reading({ clarity: "unintelligible" });
const DOWN  = Symbol("model down");

let updateId = 700_000;
let readings = 0;
function telegram(chat: string) {
  const run = (event: ReturnType<typeof normalizeTelegramUpdate>, output?: Record<string, unknown> | typeof DOWN): Promise<TurnTrace> => {
    assert.notEqual(event.kind, "ignored");
    return handleNovaTelegramEvent(event as never, {
      client, now: () => clock, webUrl: "https://nova.test", respond,
      receivedAt: Date.now() - 250, onReplied: () => { repliedSignals++; },
      generate: (async () => { throw new Error("no wording model in this test"); }) as never,
      understand: (async (text: string) => {
        readings++;
        if (output === DOWN) throw new Error("Gemini request failed (429: quota)");
        assert.ok(output, `no model output for "${text}"`);
        return parseUnderstandingResponse(JSON.stringify(output), text);
      }) as never,
    });
  };
  const message = (text: string) => normalizeTelegramUpdate({ update_id: updateId++, message: { message_id: updateId, chat: { id: Number(chat), type: "private" }, from: { id: Number(chat) }, text } });
  const tapEvent = (label: string, from = lastTo(chat)) => {
    const button = from.buttons.flat().find(b => b.text === label);
    assert.ok(button?.callback_data, `no button "${label}" (${from.buttons.flat().map(b => b.text).join(", ")})`);
    return normalizeTelegramUpdate({ update_id: updateId++, callback_query: { id: `cb${updateId}`, data: button.callback_data, from: { id: Number(chat) }, message: { message_id: 1, chat: { id: Number(chat), type: "private" } } } });
  };
  return {
    say: (text: string, output?: Record<string, unknown> | typeof DOWN) => run(message(text), output),
    tap: (label: string, from?: Sent) => run(tapEvent(label, from)),
    // The same button pressed twice before either press is handled.
    doubleTap: (label: string) => { const from = lastTo(chat); return Promise.all([run(tapEvent(label, from)), run(tapEvent(label, from))]); },
  };
}

const accounts: string[] = [];
const chats: string[] = [];
let n = 0;
async function learner() {
  const user = await prisma.user.create({ data: { email: `hard_${STAMP}_${++n}@test.local`, name: "Asha" }, select: { id: true } });
  accounts.push(user.id);
  await prisma.userProfile.create({ data: { userId: user.id, primaryPersona: "nova", onboardingComplete: true, accountabilityStyle: "soft", secondaryDomains: [], aspirationWords: [] } });
  const web = (await resolveLearnerForAccount(user.id, "Asha")) as { platformChatId: string };
  await saveSetup(web.platformChatId, { subjects: [{ name: "Operating Systems", topics: ["Processes", "Deadlocks"] }], exams: [], dailyMinutes: null, studyTime: null }, clock);
  const chat  = `${STAMP}${40 + chats.length}`;
  chats.push(chat);
  const token = `${STAMP}`.padStart(16, "0") + `${chats.length}`.padStart(16, "d");
  await prisma.userProfile.update({ where: { userId: user.id }, data: { telegramConnectToken: token, telegramConnectTokenExpiresAt: linkTokenExpiry(clock) } });
  assert.equal((await linkTelegramChat(token, { id: chat, type: "private" }, clock)).status, "linked");
  const profile = await prisma.novaAcademicProfile.findFirstOrThrow({ where: { user: { platformChatId: chat } }, select: { id: true, userId: true } });
  await prisma.novaTelegramChannel.upsert({ where: { profileId: profile.id }, create: { profileId: profile.id, lastDeliveredAt: clock }, update: { lastDeliveredAt: clock } });
  return { chat, profileId: profile.id, messengerId: profile.userId };
}

// Everything a turn could write about the learner, as it stands.
async function state(l: { profileId: string; messengerId: string }) {
  const [sessions, mastery, snapshots, facts, reality, exams, proactive, reminders, channel, profile] = await Promise.all([
    prisma.novaStudySession.count({ where: { profileId: l.profileId } }),
    prisma.novaTopicMastery.findMany({ where: { subject: { profileId: l.profileId } }, orderBy: { id: "asc" }, select: { name: true, masteryProbability: true, reviewCount: true, nextReviewAt: true } }),
    prisma.novaTopicMasterySnapshot.count({ where: { profileId: l.profileId } }),
    prisma.userFact.count({ where: { userId: l.messengerId } }),
    prisma.userReality.count({ where: { userId: l.messengerId } }),
    prisma.novaExam.count({ where: { profileId: l.profileId } }),
    prisma.novaProactiveMessage.count({ where: { profileId: l.profileId } }),
    prisma.customReminder.count({ where: { userId: l.messengerId } }),
    prisma.novaTelegramChannel.findUniqueOrThrow({ where: { profileId: l.profileId }, select: { proactiveEnabled: true, proactivePausedUntil: true } }),
    prisma.novaAcademicProfile.findUniqueOrThrow({ where: { id: l.profileId }, select: { statedMinutes: true, dailyStudyMinutes: true } }),
  ]);
  return JSON.stringify({ sessions, mastery, snapshots, facts, reality, exams, proactive, reminders, channel, profile });
}

before(async () => { await prisma.$queryRaw`SELECT 1`; });
after(async () => {
  await prisma.messengerUser.deleteMany({ where: { OR: [{ platformChatId: { in: chats } }, { platformChatId: { startsWith: "web:" }, novaAcademicProfile: null }] } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: { in: accounts } } });
  await prisma.$disconnect();
});

// ══════════════════════════════════════════════════════════════════════════════
// No fake side effects
// ══════════════════════════════════════════════════════════════════════════════

test("a reminder request creates nothing and is told so, whatever else the model read into it", async () => {
  const l  = await learner();
  const tg = telegram(l.chat);
  const before = await state(l);

  for (const [text, output] of [
    ["remind me to study at 8 am tomorrow", reading({ action: "set_reminder" }, { intent: "schedule_query" })],
    // A model that also calls it a postponement, a time and a feeling.
    ["remind me tomorrow morning", reading({ action: "set_reminder", deferUntil: "tomorrow", availableMinutes: 8 }, { emotion: "overwhelmed" })],
    ["remind me in two hours to review paging", reading({ action: "set_reminder" }, { topic: "Paging", topicConfidence: 0.9, intent: "plan_request" })],
  ] as const) {
    responses = 0;
    const sentBefore = to(l.chat).length;
    const trace = await tg.say(text, output as never);
    assert.equal(trace.decision, "reminder_unavailable:reminder_not_supported");
    assert.equal(to(l.chat).length, sentBefore + 1, "one reply");
    assert.equal(lastTo(l.chat).text, TEXT.reminderUnavailable);
    assert.equal(responses, 0, "never worded by the model, so it cannot be worded as a promise");
    assert.equal(lastTo(l.chat).buttons.length, 0);
  }
  assert.match(TEXT.reminderUnavailable, /nothing has been scheduled/);
  assert.doesNotMatch(TEXT.reminderUnavailable, /I'll remind|I will remind|reminder is set|Done/i);
  assert.equal(await state(l), before, "no reminder, no paused nudges, no stated time, nothing");

  // A reminder request the model could not read clearly is asked about, and
  // still creates nothing.
  const unclear = await tg.say("remind me", reading({ action: "set_reminder", clarity: "ambiguous" }));
  assert.match(unclear.decision ?? "", /^(clarify|reminder_unavailable):/);
  assert.equal(responses, 0);
  assert.equal(await state(l), before);
});

test("a turn with no action tells the Response Brain that nothing was done or promised", async () => {
  const l  = await learner();
  const tg = telegram(l.chat);
  const prompts: string[] = [];
  const original = respond;
  const trace = await handleNovaTelegramEvent(
    normalizeTelegramUpdate({ update_id: updateId++, message: { message_id: updateId, chat: { id: Number(l.chat), type: "private" }, from: { id: Number(l.chat) }, text: "today is a mess, I can't study" } }) as never,
    {
      client, now: () => clock, webUrl: "https://nova.test",
      respond: async (_layer: string, prompt: string) => { prompts.push(prompt); return original(); },
      understand: (async (text: string) => parseUnderstandingResponse(JSON.stringify(reading({}, { intent: "emotional_vent", emotion: "overwhelmed", disclosureClass: "emotional_disclosure" })), text)) as never,
    },
  );
  assert.equal(trace.decision, "converse:conversation");
  assert.equal(prompts.length, 1);
  assert.match(prompts[0]!, /took no action this turn/);
  assert.match(prompts[0]!, /no reminder was set/);
  assert.match(prompts[0]!, /do not promise to do anything later/);
  assert.match(prompts[0]!, /Say nothing about how the student feels or what they usually do unless/);
  assert.match(prompts[0]!, /Register: serious\. No jokes and no teasing/, "distress is never teased");
  void tg;
});

// ══════════════════════════════════════════════════════════════════════════════
// One update, one reply
// ══════════════════════════════════════════════════════════════════════════════

test("noise, twice in a row: one short reply each, and nothing changes", async () => {
  const l  = await learner();
  const tg = telegram(l.chat);
  const before = await state(l);

  const first = await tg.say("b ruh", NOISE);
  assert.equal(to(l.chat).length, 1);
  assert.equal(lastTo(l.chat).text, "I didn't catch that. Tell me what you need, or pick one:");
  assert.equal(first.decision, "clarify:unintelligible");
  assert.equal(first.failure, "none");
  assert.deepEqual(first.evidence, { kinds: [], consolidationQueued: false });

  // The second does not stack another set of buttons: the first are still open.
  const second = await tg.say("rhtqtaf", NOISE);
  assert.equal(to(l.chat).length, 2, "one reply per message");
  assert.equal(lastTo(l.chat).text, "I didn't catch that. Tell me what you need, or use the buttons above.");
  assert.equal(lastTo(l.chat).buttons.length, 0);
  assert.equal(second.modelCalls, 1, "the reading, and no wording");

  assert.equal(await state(l), before);
  assert.equal(await prisma.novaConsolidationJob.count({ where: { userId: l.messengerId } }), 0, "noise never reaches the canonical turn");
});

test("the reading model is down: one honest line per message, never a second, and nothing changes", async () => {
  const l  = await learner();
  const tg = telegram(l.chat);
  const before = await state(l);
  const quiet = console.error; console.error = () => {};

  for (const text of ["what should I study?", "b ruh"]) {
    const sentBefore = to(l.chat).length;
    responses = 0;
    const trace = await tg.say(text, DOWN);
    assert.equal(to(l.chat).length, sentBefore + 1, "one reply");
    assert.equal(lastTo(l.chat).text, TEXT.notUnderstood);
    assert.equal(trace.failure, "understanding_failed");
    assert.equal(responses, 0);
  }
  console.error = quiet;
  assert.match(TEXT.notUnderstood, /\/today, \/focus and \/done still work/);
  assert.equal(await state(l), before);

  // And those do still work, with no model.
  readings = 0;
  const today = await tg.say("/today");
  assert.match(lastTo(l.chat).text, /^Processes \(Operating Systems\)/);
  assert.equal(readings, 0);
  assert.equal(today.modelCalls, 0);
});

test("the wording model fails after the action: still one reply, the plain statement", async () => {
  const l  = await learner();
  const tg = telegram(l.chat);
  const quiet = console.error; console.error = () => {};
  respondFails = true;
  const trace = await tg.say("I'm exhausted today", reading({}, { intent: "emotional_vent", emotion: "overwhelmed", disclosureClass: "emotional_disclosure" }));
  respondFails = false;
  console.error = quiet;
  assert.equal(to(l.chat).length, 1);
  assert.equal(lastTo(l.chat).text, TEXT.converseFallback);
  assert.equal(trace.response.fallback, true);
  assert.equal(await prisma.novaStudySession.count({ where: { profileId: l.profileId } }), 0);
});

// ══════════════════════════════════════════════════════════════════════════════
// A very short session
// ══════════════════════════════════════════════════════════════════════════════

test("a session stopped after seconds can be ended and rated, is kept, and moves no mastery and no Progress number", async () => {
  const l  = await learner();
  const tg = telegram(l.chat);

  await tg.say("/focus");
  await tg.tap("Start 25 min");
  assert.equal((await loadNovaSession(l.chat, clock))?.topicName, "Processes");

  // "end session", twenty seconds in: asked how it went, and nothing inferred.
  clock = new Date(clock.getTime() + 20_000);
  const asked = await tg.say("end session", reading({ action: "finish_session" }, { intent: "study_report" }));
  assert.equal(asked.decision, "ask_outcome:finish_needs_outcome");
  assert.match(lastTo(l.chat).text, /How did it go\?$/);
  assert.deepEqual(labels(l.chat), ["Struggled", "Okay", "Good", "Crushed it"]);
  assert.ok(await loadNovaSession(l.chat, clock), "asking ends nothing");

  // The answer, pressed twice at once.
  const sentBefore = to(l.chat).length;
  await tg.doubleTap("Crushed it");
  assert.equal(to(l.chat).length, sentBefore + 1, "one answer is acted on");
  assert.match(lastTo(l.chat).text, /^Logged: 1 min on Processes\. Crushed it\. Under 10 minutes, so it's kept as a session but nothing changed in Knowledge or Progress\.$/);

  // Lifecycle history is kept, with the answer they gave.
  const rows = await prisma.novaStudySession.findMany({ where: { profileId: l.profileId }, select: { status: true, durationMinutes: true, executionReport: true } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.status, "completed");
  const report = rows[0]!.executionReport as { outcome: string; countedAsStudy: boolean; masteryUpdates: unknown[] };
  assert.deepEqual([report.outcome, report.countedAsStudy, report.masteryUpdates], ["crushed_it", false, []]);

  // Nothing downstream treats it as study.
  const topic = await prisma.novaTopicMastery.findFirstOrThrow({ where: { subject: { profileId: l.profileId }, name: "Processes" }, select: { reviewCount: true, masteryProbability: true, nextReviewAt: true } });
  assert.equal(topic.reviewCount, 0, "no review behind the topic");
  assert.equal(topic.masteryProbability, 0, "and no mastery");
  assert.equal(topic.nextReviewAt, null, "and nothing scheduled");
  assert.equal(await prisma.novaTopicMasterySnapshot.count({ where: { profileId: l.profileId } }), 0, "no mastery history");
  const progress = await loadNovaProgress(l.chat, { now: clock });
  assert.equal(progress.status, "ready");
  if (progress.status === "ready") {
    assert.equal(progress.overview.sessions, 0);
    assert.equal(progress.overview.activeDays, 0);
    assert.deepEqual(progress.overview.notCounted, { selfReported: 0, underTenMinutes: 1 });
    assert.deepEqual(progress.growth, { improving: [], steady: [], needsAttention: [], justStarted: [] });
  }
  assert.equal(await prisma.novaLearningDNA.count({ where: { profileId: l.profileId, dataPointCount: { gt: 0 } } }), 0);

  // The plan still says the topic has not been studied.
  const today = await loadNovaToday(l.chat, { now: clock });
  assert.equal(today.status === "ready" && today.recommendation?.topicName, "Processes");
});

test("a real session is ended once: Start, Pause, Resume and the outcome each pressed twice", async () => {
  const l  = await learner();
  const tg = telegram(l.chat);

  await tg.say("/focus");
  await tg.doubleTap("Start 25 min");
  assert.equal(await prisma.novaStudySession.count({ where: { profileId: l.profileId } }), 1, "one session");

  forward(6);
  await tg.say("/status");
  await tg.doubleTap("Pause");
  assert.equal((await loadNovaSession(l.chat, clock))?.status, "paused");
  forward(3);
  await tg.say("/status");
  await tg.doubleTap("Resume");
  const running = await loadNovaSession(l.chat, clock);
  assert.equal(running?.status, "in_progress");
  assert.equal(running?.elapsedSeconds, 6 * 60, "the pause is not study time, however often it was pressed");

  forward(8);
  await tg.say("/done");
  assert.match(lastTo(l.chat).text, /How did it go\?$/);
  const sentBefore = to(l.chat).length;
  const question   = lastTo(l.chat);
  await tg.doubleTap("Good");
  assert.equal(to(l.chat).length, sentBefore + 1);
  assert.match(lastTo(l.chat).text, /^Logged: 14 min on Processes\. Good\.$/);

  // One session, one mastery change, one record of it.
  assert.equal(await prisma.novaStudySession.count({ where: { profileId: l.profileId, status: "completed" } }), 1);
  const topic = await prisma.novaTopicMastery.findFirstOrThrow({ where: { subject: { profileId: l.profileId }, name: "Processes" }, select: { reviewCount: true } });
  assert.equal(topic.reviewCount, 1);
  assert.equal(await prisma.novaTopicMasterySnapshot.count({ where: { profileId: l.profileId } }), 1);

  // The web sees the same thing: no session open, one counted session.
  assert.equal(await loadNovaSession(l.chat, clock), null);
  const progress = await loadNovaProgress(l.chat, { now: clock });
  assert.equal(progress.status === "ready" && progress.overview.sessions, 1);

  // An old outcome button, pressed again later, does nothing.
  const stale = await tg.tap("Good", question);
  assert.equal(stale.failure, "stale_prompt");
  assert.equal(to(l.chat).length, sentBefore + 1, "and says nothing in the chat");
  assert.equal(await prisma.novaTopicMasterySnapshot.count({ where: { profileId: l.profileId } }), 1);
});

// ══════════════════════════════════════════════════════════════════════════════
// Latency: what is sent when, and what each update reports
// ══════════════════════════════════════════════════════════════════════════════

test("the reply is sent before the turn is recorded, and the turn is still recorded", async () => {
  const l  = await learner();
  const tg = telegram(l.chat);
  watch = l.messengerId;

  // A reply code wrote.
  await tg.say("what should I study?", reading({ action: "what_now", asks: "about_me" }, { intent: "plan_request" }));
  assert.match(lastTo(l.chat).text, /^Processes \(Operating Systems\)/);
  assert.equal(lastTo(l.chat).loggedUserMessages, 0, "sent before the message was logged");
  assert.equal(await prisma.companionMessage.count({ where: { userId: l.messengerId, role: "user" } }), 1, "and logged before the update ended");
  assert.equal(await prisma.companionMessage.count({ where: { userId: l.messengerId, role: "assistant", text: lastTo(l.chat).text } }), 1, "with what was sent");

  // A reply the Response Brain worded.
  await tg.say("I'm exhausted today", reading({}, { intent: "emotional_vent", emotion: "overwhelmed", disclosureClass: "emotional_disclosure" }));
  assert.equal(lastTo(l.chat).text, "WORDED");
  assert.equal(lastTo(l.chat).loggedUserMessages, 1, "sent before this message was logged");
  assert.equal(await prisma.companionMessage.count({ where: { userId: l.messengerId, role: "user" } }), 2);
  assert.equal(await prisma.novaConsolidationJob.count({ where: { userId: l.messengerId } }), 2, "both turns went through consolidation");
  watch = null;
});

test("commands and buttons call no model; a simple message calls one; a worded one calls two", async () => {
  const l  = await learner();
  const tg = telegram(l.chat);
  const calls = async (run: () => Promise<TurnTrace>) => { readings = 0; responses = 0; const trace = await run(); return [readings, responses, trace.modelCalls]; };

  for (const command of ["/today", "/status", "/settings", "/focus", "/help"]) {
    assert.deepEqual(await calls(() => tg.say(command)), [0, 0, 0], command);
  }
  await tg.say("/focus");
  assert.deepEqual(await calls(() => tg.tap("Start 25 min")), [0, 0, 0], "Start");
  assert.deepEqual(await calls(() => tg.tap("Pause")), [0, 0, 0], "Pause");
  assert.deepEqual(await calls(() => tg.tap("Resume")), [0, 0, 0], "Resume");
  forward(12);
  assert.deepEqual(await calls(() => tg.say("/done")), [0, 0, 0], "/done");
  assert.deepEqual(await calls(() => tg.tap("Okay")), [0, 0, 0], "an outcome");

  assert.deepEqual(await calls(() => tg.say("what should I study?", reading({ action: "what_now", asks: "about_me" }, { intent: "plan_request" }))), [1, 0, 1]);
  assert.deepEqual(await calls(() => tg.say("I have 30 minutes", reading({ availableMinutes: 30 }))), [1, 0, 1]);
  assert.deepEqual(await calls(() => tg.say("rhtqtaf", NOISE)), [1, 0, 1]);
  assert.deepEqual(await calls(() => tg.say("what is deadlock?", reading({ asks: "knowledge" }, { intent: "topic_question", topic: "deadlock", topicConfidence: 0.9 }))), [1, 1, 2]);
  assert.deepEqual(await calls(() => tg.say("should I study deadlocks tonight?", reading({ asks: "about_me" }, { intent: "plan_request", topic: "Deadlocks", topicConfidence: 0.9 }))), [1, 1, 2]);
});

test("every update reports where its time went, and says when its reply has gone", async () => {
  const l  = await learner();
  const tg = telegram(l.chat);
  const STAGES = ["webhookMs", "learnerMs", "contextMs", "understandingMs", "decisionMs", "actionMs", "responseMs", "telegramSendMs", "replyMs", "persistMs", "totalMs"];

  repliedSignals = 0;
  const command = await tg.say("/today");
  assert.deepEqual(Object.keys(command.timings).sort(), [...STAGES].sort());
  for (const stage of STAGES) assert.ok(Number.isFinite((command.timings as never)[stage]) && (command.timings as never)[stage] >= 0, stage);
  assert.equal(command.timings.understandingMs, 0);
  assert.equal(command.timings.responseMs, 0);
  assert.ok(command.timings.replyMs <= command.timings.totalMs);
  assert.ok(command.timings.webhookMs >= 250, "time spent in the webhook before the handler is counted");
  assert.ok(command.timings.replyMs >= 250, "and is part of what the learner waited");
  assert.equal(repliedSignals, 1, "the webhook is told the reply has gone, once");

  const text = await tg.say("I'm exhausted today", reading({}, { intent: "emotional_vent", emotion: "overwhelmed", disclosureClass: "emotional_disclosure" }));
  assert.equal(repliedSignals, 2, "once per update, when the reply is sent and not when the turn is recorded");
  assert.ok(text.timings.replyMs <= text.timings.totalMs);
  assert.ok(text.timings.replyMs + text.timings.persistMs <= text.timings.totalMs + 1);
  assert.equal(text.slowStage, null, "nothing was slow here");

  // The log line carries durations and counts, and nothing the learner wrote.
  const line = JSON.stringify(text);
  assert.doesNotMatch(line, /exhausted/);
  assert.match(line, /"timings":\{/);
});
