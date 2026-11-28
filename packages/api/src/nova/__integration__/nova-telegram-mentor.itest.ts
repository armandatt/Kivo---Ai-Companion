/**
 * Telegram mentor for launch (28 Nov 2026): the applied plan on Telegram,
 * plan notifications, buttons with real outcomes, reminders, flat credits.
 * Real Postgres; Telegram and the models are recording stand-ins.
 *
 *   NOVA_TEST_DATABASE_URL=postgresql://... npm run test:integration
 */
import "./test-database.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";

process.env.TELEGRAM_BOT_TOKEN = ""; process.env.GEMINI_API_KEY = ""; process.env.OPENAI_API_KEY = ""; process.env.ANTHROPIC_API_KEY = "";
delete process.env.NOVA_PROACTIVE_DISABLED; delete process.env.TELEGRAM_PROACTIVE_SENDS;

const { prisma } = await import("@repo/db/client");
const { handleNovaTelegramEvent } = await import("../telegram/telegram-turn.js");
const { normalizeTelegramUpdate } = await import("../telegram/telegram-event.js");
const { parseUnderstandingResponse } = await import("../brains/understanding-parser.js");
const { changeDayFlow, loadDayFlow } = await import("../product/day-flow.js");
import type { InlineButton, SendResult, TelegramClient } from "../telegram/telegram.types.js";

const STAMP = Date.now();
export const MIN = 60_000;
export let clock = new Date();
export const setClock = (d: Date) => { clock = d; };
export const tick = (minutes: number) => { clock = new Date(clock.getTime() + minutes * MIN); return clock; };

interface Sent { chatId: string; text: string; buttons: InlineButton[][]; messageId: number | null }
export function fakeTelegram() {
  const sent: Sent[] = []; const answered: Array<string | undefined> = []; const cleared: number[] = [];
  const queue: SendResult[] = []; let id = 5000;
  const client: TelegramClient = {
    async sendMessage(chatId, text, buttons) {
      const result = queue.shift() ?? { ok: true as const, messageId: ++id };
      sent.push({ chatId, text, buttons: buttons ?? [], messageId: result.ok ? result.messageId : null });
      return result;
    },
    async answerCallback(_id, text) { answered.push(text); },
    async clearButtons(_c, m) { cleared.push(m); },
    async setChatCommands() {},
  };
  const lastTo = (chat: string) => [...sent].reverse().find(s => s.chatId === chat);
  return {
    client, sent, answered, cleared, fail: (r: SendResult) => queue.push(r),
    lastTo,
    labels: (chat: string) => lastTo(chat)?.buttons.flat().map(b => b.text) ?? [],
    data: (chat: string, label: string) => {
      const b = lastTo(chat)?.buttons.flat().find(x => x.text === label);
      assert.ok(b?.callback_data, `no button "${label}" (${lastTo(chat)?.buttons.flat().map(x => x.text).join(", ")})`);
      return b.callback_data;
    },
  };
}

const BASE = { intent: "general_chat", emotion: "neutral", topic: null, topicConfidence: 0, disclosureClass: "none", ambiguityScore: 0.1, routingSignal: "coaching_only", secondaryIntents: [], sessionIntent: "none", reality: [] };
const REQ = { clarity: "clear", changeOfMind: false, action: "none", confidence: 0.9, promptAnswer: null, availableMinutes: null, sessionOutcome: null, deferUntil: null, struggleTopic: null, exam: null };

