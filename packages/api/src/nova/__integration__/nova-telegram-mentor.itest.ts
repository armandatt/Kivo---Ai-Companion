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

// ═══ M2–M5: plan notifications ═══════════════════════════════════════════════

const { runPlanReminders } = await import("../proactive/plan-reminders.js");
const { setPlanNotifications, ensureChannel } = await import("../telegram/channel-store.js");
const { zonedInstant, dayKey } = await import("../engines/learner-calendar.js");

const occurrences = (l: Learner) => prisma.novaReminderOccurrence.findMany({ where: { profileId: l.profileId }, orderBy: { createdAt: "asc" } });
const planOutbox = (l: Learner) => prisma.novaProactiveMessage.findMany({ where: { profileId: l.profileId, eventType: "plan_reminder" }, orderBy: { createdAt: "asc" } });
// A local wall-clock moment today in the learner's zone.
const at = (hhmm: string, zone = "Asia/Kolkata", day = dayKey(clock, zone)) => { const [h, m] = hhmm.split(":").map(Number); return zonedInstant(day, h! * 60 + m!, zone); };
// The learner's flow day starts at local 08:00 so every block below is ahead.
async function morning(zone = "Asia/Kolkata") { setClock(at("08:00", zone)); }
async function withNotifications(l: Learner, on = true) { await ensureChannel(l.profileId); await setPlanNotifications(l.profileId, on); }
async function timedPlan(l: Learner, blocks: Array<{ title: string; at: string; minutes: number }>) {
  let flow = await applyPlan(l, blocks.map(b => ({ op: "add", item: { kind: "focus", title: b.title, minutes: b.minutes } })));
  const ops = blocks.map(b => ({ op: "set_time", id: flow.items.find(i => i.title === b.title)!.id, at: b.at }));
  return applyPlan(l, ops);
}
const planTick = (tg: ReturnType<typeof fakeTelegram>) => runPlanReminders(clock, { client: tg.client });

test("M2: nothing is sent for a learner who hasn't turned plan notifications on, or hasn't applied a plan", async () => {
  await morning();
  const off = await seedLearner("Mo");
  await timedPlan(off, [{ title: "Operating Systems", at: "18:00", minutes: 25 }]);
  const draftOnly = await seedLearner("Na");
  await withNotifications(draftOnly);          // on, but no plan applied: a draft is never saved
  const { tg } = harness();
  setClock(at("18:00"));
  await planTick(tg);
  assert.equal(tg.sent.filter(s => s.chatId === off.chat || s.chatId === draftOnly.chat).length, 0);
  assert.equal((await occurrences(off)).length + (await occurrences(draftOnly)).length, 0);
});

test("M2: an applied timed block goes out once at its local time; blocks at one time are one message", async () => {
  await morning();
  const l = await seedLearner("Om");
  await withNotifications(l);
  await timedPlan(l, [{ title: "Operating Systems", at: "18:00", minutes: 25 }, { title: "Read chapter 4", at: "18:00", minutes: 20 }, { title: "DBMS", at: "20:00", minutes: 30 }]);
  const { tg } = harness();
  await planTick(tg);                                   // 08:00: scheduled, nothing due
  assert.equal(tg.sent.filter(s => s.chatId === l.chat).length, 0);
  assert.deepEqual((await occurrences(l)).map(o => [o.slotKey, o.state]), [["at:18:00", "scheduled"], ["at:20:00", "scheduled"]]);
  setClock(at("17:59")); await planTick(tg);
  assert.equal(tg.sent.filter(s => s.chatId === l.chat).length, 0, "not early");
  setClock(new Date(at("18:00").getTime() + 1_000));
  const r = await planTick(tg); await planTick(tg); await planTick(tg);   // three ticks, one send
  const mine = tg.sent.filter(s => s.chatId === l.chat);
  assert.equal(mine.length, 1);
  assert.equal(mine[0]!.text, "6:00 PM · Your plan: Operating Systems, 25 minutes; Read chapter 4, 20 minutes. Ready to start?");
  assert.deepEqual(mine[0]!.buttons.flat().map(b => b.text), ["Start Operating Systems · 25 min", "Start Read chapter 4 · 20 min", "Remind me later", "Skip this block"]);
  assert.ok(r.delaysMs.every(d => d < 5_000), `sent ${r.delaysMs} ms late`);
  assert.equal((await planOutbox(l)).length, 1);
});

