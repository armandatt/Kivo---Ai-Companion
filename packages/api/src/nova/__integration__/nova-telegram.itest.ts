/**
 * Nova on Telegram — real Postgres integration test.
 *
 * What it proves is not that Nova replies well. It proves that a Telegram
 * interaction changes the one canonical learner state, exactly once, and that
 * the rest of Nova can see the change: the session the web app shows, the
 * mastery Knowledge shows, the plan Today and the Planner build, what the
 * proactive tick does next.
 *
 * Telegram itself is a recording stand-in, and so are the two models: the
 * Understanding stand-in returns a canned model output (as JSON text, so the
 * real parser and validation run), and the Response stand-in returns a marked
 * reply. Everything between them is the real code against a real database.
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
const { handleNovaTelegramEvent }   = await import("../telegram/telegram-turn.js");
const { normalizeTelegramUpdate, encodeCallback } = await import("../telegram/telegram-event.js");
const { linkTelegramChat, linkTokenExpiry } = await import("../telegram/telegram-link.js");
const { loadOpenPrompt, resolvePrompt, openPrompt } = await import("../telegram/prompt-store.js");
const { acquireTurn, releaseTurn, ensureChannel } = await import("../telegram/channel-store.js");
const { parseUnderstandingResponse } = await import("../brains/understanding-parser.js");
const { runNovaSessionCommand, loadNovaSession } = await import("../product/session.js");
const { loadNovaToday }             = await import("../product/today.js");
const { loadNovaPlanner }           = await import("../product/planner.js");
const { loadNovaKnowledge }         = await import("../product/knowledge.js");
const { runNovaProactiveCron }      = await import("../proactive/nova-proactive-cron.js");
const { localHour, dayKey }         = await import("../engines/learner-calendar.js");

import type { InlineButton, SendResult, TelegramClient, TurnTrace } from "../telegram/telegram.types.js";
import type { UnderstandingContext } from "../types/understanding.types.js";

const STAMP = Date.now();
const MIN   = 60_000;

// ── A clock the test moves ────────────────────────────────────────────────────
// Starts at the real time (some loaders read the real clock) and only moves
// forward.
let clock = new Date();
const tick = (minutes: number) => { clock = new Date(clock.getTime() + minutes * MIN); return clock; };

// A timezone in which the test clock reads the given local hour.
function zoneWhereHourIs(hour: number, at = clock): string {
  for (let offset = -11; offset <= 12; offset++) {
    const zone = `Etc/GMT${offset <= 0 ? "+" : "-"}${Math.abs(offset)}`;
    if (localHour(at, zone) === hour) return zone;
  }
  throw new Error(`no zone with local hour ${hour}`);
}

// ── Telegram, recorded ────────────────────────────────────────────────────────

interface Sent { chatId: string; text: string; buttons: InlineButton[][]; messageId: number | null }
function fakeTelegram() {
  const sent: Sent[] = [];
  const answered: Array<{ id: string; text?: string }> = [];
  const cleared: number[] = [];
  let next: SendResult | null = null;
  let id = 1000;
  const client: TelegramClient = {
    async sendMessage(chatId, text, buttons) {
      const result = next ?? { ok: true as const, messageId: ++id };
      next = null;
      sent.push({ chatId, text, buttons: buttons ?? [], messageId: result.ok ? result.messageId : null });
      return result;
    },
    async answerCallback(callbackId, text) { answered.push({ id: callbackId, text }); },
    async clearButtons(_chat, messageId) { cleared.push(messageId); },
    async setChatCommands() {},
  };
  return {
    client, sent, answered, cleared,
    failNext: (result: SendResult) => { next = result; },
    last: () => sent[sent.length - 1]!,
    labels: () => sent[sent.length - 1]!.buttons.flat().map(b => b.text),
    data: (label: string) => {
      const button = sent[sent.length - 1]!.buttons.flat().find(b => b.text === label);
      assert.ok(button?.callback_data, `no button "${label}" on the last message (${sent[sent.length - 1]!.buttons.flat().map(b => b.text).join(", ")})`);
      return button.callback_data;
    },
  };
}

// ── The models, stood in ──────────────────────────────────────────────────────

const BASE = { intent: "general_chat", emotion: "neutral", topic: null, topicConfidence: 0, disclosureClass: "none", ambiguityScore: 0.1, routingSignal: "coaching_only", secondaryIntents: [], sessionIntent: "none", reality: [] };
const REQ  = { clarity: "clear", changeOfMind: false, action: "none", confidence: 0.9, promptAnswer: null, availableMinutes: null, sessionOutcome: null, deferUntil: null, struggleTopic: null, exam: null };

function brains() {
  const script = new Map<string, Record<string, unknown>>();
  const seen: Array<{ text: string; context: UnderstandingContext | undefined }> = [];
  const worded: string[] = [];
  let understandFails: "throw" | "garbage" | null = null;
  let respondFails = false;
  return {
    seen, worded,
    read: (text: string, model: Record<string, unknown>) => script.set(text, model),
    breakUnderstanding: (how: "throw" | "garbage" | null) => { understandFails = how; },
    breakResponse: (broken: boolean) => { respondFails = broken; },
    understand: async (text: string, _history: unknown, context?: UnderstandingContext) => {
      seen.push({ text, context });
      if (understandFails === "throw") throw new Error("model unavailable");
      if (understandFails === "garbage") return parseUnderstandingResponse("Sure! Here is my analysis:", text);
      const model = script.get(text);
      assert.ok(model, `the test has no model output for "${text}"`);
      // As the model would return it: text, through the real parser.
      return parseUnderstandingResponse(JSON.stringify(model), text);
    },
    respond: async (_dynamic: string, prompt: string) => {
      if (respondFails) throw new Error("model unavailable");
      worded.push(prompt);
      return { reply: `WORDED(${worded.length})`, reasoningMode: "direct" as const, confidence: 0.9, stateUpdates: undefined, investigationUpdate: null, followUpCheck: null };
    },
  };
}

// ── Learners ──────────────────────────────────────────────────────────────────

const chats: string[] = [];
const webUsers: string[] = [];
interface Learner { chat: string; userId: string; profileId: string; subjectId: string; deadlocksId: string }

async function seedLearner(name: string, options: { exam?: boolean; timezone?: string | null; preferredStudyTime?: string | null } = {}): Promise<Learner> {
  const chat = `${STAMP}${chats.length + 1}`;
  chats.push(chat);
  const user = await prisma.messengerUser.create({
    data: {
      platform: "telegram", platformChatId: chat, persona: "nova", displayName: name,
      novaAcademicProfile: { create: {
        onboardingComplete: true, timezone: options.timezone === undefined ? "Asia/Kolkata" : options.timezone,
        preferredStudyTime: options.preferredStudyTime ?? null,
        subjects: { create: { name: "Operating Systems", code: "OS" } },
      } },
    },
    select: { id: true, novaAcademicProfile: { select: { id: true, subjects: { select: { id: true } } } } },
  });
  const profileId = user.novaAcademicProfile!.id;
  const subjectId = user.novaAcademicProfile!.subjects[0]!.id;
  const longAgo = new Date(clock.getTime() - 5 * 86_400_000);
  const deadlocks = await prisma.novaTopicMastery.create({
    data: { subjectId, name: "Deadlocks", masteryProbability: 0.45, confidenceReported: 0.5, reviewCount: 2, lastStudiedAt: longAgo, nextReviewAt: new Date(clock.getTime() - 86_400_000) },
  });
  await prisma.novaTopicMastery.create({
    data: { subjectId, name: "Paging", masteryProbability: 0.7, confidenceReported: 0.7, reviewCount: 3, lastStudiedAt: longAgo, nextReviewAt: new Date(clock.getTime() + 6 * 86_400_000) },
  });
  if (options.exam) {
    await prisma.novaExam.create({ data: { profileId, subjectId, title: "Operating Systems final", examType: "final", scheduledAt: new Date(clock.getTime() + 26 * 3_600_000) } });
  }
  return { chat, userId: user.id, profileId, subjectId, deadlocksId: deadlocks.id };
}

let updateId = 1;
const say = (chat: string, text: string) =>
  normalizeTelegramUpdate({ update_id: updateId++, message: { message_id: updateId, chat: { id: Number(chat), type: "private" }, from: { id: Number(chat) }, text } });
const tapUpdate = (chat: string, data: string, from = chat, messageId = 1) =>
  normalizeTelegramUpdate({ update_id: updateId++, callback_query: { id: `cb${updateId}`, data, from: { id: Number(from) }, message: { message_id: messageId, chat: { id: Number(chat), type: "private" } } } });

function harness() {
  const tg = fakeTelegram();
  const ai = brains();
  const run = async (event: ReturnType<typeof normalizeTelegramUpdate>): Promise<TurnTrace> => {
    assert.notEqual(event.kind, "ignored");
    return handleNovaTelegramEvent(event as never, { client: tg.client, now: () => clock, webUrl: "https://nova.test", understand: ai.understand as never, respond: ai.respond });
  };
  return {
    tg, ai,
    send: (l: Learner, text: string) => run(say(l.chat, text)),
    tap:  (l: Learner, label: string) => run(tapUpdate(l.chat, tg.data(label))),
    tapData: (l: Learner, data: string, from?: string) => run(tapUpdate(l.chat, data, from)),
  };
}

const sessions  = (l: Learner) => prisma.novaStudySession.findMany({ where: { profileId: l.profileId }, orderBy: { sessionDate: "asc" } });
const deadlocks = (l: Learner) => prisma.novaTopicMastery.findUniqueOrThrow({ where: { id: l.deadlocksId } });
const facts     = (l: Learner) => prisma.userFact.count({ where: { userId: l.userId } });
const patterns  = (l: Learner) => prisma.behavioralPattern.count({ where: { userId: l.userId } });
const outbox    = (l: Learner) => prisma.novaProactiveMessage.findMany({ where: { profileId: l.profileId }, orderBy: { createdAt: "asc" } });
const jobs      = (l: Learner) => prisma.novaConsolidationJob.findMany({ where: { userId: l.userId } });
const channel   = (l: Learner) => prisma.novaTelegramChannel.findUniqueOrThrow({ where: { profileId: l.profileId } });

before(async () => { await prisma.$queryRaw`SELECT 1`; });

after(async () => {
  await prisma.messengerUser.deleteMany({ where: { platformChatId: { in: chats } } });
  await prisma.user.deleteMany({ where: { id: { in: webUsers } } });
  await prisma.$disconnect();
});

// ══════════════════════════════════════════════════════════════════════════════
// Protocol: commands and buttons, no model
// ══════════════════════════════════════════════════════════════════════════════

test("/today states the plan's own recommendation and calls no model", async () => {
  const l = await seedLearner("Asha", { exam: true });
  const { tg, ai, send } = harness();
  const trace = await send(l, "/today");

  const web = await loadNovaToday(l.chat, { now: clock });
  assert.equal(web.status, "ready");
  if (web.status !== "ready") return;
  // The same topic, the same reasons, as the web Home.
  assert.ok(tg.last().text.startsWith(`${web.recommendation!.topicName} (${web.recommendation!.subjectName})`));
  assert.ok(tg.last().text.includes(web.recommendation!.reasons[0]!));
  assert.deepEqual(tg.labels(), ["Start 15 min", "Start 25 min", "Start 45 min", "Something else", "Later"]);
  assert.equal(ai.seen.length + ai.worded.length, 0, "a command reaches no model");
  assert.deepEqual([trace.type, trace.understanding.attempted, trace.response.generated, trace.send.status], ["command", false, false, "sent"]);

  // Buttons carry a reference, never the action.
  for (const button of tg.last().buttons.flat()) assert.match(button.callback_data!, /^p:[a-z0-9]+:[a-j]$/);
  const prompt = await loadOpenPrompt(l.profileId, clock);
  assert.equal(prompt?.kind, "start");
  assert.equal(prompt?.messageId, tg.last().messageId);
});

test("Start on Telegram opens the one canonical session, and the web app sees it", async () => {
  const l = await seedLearner("Bo");
  const { tg, ai, send, tap } = harness();
  await send(l, "/today");
  const trace = await tap(l, "Start 25 min");

  const rows = await sessions(l);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0]!.status, rows[0]!.topicName, rows[0]!.plannedDurationMinutes, rows[0]!.subjectId], ["in_progress", "Deadlocks", 25, l.subjectId]);
  assert.ok(tg.last().text.startsWith("Started.\nRunning: Deadlocks"));
  assert.deepEqual(tg.labels(), ["Pause", "End"]);
  assert.deepEqual([trace.operation.name, trace.operation.ok, trace.decision], ["session_start", true, "option:start"]);

  // The Focus page reads the same row.
  const web = await loadNovaSession(l.chat, clock);
  assert.deepEqual([web?.id, web?.status, web?.plannedDurationMinutes], [rows[0]!.id, "in_progress", 25]);
  assert.equal(ai.seen.length, 0);
});

test("a prompt is answered once: a double tap, an old button and a replaced prompt do nothing", async () => {
  const l = await seedLearner("Cy");
  const { tg, send, tapData } = harness();
  await send(l, "/today");
  const start = tg.data("Start 25 min");

  // Two taps at the same moment.
  const [a, b] = await Promise.all([tapData(l, start), tapData(l, start)]);
  assert.deepEqual([a.failure, b.failure].sort(), ["none", "stale_prompt"]);
  assert.equal((await sessions(l)).length, 1, "one session, not two");
  assert.ok(tg.answered.some(x => x.text === "That one's closed."));

  // The same button again, later: still nothing.
  await runNovaSessionCommand(l.chat, { action: "end", outcome: "okay" }, tick(12));
  const again = await tapData(l, start);
  assert.equal(again.failure, "stale_prompt");
  assert.equal((await sessions(l)).filter(s => s.status !== "completed").length, 0);

  // A newer prompt closes the older one.
  await send(l, "/today");
  const older = tg.data("Start 15 min");
  await send(l, "/status");
  assert.equal((await tapData(l, older)).failure, "stale_prompt");
  assert.equal(await prisma.novaTelegramPrompt.count({ where: { profileId: l.profileId, openKey: { not: null } } }), 1, "one open prompt per learner");
});

test("an expired prompt cannot be answered, by tap or by typing", async () => {
  const l = await seedLearner("Di");
  const { tg, ai, send, tapData } = harness();
  await send(l, "/today");
  const start = tg.data("Start 25 min");
  tick(181);   // a start offer is good for three hours

  assert.equal((await tapData(l, start)).failure, "stale_prompt");
  assert.equal((await sessions(l)).length, 0);

  // "yes" now has nothing to attach to: the model is shown no open question.
  ai.read("yes", { ...BASE, ambiguityScore: 0.9, request: { ...REQ, action: "none", confidence: 0.2 } });
  await send(l, "yes");
  assert.equal(ai.seen.at(-1)!.context!.openPrompt, null);
  assert.equal(tg.last().text, "Not sure what you need there. Pick one:");
  assert.equal((await sessions(l)).length, 0);
});

test("a callback is only a reference: forged, foreign and malformed ones change nothing", async () => {
  const mine  = await seedLearner("Eve");
  const other = await seedLearner("Fox");
  const { tg, send, tapData } = harness();
  await send(other, "/today");
  const theirs = tg.data("Start 25 min");
  const theirPrompt = await loadOpenPrompt(other.profileId, clock);

  // Someone else's prompt id, sent from my chat.
  assert.equal((await tapData(mine, theirs)).failure, "forged_callback");
  // Their prompt is untouched and still theirs to answer.
  assert.equal((await loadOpenPrompt(other.profileId, clock))?.id, theirPrompt!.id);

  for (const data of ["start:Deadlocks:25", "p:nope:a", `p:${theirPrompt!.id}:z`, "p::", "end:crushed_it"]) {
    assert.equal((await tapData(mine, data)).failure, "forged_callback", data);
  }
  // A tap whose sender is not the chat.
  await send(mine, "/today");
  assert.equal((await tapData(mine, tg.data("Start 25 min"), other.chat)).failure, "forged_callback");

  assert.equal((await sessions(mine)).length + (await sessions(other)).length, 0);
  // resolvePrompt itself refuses a prompt that is not this learner's.
  assert.deepEqual(await resolvePrompt(mine.profileId, theirPrompt!.id, "a", "callback", clock), { ok: false, reason: "unknown" });
});

// ══════════════════════════════════════════════════════════════════════════════
// One session, two surfaces
// ══════════════════════════════════════════════════════════════════════════════

test("a session started on the web is the session Telegram sees, pauses and ends", async () => {
  const l = await seedLearner("Gus");
  const { tg, send, tap } = harness();
  const started = await runNovaSessionCommand(l.chat, { action: "start", topicName: "Deadlocks", subjectName: "Operating Systems", plannedMinutes: 45 }, clock);
  assert.ok(started.ok);
  tick(10);

  await send(l, "/status");
  assert.ok(tg.last().text.startsWith("Running: Deadlocks, 10 of 45 min."), tg.last().text);

  await tap(l, "Pause");
  assert.equal((await loadNovaSession(l.chat, clock))?.status, "paused");
  tick(5);
  await tap(l, "Resume");
  tick(12);

  // /focus while one is running starts nothing.
  await send(l, "/focus");
  assert.ok(tg.last().text.startsWith("You already have one going."));
  assert.equal((await sessions(l)).length, 1);

  await send(l, "/done");
  assert.equal(tg.last().text, "Deadlocks. How did it go?");
  assert.deepEqual(tg.labels(), ["Struggled", "Okay", "Good", "Crushed it"]);
  assert.equal((await loadNovaSession(l.chat, clock))?.status, "in_progress", "asking is not ending");

  await tap(l, "Good");
  const [row] = await sessions(l);
  assert.equal(row!.status, "completed");
  assert.equal(row!.durationMinutes, 22, "paused time is not study time");
  assert.equal((row!.executionReport as { outcome: string; evidenceBasis: string }).outcome, "good");
  assert.equal((row!.executionReport as { evidenceBasis: string }).evidenceBasis, "learner_outcome");
  assert.equal(await loadNovaSession(l.chat, clock), null);
  assert.equal(tg.last().text, "Logged: 22 min on Deadlocks. Good.");
});

test("Struggled on Telegram reaches mastery, its history, Learning DNA, consolidation, Knowledge and tomorrow's plan", async () => {
  const l = await seedLearner("Hal");
  const { tg, send, tap } = harness();
  const before = await deadlocks(l);
  await send(l, "/today");
  await tap(l, "Start 25 min");
  tick(27);
  await send(l, "/done");
  const trace = await tap(l, "Struggled");

  // SessionExecutionReport on the session row.
  const [row] = await sessions(l);
  const report = row!.executionReport as { outcome: string; masteryUpdates: unknown[]; actualDurationMinutes: number };
  assert.deepEqual([row!.status, report.outcome, report.actualDurationMinutes, report.masteryUpdates.length], ["completed", "struggled", 27, 1]);
  assert.deepEqual([trace.operation.name, trace.operation.ok], ["session_end", true]);
  assert.equal(tg.last().text, "Logged: 27 min on Deadlocks. Struggled. It comes back for review tomorrow.");

  // Mastery moved through the canonical writer: a full review, interval reset.
  const after = await deadlocks(l);
  assert.ok(after.masteryProbability < before.masteryProbability, `${before.masteryProbability} → ${after.masteryProbability}`);
  assert.equal(after.reviewCount, before.reviewCount + 1);
  assert.equal(after.intervalDays, 1);
  assert.ok(Math.abs(after.nextReviewAt!.getTime() - (clock.getTime() + 86_400_000)) < 5 * MIN, "due again tomorrow");

  // History: one record, tied to this session.
  const history = await prisma.novaTopicMasterySnapshot.findMany({ where: { topicId: l.deadlocksId } });
  assert.deepEqual(history.map(h => [h.source, h.sessionId, h.masteryBefore, h.masteryAfter]), [["session_report", row!.id, before.masteryProbability, after.masteryProbability]]);

  // Learning DNA was recomputed from this session.
  const dna = await prisma.novaLearningDNA.findUnique({ where: { profileId: l.profileId } });
  assert.equal(dna?.computedAt?.getTime(), clock.getTime());

  // The end is in the conversation log, marked as coming from Telegram, and consolidated.
  const closing = await prisma.companionMessage.findFirstOrThrow({ where: { userId: l.userId, role: "user" }, orderBy: { createdAt: "desc" } });
  assert.equal((closing.metadata as { surface?: string }).surface, "telegram");
  assert.deepEqual((await jobs(l)).map(j => j.status), ["completed"]);
  // A session is evidence about a topic, not a belief about the learner.
  assert.equal(await facts(l) + await patterns(l), 0);

  // Knowledge shows it; tomorrow's Today and Planner put it back in front.
  const knowledge = await loadNovaKnowledge(l.chat, { now: clock });
  assert.equal(knowledge.status, "ready");
  const tomorrow = new Date(clock.getTime() + 25 * 3_600_000);
  const today = await loadNovaToday(l.chat, { now: tomorrow });
  assert.ok(today.status === "ready" && today.reviewDue.topics.some(t => t.topicName === "Deadlocks"), "due for review tomorrow");
  const planner = await loadNovaPlanner(l.chat, { now: tomorrow });
  assert.ok(planner.status === "ready");
});

test("two ends at once close the session once: one report, one mastery record", async () => {
  const l = await seedLearner("Ian");
  const { tg, send, tap, tapData } = harness();
  await send(l, "/today");
  await tap(l, "Start 25 min");
  tick(20);
  await send(l, "/done");
  const good = tg.data("Good");

  // The Telegram tap and the web app's End button, together.
  const [telegram, web] = await Promise.all([
    tapData(l, good),
    runNovaSessionCommand(l.chat, { action: "end", outcome: "okay" }, clock),
  ]);
  const rows = await sessions(l);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.status, "completed");
  assert.equal(await prisma.novaTopicMasterySnapshot.count({ where: { topicId: l.deadlocksId } }), 1, "the topic moved once");
  // Exactly one of them recorded the end; the other was told so.
  const telegramEnded = telegram.operation.ok === true;
  const webEnded      = web.ok && web.ended !== null;
  assert.equal(Number(telegramEnded) + Number(webEnded), 1);
  // The one that came second is told the truth: there was nothing left to end.
  if (!telegramEnded) assert.ok(["That session was already closed. Nothing was logged twice.", "Nothing is running. /focus starts a session."].includes(tg.last().text));
});

test("a start from Telegram and a start from the web at the same moment leave one session", async () => {
  const l = await seedLearner("Jo");
  const { tg, send, tapData } = harness();
  await send(l, "/today");
  const start = tg.data("Start 25 min");
  await Promise.all([
    tapData(l, start),
    runNovaSessionCommand(l.chat, { action: "start", topicName: "Paging", subjectName: "Operating Systems", plannedMinutes: 15 }, clock),
  ]);
  assert.equal((await sessions(l)).filter(s => s.status !== "completed").length, 1);
});

// ══════════════════════════════════════════════════════════════════════════════
// Words: one reading, then the same actions
// ══════════════════════════════════════════════════════════════════════════════

test("\"bro I'm fucked, exam is tomorrow and I've only got 30 mins\": understood once, decided by code, and it changes state", async () => {
  const l = await seedLearner("Kai", { exam: true });
  const { tg, ai, send, tap } = harness();
  const text = "bro I'm fucked, exam is tomorrow and I've only got 30 mins";
  const tomorrow = dayKey(new Date(clock.getTime() + 26 * 3_600_000), "Asia/Kolkata");
  ai.read(text, {
    ...BASE, intent: "exam_anxiety", emotion: "anxious_exam", disclosureClass: "study_context", routingSignal: "exam_engine",
    request: { ...REQ, action: "what_now", availableMinutes: 30, exam: { title: "Operating Systems", date: tomorrow } },
  });
  const trace = await send(l, text);

  // 1–2. One reading, made with context.
  assert.equal(ai.seen.length, 1);
  assert.deepEqual(ai.seen[0]!.context, { today: ai.seen[0]!.context!.today, session: "none", sessionTopic: null, openPrompt: null });
  assert.ok(ai.seen[0]!.context!.today.endsWith(dayKey(clock, "Asia/Kolkata")));
  // 5–7. The decision is code's; the Response Brain is asked once, to word it.
  assert.equal(trace.decision, "show_today:asked_what_now");
  assert.equal(ai.worded.length, 1, "no more than two model calls in the turn");
  assert.ok(ai.worded[0]!.includes("Register: serious"), "exam tomorrow and anxious: no jokes");
  assert.ok(ai.worded[0]!.includes("Decided action (word this, do not change it)"));
  assert.ok(ai.worded[0]!.includes("Deadlocks (Operating Systems)"), "the recommendation is given to the model, not chosen by it");
  assert.equal(tg.last().text, "WORDED(1)");
  // Only lengths that fit thirty minutes are offered.
  assert.deepEqual(tg.labels(), ["Start 15 min", "Start 25 min", "Something else", "Later"]);
  // The exam is already on record, so Nova does not ask to add it again.
  assert.equal(await prisma.novaExam.count({ where: { profileId: l.profileId } }), 1);

  // 3. Nothing became a permanent belief about the learner.
  assert.equal(await facts(l) + await patterns(l), 0);
  assert.equal(await prisma.userReality.count({ where: { userId: l.userId } }), 0);
  // The message is logged, with what it was read as, and its consolidation ran.
  const logged = await prisma.companionMessage.findFirstOrThrow({ where: { userId: l.userId, role: "user" } });
  assert.deepEqual([logged.text, logged.intent, logged.emotion], [text, "exam_anxiety", "anxious_exam"]);
  assert.deepEqual((await jobs(l)).map(j => j.status), ["completed"]);
  assert.ok(trace.evidence.consolidationQueued);

  // "30 minutes" is now true for today on every surface, not only in this chat.
  const today = await loadNovaToday(l.chat, { now: clock });
  assert.ok(today.status === "ready" && today.availableMinutes === 30 && today.plan.budgetBasis === "stated_time");
  const planner = await loadNovaPlanner(l.chat, { now: clock });
  assert.ok(planner.status === "ready");
  // …and lapses when the learner's day ends.
  const nextDay = await loadNovaToday(l.chat, { now: new Date(clock.getTime() + 26 * 3_600_000) });
  assert.ok(nextDay.status === "ready" && nextDay.availableMinutes === null);

  // 8–15. The offered action starts the canonical session; "Struggled" ends it.
  await tap(l, "Start 25 min");
  tick(26);
  await send(l, "/done");
  await tap(l, "Struggled");
  const [row] = await sessions(l);
  assert.equal((row!.executionReport as { outcome: string }).outcome, "struggled");
  assert.equal((await deadlocks(l)).intervalDays, 1);
  assert.equal(await prisma.novaTopicMasterySnapshot.count({ where: { topicId: l.deadlocksId, sessionId: row!.id } }), 1);

  // 17–18. "what should I study?" the next day uses what happened.
  ai.read("what should I study?", { ...BASE, intent: "plan_request", request: { ...REQ, action: "what_now" } });
  tick(25 * 60);
  await send(l, "what should I study?");
  assert.ok(tg.last().text.startsWith("Deadlocks (Operating Systems)"), tg.last().text);
  const later = await loadNovaToday(l.chat, { now: clock });
  assert.ok(later.status === "ready" && later.reviewDue.topics.some(t => t.topicName === "Deadlocks"), "yesterday's Struggled made it due again");
  assert.ok(later.status === "ready" && tg.last().text.includes(later.recommendation!.reasons[0]!), tg.last().text);
  assert.equal(ai.worded.length, 1, "a plain question gets a plain answer: no second wording call");
});

test("an exam Nova does not have is offered, added only on the tap, and only once", async () => {
  const l = await seedLearner("Lu");
  const { tg, ai, send, tap } = harness();
  const friday = dayKey(new Date(clock.getTime() + 3 * 86_400_000), "Asia/Kolkata");
  ai.read("I have my OS exam Friday", { ...BASE, intent: "exam_anxiety", request: { ...REQ, exam: { title: "OS", date: friday } } });
  await send(l, "I have my OS exam Friday");

  assert.equal(await prisma.novaExam.count({ where: { profileId: l.profileId } }), 0, "a reading adds nothing");
  assert.deepEqual(tg.labels(), [`Add exam (${friday})`, "No"]);
  await tap(l, `Add exam (${friday})`);
  const exams = await prisma.novaExam.findMany({ where: { profileId: l.profileId } });
  assert.deepEqual(exams.map(e => [e.title, e.subjectId, dayKey(e.scheduledAt, "Asia/Kolkata")]), [["OS", l.subjectId, friday]]);

  // The plan now knows.
  const today = await loadNovaToday(l.chat, { now: clock });
  assert.ok(today.status === "ready" && today.nextDeadline?.title === "OS");

  // Said again: already known, so nothing is offered.
  await send(l, "I have my OS exam Friday");
  assert.ok(!tg.labels().some(label => label.startsWith("Add exam")));
  assert.equal(await prisma.novaExam.count({ where: { profileId: l.profileId } }), 1);
});

test("\"I can't study tonight, family stuff came up\" becomes a temporary constraint, quiets Nova, and resolves", async () => {
  const l = await seedLearner("Mia");
  const { tg, ai, send } = harness();
  const text = "I can't study tonight, family stuff came up";
  ai.read(text, {
    ...BASE, intent: "life_disclosure", disclosureClass: "life_event", routingSignal: "reality_extraction",
    request: { ...REQ, action: "not_now", deferUntil: "tomorrow" },
    reality: [{ about: "self", category: "life_constraint", subtype: "family", claim: "Student has a family matter tonight", status: "active", persistence: "temporary", expectedDurationHours: 12, confidence: 0.9 }],
  });
  const trace = await send(l, text);

  // Captured as reality, through consolidation, with an end.
  const reality = await prisma.userReality.findMany({ where: { userId: l.userId } });
  assert.deepEqual(reality.map(r => [r.category, r.subtype, r.isActive, r.resolvedAt]), [["life_constraint", "family", true, null]]);
  assert.ok(reality[0]!.expiresAt.getTime() - clock.getTime() <= 72 * 3_600_000, "it expires by itself");
  assert.equal(await facts(l), 0, "not a permanent fact about the learner");
  assert.ok(trace.evidence.kinds.includes("reality_claim"));
  // A circumstance is answered by Nova, not by a template.
  assert.equal(tg.last().text, "WORDED(1)");
  assert.ok(ai.worded[0]!.includes("Register: serious"));

  // "Not tonight" is also honoured directly: nothing proactive before the day ends.
  assert.ok((await channel(l)).proactivePausedUntil! > clock);

  // The proactive tick, at their usual hour with a review due, stays silent
  // and stores nothing.
  await prisma.novaAcademicProfile.update({ where: { id: l.profileId }, data: { timezone: zoneWhereHourIs(18), preferredStudyTime: "evening" } });
  await prisma.novaTelegramChannel.update({ where: { profileId: l.profileId }, data: { proactivePausedUntil: null } });
  await prisma.companionMessage.updateMany({ where: { userId: l.userId }, data: { createdAt: new Date(clock.getTime() - 2 * 3_600_000) } });
  const quiet = fakeTelegram();
  await runNovaProactiveCron(clock, { client: quiet.client, word: async () => ({ text: "x", generated: false }) });
  assert.equal(quiet.sent.filter(s => s.chatId === l.chat).length, 0, "no study pressure while the constraint is active");
  assert.equal((await outbox(l)).length, 0, "a decision not to send is not stored");
  // The web Home shows the same constraint.
  const today = await loadNovaToday(l.chat, { now: clock });
  assert.ok(today.status === "ready" && today.constraints.some(c => c.category === "life_constraint"));

  // Later: it is over.
  ai.read("family thing is sorted, I'm back", {
    ...BASE, intent: "life_disclosure", disclosureClass: "life_event",
    reality: [{ about: "self", category: "life_constraint", subtype: "family", claim: "Family matter is over", status: "resolved", persistence: "temporary", expectedDurationHours: null, confidence: 0.9 }],
  });
  tick(60);
  await send(l, "family thing is sorted, I'm back");
  const resolved = await prisma.userReality.findFirstOrThrow({ where: { userId: l.userId } });
  assert.equal(resolved.isActive, false);
  assert.ok(resolved.resolvedAt);
});

test("\"I keep fucking up deadlocks\" nudges the topic through consolidation, once a day, and creates no belief", async () => {
  const l = await seedLearner("Ned");
  const { tg, ai, send } = harness();
  const before = await deadlocks(l);
  const text = "I keep fucking up deadlocks";
  ai.read(text, { ...BASE, intent: "emotional_vent", emotion: "frustrated", topic: "deadlocks", topicConfidence: 0.9, request: { ...REQ, struggleTopic: "deadlocks" } });
  const trace = await send(l, text);

  const after = await deadlocks(l);
  // The Knowledge Engine's soft path: the number moves a little, nothing else does.
  assert.equal(after.masteryProbability, Math.round((0.85 * before.masteryProbability + 0.15 * 0.3) * 100) / 100);
  assert.deepEqual([after.reviewCount, after.intervalDays, after.nextReviewAt?.getTime()], [before.reviewCount, before.intervalDays, before.nextReviewAt?.getTime()]);
  const history = await prisma.novaTopicMasterySnapshot.findMany({ where: { topicId: l.deadlocksId } });
  assert.deepEqual(history.map(h => [h.source, h.sessionId]), [["conversation_signal", null]]);
  assert.ok(trace.evidence.kinds.includes("signal:topic_struggle"));
  // No "this student is bad at deadlocks", and no pattern from one sentence.
  assert.equal(await facts(l), 0);
  assert.equal(await prisma.behavioralPattern.count({ where: { userId: l.userId, status: "active" } }), 0);
  assert.equal(tg.last().text, "WORDED(1)");

  // Said again an hour later: logged, but the topic does not move twice.
  tick(60);
  await send(l, text);
  assert.equal((await deadlocks(l)).masteryProbability, after.masteryProbability);
  assert.equal(await prisma.novaTopicMasterySnapshot.count({ where: { topicId: l.deadlocksId } }), 1);

  // Knowledge and Today see the lower number.
  const today = await loadNovaToday(l.chat, { now: clock });
  assert.ok(today.status === "ready" && today.weakArea?.topicName === "Deadlocks" && today.weakArea.masteryPercent === Math.round(after.masteryProbability * 100));
});

test("short replies are read against the open question, or not at all", async () => {
  const l = await seedLearner("Oz");
  const { tg, ai, send, tapData } = harness();

  // "yeah" with nothing asked.
  ai.read("yeah", { ...BASE, ambiguityScore: 0.9, request: { ...REQ, action: "none", confidence: 0.2 } });
  await send(l, "yeah");
  assert.equal(tg.last().text, "Not sure what you need there. Pick one:");
  assert.equal((await sessions(l)).length, 0);

  // A model that answers a question nobody asked is not believed.
  ai.read("yes", { ...BASE, ambiguityScore: 0.9, request: { ...REQ, action: "start_session", confidence: 0.3, promptAnswer: "a" } });
  await send(l, "/help");            // no open prompt after this
  await prisma.novaTelegramPrompt.updateMany({ where: { profileId: l.profileId }, data: { openKey: null, resolvedAt: clock } });
  await send(l, "yes");
  assert.equal((await sessions(l)).length, 0);

  // Now Nova asks, and "make it 20" then "yeah" are about that offer.
  await send(l, "/today");
  ai.read("make it 20 mins", { ...BASE, request: { ...REQ, availableMinutes: 20 } });
  await send(l, "make it 20 mins");
  assert.deepEqual(ai.seen.at(-1)!.context!.openPrompt?.options.map(o => o.label), ["Start 15 min", "Start 25 min", "Start 45 min", "Something else", "Later"]);
  assert.deepEqual(tg.labels(), ["Start 15 min", "Something else", "Later"]);
  const offered = tg.data("Start 15 min");

  ai.read("yeah let's do that", { ...BASE, request: { ...REQ, action: "start_session", promptAnswer: "a" } });
  const trace = await send(l, "yeah let's do that");
  assert.equal(trace.decision, "answer_prompt:answered_open_prompt");
  const [row] = await sessions(l);
  assert.deepEqual([row!.status, row!.topicName, row!.plannedDurationMinutes], ["in_progress", "Deadlocks", 15]);
  // The typed answer used the prompt up: the button under it is now closed.
  assert.equal((await tapData(l, offered)).failure, "stale_prompt");
  assert.equal((await sessions(l)).length, 1);

  // "done" while it runs asks; it does not end.
  ai.read("done", { ...BASE, intent: "study_report", request: { ...REQ, action: "finish_session" } });
  tick(15);
  await send(l, "done");
  assert.equal(ai.seen.at(-1)!.context!.session, "running");
  assert.equal(tg.last().text, "Deadlocks. How did it go?");
  assert.equal((await loadNovaSession(l.chat, clock))?.status, "in_progress");

  // "finished but sucked" answers the question that is now open.
  ai.read("finished but sucked", { ...BASE, intent: "study_report", request: { ...REQ, action: "finish_session", sessionOutcome: "struggled", promptAnswer: "a" } });
  await send(l, "finished but sucked");
  const ended = (await sessions(l))[0]!;
  assert.deepEqual([ended.status, (ended.executionReport as { outcome: string }).outcome], ["completed", "struggled"]);

  // "done" with nothing running is a report, not an end.
  tick(240);
  await send(l, "done");
  assert.ok(tg.last().text.startsWith("Noted. There was no timer running"));
});

test("a start asked for in words runs only when the reading is confident", async () => {
  const l = await seedLearner("Pam");
  const { tg, ai, send } = harness();
  ai.read("maybe I should study?", { ...BASE, request: { ...REQ, action: "start_session", confidence: 0.6 } });
  await send(l, "maybe I should study?");
  assert.equal((await sessions(l)).length, 0, "offered, not started");
  assert.ok(tg.labels().includes("Start 25 min"));

  ai.read("ok starting OS now, 20 mins", { ...BASE, topic: "OS", sessionIntent: "start", request: { ...REQ, action: "start_session", confidence: 0.95, availableMinutes: 20 } });
  await send(l, "ok starting OS now, 20 mins");
  const [row] = await sessions(l);
  // "OS" is a subject: the plan's own block for it is what starts.
  assert.deepEqual([row!.status, row!.topicName, row!.subjectId, row!.plannedDurationMinutes], ["in_progress", "Deadlocks", l.subjectId, 20]);
  assert.equal((await sessions(l)).length, 1, "the turn itself did not open a second one");
});

// ══════════════════════════════════════════════════════════════════════════════
// The model can be wrong; the state stays right
// ══════════════════════════════════════════════════════════════════════════════
// The readings marked "real" are what the model returned in the evaluation
// run of 2026-10-06, including the wrong ones.

// Everything a message could have changed, for comparing before and after.
async function stateOf(l: Learner) {
  const [sessionRows, topics, exams, reality, factCount, patternCount, jobRows, profile, ch, proactive] = await Promise.all([
    sessions(l),
    prisma.novaTopicMastery.findMany({ where: { subjectId: l.subjectId }, orderBy: { name: "asc" }, select: { name: true, masteryProbability: true, reviewCount: true, intervalDays: true, nextReviewAt: true, lastStudiedAt: true } }),
    prisma.novaExam.count({ where: { profileId: l.profileId } }),
    prisma.userReality.count({ where: { userId: l.userId } }),
    facts(l), patterns(l),
    prisma.novaConsolidationJob.count({ where: { userId: l.userId } }),
    prisma.novaAcademicProfile.findUniqueOrThrow({ where: { id: l.profileId }, select: { statedMinutes: true, statedMinutesDay: true } }),
    prisma.novaTelegramChannel.findUnique({ where: { profileId: l.profileId }, select: { proactiveEnabled: true, proactivePausedUntil: true } }),
    prisma.novaProactiveMessage.count({ where: { profileId: l.profileId } }),
  ]);
  return {
    sessions: sessionRows.map(r => [r.id, r.status, r.totalPausedSeconds]), topics, exams, reality, factCount, patternCount, jobRows, profile,
    snapshots: await prisma.novaTopicMasterySnapshot.count({ where: { topic: { subjectId: l.subjectId } } }),
    dna: await prisma.novaLearningDNA.count({ where: { profileId: l.profileId } }),
    nudges: ch ? [ch.proactiveEnabled, ch.proactivePausedUntil?.toISOString() ?? null] : null, proactive,
  };
}

test("gibberish changes nothing, whatever the model claims to have found in it", async () => {
  const l = await seedLearner("Gib");
  const { tg, ai, send } = harness();
  await send(l, "/status");                       // creates the channel row, so before/after compare like with like
  const idle = await stateOf(l);

  // The model says "unintelligible" and still fills in an action, a topic, a
  // struggle, an exam, an outcome, minutes and an illness.
  const loaded = {
    ...BASE, intent: "study_report", emotion: "distressed", topic: "Deadlocks", topicConfidence: 1, sessionIntent: "start", secondaryIntents: ["mastery_claim"],
    reality: [{ about: "self", category: "health", subtype: "illness", claim: "Student is ill", status: "active", persistence: "temporary", expectedDurationHours: null, confidence: 1 }],
    request: { ...REQ, clarity: "unintelligible", action: "start_session", confidence: 1, promptAnswer: "a", availableMinutes: 45, sessionOutcome: "crushed_it",
      deferUntil: "tomorrow", struggleTopic: "Deadlocks", exam: { title: "OS", date: dayKey(new Date(clock.getTime() + 3 * 86_400_000), "Asia/Kolkata") } },
  };
  for (const text of ["asdfghjkl", "????", "123123", "skibidi 92837", "deadlocks asdf"]) {
    ai.read(text, loaded);
    const trace = await send(l, text);
    assert.equal(trace.decision, "clarify:unintelligible");
    // /status left its buttons up, so those are the options: nothing new is opened.
    assert.equal(tg.last().text, "I didn't catch that. The buttons above still work, or tell me in a few more words.");
    assert.equal(tg.last().buttons.length, 0);
    assert.deepEqual(trace.evidence, { kinds: [], consolidationQueued: false });
  }
  // With nothing open, the fixed choices.
  await prisma.novaTelegramPrompt.updateMany({ where: { profileId: l.profileId }, data: { openKey: null, resolvedAt: clock } });
  await send(l, "asdfghjkl");
  assert.equal(tg.last().text, "Not sure what you need there. Pick one:");
  assert.deepEqual(tg.labels(), ["What should I do?", "Where do I stand?", "Nothing"]);
  assert.deepEqual(await stateOf(l), idle, "idle: nothing moved");
  assert.equal(ai.worded.length, 0, "noise is never sent to the Response Brain");
  // It is in the conversation log, and nowhere else.
  assert.equal(await prisma.companionMessage.count({ where: { userId: l.userId, role: "user" } }), 6);

  // With an offer open: the offer stays open and nothing starts.
  await send(l, "/today");
  const offer = tg.data("Start 25 min");
  await send(l, "asdfghjkl");
  assert.equal(tg.last().text, "I didn't catch that. The buttons above still work, or tell me in a few more words.");
  assert.equal(tg.last().buttons.length, 0);
  assert.deepEqual(await stateOf(l), idle);

  // With a session running: it keeps running, untouched, and nothing is asked of it.
  await harness().tapData(l, offer);
  const running = await stateOf(l);
  assert.equal(running.sessions.length, 1);
  tick(5);
  await send(l, "????");
  assert.deepEqual(await stateOf(l), running, "running: nothing moved");
  assert.equal((await loadNovaSession(l.chat, clock))?.status, "in_progress");
  await runNovaSessionCommand(l.chat, { action: "end", outcome: "okay" }, clock, "web");
});

test("\"I finished deadlocks\" while a session runs asks how it went, and only the answer ends it", async () => {
  const l = await seedLearner("Fin");
  const { tg, ai, send, tap } = harness();
  await send(l, "/today");
  await tap(l, "Start 25 min");
  tick(20);

  // real: a study report with no request and no outcome.
  ai.read("I finished deadlocks", { ...BASE, intent: "study_report", emotion: "proud", topic: "Deadlocks", topicConfidence: 1, request: { ...REQ, action: "none", confidence: 1 } });
  const trace = await send(l, "I finished deadlocks");
  assert.equal(trace.decision, "ask_outcome:report_during_session");
  assert.equal(tg.last().text, "Deadlocks. How did it go?");
  assert.deepEqual(tg.labels(), ["Struggled", "Okay", "Good", "Crushed it"]);
  // Asked, not ended: no report, no mastery, no history yet.
  const open = (await sessions(l))[0]!;
  assert.equal(open.status, "in_progress");
  assert.equal(open.executionReport, null);
  assert.equal(await prisma.novaTopicMasterySnapshot.count({ where: { topicId: l.deadlocksId } }), 0);
  assert.equal(ai.worded.length, 0);

  // The answer goes through the same end the web app uses.
  await tap(l, "Good");
  const ended = (await sessions(l))[0]!;
  assert.deepEqual([ended.status, (ended.executionReport as { outcome: string }).outcome, ended.durationMinutes], ["completed", "good", 20]);
  assert.equal(await prisma.novaTopicMasterySnapshot.count({ where: { topicId: l.deadlocksId, sessionId: ended.id } }), 1);
  assert.equal((await loadNovaSession(l.chat, clock)), null, "the web app sees it closed too");
});

test("a stated time never starts a session, however sure the model is that it should", async () => {
  const l = await seedLearner("Tim");
  const { tg, ai, send } = harness();

  // real: "bro I have 30 mins" read as a confident start.
  ai.read("bro I have 30 mins", { ...BASE, intent: "accountability_request", emotion: "motivated", sessionIntent: "start", request: { ...REQ, action: "start_session", confidence: 0.9, availableMinutes: 30 } });
  const trace = await send(l, "bro I have 30 mins");
  assert.equal(trace.decision, "offer_start:start_needs_confirmation");
  assert.equal((await sessions(l)).length, 0, "nothing started");
  assert.deepEqual(tg.labels(), ["Start 15 min", "Start 25 min", "Something else", "Later"]);
  // What was actually said is kept: thirty minutes, for today, on every surface.
  const today = await loadNovaToday(l.chat, { now: clock });
  assert.ok(today.status === "ready" && today.availableMinutes === 30);

  // A confident start that names something the plan does not have is offered too.
  ai.read("start quantum basket weaving for 25", { ...BASE, topic: "quantum basket weaving", topicConfidence: 0.9, sessionIntent: "start", request: { ...REQ, action: "start_session", confidence: 1, availableMinutes: 25 } });
  await send(l, "start quantum basket weaving for 25");
  assert.equal((await sessions(l)).length, 0, "a word from a sentence is not a session");
  assert.ok(tg.last().text.startsWith("quantum basket weaving"), tg.last().text);

  // The one start words can make: asked for outright, by a name the plan knows.
  ai.read("start deadlocks for 25", { ...BASE, topic: "deadlocks", topicConfidence: 1, sessionIntent: "start", request: { ...REQ, action: "start_session", confidence: 1, availableMinutes: 25 } });
  await send(l, "start deadlocks for 25");
  const [row] = await sessions(l);
  assert.deepEqual([row!.status, row!.topicName, row!.subjectId, row!.plannedDurationMinutes], ["in_progress", "Deadlocks", l.subjectId, 25]);
  assert.ok(tg.last().text.startsWith("Started."), "said after the row exists");
  await runNovaSessionCommand(l.chat, { action: "end", outcome: "okay" }, clock, "web");
});

test("changing an open offer re-offers it at that length and starts nothing", async () => {
  // real readings, each wrong in a different way.
  const cases: Array<[string, Record<string, unknown>, number, string[]]> = [
    ["make it 20 mins",             { ...REQ, action: "start_session", confidence: 0.95, availableMinutes: 20 }, 20, ["Start 15 min", "Something else", "Later"]],
    ["actually I only got 10 mins", { ...REQ, action: "something_else", confidence: 0.9, availableMinutes: 10, promptAnswer: "c" }, 10, ["Start 10 min", "Something else", "Later"]],
    ["nah actually make it 20",     { ...REQ, action: "start_session", confidence: 0.95, availableMinutes: 20, promptAnswer: "c" }, 20, ["Start 15 min", "Something else", "Later"]],
  ];
  for (const [text, request, minutes, labels] of cases) {
    const l = await seedLearner("Chg");
    const { tg, ai, send, tap } = harness();
    await send(l, "/today");
    const before = tg.last().text;
    ai.read(text, { ...BASE, intent: "plan_request", request });
    const trace = await send(l, text);
    assert.equal(trace.decision, "show_today:offer_changed", text);
    assert.equal((await sessions(l)).length, 0, `${text}: nothing started`);
    assert.deepEqual(tg.labels(), labels, text);
    assert.equal(tg.last().text.split("\n")[0], before.split("\n")[0], `${text}: the same topic, not a different one`);
    const today = await loadNovaToday(l.chat, { now: clock });
    assert.ok(today.status === "ready" && today.availableMinutes === minutes, `${text}: the stated time reaches Today and the Planner`);
    // Accepting is a separate act.
    await tap(l, labels[0]!);
    assert.equal((await sessions(l)).length, 1);
    await runNovaSessionCommand(l.chat, { action: "end", outcome: "okay" }, clock, "web");
  }
});

test("typed \"not today\" quiets Nova until the learner's midnight, with or without an offer open", async () => {
  const l = await seedLearner("Nat");
  const { tg, ai, send } = harness();
  ai.read("not today", { ...BASE, intent: "commitment_made", emotion: "avoidant", request: { ...REQ, action: "not_now", confidence: 0.95, deferUntil: "tomorrow" } });
  await send(l, "not today");
  assert.equal(tg.last().text, "Got it. Nothing more from me today.");
  const paused = (await channel(l)).proactivePausedUntil!;
  assert.ok(paused > clock);
  assert.equal(dayKey(paused, "Asia/Kolkata"), dayKey(new Date(clock.getTime() + 86_400_000), "Asia/Kolkata"));
  assert.notEqual(dayKey(new Date(paused.getTime() - 1), "Asia/Kolkata"), dayKey(paused, "Asia/Kolkata"), "the first instant of tomorrow");

  // Against an offer whose only decline is "Later" (real: the model picks it).
  const m = await seedLearner("Nan");
  const second = harness();
  await second.send(m, "/today");
  second.ai.read("nah not today", { ...BASE, intent: "commitment_made", request: { ...REQ, action: "not_now", confidence: 1, deferUntil: "tomorrow", promptAnswer: "e" } });
  const trace = await second.send(m, "nah not today");
  assert.equal(trace.decision, "defer:declined_for_today");
  assert.ok((await channel(m)).proactivePausedUntil! > clock);

  // "later" is only later.
  const n = await seedLearner("Lat");
  const third = harness();
  await third.send(n, "/today");
  third.ai.read("later", { ...BASE, request: { ...REQ, action: "not_now", confidence: 1, deferUntil: "later", promptAnswer: "e" } });
  await third.send(n, "later");
  assert.equal(third.tg.last().text, "OK. It'll keep.");
  assert.equal((await channel(n)).proactivePausedUntil, null);
});

test("\"exam is tomorrow\" cannot make a second exam", async () => {
  const l = await seedLearner("Exa", { exam: true });      // Operating Systems final, tomorrow
  const { tg, ai, send } = harness();
  const tomorrow = dayKey(new Date(clock.getTime() + 26 * 3_600_000), "Asia/Kolkata");
  // real: the model titles it "exam", and "OS exam" for the second phrase.
  for (const [text, title] of [["exam is tomorrow", "exam"], ["my OS exam is tomorrow", "OS exam"], ["cs final tmrw", "final"]] as const) {
    ai.read(text, { ...BASE, intent: "exam_anxiety", emotion: "anxious_exam", request: { ...REQ, exam: { title, date: tomorrow } } });
    await send(l, text);
    assert.ok(!tg.labels().some(label => label.startsWith("Add exam")), `${text}: not offered`);
  }
  assert.equal(await prisma.novaExam.count({ where: { profileId: l.profileId } }), 1);

  // With no exam on record, a subject-less "exam" is still not offered: there is nothing to file it under.
  const m = await seedLearner("Exb");
  const second = harness();
  second.ai.read("exam is tomorrow", { ...BASE, intent: "exam_anxiety", emotion: "anxious_exam", request: { ...REQ, exam: { title: "exam", date: tomorrow } } });
  await second.send(m, "exam is tomorrow");
  assert.ok(!second.tg.labels().some(label => label.startsWith("Add exam")));
  assert.equal(await prisma.novaExam.count({ where: { profileId: m.profileId } }), 0);
  // The Response Brain is told nothing was done, so it cannot say it was.
  assert.ok(second.ai.worded.at(-1)!.includes("took no action this turn"), second.ai.worded.at(-1));
});

test("a message that takes itself back starts nothing", async () => {
  const l = await seedLearner("Con");
  const { tg, ai, send } = harness();
  ai.read("start deadlocks for 30 but don't start yet", { ...BASE, topic: "deadlocks", topicConfidence: 1, sessionIntent: "start", request: { ...REQ, changeOfMind: true, action: "start_session", confidence: 0.95, availableMinutes: 30 } });
  const trace = await send(l, "start deadlocks for 30 but don't start yet");
  assert.equal(trace.decision, "offer_start:start_needs_confirmation");
  assert.equal((await sessions(l)).length, 0);
  assert.ok(tg.labels().includes("Start 25 min"));

  // "wait, don't" against the offer, with the model still picking Start.
  ai.read("wait, don't start yet", { ...BASE, request: { ...REQ, changeOfMind: true, action: "start_session", confidence: 0.9, promptAnswer: "a" } });
  await send(l, "wait, don't start yet");
  assert.equal((await sessions(l)).length, 0);
});

test("the Response Brain is not asked to word an action that did not happen", async () => {
  const l = await seedLearner("Rsp");
  const { tg, ai, send, tap } = harness();
  await send(l, "/today");
  await tap(l, "Start 25 min");
  tick(3);

  // The session is ended on the web while the message is being read, so the
  // pause the message asks for has nothing to pause.
  const trace = await handleNovaTelegramEvent(say(l.chat, "ugh i need a break") as never, {
    client: tg.client, now: () => clock, webUrl: "https://nova.test", respond: ai.respond,
    understand: (async (text: string) => {
      await runNovaSessionCommand(l.chat, { action: "end", outcome: "okay" }, clock, "web");
      return parseUnderstandingResponse(JSON.stringify({ ...BASE, emotion: "overwhelmed", sessionIntent: "break", request: { ...REQ, action: "pause_session", confidence: 1 } }), text);
    }) as never,
  });
  assert.deepEqual(trace.operation, { name: "session_pause", ok: false });
  assert.equal(ai.worded.length, 0, "a failed action is stated plainly, never worded as if it worked");
  assert.equal(tg.last().text, "Nothing is running. /focus starts a session.");
  assert.equal((await sessions(l)).filter(r => r.status === "completed").length, 1);
});

// ══════════════════════════════════════════════════════════════════════════════
// Failure
// ══════════════════════════════════════════════════════════════════════════════

test("with the model down, commands and buttons still work and words do nothing", async () => {
  const l = await seedLearner("Quin");
  const { tg, ai, send, tap } = harness();
  ai.breakUnderstanding("throw");
  ai.breakResponse(true);

  const trace = await send(l, "start it");
  assert.deepEqual([trace.failure, trace.understanding.ok], ["understanding_failed", false]);
  assert.ok(tg.last().text.startsWith("I couldn't read that just now."));
  assert.equal((await sessions(l)).length, 0, "an unread message runs nothing");
  assert.equal(await prisma.companionMessage.count({ where: { userId: l.userId } }), 0);

  ai.breakUnderstanding("garbage");
  assert.equal((await send(l, "start it")).failure, "understanding_malformed");
  assert.equal((await sessions(l)).length, 0);

  // The whole protocol path, with no model at all.
  await send(l, "/today");
  await tap(l, "Start 25 min");
  tick(15);
  await send(l, "/done");
  await tap(l, "Okay");
  assert.equal((await sessions(l))[0]!.status, "completed");
  assert.equal(ai.worded.length, 0);
});

test("when the Response Brain fails, the action stands and the plain result is sent", async () => {
  const l = await seedLearner("Ray", { exam: true });
  const { tg, ai, send } = harness();
  ai.breakResponse(true);
  const text = "I'm so behind, I have 45 minutes, what do I do";
  ai.read(text, { ...BASE, intent: "exam_anxiety", emotion: "overwhelmed", request: { ...REQ, action: "what_now", availableMinutes: 45 } });
  const trace = await send(l, text);

  assert.deepEqual([trace.failure, trace.response.generated, trace.response.fallback], ["response_failed", true, true]);
  assert.ok(tg.last().text.startsWith("Deadlocks (Operating Systems)"), "the same facts, unworded");
  assert.ok(tg.labels().includes("Start 45 min"));
  // The turn was still recorded and consolidated.
  assert.equal(await prisma.companionMessage.count({ where: { userId: l.userId, role: "user" } }), 1);
  assert.deepEqual((await jobs(l)).map(j => j.status), ["completed"]);
  const stored = await prisma.novaAcademicProfile.findUniqueOrThrow({ where: { id: l.profileId } });
  assert.equal(stored.statedMinutes, 45);
});

test("one free-text turn at a time per chat, held in the database", async () => {
  const l = await seedLearner("Sol");
  const { tg, ai, send } = harness();
  await ensureChannel(l.profileId);
  // Another instance is in the middle of this learner's turn.
  assert.equal(await acquireTurn(l.profileId, clock), true);
  assert.equal(await acquireTurn(l.profileId, clock), false);

  ai.read("what now", { ...BASE, request: { ...REQ, action: "what_now" } });
  assert.equal((await send(l, "what now")).failure, "busy");
  assert.equal(tg.last().text, "Still on your last message. One moment.");
  assert.equal(ai.seen.length, 0);
  // Buttons and commands are not blocked by it.
  await send(l, "/today");
  assert.ok(tg.labels().includes("Start 25 min"));

  // A lease left by a process that died expires by itself.
  tick(2);
  assert.equal((await send(l, "what now")).failure, "none");
  await releaseTurn(l.profileId);
  assert.equal((await channel(l)).turnLockedUntil, null, "released when the turn ends");
});

test("limits: a flood of taps is dropped, and a spent model budget falls back to buttons", async () => {
  const l = await seedLearner("Tess");
  const { tg, ai, send } = harness();
  await send(l, "/today");
  const count = tg.sent.length;
  await prisma.novaTelegramChannel.update({ where: { profileId: l.profileId }, data: { actionWindowStart: clock, actionCount: 30 } });
  assert.equal((await send(l, "/today")).failure, "rate_limited");
  assert.equal(tg.sent.length, count, "no reply to a flood");
  tick(2);

  await prisma.novaTelegramChannel.update({ where: { profileId: l.profileId }, data: { usageDay: dayKey(clock, "Asia/Kolkata"), understandingCalls: 100000 } });
  assert.equal((await send(l, "what should I do")).failure, "budget_exhausted");
  assert.equal(ai.seen.length, 0, "past the budget the model is not asked");
  assert.ok(tg.last().text.includes("/today, /focus and /done all still work"));
});

test("a blocked bot is noticed and forgiven when the learner writes again", async () => {
  const l = await seedLearner("Uma");
  const { tg, send } = harness();
  tg.failNext({ ok: false, kind: "blocked", detail: "Forbidden: bot was blocked by the user" });
  const trace = await send(l, "/today");
  assert.deepEqual([trace.send.status, trace.send.failure, trace.failure], ["failed", "blocked", "send_failed"]);
  assert.ok((await channel(l)).undeliverableSince);
  assert.equal(await loadOpenPrompt(l.profileId, clock), null, "buttons nobody saw are not an open question");

  await send(l, "/today");
  assert.equal((await channel(l)).undeliverableSince, null);
  assert.ok(await loadOpenPrompt(l.profileId, clock));
});

test("before setup is finished, buttons and commands have nothing to act on", async () => {
  const chat = `${STAMP}99`;
  chats.push(chat);
  await prisma.messengerUser.create({ data: { platform: "telegram", platformChatId: chat, persona: "nova" } });
  const tg = fakeTelegram();
  const run = (event: ReturnType<typeof normalizeTelegramUpdate>) => handleNovaTelegramEvent(event as never, { client: tg.client, now: () => clock });
  await run(say(chat, "/today"));
  assert.equal(tg.last().text, "Finish setting up with Nova first. It takes a couple of minutes.");
  assert.equal((await run(tapUpdate(chat, "p:x:a"))).failure, "stale_prompt");
});

// ══════════════════════════════════════════════════════════════════════════════
// Linking
// ══════════════════════════════════════════════════════════════════════════════

async function webAccount(persona: string | null, token: string, expires: Date | null, chatId: string | null = null) {
  const user = await prisma.user.create({ data: { email: `tg_${STAMP}_${webUsers.length}@test.local` }, select: { id: true } });
  webUsers.push(user.id);
  const profile = await prisma.userProfile.create({
    data: { userId: user.id, primaryPersona: persona, telegramConnectToken: token, telegramConnectTokenExpiresAt: expires, telegramChatId: chatId, secondaryDomains: [], aspirationWords: [] },
    select: { id: true },
  });
  return profile.id;
}
const token = (n: number) => `${STAMP}`.padStart(16, "0") + `${n}`.padStart(16, "a");

test("linking: a token works once, in a private chat, before it expires, and makes a Nova chat", async () => {
  const chat = `${STAMP}71`;
  chats.push(chat);
  const profileId = await webAccount("nova", token(1), linkTokenExpiry(clock));

  assert.deepEqual(await linkTelegramChat(token(1), { id: chat, type: "group" }, clock), { status: "not_private" });
  assert.deepEqual(await linkTelegramChat("short", { id: chat, type: "private" }, clock), { status: "invalid" });
  assert.deepEqual(await linkTelegramChat(token(999), { id: chat, type: "private" }, clock), { status: "invalid" });

  // Two attempts with the same token at once: one links.
  const results = await Promise.all([
    linkTelegramChat(token(1), { id: chat, type: "private" }, clock),
    linkTelegramChat(token(1), { id: chat, type: "private" }, clock),
  ]);
  assert.deepEqual(results.map(r => r.status).sort(), ["invalid", "linked"]);
  assert.deepEqual(results.find(r => r.status === "linked"), { status: "linked", companion: "nova", profileId, onboarded: false });

  // The missing piece: the chat is now Nova's, so the webhook routes it to Nova.
  const messenger = await prisma.messengerUser.findUniqueOrThrow({ where: { platform_platformChatId: { platform: "telegram", platformChatId: chat } } });
  assert.equal(messenger.persona, "nova");
  const stored = await prisma.userProfile.findUniqueOrThrow({ where: { id: profileId } });
  assert.deepEqual([stored.telegramChatId, stored.telegramConnectToken, stored.telegramConnectTokenExpiresAt], [chat, null, null]);
  assert.deepEqual(await linkTelegramChat(token(1), { id: chat, type: "private" }, clock), { status: "invalid" }, "single use");
});

test("linking: expired tokens, undated tokens, a taken chat and a second chat are refused", async () => {
  const chat = `${STAMP}72`;
  chats.push(chat);
  await webAccount("nova", token(2), new Date(clock.getTime() - MIN));
  assert.deepEqual(await linkTelegramChat(token(2), { id: chat, type: "private" }, clock), { status: "expired" });
  assert.deepEqual(await linkTelegramChat(token(2), { id: chat, type: "private" }, clock), { status: "invalid" }, "an expired token is destroyed");

  // Issued before tokens had an expiry.
  await webAccount("nova", token(3), null);
  assert.deepEqual(await linkTelegramChat(token(3), { id: chat, type: "private" }, clock), { status: "expired" });

  // A chat that already belongs to another account.
  const owner = await seedLearner("Vic");
  await webAccount("nova", token(4), linkTokenExpiry(clock), owner.chat);
  await webAccount("nova", token(5), linkTokenExpiry(clock));
  assert.deepEqual(await linkTelegramChat(token(5), { id: owner.chat, type: "private" }, clock), { status: "chat_taken" });

  // An account whose learner lives on one chat cannot move to another.
  assert.deepEqual(await linkTelegramChat(token(4), { id: chat, type: "private" }, clock), { status: "has_other_chat" });
  assert.equal(await prisma.messengerUser.count({ where: { platformChatId: chat } }), 0, "nothing was created for a refused link");
});

test("linking: a Rex account stays Rex, and a chat with a finished Rex intake is not taken over", async () => {
  const rexChat = `${STAMP}73`;
  chats.push(rexChat);
  const rexProfile = await webAccount("rex", token(6), linkTokenExpiry(clock));
  assert.deepEqual(await linkTelegramChat(token(6), { id: rexChat, type: "private" }, clock), { status: "linked", companion: "rex", profileId: rexProfile });
  assert.equal(await prisma.messengerUser.count({ where: { platformChatId: rexChat } }), 0, "Rex's own flow creates its user, as before");

  const oldRex = `${STAMP}74`;
  chats.push(oldRex);
  await prisma.messengerUser.create({ data: { platform: "telegram", platformChatId: oldRex, persona: "rex", intakeComplete: true } });
  const novaProfile = await webAccount("nova", token(7), linkTokenExpiry(clock));
  assert.deepEqual(await linkTelegramChat(token(7), { id: oldRex, type: "private" }, clock), { status: "linked", companion: "rex", profileId: novaProfile });
  assert.equal((await prisma.messengerUser.findFirstOrThrow({ where: { platformChatId: oldRex } })).persona, "rex");
});

// ══════════════════════════════════════════════════════════════════════════════
// Proactive: claim, then word, then send
// ══════════════════════════════════════════════════════════════════════════════

// A learner for whom a review is due, at 6pm their time, in their stated window.
async function eveningLearner(name: string, options: { exam?: boolean } = {}) {
  return seedLearner(name, { timezone: zoneWhereHourIs(18), preferredStudyTime: "evening", ...options });
}
function proactive() {
  const tg = fakeTelegram();
  const asked: string[] = [];
  // Every learner in the test database is visited by a tick, so what was
  // asked is recorded per learner.
  const word = async (input: { studentName: string | null; type: string; facts: string[]; register: string }) => {
    asked.push(`${input.studentName}: ${input.type}|${input.register}|${input.facts.join(" / ")}`);
    return { text: `NUDGE(${input.studentName})`, generated: true };
  };
  return { tg, asked, run: () => runNovaProactiveCron(clock, { client: tg.client, word: word as never }) };
}
const mine = (tg: ReturnType<typeof fakeTelegram>, l: Learner) => tg.sent.filter(s => s.chatId === l.chat);

test("a due review at the learner's usual hour is sent once, with a prompt, however many ticks run", async () => {
  const l = await eveningLearner("Wyn");
  const { tg, asked, run } = proactive();
  await run();

  assert.equal(mine(tg, l).length, 1);
  assert.equal(mine(tg, l)[0]!.text, "NUDGE(Wyn)");
  assert.deepEqual(mine(tg, l)[0]!.buttons.flat().map(b => b.text), ["Start 15 min", "Start 25 min", "Start 45 min", "Later", "Not today"]);
  const mineAsked = asked.find(a => a.startsWith("Wyn: "))!;
  assert.ok(mineAsked.startsWith("Wyn: review_due|steady|1 topic due for review / Recommended now: Deadlocks (Operating Systems)"), mineAsked);
  assert.ok(!mineAsked.includes("usually fall around this time"), "no claim about habits Learning DNA does not support");

  const [row] = await outbox(l);
  assert.deepEqual([row!.eventType, row!.status, row!.occurrenceKey, row!.attempts, row!.telegramMessageId], ["review_due", "sent", `review:${dayKey(clock, zoneWhereHourIs(18))}`, 1, mine(tg, l)[0]!.messageId]);
  // It is in Nova's conversation history, and it is the open question.
  assert.equal(await prisma.companionMessage.count({ where: { userId: l.userId, intent: "nova_proactive_review_due" } }), 1);
  assert.equal((await loadOpenPrompt(l.profileId, clock))?.kind, "nudge");

  // Five more ticks, a restart's worth.
  for (let i = 0; i < 5; i++) { tick(5); await run(); }
  assert.equal(mine(tg, l).length, 1);
  assert.equal((await outbox(l)).length, 1, "later ticks write nothing");

  // The nudge's Start button starts the canonical session.
  const h = harness();
  const start = mine(tg, l)[0]!.buttons.flat().find(b => b.text === "Start 25 min")!.callback_data!;
  await h.tapData(l, start);
  assert.equal((await sessions(l))[0]!.status, "in_progress");

  // While it runs, Nova says nothing, whatever is due.
  tick(5 * 60);
  await prisma.novaAcademicProfile.update({ where: { id: l.profileId }, data: { timezone: zoneWhereHourIs(10) } });
  await prisma.novaExam.create({ data: { profileId: l.profileId, title: "OS quiz", scheduledAt: new Date(clock.getTime() + 20 * 3_600_000) } });
  await run();
  assert.equal(mine(tg, l).length, 1, "no message during a session");
});

test("two instances ticking at once send one message", async () => {
  const l = await eveningLearner("Xan");
  const a = proactive(), b = proactive();
  await Promise.all([a.run(), b.run()]);
  assert.equal(mine(a.tg, l).length + mine(b.tg, l).length, 1);
  assert.equal((await outbox(l)).length, 1);
});

test("a failed send is retried with the stored text, and a failure is never counted as sent", async () => {
  const l = await eveningLearner("Yas");
  const { tg, asked, run } = proactive();
  tg.failNext({ ok: false, kind: "server", detail: "Bad Gateway" });
  await run();
  let [row] = await outbox(l);
  assert.deepEqual([row!.status, row!.attempts, row!.text !== null], ["failed", 1, true]);
  assert.equal(await prisma.companionMessage.count({ where: { userId: l.userId } }), 0, "not said, so not in the conversation");
  assert.equal(await loadOpenPrompt(l.profileId, clock), null);
  const wordedOnce = asked.filter(a => a.startsWith("Yas: ")).length;
  assert.equal(wordedOnce, 1);

  tick(5);
  await run();
  [row] = await outbox(l);
  assert.deepEqual([row!.status, row!.attempts], ["sent", 2]);
  assert.equal(asked.filter(a => a.startsWith("Yas: ")).length, wordedOnce, "the retry sends what was already worded");
  assert.equal(mine(tg, l).filter(s => s.messageId !== null).length, 1);
});

test("an unanswered send is never repeated, and a blocked bot stops Nova from trying", async () => {
  const unknown = await eveningLearner("Zed");
  const first = proactive();
  first.tg.failNext({ ok: false, kind: "unknown", detail: "no response" });
  await first.run();
  assert.equal((await outbox(unknown))[0]!.status, "unknown");
  tick(5);
  await first.run();
  assert.equal(mine(first.tg, unknown).length, 1, "it may have arrived, so it is not sent again");
  // It counts as today's one push to study.
  assert.equal((await outbox(unknown)).length, 1);

  const blocked = await eveningLearner("Abe");
  const second = proactive();
  // Deliver nothing to the earlier learners in this tick; fail this one.
  await prisma.novaTelegramChannel.updateMany({ where: { profileId: { not: blocked.profileId } }, data: { proactiveEnabled: false } });
  second.tg.failNext({ ok: false, kind: "blocked", detail: "Forbidden: bot was blocked by the user" });
  await second.run();
  assert.equal((await outbox(blocked))[0]!.status, "abandoned");
  assert.ok((await channel(blocked)).undeliverableSince);
  tick(24 * 60);
  await second.run();
  assert.equal(mine(second.tg, blocked).length, 1, "no further attempts to a chat that refused");
  await prisma.novaTelegramChannel.updateMany({ where: { profileId: { not: blocked.profileId } }, data: { proactiveEnabled: true } });
});

test("a send interrupted by a restart is treated as unknown, not resent", async () => {
  const l = await eveningLearner("Cal");
  await ensureChannel(l.profileId);
  const day = dayKey(clock, zoneWhereHourIs(18));
  await prisma.novaProactiveMessage.create({
    data: { profileId: l.profileId, eventType: "review_due", occurrenceKey: `review:${day}`, localDay: day, status: "sending", text: "half-sent",
            attempts: 1, firedAt: new Date(clock.getTime() - 10 * MIN), sentAt: new Date(clock.getTime() - 10 * MIN), cooldownUntil: clock, priority: 4, confidence: 1 },
  });
  const { tg, run } = proactive();
  await run();
  assert.equal(mine(tg, l).length, 0);
  assert.deepEqual((await outbox(l)).map(r => r.status), ["unknown"]);
});

test("no timezone, nudges off, 'Not today', quiet hours and a recent message each mean silence, with nothing stored", async () => {
  const noZone = await seedLearner("Dee", { timezone: null, preferredStudyTime: "evening" });
  const off    = await eveningLearner("Eli");
  const paused = await eveningLearner("Fay");
  const night  = await seedLearner("Gil", { timezone: zoneWhereHourIs(2), preferredStudyTime: "evening" });
  const chatty = await eveningLearner("Hux");

  const h = harness();
  await h.send(off, "/settings");
  await h.tap(off, "Turn nudges off");
  assert.equal(h.tg.last().text, "Nudges are off. I'll only speak when you do.");
  await prisma.novaTelegramPrompt.updateMany({ where: { profileId: paused.profileId }, data: { openKey: null } });
  await openPrompt(paused.profileId, paused.chat, { kind: "nudge", options: [{ id: "a", label: "Not today", action: { type: "not_today" } }] }, clock);
  await h.tapData(paused, encodeCallback((await loadOpenPrompt(paused.profileId, clock))!.id, "a"));
  assert.equal(h.tg.last().text, "Got it. Nothing more from me today.");
  h.ai.read("hey", { ...BASE, request: { ...REQ } });
  await h.send(chatty, "hey");

  const { tg, run } = proactive();
  await run();
  for (const l of [noZone, off, paused, night, chatty]) {
    assert.equal(mine(tg, l).length, 0);
    assert.equal((await outbox(l)).length, 0);
  }
  // /settings tells the learner why Nova will not message first.
  await h.send(noZone, "/settings");
  assert.ok(h.tg.last().text.includes("Timezone: not set, so I won't message first."));
});

test("an exam within three days outranks the review, takes the serious register, and the day is capped at two", async () => {
  const l = await seedLearner("Ida", { timezone: zoneWhereHourIs(10), preferredStudyTime: "evening", exam: true });
  const { tg, asked, run } = proactive();
  await run();
  const first = asked.find(a => a.startsWith("Ida: "))!;
  assert.ok(first.startsWith("Ida: exam_countdown|serious|Operating Systems final"), first);
  assert.equal(mine(tg, l).length, 1);

  // Evening, same local day: the review is still worth one message…
  tick(8 * 60);
  await run();
  assert.deepEqual((await outbox(l)).map(r => [r.eventType, r.status]), [["exam_countdown", "sent"], ["review_due", "sent"]]);
  // …and that is the day's two. Nothing more, whatever else is due.
  tick(4 * 60 + 5);
  await prisma.novaAcademicProfile.update({ where: { id: l.profileId }, data: { timezone: zoneWhereHourIs(20) } });
  await prisma.novaProactiveMessage.updateMany({ where: { profileId: l.profileId }, data: { localDay: dayKey(clock, zoneWhereHourIs(20)) } });
  await prisma.novaExam.create({ data: { profileId: l.profileId, title: "Another exam", scheduledAt: new Date(clock.getTime() + 30 * 3_600_000) } });
  await run();
  assert.equal(mine(tg, l).length, 2);
});