const chats: string[] = [];
export interface Learner { chat: string; userId: string; profileId: string; subjectId: string; osId: string; pagingId: string }
export async function seedLearner(name: string, timezone = "Asia/Kolkata"): Promise<Learner> {
  const chat = `9${String(STAMP).slice(-8)}${chats.length + 1}`;
  chats.push(chat);
  const user = await prisma.messengerUser.create({
    data: { platform: "telegram", platformChatId: chat, persona: "nova", displayName: name,
      novaAcademicProfile: { create: { onboardingComplete: true, timezone, subjects: { create: { name: "Operating Systems", code: "OS" } } } } },
    select: { id: true, novaAcademicProfile: { select: { id: true, subjects: { select: { id: true } } } } },
  });
  const profileId = user.novaAcademicProfile!.id, subjectId = user.novaAcademicProfile!.subjects[0]!.id;
  const ago = new Date(clock.getTime() - 5 * 86_400_000);
  const os = await prisma.novaTopicMastery.create({ data: { subjectId, name: "Deadlocks", masteryProbability: 0.45, confidenceReported: 0.5, reviewCount: 2, lastStudiedAt: ago, nextReviewAt: new Date(clock.getTime() - 86_400_000) } });
  const pg = await prisma.novaTopicMastery.create({ data: { subjectId, name: "Paging", masteryProbability: 0.7, confidenceReported: 0.7, reviewCount: 3, lastStudiedAt: ago, nextReviewAt: new Date(clock.getTime() + 6 * 86_400_000) } });
  return { chat, userId: user.id, profileId, subjectId, osId: os.id, pagingId: pg.id };
}

// A plan applied on the web: ops through the same writer the Today page uses.
export async function applyPlan(l: Learner, ops: unknown[]) {
  const flow = await loadDayFlow(l.profileId, l.chat, clock);
  const r = await changeDayFlow({ profileId: l.profileId, platformChatId: l.chat, version: flow.version, ops, by: "learner", now: clock });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.ok ? r.flow : null!;
}

let updateId = Math.floor(STAMP / 1000);
export function harness() {
  const tg = fakeTelegram();
  const readings = new Map<string, unknown>();
  let modelCalls = 0;
  const deps = () => ({ client: tg.client, now: () => clock, webUrl: "https://nova.test",
    understand: (async (text: string) => { modelCalls++; return parseUnderstandingResponse(JSON.stringify(readings.get(text) ?? { ...BASE, request: REQ }), text); }) as never,
    respond: async () => { modelCalls++; return { reply: "WORDED", reasoningMode: "direct" as const, confidence: 0.9, stateUpdates: undefined, investigationUpdate: null, followUpCheck: null }; } });
  const run = (u: Record<string, unknown>, id = updateId++) => handleNovaTelegramEvent(normalizeTelegramUpdate({ update_id: id, ...u }) as never, deps());
  return {
    tg, readings, models: () => modelCalls,
    send: (l: Learner, text: string) => run({ message: { message_id: 1, chat: { id: Number(l.chat), type: "private" }, from: { id: Number(l.chat) }, text } }),
    tapData: (l: Learner, data: string) => run({ callback_query: { id: `cb${updateId}`, data, from: { id: Number(l.chat) }, message: { message_id: 1, chat: { id: Number(l.chat), type: "private" } } } }),
    tap: (l: Learner, label: string) => run({ callback_query: { id: `cb${updateId}`, data: tg.data(l.chat, label), from: { id: Number(l.chat) }, message: { message_id: 1, chat: { id: Number(l.chat), type: "private" } } } }),
  };
}
export const sessions = (l: Learner) => prisma.novaStudySession.findMany({ where: { profileId: l.profileId }, orderBy: { sessionDate: "asc" } });

after(async () => {
  await prisma.messengerUser.deleteMany({ where: { platformChatId: { in: chats } } });
  await prisma.$disconnect();
});

// ═══ M1: the applied plan on Telegram ═════════════════════════════════════════