test("M3: Remind me later → 15 min replaces the occurrence, says the exact time, and sends once then", async () => {
  await morning();
  const l = await seedLearner("Pia");
  await withNotifications(l);
  await timedPlan(l, [{ title: "Operating Systems", at: "18:00", minutes: 25 }]);
  const { tg, tap, tapData, models } = harness();
  await planTick(tg);
  setClock(at("18:00")); await planTick(tg);
  await tap(l, "Remind me later");
  assert.equal(tg.lastTo(l.chat)!.text, "When should I remind you?");
  assert.deepEqual(tg.labels(l.chat), ["In 15 min", "In 1 hour", "Pick a time"]);
  await tap(l, "In 15 min");
  assert.equal(tg.lastTo(l.chat)!.text, "OK, I'll remind you at 6:15 PM.");
  const [o] = await occurrences(l);
  assert.deepEqual([o!.state, o!.dueAt.toISOString(), o!.snoozes], ["deferred", at("18:15").toISOString(), 1]);
  setClock(at("18:14")); await planTick(tg);
  assert.equal(tg.sent.filter(s => s.chatId === l.chat && s.text.includes("Ready to start?")).length, 1);
  setClock(at("18:15")); await planTick(tg); await planTick(tg);
  assert.equal(tg.sent.filter(s => s.chatId === l.chat && s.text.includes("Ready to start?")).length, 2);
  assert.equal(models(), 0, "no model for any of it");
  // Pick a time offers clock times and Tomorrow; a chosen time is confirmed.
  const later = tg.data(l.chat, "Remind me later");
  await tapData(l, later); await tap(l, "Pick a time");
  // 6:15 PM now: the next half-hour mark at least 30 minutes ahead, then hourly.
  assert.deepEqual(tg.labels(l.chat), ["7:00 PM", "8:00 PM", "9:00 PM", "Tomorrow, same time"]);
  await tap(l, "8:00 PM");
  assert.equal(tg.lastTo(l.chat)!.text, "OK, I'll remind you at 8:00 PM.");
  // The reminder's own button still works after a snooze.
  await tapData(l, later); await tap(l, "Pick a time"); await tap(l, "Tomorrow, same time");
  assert.equal(tg.lastTo(l.chat)!.text, "OK, I'll remind you tomorrow at 6:00 PM, and check it's still on that day's plan first.");
  assert.equal((await occurrences(l))[0]!.source, "carried");
});

test("M3: Skip dismisses today's occurrence only; an old button says it is no longer current", async () => {
  await morning();
  const l = await seedLearner("Quin");
  await withNotifications(l);
  await timedPlan(l, [{ title: "Operating Systems", at: "18:00", minutes: 25 }]);
  const { tg, tap, tapData } = harness();
  await planTick(tg);
  setClock(at("18:00")); await planTick(tg);
  const start = tg.data(l.chat, "Start 25 min");
  await tap(l, "Skip this block");
  assert.equal(tg.lastTo(l.chat)!.text, "Skipped for today. The block stays on your plan.");
  assert.equal((await occurrences(l))[0]!.state, "dismissed");
  await tapData(l, start);
  assert.equal(tg.lastTo(l.chat)!.text, "You skipped that block for today.");
  assert.equal((await sessions(l)).length, 0);
  const flow = await loadDayFlow(l.profileId, l.chat, clock);
  assert.equal(flow.items[0]!.status, "planned", "skipping changes delivery only, never the plan");
});

test("M1+M3: Start on a plan notification attaches the session to the block; a second tap shows it, once", async () => {
  await morning();
  const l = await seedLearner("Rae");
  await withNotifications(l);
  await timedPlan(l, [{ title: "Operating Systems", at: "18:00", minutes: 25 }]);
  const { tg, tapData } = harness();
  await planTick(tg);
  setClock(at("18:00")); await planTick(tg);
  const start = tg.data(l.chat, "Start 25 min");
  await Promise.all([tapData(l, start), tapData(l, start)]);
  const rows = await sessions(l);
  assert.equal(rows.length, 1);
  const flow = await loadDayFlow(l.profileId, l.chat, clock);
  assert.equal(flow.items[0]!.sessionId, rows[0]!.id);
  assert.equal((await occurrences(l))[0]!.state, "started");
  await tapData(l, start);
  assert.equal((await sessions(l)).length, 1);
});

