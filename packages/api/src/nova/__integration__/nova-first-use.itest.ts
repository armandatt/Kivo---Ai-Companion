/**
 * The first message in a newly connected Telegram chat — real Postgres
 * integration test.
 *
 * What it proves: after a chat is linked, Nova's first message comes from the
 * learner's own record (the plan, a known exam, time they stated, a running
 * session, what is going on in their life), carries the ordinary buttons, is
 * sent once per chat, and teaches no command. Telegram and the model are stood
 * in. Everything between is the real code against a real database.
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
const { addExam }                    = await import("../product/exams.js");
const { recordStatedMinutes }        = await import("../product/planning-inputs.js");
const { runNovaSessionCommand, loadNovaSession } = await import("../product/session.js");
const { claimTelegramUpdate }        = await import("../../services/telegramTransport.service.js");

import type { InlineButton, SendResult, TelegramClient } from "../telegram/telegram.types.js";

const STAMP = Date.now();
const clock = new Date();
const inDays = (n: number) => new Date(clock.getTime() + n * 86_400_000).toISOString().slice(0, 10);

// ── Telegram and the model, stood in ──────────────────────────────────────────

interface Sent { chatId: string; text: string; buttons: InlineButton[][] }
const sent: Sent[] = [];
let messageId = 11_000;
let failNext: SendResult | null = null;
const client: TelegramClient = {
  async sendMessage(chatId, text, buttons) {
    const result = failNext ?? { ok: true as const, messageId: ++messageId };
    failNext = null;
    if (result.ok) sent.push({ chatId, text, buttons: buttons ?? [] });
    return result;
  },
  async answerCallback() {}, async clearButtons() {}, async setChatCommands() {},
};
const to     = (chat: string) => sent.filter(s => s.chatId === chat);
const lastTo = (chat: string) => to(chat).at(-1)!;
const labels = (chat: string) => lastTo(chat).buttons.flat().map(b => b.text);

// What the model was asked, and what it answers. null: the model is down.
const asked: Array<{ systemInstruction: string; prompt: string }> = [];
let modelSays: string | null = null;
const generate = (async (request: { systemInstruction: string; prompt: string }) => {
  asked.push(request);
  if (modelSays === null) throw new Error("model unavailable");
  return modelSays;
}) as never;

const BASE = { intent: "general_chat", emotion: "neutral", topic: null, topicConfidence: 0, disclosureClass: "none", ambiguityScore: 0.1, routingSignal: "coaching_only", secondaryIntents: [], sessionIntent: "none", reality: [] };
const REQ  = { clarity: "clear", changeOfMind: false, action: "none", confidence: 0.9, promptAnswer: null, availableMinutes: null, availableMinutesMax: null, sessionOutcome: null, deferUntil: null, struggleTopic: null, exam: null, asks: "none", setup: null };
const respond = async () => ({ reply: "WORDED", reasoningMode: "direct" as const, confidence: 0.9, stateUpdates: undefined, investigationUpdate: null, followUpCheck: null });

let updateId = 600_000;
function telegram(chat: string) {
  const run = (event: ReturnType<typeof normalizeTelegramUpdate>, output?: Record<string, unknown>) => {
    assert.notEqual(event.kind, "ignored");
    return handleNovaTelegramEvent(event as never, {
      client, now: () => clock, webUrl: "https://nova.test", respond, generate,
      understand: (async (text: string) => { assert.ok(output, `no model output for "${text}"`); return parseUnderstandingResponse(JSON.stringify(output), text); }) as never,
    });
  };
  const message = (text: string) => normalizeTelegramUpdate({ update_id: updateId++, message: { message_id: updateId, chat: { id: Number(chat), type: "private" }, from: { id: Number(chat) }, text } });
  return {
    say: (text: string, output?: Record<string, unknown>) => run(message(text), output),
    // What the webhook does once a chat is linked: the Start event, with no token.
    linked: () => run({ kind: "command", command: "start", argument: "", updateId: updateId++, chatId: chat, fromId: chat } as never),
    tap: (label: string) => {
      const button = lastTo(chat).buttons.flat().find(b => b.text === label);
      assert.ok(button?.callback_data, `no button "${label}" (${labels(chat).join(", ")})`);
      return run(normalizeTelegramUpdate({ update_id: updateId++, callback_query: { id: `cb${updateId}`, data: button.callback_data, from: { id: Number(chat) }, message: { message_id: 1, chat: { id: Number(chat), type: "private" } } } }));
    },
  };
}

// ── A learner set up on the web, about to connect Telegram ────────────────────

const accounts: string[] = [];
const chats: string[] = [];
let n = 0;
async function webLearner(setup: "complete" | "subjects_only" | "none" = "complete") {
  const user = await prisma.user.create({ data: { email: `first_${STAMP}_${++n}@test.local`, name: "Asha" }, select: { id: true } });
  accounts.push(user.id);
  await prisma.userProfile.create({ data: { userId: user.id, primaryPersona: "nova", onboardingComplete: true, accountabilityStyle: "soft", secondaryDomains: [], aspirationWords: [] } });
  const learner = (await resolveLearnerForAccount(user.id, "Asha")) as { platformChatId: string };
  if (setup !== "none") {
    await saveSetup(learner.platformChatId, {
      subjects: [{ name: "Operating Systems", topics: setup === "complete" ? ["Processes", "Deadlocks"] : [] }],
      exams: [], dailyMinutes: null, studyTime: null,
    }, clock);
  }
  return { userId: user.id, webId: learner.platformChatId };
}
async function link(l: { userId: string }) {
  const chat  = `${STAMP}${60 + chats.length}`;
  chats.push(chat);
  const token = `${STAMP}`.padStart(16, "0") + `${chats.length}`.padStart(16, "f");
  await prisma.userProfile.update({ where: { userId: l.userId }, data: { telegramConnectToken: token, telegramConnectTokenExpiresAt: linkTokenExpiry(clock) } });
  const result = await linkTelegramChat(token, { id: chat, type: "private" }, clock);
  assert.equal(result.status, "linked");
  return chat;
}
const profileOf = (chat: string) => prisma.novaAcademicProfile.findFirstOrThrow({ where: { user: { platformChatId: chat } }, select: { id: true } });

before(async () => { await prisma.$queryRaw`SELECT 1`; });
after(async () => {
  await prisma.messengerUser.deleteMany({ where: { OR: [{ platformChatId: { in: chats } }, { platformChatId: { startsWith: "web:" }, novaAcademicProfile: null }] } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: { in: accounts } } });
  await prisma.$disconnect();
});

// ══════════════════════════════════════════════════════════════════════════════

test("a learner set up on the web links Telegram and gets one mentor message from their own record, with the plan's Start button", async () => {
  const l    = await webLearner();
  const chat = await link(l);
  asked.length = 0;
  modelSays = "Yo, you're set.\n\nProcesses is the move today.\n\nOr just tell me what's going on.";

  const trace = await telegram(chat).linked();
  assert.equal(trace.decision, "command:start:first_use");
  assert.equal(trace.operation.name, "first_use:recommend");
  assert.equal(to(chat).length, 1, "one message");
  assert.equal(lastTo(chat).text, modelSays);
  assert.ok(labels(chat).includes("Start 25 min"), "the plan's own Start button");
  assert.doesNotMatch(lastTo(chat).text, /\/[a-z]+/, "no command is taught");

  // The model was shown the recommendation and nothing that is not on record.
  assert.equal(asked.length, 1);
  assert.match(asked[0]!.systemInstruction, /First on today's plan: Processes \(Operating Systems\), 25 min\./);
  assert.doesNotMatch(asked[0]!.systemInstruction, /Next exam|Time they said/);
  assert.match(asked[0]!.prompt, /Do not mention commands/);

  // The button is the ordinary one: it starts the one session the web sees.
  await telegram(chat).tap("Start 25 min");
  assert.equal((await loadNovaSession(chat, clock))?.topicName, "Processes");
  assert.equal(await prisma.novaStudySession.count({ where: { profileId: (await profileOf(chat)).id } }), 1);
});

test("an exam and the time they have are mentioned when they are on record, and only then", async () => {
  const l = await webLearner();
  await addExam(l.webId, { title: "OS exam", subjectName: "Operating Systems", date: inDays(8) }, clock);
  await recordStatedMinutes(l.webId, 30, clock);
  const chat = await link(l);
  asked.length = 0;
  modelSays = null;   // the model is down: the plain message goes out

  await telegram(chat).linked();
  assert.match(asked[0]!.systemInstruction, /Next exam: OS exam, in 8 days\./);
  assert.match(asked[0]!.systemInstruction, /Time they said they have today: 30 min\./);
  assert.match(lastTo(chat).text, /^You're set\.\n\nOS exam is in 8 days, and \w+ is first on your plan: \d+ min\./);
  assert.match(lastTo(chat).text, /Or just tell me what's going on\.$/);
  assert.doesNotMatch(lastTo(chat).text, /in [^8] days|in 8 days.*in 8 days.*in [^8] days/, "one count for the exam, the learner's calendar days");
  assert.match(lastTo(chat).text, /Why: exam in 8 days/);
  assert.deepEqual(labels(chat).filter(t => t.startsWith("Start")), ["Start 15 min", "Start 25 min", "Start 30 min"], "fitted to the 30 minutes they said");
});

test("the greeting is sent once: again, replayed, or twice at the same moment", async () => {
  const l    = await webLearner();
  const chat = await link(l);
  modelSays  = null;
  const tg   = telegram(chat);

  // Two deliveries of the linking moment at once: one greeting between them.
  await Promise.all([tg.linked(), tg.linked()]);
  assert.equal(to(chat).filter(m => m.text.startsWith("You're set.")).length, 1);

  // Later, /start is simply "what now": the plan, without the greeting.
  await tg.say("/start");
  assert.match(lastTo(chat).text, /^Processes \(Operating Systems\)/);
  assert.equal(to(chat).filter(m => m.text.startsWith("You're set.")).length, 1);

  // And Telegram resending the very same update is refused before any of this runs.
  const id = (STAMP % 1_000_000_000) + 4242;   // an id no other test has used
  assert.equal(await claimTelegramUpdate(id), "claimed");
  assert.notEqual(await claimTelegramUpdate(id), "claimed");
});

test("a greeting that was not delivered is not counted as sent", async () => {
  const l    = await webLearner();
  const chat = await link(l);
  modelSays  = null;
  failNext   = { ok: false, kind: "server", detail: "telegram is down" };
  await telegram(chat).linked();
  assert.equal(to(chat).length, 0);
  await telegram(chat).linked();
  assert.match(lastTo(chat).text, /^You're set\./);
});

test("setup that is not finished is not papered over: the one missing thing is asked", async () => {
  const partial = await link(await webLearner("subjects_only"));
  asked.length = 0;
  await telegram(partial).linked();
  assert.equal(lastTo(partial).text, "I'm Nova. Before I can plan anything I need to know what you're studying. What does Operating Systems cover this term? List the topics or chapters, in any order.");
  assert.deepEqual(labels(partial), ["Set it up on the web"]);

  const nothing = await link(await webLearner("none"));
  await telegram(nothing).linked();
  assert.equal(lastTo(nothing).text, "I'm Nova. Before I can plan anything I need to know what you're studying. Which subjects are you taking this term?");
  assert.equal(asked.length, 0, "no model was asked to dress it up");
});

test("with a session already running, the first message is about that session and offers no other", async () => {
  const l = await webLearner();
  await runNovaSessionCommand(l.webId, { action: "start", topicName: "Deadlocks", subjectName: "Operating Systems", plannedMinutes: 25 }, clock, "web");
  const chat = await link(l);
  modelSays  = null;
  const trace = await telegram(chat).linked();
  assert.equal(trace.operation.name, "first_use:session");
  assert.match(lastTo(chat).text, /^You're connected\. You have a session running on Deadlocks/);
  assert.deepEqual(labels(chat), ["Pause", "End"]);
  assert.equal(await prisma.novaStudySession.count({ where: { profileId: (await profileOf(chat)).id } }), 1);
});

test("with illness on record there is no push to study and no Start button", async () => {
  const l    = await webLearner();
  await addExam(l.webId, { title: "OS exam", subjectName: "Operating Systems", date: inDays(5) }, clock);
  const chat = await link(l);
  const user = await prisma.messengerUser.findFirstOrThrow({ where: { platformChatId: chat }, select: { id: true } });
  await prisma.userReality.create({ data: { userId: user.id, category: "health", subtype: "illness", fact: "Student has the flu", confidence: 0.9, isActive: true, expiresAt: new Date(clock.getTime() + 3 * 86_400_000) } });
  asked.length = 0;
  modelSays = null;

  const trace = await telegram(chat).linked();
  assert.equal(trace.operation.name, "first_use:hold");
  assert.equal(lastTo(chat).text, "You're connected. You told me: Student has the flu. Nothing from me to push today. I'm here when you want to talk.");
  assert.deepEqual(labels(chat), []);
  assert.match(asked[0]!.prompt, /Register: serious/);
  assert.match(asked[0]!.prompt, /Do not suggest studying or a session\./);
  assert.doesNotMatch(asked[0]!.systemInstruction, /First on today's plan/);
});

test("after the first message the chat is an ordinary one: commands still work and so do plain words", async () => {
  const l    = await webLearner();
  const chat = await link(l);
  modelSays  = null;
  const tg   = telegram(chat);
  await tg.linked();

  await tg.say("/today");
  assert.match(lastTo(chat).text, /^Processes \(Operating Systems\)/);
  await tg.say("/status");
  assert.match(lastTo(chat).text, /No session running\./);
  await tg.say("/settings");
  assert.match(lastTo(chat).text, /^Nudges: on/);

  const plan = await tg.say("what should I study?", { ...BASE, intent: "plan_request", request: { ...REQ, asks: "about_me", action: "what_now" } });
  assert.equal(plan.decision, "show_today:asked_what_now");
  await tg.say("I've got 30 minutes", { ...BASE, request: { ...REQ, availableMinutes: 30 } });
  assert.ok(labels(chat).includes("Start 30 min"));
  await tg.say("start it", { ...BASE, request: { ...REQ, action: "start_session", promptAnswer: "abcdef"[lastTo(chat).buttons.flat().findIndex(b => b.text === "Start 30 min")] } });
  assert.equal((await loadNovaSession(chat, clock))?.plannedDurationMinutes, 30);
  await tg.say("/done");
  assert.match(lastTo(chat).text, /How did it go\?$/);
});