test("M1: /today shows the plan the learner applied, and Start attaches the session to that block", async () => {
  const l = await seedLearner("Ira");
  const flow = await applyPlan(l, [
    { op: "add", item: { kind: "topic", topicId: l.pagingId, minutes: 30 } },
    { op: "add", item: { kind: "focus", title: "Read chapter 4", minutes: 20 } },
  ]);
  const paging = flow.items.find(i => i.topicId === l.pagingId)!;
  const { tg, send, tap, tapData, models } = harness();
  await send(l, "/today");
  const text = tg.lastTo(l.chat)!.text;
  assert.ok(text.startsWith("Your plan for today:"), text);
  assert.ok(text.includes("Paging, 30 min") && text.includes("Read chapter 4, 20 min"), text);
  assert.deepEqual(tg.labels(l.chat), ["Start 30 min", "Something else", "Later"]);
  const start = tg.data(l.chat, "Start 30 min");
  // Two taps at once, and a replay of the first: exactly one session.
  await Promise.all([tapData(l, start), tapData(l, start)]);
  await tapData(l, start);
  const rows = await sessions(l);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0]!.topicName, rows[0]!.plannedDurationMinutes, rows[0]!.status], ["Paging", 30, "in_progress"]);
  const after = await loadDayFlow(l.profileId, l.chat, clock);
  const item = after.items.find(i => i.id === paging.id)!;
  assert.deepEqual([item.status, item.sessionId], ["active", rows[0]!.id], "the session is on the saved block");
  assert.equal(models(), 0, "buttons and commands call no model");
  // /focus while it runs shows its controls instead of starting another.
  await send(l, "/focus");
  assert.ok(tg.lastTo(l.chat)!.text.startsWith("You already have one going."));
  assert.deepEqual(tg.labels(l.chat), ["Pause", "End"]);
});

test("M1: Something else offers the plan's other blocks; a removed block is said to be gone", async () => {
  const l = await seedLearner("Jo");
  await applyPlan(l, [
    { op: "add", item: { kind: "topic", topicId: l.osId, minutes: 25 } },
    { op: "add", item: { kind: "focus", title: "Flashcards", minutes: 15 } },
  ]);
  const { tg, send, tap } = harness();
  await send(l, "/today");
  await tap(l, "Something else");
  assert.equal(tg.lastTo(l.chat)!.text, "Which one?");
  assert.deepEqual(tg.labels(l.chat), ["Flashcards · 15 min", "Later"]);
  const data = tg.data(l.chat, "Flashcards · 15 min");
  // Removed on the web before the tap.
  const flow = await loadDayFlow(l.profileId, l.chat, clock);
  await changeDayFlow({ profileId: l.profileId, platformChatId: l.chat, version: flow.version, ops: [{ op: "remove", id: flow.items.find(i => i.title === "Flashcards")!.id }], by: "learner", now: clock });
  const again = harness();
  await again.tapData(l, data);
  assert.equal(again.tg.lastTo(l.chat)!.text, "That block isn't in today's plan any more.");
  assert.equal((await sessions(l)).length, 0);
});

test("M1: finishing a session with no topic offers filing; tapping a topic files it", async () => {
  const l = await seedLearner("Kai");
  await applyPlan(l, [{ op: "add", item: { kind: "focus", title: "Revise chapter 4 notes", minutes: 20 } }]);
  const { tg, send, tap } = harness();
  await send(l, "/today");
  await tap(l, "Start 20 min");
  tick(15);
  await send(l, "/done");
  await tap(l, "Good");
  const end = tg.lastTo(l.chat)!.text;
  assert.ok(end.includes("File it on a topic so it counts there?"), end);
  assert.deepEqual(tg.labels(l.chat).sort(), ["Deadlocks", "Leave it", "Open Nova", "Paging"]);
  await tap(l, "Deadlocks");
  assert.equal(tg.lastTo(l.chat)!.text, "Filed on Deadlocks.");
  const [s] = await sessions(l);
  assert.deepEqual([s!.subjectId, s!.topicName], [l.subjectId, "Deadlocks"]);
});

test("M1: finishing a topic session asks where the topic stands; the tap sets it", async () => {
  const l = await seedLearner("Lea");
  await applyPlan(l, [{ op: "add", item: { kind: "topic", topicId: l.osId, minutes: 20 } }]);
  const { tg, send, tap } = harness();
  await send(l, "/today");
  await tap(l, "Start 20 min");
  tick(12);
  await send(l, "/done");
  await tap(l, "Okay");
  assert.ok(tg.lastTo(l.chat)!.text.includes("Where does Deadlocks stand?"));
  await tap(l, "In progress");
  const t = await prisma.novaTopicMastery.findUniqueOrThrow({ where: { id: l.osId } });
  assert.equal(t.status, "in_progress");
});