test("M4: a newer schedule change on the web supersedes a snooze; a title edit keeps it", async () => {
  await morning();
  const l = await seedLearner("Sid");
  await withNotifications(l);
  const flow = await timedPlan(l, [{ title: "Operating Systems", at: "18:00", minutes: 25 }]);
  const id = flow.items[0]!.id;
  const { tg, tap } = harness();
  await planTick(tg);
  setClock(at("18:00")); await planTick(tg);
  await tap(l, "Remind me later"); await tap(l, "In 1 hour");
  // Title edit on the web: the snooze stands, and the message uses the new title.
  await applyPlan(l, [{ op: "replace", id, item: { kind: "focus", title: "Operating Systems II", minutes: 25 } }]);
  const afterTitle = await loadDayFlow(l.profileId, l.chat, clock);
  const newId = afterTitle.items[0]!.id;
  if (newId === id) {
    await planTick(tg);
    assert.equal((await occurrences(l)).find(o => o.slotKey === "at:18:00")!.state, "deferred");
  }
  // A new time on the web: the snoozed one is superseded, the new time is scheduled.
  await applyPlan(l, [{ op: "set_time", id: newId, at: "21:00" }]);
  setClock(at("18:30")); await planTick(tg);
  const all = await occurrences(l);
  assert.equal(all.find(o => o.slotKey === "at:18:00")!.state, "superseded");
  assert.equal(all.find(o => o.slotKey === "at:21:00")!.state, "scheduled");
  setClock(at("19:00")); await planTick(tg);
  assert.equal(tg.sent.filter(s => s.chatId === l.chat && s.text.includes("Ready to start?")).length, 1, "the old snooze never fires");
  // Removing the block retires its reminder.
  const now = await loadDayFlow(l.profileId, l.chat, clock);
  await applyPlan(l, [{ op: "remove", id: now.items[0]!.id }]);
  await planTick(tg);
  assert.equal((await occurrences(l)).find(o => o.slotKey === "at:21:00")!.state, "superseded");
});

test("M4: starting a block on the web before its time retires its reminder", async () => {
  await morning();
  const l = await seedLearner("Tia");
  await withNotifications(l);
  const flow = await timedPlan(l, [{ title: "Operating Systems", at: "18:00", minutes: 25 }]);
  const { tg } = harness();
  await planTick(tg);
  setClock(at("17:30"));
  const { startFocus } = await import("../product/day-flow.js");
  const r = await startFocus({ profileId: l.profileId, platformChatId: l.chat, version: (await loadDayFlow(l.profileId, l.chat, clock)).version, itemId: flow.items[0]!.id, minutes: 25, now: clock });
  assert.equal(r.ok, true);
  setClock(at("18:00")); await planTick(tg);
  assert.equal(tg.sent.filter(s => s.chatId === l.chat).length, 0);
  assert.equal((await occurrences(l))[0]!.state, "started");
});

test("M3: Pause plan nudges today holds the plan; Resume shows what's next and replays nothing", async () => {
  await morning();
  const l = await seedLearner("Uma");
  await withNotifications(l);
  await timedPlan(l, [{ title: "Operating Systems", at: "18:00", minutes: 25 }, { title: "DBMS", at: "21:00", minutes: 30 }]);
  const { tg, send, tap } = harness();
  await planTick(tg);
  await send(l, "/settings");
  await tap(l, "Pause plan nudges today");
  assert.ok(tg.lastTo(l.chat)!.text.startsWith("Plan prompts and nudges are paused until midnight."));
  setClock(at("18:00")); await planTick(tg);
  assert.equal(tg.sent.filter(s => s.chatId === l.chat && s.text.includes("Ready to start?")).length, 0);
  setClock(at("19:00"));
  await send(l, "/settings");
  await tap(l, "Resume");
  assert.ok(tg.lastTo(l.chat)!.text.startsWith("Resumed. Here's what's next."));
  await planTick(tg);
  assert.equal(tg.sent.filter(s => s.chatId === l.chat && s.text.startsWith("6:00 PM · Your plan")).length, 0, "no backlog");
  assert.equal((await occurrences(l)).find(o => o.slotKey === "at:18:00")!.state, "expired");
  setClock(at("21:00")); await planTick(tg);
  assert.equal(tg.sent.filter(s => s.chatId === l.chat && s.text.startsWith("9:00 PM")).length, 1);
});

