/**
 * Reply language on Telegram, and the Creature view — real Postgres
 * integration test.
 *
 * What it proves: Nova answers in the language the learner writes in (and
 * keeps to it in the fixed lines of commands and buttons, which call no model), the
 * figures and buttons are the same in both, a rendering that changes a figure
 * is thrown away, and a turn never takes more than one wording call. Then:
 * the Creature view is the learner's own streak and active days. Telegram and
 * the models are stood in. Everything between is the real code against a real
 * database.
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
const { loadNovaToday }              = await import("../product/today.js");
const { loadNovaCreature }           = await import("../product/creature.js");
const { loadReplyLanguage }          = await import("../adapters/conversation-adapter.js");
const { TEXT, TEXT_HINGLISH }        = await import("../telegram/telegram-replies.js");

import type { InlineButton, TelegramClient } from "../telegram/telegram.types.js";

const STAMP = Date.now();
const clock = new Date();

// ── Telegram and the models, stood in ─────────────────────────────────────────

interface Sent { chatId: string; text: string; buttons: InlineButton[][] }
const sent: Sent[] = [];
let messageId = 21_000;
const client: TelegramClient = {
  async sendMessage(chatId, text, buttons) { sent.push({ chatId, text, buttons: buttons ?? [] }); return { ok: true as const, messageId: ++messageId }; },
  async answerCallback() {}, async clearButtons() {}, async setChatCommands() {},
};
const to     = (chat: string) => sent.filter(s => s.chatId === chat);
const lastTo = (chat: string) => to(chat).at(-1)!;
const labels = (chat: string) => lastTo(chat).buttons.flat().map(b => b.text);

// The small model that says a reply in Hinglish. By default it keeps the
// text and marks it, so a rendered reply can be told from a plain one.
const HI = "[hinglish] ";
const asked: Array<{ model: string; systemInstruction: string; prompt: string }> = [];
let render: ((plain: string) => string) | null = plain => `${HI}${plain}`;
const generate = (async (request: { model: string; systemInstruction: string; prompt: string }) => {
  asked.push(request);
  if (render === null) throw new Error("model unavailable");
  return render(request.prompt);
}) as never;

// The Response Brain: records what it was told.
const directives: string[] = [];
const respond = async (_layer: string, prompt: string) => {
  directives.push(prompt);
  return { reply: "WORDED", reasoningMode: "direct" as const, confidence: 0.9, stateUpdates: undefined, investigationUpdate: null, followUpCheck: null };
};

const BASE = { intent: "general_chat", emotion: "neutral", topic: null, topicConfidence: 0, disclosureClass: "none", ambiguityScore: 0.1, routingSignal: "coaching_only", secondaryIntents: [], sessionIntent: "none", reality: [] };
const REQ  = { clarity: "clear", changeOfMind: false, action: "none", confidence: 0.9, promptAnswer: null, availableMinutes: null, availableMinutesMax: null, sessionOutcome: null, deferUntil: null, struggleTopic: null, exam: null, asks: "none", setup: null, language: null };
const reading = (request: Record<string, unknown>, base: Record<string, unknown> = {}) => ({ ...BASE, ...base, request: { ...REQ, ...request } });

// Each update arrives a little after the one before, as in a real chat.
let tick = 0;
const nextMoment = () => new Date(clock.getTime() + (++tick) * 2_000);

let updateId = 800_000;
function telegram(chat: string) {
  const run = (event: ReturnType<typeof normalizeTelegramUpdate>, output?: Record<string, unknown>) => {
    assert.notEqual(event.kind, "ignored");
    return handleNovaTelegramEvent(event as never, {
      client, now: nextMoment, webUrl: "https://nova.test", respond, generate,
      understand: (async (text: string) => { assert.ok(output, `no model output for "${text}"`); return parseUnderstandingResponse(JSON.stringify(output), text); }) as never,
    });
  };
  const message = (text: string) => normalizeTelegramUpdate({ update_id: updateId++, message: { message_id: updateId, chat: { id: Number(chat), type: "private" }, from: { id: Number(chat) }, text } });
  return {
    say: (text: string, output?: Record<string, unknown>) => run(message(text), output),
    tap: (label: string) => {
      const button = lastTo(chat).buttons.flat().find(b => b.text === label);
      assert.ok(button?.callback_data, `no button "${label}" (${labels(chat).join(", ")})`);
      return run(normalizeTelegramUpdate({ update_id: updateId++, callback_query: { id: `cb${updateId}`, data: button.callback_data, from: { id: Number(chat) }, message: { message_id: 1, chat: { id: Number(chat), type: "private" } } } }));
    },
  };
}

const accounts: string[] = [];
const chats: string[] = [];
let n = 0;
async function learner(setup: "complete" | "none" = "complete") {
  const user = await prisma.user.create({ data: { email: `lang_${STAMP}_${++n}@test.local`, name: "Asha" }, select: { id: true } });
  accounts.push(user.id);
  await prisma.userProfile.create({ data: { userId: user.id, primaryPersona: "nova", onboardingComplete: true, accountabilityStyle: "soft", secondaryDomains: [], aspirationWords: [] } });
  const web = (await resolveLearnerForAccount(user.id, "Asha")) as { platformChatId: string };
  if (setup === "complete") {
    await saveSetup(web.platformChatId, { subjects: [{ name: "Operating Systems", topics: ["Processes", "Deadlocks"] }], exams: [], dailyMinutes: null, studyTime: null }, clock);
  }
  const chat  = `${STAMP}${80 + chats.length}`;
  chats.push(chat);
  const token = `${STAMP}`.padStart(16, "0") + `${chats.length}`.padStart(16, "e");
  await prisma.userProfile.update({ where: { userId: user.id }, data: { telegramConnectToken: token, telegramConnectTokenExpiresAt: linkTokenExpiry(clock) } });
  assert.equal((await linkTelegramChat(token, { id: chat, type: "private" }, clock)).status, "linked");
  // The chat has had its first message: these tests are about what follows.
  const row = await prisma.messengerUser.findFirstOrThrow({ where: { platform: "telegram", platformChatId: chat }, select: { id: true, novaAcademicProfile: { select: { id: true } } } });
  const profileId = row.novaAcademicProfile?.id ?? null;
  if (profileId) await prisma.novaTelegramChannel.upsert({ where: { profileId }, create: { profileId, lastDeliveredAt: clock }, update: { lastDeliveredAt: clock } });
  return { chat, profileId: profileId ?? "", messengerId: row.id };
}
const reset = () => { asked.length = 0; directives.length = 0; render = plain => `${HI}${plain}`; };

before(async () => { await prisma.$queryRaw`SELECT 1`; });
after(async () => {
  await prisma.messengerUser.deleteMany({ where: { OR: [{ platformChatId: { in: chats } }, { platformChatId: { startsWith: "web:" }, novaAcademicProfile: null }] } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: { in: accounts } } });
  await prisma.$disconnect();
});

// ══════════════════════════════════════════════════════════════════════════════

test("a learner who writes in Hinglish is answered in Hinglish, with the same plan, figures and buttons", async () => {
  const l  = await learner();
  const tg = telegram(l.chat);
  reset();

  // First in English: the plan as code wrote it, and no wording call.
  await tg.say("what should I study?", reading({ action: "what_now", asks: "about_me", language: "english" }, { intent: "plan_request" }));
  const english = lastTo(l.chat);
  assert.match(english.text, /^Processes \(Operating Systems\)\n\d+ min/);
  assert.equal(asked.length, 0, "English needs no wording call");

  // The same question in Hinglish.
  const trace = await tg.say("aaj kya padhna hai?", reading({ action: "what_now", asks: "about_me", language: "hinglish" }, { intent: "plan_request" }));
  assert.equal(lastTo(l.chat).text, `${HI}${english.text}`, "the same reply, said in their language");
  assert.deepEqual(labels(l.chat), english.buttons.flat().map(b => b.text), "the same buttons");
  assert.equal(asked.length, 1, "one wording call");
  assert.equal(asked[0]!.model, "gpt-4o-mini");
  assert.equal(asked[0]!.prompt, english.text, "the model is given only the reply code wrote");
  assert.match(asked[0]!.systemInstruction, /Language: Hinglish/);
  assert.deepEqual(trace.language, { language: "hinglish", rendered: true });
  assert.equal(directives.length, 0, "the Response Brain was not also called: two model calls at most");

  // The conversation log holds what they were actually sent.
  const logged = await prisma.companionMessage.findFirst({ where: { userId: l.messengerId, role: "assistant" }, orderBy: { createdAt: "desc" }, select: { text: true } });
  assert.equal(logged?.text, `${HI}${english.text}`);
  const theirs = await prisma.companionMessage.findFirst({ where: { userId: l.messengerId, role: "user" }, orderBy: { createdAt: "desc" }, select: { text: true, metadata: true } });
  assert.equal(theirs?.text, "aaj kya padhna hai?");
  assert.equal((theirs?.metadata as { language?: string }).language, "hinglish");
  assert.equal(await loadReplyLanguage(l.messengerId), "hinglish");
});

test("commands and buttons call no model: their fixed lines are in the learner's language, the plan as code wrote it", async () => {
  const l  = await learner();
  const tg = telegram(l.chat);
  reset();
  await tg.say("aaj kya padhna hai?", reading({ action: "what_now", asks: "about_me", language: "hinglish" }, { intent: "plan_request" }));

  // A command calls no model at all: the plan goes out as code wrote it.
  asked.length = 0;
  const trace = await tg.say("/today");
  assert.equal(trace.understanding.attempted, false, "a command is not read by a model");
  assert.match(lastTo(l.chat).text, /^Processes \(Operating Systems\)\n25 min/);
  assert.equal(asked.length, 0, "and not reworded by one");

  // Its fixed lines are written in Hinglish already.
  await tg.tap("Later");
  assert.equal(lastTo(l.chat).text, TEXT_HINGLISH.later);
  assert.equal(asked.length, 0);

  await tg.say("/help");
  assert.equal(lastTo(l.chat).text, TEXT_HINGLISH.help);
  assert.equal(asked.length, 0);

  // A message too short to tell ("30") does not change it.
  await tg.say("30", reading({ action: "none", availableMinutes: 30, language: null }));
  assert.ok(lastTo(l.chat).text.startsWith(HI), "still Hinglish");
  assert.equal(await loadReplyLanguage(l.messengerId), "hinglish");
});

test("writing in English again switches back at once", async () => {
  const l  = await learner();
  const tg = telegram(l.chat);
  reset();
  await tg.say("aaj kya padhna hai?", reading({ action: "what_now", asks: "about_me", language: "hinglish" }, { intent: "plan_request" }));
  asked.length = 0;

  await tg.say("what should I study?", reading({ action: "what_now", asks: "about_me", language: "english" }, { intent: "plan_request" }));
  assert.match(lastTo(l.chat).text, /^Processes \(Operating Systems\)/);
  assert.equal(asked.length, 0);
  assert.equal(await loadReplyLanguage(l.messengerId), "english");

  await tg.tap("Later");
  assert.equal(lastTo(l.chat).text, TEXT.later);
});

test("a rendering that changes a figure, or a model that is down, sends the reply as code wrote it", async () => {
  const l  = await learner();
  const tg = telegram(l.chat);
  reset();

  render = plain => plain.replace("25", "40");
  const wrong = await tg.say("aaj kya padhna hai?", reading({ action: "what_now", asks: "about_me", language: "hinglish" }, { intent: "plan_request" }));
  assert.match(lastTo(l.chat).text, /^Processes \(Operating Systems\)\n25 min/, "the plan's own figure");
  assert.deepEqual(wrong.language, { language: "hinglish", rendered: false });
  assert.ok(labels(l.chat).includes("Start 25 min"));

  render = null;
  await tg.say("abhi kya karu?", reading({ action: "what_now", asks: "about_me", language: "hinglish" }, { intent: "plan_request" }));
  assert.match(lastTo(l.chat).text, /^Processes \(Operating Systems\)\n25 min/);
  assert.equal(wrong.failure, "none", "a plain reply is not a failed turn");
});

test("a turn the Response Brain words is told the language, and is worded once", async () => {
  const l  = await learner();
  const tg = telegram(l.chat);
  reset();

  await tg.say("bhai aaj bahut thak gaya hoon", reading({ action: "none", language: "hinglish" }, { intent: "emotional_vent", emotion: "overwhelmed", disclosureClass: "emotional_disclosure" }));
  assert.equal(lastTo(l.chat).text, "WORDED");
  assert.equal(directives.length, 1);
  assert.match(directives[0]!, /Language: Hinglish/);
  assert.equal(asked.length, 0, "not said a second time by the language step");

  // In English the directive carries no language line.
  directives.length = 0;
  await tg.say("I'm exhausted today", reading({ action: "none", language: "english" }, { intent: "emotional_vent", emotion: "overwhelmed", disclosureClass: "emotional_disclosure" }));
  assert.equal(directives.length, 1);
  assert.doesNotMatch(directives[0]!, /Language:/);
});

test("a learner still setting up is asked for what is missing in their language", async () => {
  const l  = await learner("none");
  const tg = telegram(l.chat);
  reset();

  await tg.say("bhai kya padhu aaj", reading({ action: "what_now", asks: "about_me", language: "hinglish" }, { intent: "plan_request" }));
  assert.ok(lastTo(l.chat).text.startsWith(HI));
  assert.match(lastTo(l.chat).text, /Which subjects are you taking this term\?/);
  assert.equal(asked.length, 1);
  assert.equal(await loadReplyLanguage(l.messengerId), "hinglish");
});

// ── Creature ──────────────────────────────────────────────────────────────────

test("the Creature view is the learner's own streak and active days, and an untouched world before any session", async () => {
  const l = await learner();

  const fresh = await loadNovaCreature(l.chat, { now: clock });
  assert.equal(fresh.status, "ready");
  if (fresh.status !== "ready") return;
  assert.deepEqual({ streakDays: fresh.streakDays, activeDays: fresh.activeDays, level: fresh.level, worldHealth: fresh.worldHealth }, { streakDays: 0, activeDays: 0, level: 1, worldHealth: 70 });

  // One timed session of 25 minutes, finished an hour ago.
  const subject = await prisma.novaSubject.findFirstOrThrow({ where: { profileId: l.profileId }, select: { id: true } });
  await prisma.novaStudySession.create({ data: {
    profileId: l.profileId, subjectId: subject.id, topicName: "Processes", activityType: "review", status: "completed",
    sessionDate: new Date(clock.getTime() - 60 * 60_000), durationMinutes: 25,
  } });

  const after = await loadNovaCreature(l.chat, { now: clock });
  const today = await loadNovaToday(l.chat, { now: clock });
  assert.equal(after.status, "ready");
  assert.equal(today.status, "ready");
  if (after.status !== "ready" || today.status !== "ready") return;
  assert.equal(after.activeDays, 1);
  assert.equal(after.worldHealth, 75);
  assert.equal(after.level, 1);
  assert.equal(after.streakDays, today.progress.streakDays, "the streak Home shows");
  assert.equal(after.seed, fresh.seed, "the same world");
  assert.doesNotMatch(after.seed, new RegExp(l.chat));

  // Another learner's world is their own.
  const other = await learner();
  const theirs = await loadNovaCreature(other.chat, { now: clock });
  assert.equal(theirs.status === "ready" && theirs.activeDays, 0);
  assert.notEqual(theirs.status === "ready" && theirs.seed, after.seed);
});

test("an account that has not finished setup has no creature numbers", async () => {
  const l = await learner("none");
  assert.equal((await loadNovaCreature(l.chat, { now: clock })).status, "onboarding_incomplete");
});