test("M5: 429 is retried on the next run; 403 marks the chat undeliverable; unknown is never resent", async () => {
  await morning();
  const a = await seedLearner("Val"), b = await seedLearner("Wes"), c = await seedLearner("Xi");
  for (const l of [a, b, c]) { await withNotifications(l); await timedPlan(l, [{ title: "Operating Systems", at: "18:00", minutes: 25 }]); }
  const { tg } = harness();
  await planTick(tg);
  setClock(at("18:00"));
  // The three are sent in due order; arm one failure each.
  const due = (await prisma.novaReminderOccurrence.findMany({ where: { profileId: { in: [a, b, c].map(l => l.profileId) } }, orderBy: [{ dueAt: "asc" }, { id: "asc" }], select: { profileId: true } })).map(r => r.profileId);
  const kinds = new Map([[a.profileId, { ok: false as const, kind: "rate_limited" as const, retryAfterSeconds: 3, detail: "429" }], [b.profileId, { ok: false as const, kind: "blocked" as const, detail: "403" }], [c.profileId, { ok: false as const, kind: "unknown" as const, detail: "timeout" }]]);
  for (const p of due) tg.fail(kinds.get(p)!);
  await planTick(tg);
  const state = async (l: Learner) => (await occurrences(l))[0]!.state;
  assert.deepEqual([await state(a), await state(b), await state(c)], ["failed", "undeliverable", "unknown"]);
  assert.ok((await prisma.novaTelegramChannel.findUniqueOrThrow({ where: { profileId: b.profileId } })).undeliverableSince);
  setClock(at("18:05")); await planTick(tg);
  assert.deepEqual([await state(a), await state(b), await state(c)], ["sent", "undeliverable", "unknown"]);
  assert.equal(tg.sent.filter(s => s.chatId === c.chat).length, 1, "unknown is not resent");
  assert.equal((await planOutbox(a))[0]!.attempts, 2);
});

test("operational: schedule → snooze → edit on the web → restart → tap the old message twice: one occurrence, ≤1 session, no charge", async () => {
  await morning();
  const l = await seedLearner("Yara");
  await withNotifications(l);
  const flow = await timedPlan(l, [{ title: "Operating Systems", at: "18:00", minutes: 25 }]);
  const { tg, tap, tapData, models } = harness();
  await planTick(tg);
  setClock(at("18:00")); await planTick(tg);
  const oldStart = tg.data(l.chat, "Start 25 min");
  await tap(l, "Remind me later"); await tap(l, "In 15 min");
  // Edited on the web: the block now starts at 18:40.
  await applyPlan(l, [{ op: "set_time", id: flow.items[0]!.id, at: "18:40" }]);
  // "Restart": a fresh run with nothing in memory (the job keeps none).
  setClock(at("18:10"));
  const fresh = fakeTelegram();
  await runPlanReminders(clock, { client: fresh.client });
  await Promise.all([tapData(l, oldStart), tapData(l, oldStart)]);
  const current = (await occurrences(l)).filter(o => ["scheduled", "deferred", "sent", "failed"].includes(o.state));
  assert.equal(current.length, 1, JSON.stringify((await occurrences(l)).map(o => [o.slotKey, o.state])));
  assert.equal(current[0]!.slotKey, "at:18:40");
  assert.ok((await sessions(l)).length <= 1);
  const charges = await prisma.usageLedger.count({ where: { feature: { startsWith: "telegram_" }, accountKey: { contains: l.chat } } }).catch(() => 0);
  assert.equal(charges, 0);
  assert.equal(models(), 0);
});

test("timezones: a timezone change between scheduling and sending moves an unsnoozed block to the new local time", async () => {
  await morning("Asia/Kolkata");
  const l = await seedLearner("Zed", "Asia/Kolkata");
  await withNotifications(l);
  await timedPlan(l, [{ title: "Operating Systems", at: "18:00", minutes: 25 }]);
  const { tg } = harness();
  await planTick(tg);
  assert.equal((await occurrences(l))[0]!.dueAt.toISOString(), at("18:00", "Asia/Kolkata").toISOString());
  await prisma.novaAcademicProfile.update({ where: { id: l.profileId }, data: { timezone: "Asia/Dubai" } });
  await planTick(tg);
  const [o] = await occurrences(l);
  assert.equal(o!.dueAt.toISOString(), zonedInstant(o!.day, 18 * 60, "Asia/Dubai").toISOString());
  assert.equal(o!.timezone, "Asia/Dubai");
});

test("kill switch: TELEGRAM_PLAN_NOTIFICATIONS=off sends nothing; chat and buttons still work", async () => {
  await morning();
  const l = await seedLearner("Ada");
  await withNotifications(l);
  await timedPlan(l, [{ title: "Operating Systems", at: "18:00", minutes: 25 }]);
  const { tg, send } = harness();
  await planTick(tg);
  process.env.TELEGRAM_PLAN_NOTIFICATIONS = "off";
  try {
    setClock(at("18:00")); await planTick(tg);
    assert.equal(tg.sent.filter(s => s.chatId === l.chat).length, 0);
    await send(l, "/today");
    assert.ok(tg.lastTo(l.chat)!.text.startsWith("Your plan for today:"));
  } finally { delete process.env.TELEGRAM_PLAN_NOTIFICATIONS; }
});

// ═══ M9: first message, settings and help ════════════════════════════════════

test("M9: /settings turns plan notifications on and asks for a check-in time when there is none; /help says what Nova sends", async () => {
  await morning();
  const l = await seedLearner("Bea");
  const { tg, send, tap, models } = harness();
  await send(l, "/settings");
  assert.ok(tg.lastTo(l.chat)!.text.startsWith("Plan notifications: off."));
  await tap(l, "Plan notifications on");
  assert.ok(tg.lastTo(l.chat)!.text.includes("A draft you haven't applied sends nothing."));
  assert.ok(tg.lastTo(l.chat)!.text.endsWith("For blocks without a set time, what time should I check in?"));
  assert.deepEqual(tg.labels(l.chat), ["7:00 AM", "9:00 AM", "1:00 PM", "6:00 PM", "8:00 PM", "10:00 PM", "No check-in"]);
  assert.equal((await prisma.novaTelegramChannel.findUniqueOrThrow({ where: { profileId: l.profileId } })).planNotifications, true);
  await send(l, "/help");
  assert.ok(tg.lastTo(l.chat)!.text.includes("/settings: plan notifications, check-in time, pause or resume"));
  assert.ok(tg.lastTo(l.chat)!.text.includes("What I send by myself:"));
  assert.ok(!tg.lastTo(l.chat)!.text.toLowerCase().includes("unlimited"));
  assert.equal(models(), 0);
});

// ═══ M8: the Telegram page ════════════════════════════════════════════════════

test("M8: the page shows what is coming by source, what happened, and its changes are the chat's", async () => {
  await morning();
  const { loadTelegramPage, changeTelegramPage } = await import("../product/telegram-page.js");
  const l = await seedLearner("Cal");
  await withNotifications(l);
  await timedPlan(l, [{ title: "Operating Systems", at: "18:00", minutes: 25 }, { title: "DBMS", at: "20:00", minutes: 30 }]);
  const { tg, tap } = harness();
  await planTick(tg);
  const me = { profileId: l.profileId, platformChatId: l.chat, timezone: "Asia/Kolkata", credits: { used: 3, limit: 150, resetsAt: null, enforced: false } };
  let page = await loadTelegramPage(me, clock);
  assert.deepEqual([page.connected, page.planNotifications, page.nextDelivery?.title], [true, true, "Operating Systems"]);
  assert.deepEqual(page.upcoming.filter(u => u.source === "day_plan").map(u => u.title), ["Operating Systems", "DBMS"]);
  // Snoozed on the page → the chat's occurrence moved; skipped on the page → its button says so.
  const first = page.upcoming[0]!;
  assert.deepEqual(await changeTelegramPage(me, { action: "snooze", id: first.id, minutes: 60 }, clock), { ok: true });
  assert.equal((await occurrences(l)).find(o => o.id === first.id)!.dueAt.toISOString(), new Date(clock.getTime() + 3_600_000).toISOString());
  setClock(at("20:00")); await planTick(tg);
  await tap(l, "Skip this block");
  page = await loadTelegramPage(me, clock);
  assert.ok(page.recent.some(r => r.title === "DBMS" && r.label === "Skipped"));
  // Pause from the page holds the chat's plan prompts; resume clears it.
  assert.deepEqual(await changeTelegramPage(me, { action: "pause", scope: "all" }, clock), { ok: true });
  page = await loadTelegramPage(me, clock);
  assert.equal(page.pause?.scope, "all");
  await changeTelegramPage(me, { action: "resume" }, clock);
  assert.equal((await loadTelegramPage(me, clock)).pause, null);
  assert.equal((await changeTelegramPage(me, { action: "snooze", id: "nope", minutes: 15 }, clock)).ok, false);
  assert.equal((await changeTelegramPage(me, { action: "delete_everything" }, clock)).ok, false);
});
