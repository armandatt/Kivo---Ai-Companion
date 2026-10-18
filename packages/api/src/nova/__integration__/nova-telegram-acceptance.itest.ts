/**
 * Nova on Telegram — acceptance scenarios, real Postgres.
 *
 * Each test is one numbered scenario (S01…) with the behaviour it expects
 * written in its name before it runs. They drive the real update handler
 * (`handleNovaTelegramEvent`), the real transport gate, the canonical product
 * services and the real proactive tick and outbox, and check what was
 * replied, which route was taken, and what the database holds before and
 * after. Telegram and both models are recording stand-ins, as in
 * `nova-telegram.itest.ts`; what the real model reads is checked separately
 * by `scripts/novaTelegramEval.ts`.
 *
 *   NOVA_TEST_DATABASE_URL=postgresql://... npm run test:integration
 */

import "./test-database.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

process.env.TELEGRAM_BOT_TOKEN = "";
process.env.GEMINI_API_KEY = "";
process.env.OPENAI_API_KEY = "";

const { prisma }                    = await import("@repo/db/client");
const { handleNovaTelegramEvent }   = await import("../telegram/telegram-turn.js");
const { normalizeTelegramUpdate, encodeCallback } = await import("../telegram/telegram-event.js");
const { loadOpenPrompt }            = await import("../telegram/prompt-store.js");
const { parseUnderstandingResponse } = await import("../brains/understanding-parser.js");
const { runNovaSessionCommand, loadNovaSession } = await import("../product/session.js");
const { loadNovaToday }             = await import("../product/today.js");
const { loadNovaPlanner }           = await import("../product/planner.js");
const { runNovaProactiveCron }      = await import("../proactive/nova-proactive-cron.js");
const { localHour, dayKey }         = await import("../engines/learner-calendar.js");
const { dayLabel, TEXT, TEXT_HINGLISH } = await import("../telegram/telegram-replies.js");
const { admitTelegramUpdate }       = await import("../../services/telegramTransport.service.js");

import type { InlineButton, SendResult, TelegramClient, TurnTrace } from "../telegram/telegram.types.js";
import type { UnderstandingContext } from "../types/understanding.types.js";

const STAMP = Date.now();
const MIN   = 60_000;
const DAY   = 86_400_000;
let clock = new Date();
const tick = (minutes: number) => { clock = new Date(clock.getTime() + minutes * MIN); return clock; };

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
  const menus: Array<{ chatId: string; commands: string[] }> = [];
  let next: { result: SendResult; chat: string } | null = null;
  let id = 5000;
  const client: TelegramClient = {
    async sendMessage(chatId, text, buttons) {
      const armed = next !== null && next.chat === chatId;
      const result = armed ? next!.result : { ok: true as const, messageId: ++id };
      if (armed) next = null;
      sent.push({ chatId, text, buttons: buttons ?? [], messageId: result.ok ? result.messageId : null });
      return result;
    },
    async answerCallback(callbackId, text) { answered.push({ id: callbackId, text }); },
    async clearButtons() {},
    async setChatCommands(chatId, commands) { menus.push({ chatId, commands: commands.map(c => c.command) }); },
  };
  const to = (chat: string) => sent.filter(s => s.chatId === chat);
  return {
    client, sent, answered, menus, to,
    failNext: (result: SendResult, chat: string) => { next = { result, chat }; },
    last: (chat: string) => to(chat).at(-1)!,
    labels: (chat: string) => (to(chat).at(-1)?.buttons ?? []).flat().filter(b => b.callback_data).map(b => b.text),
    data: (chat: string, label: string) => {
      const button = to(chat).at(-1)!.buttons.flat().find(b => b.text === label);
      assert.ok(button?.callback_data, `no button "${label}" (${to(chat).at(-1)!.buttons.flat().map(b => b.text).join(", ")})`);
      return button.callback_data;
    },
  };
}

// ── The models, stood in ──────────────────────────────────────────────────────

const BASE = { intent: "general_chat", emotion: "neutral", topic: null, topicConfidence: 0, disclosureClass: "none", ambiguityScore: 0.1, routingSignal: "coaching_only", secondaryIntents: [], sessionIntent: "none", reality: [] };
const REQ  = { clarity: "clear", changeOfMind: false, action: "none", confidence: 0.9, promptAnswer: null, availableMinutes: null, sessionOutcome: null, deferUntil: null, struggleTopic: null, exam: null, asks: "none", setup: null, language: null };

function models() {
  const script = new Map<string, Record<string, unknown>>();
  const seen: string[] = [];
  const worded: string[] = [];
  let fail: "throw" | "garbage" | "timeout" | null = null;
  let respondFails = false;
  // Every request to say code-written text in Hinglish (brains/language-wording.ts),
  // answered with the text unchanged: a test can see which language a turn chose.
  const rendered: string[] = [];
  return {
    seen, worded, rendered,
    generate: async (request: { prompt: string }) => { rendered.push(request.prompt); return request.prompt; },
    read: (text: string, model: Record<string, unknown>) => script.set(text, model),
    breakUnderstanding: (how: typeof fail) => { fail = how; },
    breakResponse: (broken: boolean) => { respondFails = broken; },
    understand: async (text: string, _h: unknown, _c?: UnderstandingContext) => {
      seen.push(text);
      if (fail === "throw") throw new Error("provider returned 503");
      if (fail === "timeout") { await new Promise(r => setTimeout(r, 20)); throw new Error("deadline exceeded after 6000 ms"); }
      if (fail === "garbage") return parseUnderstandingResponse("Sure! Here is my analysis of the message:", text);
      const model = script.get(text);
      assert.ok(model, `no model output for "${text}"`);
      return parseUnderstandingResponse(JSON.stringify(model), text);
    },
    respond: async () => {
      if (respondFails) throw new Error("provider returned 503");
      worded.push("w");
      return { reply: `WORDED(${worded.length})`, reasoningMode: "direct" as const, confidence: 0.9, stateUpdates: undefined, investigationUpdate: null, followUpCheck: null };
    },
  };
}

// ── Learners ──────────────────────────────────────────────────────────────────

const chats: string[] = [];
interface Learner { chat: string; userId: string; profileId: string; os: string; dl: string | null; deadlocks: string; paging: string; zone: string }

async function seed(name: string, o: { zone?: string | null; exam?: boolean; dl?: boolean; study?: string | null; onboarded?: boolean } = {}): Promise<Learner> {
  const chat = `${STAMP}${chats.length + 1}`;
  chats.push(chat);
  const zone = o.zone === undefined ? "Asia/Kolkata" : o.zone;
  const onboarded = o.onboarded ?? true;
  const user = await prisma.messengerUser.create({
    data: {
      platform: "telegram", platformChatId: chat, persona: "nova", displayName: name,
      novaAcademicProfile: { create: {
        onboardingComplete: onboarded, timezone: zone, preferredStudyTime: o.study ?? null,
        ...(onboarded ? { subjects: { create: { name: "Operating Systems", code: "OS" } } } : {}),
      } },
    },
    select: { id: true, novaAcademicProfile: { select: { id: true, subjects: { select: { id: true } } } } },
  });
  const profileId = user.novaAcademicProfile!.id;
  // The chat's channel row, as an earlier update would have made it, so a
  // before/after comparison compares like with like.
  if (onboarded) await prisma.novaTelegramChannel.create({ data: { profileId } });
  if (!onboarded) return { chat, userId: user.id, profileId, os: "", dl: null, deadlocks: "", paging: "", zone: zone ?? "UTC" };
  const os = user.novaAcademicProfile!.subjects[0]!.id;
  const longAgo = new Date(clock.getTime() - 5 * DAY);
  const deadlocks = await prisma.novaTopicMastery.create({ data: { subjectId: os, name: "Deadlocks", masteryProbability: 0.45, confidenceReported: 0.5, reviewCount: 2, lastStudiedAt: longAgo, nextReviewAt: new Date(clock.getTime() - DAY) } });
  const paging = await prisma.novaTopicMastery.create({ data: { subjectId: os, name: "Paging", masteryProbability: 0.7, confidenceReported: 0.7, reviewCount: 3, lastStudiedAt: longAgo, nextReviewAt: new Date(clock.getTime() + 3 * DAY) } });
  if (o.exam) await prisma.novaExam.create({ data: { profileId, subjectId: os, title: "Operating Systems final", examType: "final", scheduledAt: new Date(clock.getTime() + 26 * 3_600_000) } });
  let dl: string | null = null;
  if (o.dl) {
    dl = (await prisma.novaSubject.create({ data: { profileId, name: "Deep Learning" }, select: { id: true } })).id;
    const lately = new Date(clock.getTime() - DAY);
    for (const n of ["Backpropagation", "CNNs"]) {
      await prisma.novaTopicMastery.create({ data: { subjectId: dl, name: n, masteryProbability: 0.9, confidenceReported: 0.9, reviewCount: 4, lastStudiedAt: lately, nextReviewAt: new Date(clock.getTime() + 9 * DAY) } });
    }
  }
  return { chat, userId: user.id, profileId, os, dl, deadlocks: deadlocks.id, paging: paging.id, zone: zone ?? "UTC" };
}

let updateId = 9_000_000;
const message = (chat: string, text: string, from = chat) =>
  normalizeTelegramUpdate({ update_id: updateId++, message: { message_id: updateId, chat: { id: Number(chat), type: "private" }, from: { id: Number(from) }, text } });
const callback = (chat: string, data: string, from = chat) =>
  normalizeTelegramUpdate({ update_id: updateId++, callback_query: { id: `cb${updateId}`, data, from: { id: Number(from) }, message: { message_id: 1, chat: { id: Number(chat), type: "private" } } } });

function harness() {
  const tg = fakeTelegram();
  const ai = models();
  const run = (event: ReturnType<typeof normalizeTelegramUpdate>): Promise<TurnTrace> => {
    assert.notEqual(event.kind, "ignored");
    return handleNovaTelegramEvent(event as never, { client: tg.client, now: () => clock, webUrl: "https://nova.test", understand: ai.understand as never, respond: ai.respond, generate: ai.generate as never });
  };
  return {
    tg, ai,
    send: (l: Learner, text: string) => run(message(l.chat, text)),
    tap:  (l: Learner, label: string) => run(callback(l.chat, tg.data(l.chat, label))),
    tapData: (l: Learner, data: string, from?: string) => run(callback(l.chat, data, from)),
  };
}

// What a learner has on record that a turn could change.
async function state(l: Learner) {
  const [sessions, overrides, topics, tasks, exams, profile, channel, outbox, facts, reality] = await Promise.all([
    prisma.novaStudySession.findMany({ where: { profileId: l.profileId }, select: { status: true, topicName: true, plannedDurationMinutes: true }, orderBy: { sessionDate: "asc" } }),
    prisma.novaPlanOverride.findMany({ where: { profileId: l.profileId }, select: { kind: true, topicId: true, day: true, position: true }, orderBy: [{ kind: "asc" }, { position: "asc" }] }),
    prisma.novaTopicMastery.findMany({ where: { subject: { profileId: l.profileId } }, select: { name: true, masteryProbability: true, reviewCount: true, archivedAt: true }, orderBy: { name: "asc" } }),
    prisma.novaTask.findMany({ where: { profileId: l.profileId }, select: { title: true, status: true, dueDay: true } }),
    prisma.novaExam.count({ where: { profileId: l.profileId } }),
    prisma.novaAcademicProfile.findUniqueOrThrow({ where: { id: l.profileId }, select: { statedMinutes: true, onboardingComplete: true } }),
    prisma.novaTelegramChannel.findUnique({ where: { profileId: l.profileId }, select: { proactiveEnabled: true, proactivePausedUntil: true } }),
    prisma.novaProactiveMessage.count({ where: { profileId: l.profileId } }),
    prisma.userFact.count({ where: { userId: l.userId } }),
    prisma.userReality.count({ where: { userId: l.userId } }),
  ]);
  return { sessions, overrides, topics, tasks, exams, profile, channel, outbox, facts, reality };
}
const today = async (l: Learner) => {
  const v = await loadNovaToday(l.chat, { now: clock });
  assert.equal(v.status, "ready");
  return v.status === "ready" ? v : null!;
};
const planned = (v: Awaited<ReturnType<typeof today>>) => [v.recommendation, ...v.alternatives].filter(Boolean).map(a => a!.topicName);
const overrides = (l: Learner) => prisma.novaPlanOverride.findMany({ where: { profileId: l.profileId } });
const sessions  = (l: Learner) => prisma.novaStudySession.findMany({ where: { profileId: l.profileId }, orderBy: { sessionDate: "asc" } });
const outbox    = (l: Learner) => prisma.novaProactiveMessage.findMany({ where: { profileId: l.profileId }, orderBy: { createdAt: "asc" } });

function proactive() {
  const tg = fakeTelegram();
  const word = async (input: { studentName: string | null }) => ({ text: `NUDGE(${input.studentName})`, generated: true });
  return { tg, run: () => runNovaProactiveCron(clock, { client: tg.client, word: word as never }) };
}

before(async () => { await prisma.$queryRaw`SELECT 1`; });
after(async () => {
  await prisma.messengerUser.deleteMany({ where: { platformChatId: { in: chats } } });
  await prisma.$disconnect();
});

// ══════════════════════════════════════════════════════════════════════════════
// 1. Today
// ══════════════════════════════════════════════════════════════════════════════

test("S01 /today: the plan's first block with Start lengths, the rest of the day and the total; no model; opens one start prompt; writes nothing else", async () => {
  const l = await seed("Asha");
  const { tg, ai, send } = harness();
  const trace = await send(l, "/today");
  const v = await today(l);
  const text = tg.last(l.chat).text;
  assert.ok(text.startsWith(`${v.recommendation!.topicName} (${v.recommendation!.subjectName})\n${v.recommendation!.durationMinutes} min`), text);
  if (v.alternatives.length > 0) assert.ok(text.includes(`After that: ${v.alternatives[0]!.topicName} ${v.alternatives[0]!.durationMinutes} min`), text);
  assert.ok(text.includes(`Today: ${v.plan.totalMinutesToday} of ${v.plan.budgetMinutes} min planned.`), text);
  assert.deepEqual(tg.labels(l.chat), ["Start 15 min", "Start 25 min", "Start 45 min", "Something else", "Later"]);
  assert.equal((await loadOpenPrompt(l.profileId, clock))?.kind, "start");
  assert.deepEqual([trace.decision, ai.seen.length, (await state(l)).sessions.length], ["command:today", 0, 0]);
});

test("S02 \"Toh bhai aaj kya plan hai?\" (what_now): the same plan as /today, decided show_today, and nothing recorded", async () => {
  const l = await seed("Bilal");
  const { tg, ai, send } = harness();
  await send(l, "/today");
  const byCommand = tg.last(l.chat).text;
  const before = await state(l);
  ai.read("Toh bhai aaj kya plan hai?", { ...BASE, intent: "plan_request", request: { ...REQ, action: "what_now", asks: "about_me", language: "hinglish", promptAnswer: null } });
  const trace = await send(l, "Toh bhai aaj kya plan hai?");
  assert.equal(trace.decision, "show_today:asked_what_now");
  assert.equal(tg.last(l.chat).text, byCommand);
  assert.deepEqual((await state(l)).profile, before.profile);
});

test("S03 \"I have 40 minutes\": the stated time is recorded for today and the plan fits inside it", async () => {
  const l = await seed("Chen");
  const { ai, send } = harness();
  ai.read("I have 40 minutes", { ...BASE, request: { ...REQ, availableMinutes: 40 } });
  const trace = await send(l, "I have 40 minutes");
  assert.equal(trace.decision, "show_today:stated_time");
  assert.equal((await state(l)).profile.statedMinutes, 40);
  const v = await today(l);
  assert.ok(v.plan.totalMinutesToday <= 40, `${v.plan.totalMinutesToday} > 40`);
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. The week
// ══════════════════════════════════════════════════════════════════════════════

test("S04 /week: the next seven days from the learner's today (dates in their zone), today's planned blocks, a review on its day, an exam, a task; link only, no model, no writes", async () => {
  const l = await seed("Dana", { exam: true });
  const in2 = dayKey(new Date(clock.getTime() + 2 * DAY), l.zone);
  await prisma.novaTask.create({ data: { profileId: l.profileId, title: "Lab report", dueDay: in2 } });
  const { tg, ai, send } = harness();
  const before = await state(l);
  await send(l, "/week");
  const text = tg.last(l.chat).text;
  const first = dayKey(clock, l.zone);
  const last  = dayKey(new Date(clock.getTime() + 6 * DAY), l.zone);
  assert.ok(text.startsWith(`Next 7 days, ${dayLabel(first)} to ${dayLabel(last)}:`), text);
  assert.ok(text.includes(`Today, ${dayLabel(first)}\n- Planned: Deadlocks`), text);
  assert.ok(text.includes(`${dayLabel(dayKey(new Date(clock.getTime() + 3 * DAY), l.zone))}\n- Reviews falling due: Paging`), text);
  assert.ok(text.includes("Operating Systems final (Operating Systems)"), text);
  assert.ok(text.includes(`${dayLabel(in2)}\n- Tasks due: Lab report`), text);
  assert.deepEqual(tg.labels(l.chat), []);
  assert.equal(tg.last(l.chat).buttons.flat()[0]?.text, "Open Planner");
  assert.equal(ai.seen.length, 0);
  assert.deepEqual(await state(l), before);
});

test("S05 the week read from the Planner covers seven consecutive days starting today, across a week boundary, with only today planned", async () => {
  const l = await seed("Eli");
  const p = await loadNovaPlanner(l.chat, { now: clock, ahead: true });
  assert.equal(p.status, "ready");
  if (p.status !== "ready") return;
  assert.equal(p.week.length, 7);
  assert.equal(p.week[0]!.date, dayKey(clock, l.zone));
  for (let i = 1; i < 7; i++) assert.equal(Date.parse(p.week[i]!.date) - Date.parse(p.week[i - 1]!.date), DAY);
  assert.deepEqual(p.week.map(d => d.relation), ["today", "future", "future", "future", "future", "future", "future"]);
  assert.ok(p.week.slice(1).every(d => d.planned.length === 0), "no invented blocks on later days");
  // The calendar week is unchanged for the Planner page.
  const page = await loadNovaPlanner(l.chat, { now: clock });
  assert.ok(page.status === "ready" && new Date(`${page.week[0]!.date}T12:00:00Z`).getUTCDay() === 1, "the page's week still starts on Monday");
});

test("S06 the week names an overdue task and a session done today, and says that only today is planned", async () => {
  // Midday in their zone, so the session cannot cross their midnight.
  const l = await seed("Fay", { zone: zoneWhereHourIs(12) });
  await prisma.novaTask.create({ data: { profileId: l.profileId, title: "Old reading", dueDay: dayKey(new Date(clock.getTime() - 2 * DAY), l.zone) } });
  await runNovaSessionCommand(l.chat, { action: "start", topicName: "Deadlocks", subjectName: "Operating Systems", plannedMinutes: 25 }, clock, "web");
  await runNovaSessionCommand(l.chat, { action: "end", outcome: "okay" }, tick(25), "web");
  const { tg, send } = harness();
  await send(l, "/week");
  const text = tg.last(l.chat).text;
  assert.ok(text.includes("- Done: 1 session, 25 min"), text);
  assert.ok(text.includes("Overdue: 1 task."), text);
  assert.ok(text.includes("Only today has a plan"), text);
});

test("S07 \"What is my next one-week plan?\" with a proactive nudge open: the week, and the nudge is still the open prompt", async () => {
  const l = await seed("Gita", { zone: zoneWhereHourIs(18), study: "evening" });
  const { run, tg: out } = proactive();
  await run();
  assert.equal(out.to(l.chat).length, 1);
  const nudge = await loadOpenPrompt(l.profileId, clock);
  assert.equal(nudge?.kind, "nudge");
  const { tg, ai, send } = harness();
  ai.read("What is my next one-week plan?", { ...BASE, request: { ...REQ, action: "week_plan", asks: "about_me", promptAnswer: "a" } });
  const trace = await send(l, "What is my next one-week plan?");
  assert.equal(trace.decision, "show_week:asked_week");
  assert.ok(tg.last(l.chat).text.startsWith("Next 7 days"));
  assert.equal((await loadOpenPrompt(l.profileId, clock))?.id, nudge!.id);
  assert.equal((await sessions(l)).length, 0, "the nudge's Start was not taken");
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. Changing today's plan
// ══════════════════════════════════════════════════════════════════════════════

test("S08 \"I want to update today's goals\": the plan with Skip / First / Change my time / Nothing; nothing written until a tap", async () => {
  const l = await seed("Hao");
  const { tg, ai, send } = harness();
  const v = await today(l);
  ai.read("I want to update today's goals", { ...BASE, request: { ...REQ, action: "change_plan" } });
  const trace = await send(l, "I want to update today's goals");
  assert.equal(trace.decision, "change_plan:asked_change_plan");
  const names = planned(v);
  assert.deepEqual(tg.labels(l.chat), [...names.slice(0, 3).map(n => `Skip: ${n}`), ...(names[1] ? [`First: ${names[1]}`] : []), "Change my time", "Nothing"]);
  assert.equal((await overrides(l)).length, 0);
  assert.equal((await loadOpenPrompt(l.profileId, clock))?.kind, "change_plan");
});

test("S09 Hinglish \"Aaj ke plans update karne hain\": the same flow, and \"Nothing\" changes nothing", async () => {
  const l = await seed("Isha");
  const { tg, ai, send, tap } = harness();
  ai.read("Aaj ke plans update karne hain", { ...BASE, request: { ...REQ, action: "change_plan", language: "hinglish" } });
  assert.equal((await send(l, "Aaj ke plans update karne hain")).decision, "change_plan:asked_change_plan");
  const before = await state(l);
  await tap(l, "Nothing");
  // In the language they wrote in.
  assert.equal(tg.last(l.chat).text, TEXT_HINGLISH.dismissed);
  assert.deepEqual(await state(l), before);
});

test("S10 \"First: <second block>\": one order for today, the recommendation becomes that block, the web plan agrees", async () => {
  const l = await seed("Jon");
  const { ai, send, tap } = harness();
  const names = planned(await today(l));
  assert.ok(names.length >= 2, `needs two blocks: ${names}`);
  ai.read("reorder today", { ...BASE, request: { ...REQ, action: "change_plan" } });
  await send(l, "reorder today");
  await tap(l, `First: ${names[1]}`);
  const rows = await overrides(l);
  assert.ok(rows.every(r => r.kind === "order" && r.day === dayKey(clock, l.zone)));
  assert.equal((await prisma.novaTopicMastery.findUnique({ where: { id: rows.find(r => r.position === 0)!.topicId } }))!.name, names[1]);
  assert.equal((await today(l)).recommendation?.topicName, names[1]);
  const p = await loadNovaPlanner(l.chat, { now: clock });
  assert.ok(p.status === "ready" && p.today.blocks[0]!.topicName === names[1]);
});

test("S11 naming a topic of theirs that is not on today's plan offers to add it; \"Add it today\" puts it on the plan once", async () => {
  const l = await seed("Kiri", { dl: true });
  const { tg, ai, send, tap } = harness();
  assert.ok(!planned(await today(l)).includes("Backpropagation"));
  ai.read("add backpropagation to today", { ...BASE, topic: "Backpropagation", topicConfidence: 0.9, request: { ...REQ, action: "change_plan" } });
  await send(l, "add backpropagation to today");
  assert.ok(tg.last(l.chat).text.startsWith("Add Backpropagation (Deep Learning) to today's plan?"), tg.last(l.chat).text);
  assert.deepEqual(tg.labels(l.chat), ["Add it today", "No"]);
  await tap(l, "Add it today");
  assert.deepEqual((await overrides(l)).map(r => r.kind), ["pin"]);
  assert.ok(tg.last(l.chat).text.startsWith("Done: Backpropagation is on today's plan."), tg.last(l.chat).text);
  assert.ok(planned(await today(l)).includes("Backpropagation"));
});

test("S12 naming a topic on record nowhere: said so, offered as an addition, and nothing is created", async () => {
  const l = await seed("Lior");
  const { tg, ai, send } = harness();
  const before = await state(l);
  ai.read("drop quantum physics from today", { ...BASE, topic: "Quantum Physics", topicConfidence: 0.9, request: { ...REQ, action: "change_plan" } });
  await send(l, "drop quantum physics from today");
  assert.ok(tg.last(l.chat).text.startsWith("Quantum Physics isn't one of your subjects or topics yet"), tg.last(l.chat).text);
  assert.deepEqual(await state(l), before);
});

test("S13 \"aaj sirf 30 min hai, plan update karo\": the stated time is recorded and the day refitted; a topic in the same message is not skipped", async () => {
  const l = await seed("Mei");
  const { tg, ai, send } = harness();
  ai.read("aaj sirf 30 min hai, deadlocks wala plan update karo", { ...BASE, topic: "Deadlocks", topicConfidence: 0.8, request: { ...REQ, action: "change_plan", availableMinutes: 30, language: "hinglish" } });
  await send(l, "aaj sirf 30 min hai, deadlocks wala plan update karo");
  assert.ok(tg.last(l.chat).text.startsWith("Today is now fitted to 30 min."), tg.last(l.chat).text);
  const s = await state(l);
  assert.equal(s.profile.statedMinutes, 30);
  assert.equal(s.overrides.length, 0);
  assert.ok((await today(l)).plan.totalMinutesToday <= 30);
});

test("S14 \"Change my time\" then \"60 min\": two taps, one recorded stated time of 60", async () => {
  const l = await seed("Nasr");
  const { tg, ai, send, tap } = harness();
  ai.read("change today's plan", { ...BASE, request: { ...REQ, action: "change_plan" } });
  await send(l, "change today's plan");
  await tap(l, "Change my time");
  assert.deepEqual(tg.labels(l.chat), ["15 min", "30 min", "45 min", "60 min", "90 min", "120 min"]);
  await tap(l, "60 min");
  assert.equal((await state(l)).profile.statedMinutes, 60);
});

test("S15 Skip, then Undo, then Undo again: the skip is written once, removed once, and the second Undo is closed", async () => {
  const l = await seed("Omar");
  const { tg, ai, send, tap, tapData } = harness();
  const first = (await today(l)).recommendation!.topicName;
  ai.read("change today's plan", { ...BASE, request: { ...REQ, action: "change_plan" } });
  await send(l, "change today's plan");
  await tap(l, `Skip: ${first}`);
  assert.equal((await overrides(l)).length, 1);
  assert.notEqual((await today(l)).recommendation?.topicName, first);
  const undo = tg.data(l.chat, "Undo");
  assert.equal((await tapData(l, undo)).failure, "none");
  assert.equal((await tapData(l, undo)).failure, "stale_prompt");
  assert.equal((await overrides(l)).length, 0);
  assert.equal((await today(l)).recommendation?.topicName, first);
});

test("S16 the same Skip tapped three times at once: one change, two closed", async () => {
  const l = await seed("Pia");
  const { tg, ai, send, tapData } = harness();
  const first = (await today(l)).recommendation!.topicName;
  ai.read("change today's plan", { ...BASE, request: { ...REQ, action: "change_plan" } });
  await send(l, "change today's plan");
  const skip = tg.data(l.chat, `Skip: ${first}`);
  const r = await Promise.all([tapData(l, skip), tapData(l, skip), tapData(l, skip)]);
  assert.deepEqual(r.map(x => x.failure).sort(), ["none", "stale_prompt", "stale_prompt"]);
  assert.equal((await overrides(l)).length, 1);
  assert.equal(tg.to(l.chat).filter(m => m.text.startsWith("Done: ")).length, 1, "one confirmation");
});

test("S17 a named skip confirmed with \"Keep it\" writes nothing; confirmed with \"Skip it today\" writes exactly that skip", async () => {
  const l = await seed("Quin");
  const { tg, ai, send, tap } = harness();
  ai.read("deadlocks aaj nahi", { ...BASE, topic: "Deadlocks", topicConfidence: 0.9, request: { ...REQ, action: "change_plan", language: "hinglish" } });
  await send(l, "deadlocks aaj nahi");
  assert.deepEqual(tg.labels(l.chat), ["Skip it today", "Keep it"]);
  await tap(l, "Keep it");
  assert.equal((await overrides(l)).length, 0);
  await send(l, "deadlocks aaj nahi");
  await tap(l, "Skip it today");
  assert.deepEqual((await overrides(l)).map(r => [r.kind, r.topicId]), [["skip", l.deadlocks]]);
});

test("S18 a change prompt older than its 30 minutes is closed: a tap changes nothing", async () => {
  const l = await seed("Rui");
  const { tg, ai, send, tapData } = harness();
  const first = (await today(l)).recommendation!.topicName;
  ai.read("change today's plan", { ...BASE, request: { ...REQ, action: "change_plan" } });
  await send(l, "change today's plan");
  const skip = tg.data(l.chat, `Skip: ${first}`);
  tick(31);
  assert.equal((await tapData(l, skip)).failure, "stale_prompt");
  assert.equal((await overrides(l)).length, 0);
});

test("S19 a change prompt replaced by /today is superseded: its Skip changes nothing", async () => {
  const l = await seed("Sana");
  const { tg, ai, send, tapData } = harness();
  const first = (await today(l)).recommendation!.topicName;
  ai.read("change today's plan", { ...BASE, request: { ...REQ, action: "change_plan" } });
  await send(l, "change today's plan");
  const skip = tg.data(l.chat, `Skip: ${first}`);
  await send(l, "/today");
  assert.equal((await tapData(l, skip)).failure, "stale_prompt");
  assert.equal((await overrides(l)).length, 0);
});

test("S20 a skip is for the learner's day only: after their midnight the topic is planned again and nothing says it was left out", async () => {
  const l = await seed("Tao", { zone: zoneWhereHourIs(23) });
  const { tg, ai, send, tap } = harness();
  const first = (await today(l)).recommendation!.topicName;
  ai.read("change today's plan", { ...BASE, request: { ...REQ, action: "change_plan" } });
  await send(l, "change today's plan");
  await tap(l, `Skip: ${first}`);
  const skippedDay = dayKey(clock, l.zone);
  assert.equal((await overrides(l))[0]!.day, skippedDay);
  while (dayKey(clock, l.zone) === skippedDay) tick(15);
  const v = await today(l);
  assert.ok(planned(v).includes(first), `${first} is back on ${dayKey(clock, l.zone)}`);
  assert.deepEqual(v.planChanges?.skipped ?? [], []);
  await send(l, "/today");
  assert.ok(!tg.last(l.chat).text.includes("Left out today"));
});

// ══════════════════════════════════════════════════════════════════════════════
// 4–5. A different topic, existing and unknown
// ══════════════════════════════════════════════════════════════════════════════

test("S21 \"kuch Deep Learning se related bata\" (subject named), with the card's own Something else attached: their Deep Learning topics, Start one, the session is under Deep Learning", async () => {
  const l = await seed("Uma", { dl: true });
  const { tg, ai, send, tap } = harness();
  await send(l, "/today");
  const plan = planned(await today(l));
  ai.read("Ye hi padhna hai, kuch Deep Learning se related bata", { ...BASE, topic: "Deep Learning", topicConfidence: 0.9, request: { ...REQ, action: "something_else", promptAnswer: "d", language: "hinglish" } });
  const trace = await send(l, "Ye hi padhna hai, kuch Deep Learning se related bata");
  assert.equal(trace.decision, "something_else:asked_for_named_alternative");
  assert.deepEqual(tg.labels(l.chat), ["Backpropagation · 25 min", "CNNs · 25 min", "Later"]);
  for (const name of plan) assert.ok(!tg.last(l.chat).text.includes(name), `${name} is not offered`);
  await tap(l, "CNNs · 25 min");
  const [row] = await sessions(l);
  assert.deepEqual([row!.topicName, row!.subjectId, row!.plannedDurationMinutes], ["CNNs", l.dl, 25]);
});

test("S22 a topic named in lower case and plural (\"cnns\") is matched to the learner's own \"CNNs\"", async () => {
  const l = await seed("Vik", { dl: true });
  const { tg, ai, send } = harness();
  ai.read("something on cnns instead", { ...BASE, topic: "cnns", topicConfidence: 0.9, request: { ...REQ, action: "something_else" } });
  await send(l, "something on cnns instead");
  assert.deepEqual(tg.labels(l.chat), ["CNNs · 25 min", "Later"]);
});

test("S23 a named topic that is on today's plan gets that block's card, with its reasons", async () => {
  const l = await seed("Wen");
  const { tg, ai, send } = harness();
  const v = await today(l);
  const second = [v.recommendation, ...v.alternatives].filter(Boolean)[1]!;
  ai.read(`something with ${second.topicName} instead`, { ...BASE, topic: second.topicName, topicConfidence: 0.9, request: { ...REQ, action: "something_else" } });
  await send(l, `something with ${second.topicName} instead`);
  assert.ok(tg.last(l.chat).text.startsWith(`${second.topicName} (${second.subjectName})`), tg.last(l.chat).text);
  assert.ok(tg.labels(l.chat).includes("Start 25 min"));
});

test("S24 an unknown topic is offered under one of their subjects; the tap adds it once and a second tap is closed", async () => {
  const l = await seed("Xia", { dl: true });
  const { tg, ai, send, tap, tapData } = harness();
  ai.read("kuch Quantum Computing se related bata", { ...BASE, topic: "Quantum Computing", topicConfidence: 0.9, request: { ...REQ, action: "something_else", language: "hinglish" } });
  await send(l, "kuch Quantum Computing se related bata");
  assert.deepEqual(tg.labels(l.chat), ["Operating Systems", "Deep Learning", "No"]);
  const add = tg.data(l.chat, "Deep Learning");
  await tap(l, "Deep Learning");
  const created = await prisma.novaTopicMastery.findMany({ where: { subjectId: l.dl!, name: "Quantum Computing" } });
  assert.equal(created.length, 1);
  assert.deepEqual([created[0]!.reviewCount, created[0]!.lastStudiedAt], [0, null], "declared, not studied");
  assert.equal((await tapData(l, add)).failure, "stale_prompt");
  assert.equal(await prisma.novaTopicMastery.count({ where: { subjectId: l.dl!, name: "Quantum Computing" } }), 1);
});

test("S25 a plain \"something else\" offers the next block of today's plan, never the one just offered", async () => {
  const l = await seed("Yan");
  const { tg, ai, send } = harness();
  const v = await today(l);
  ai.read("something else", { ...BASE, request: { ...REQ, action: "something_else" } });
  const trace = await send(l, "something else");
  assert.equal(trace.decision, "something_else:asked_for_alternative");
  assert.ok(!tg.last(l.chat).text.startsWith(`${v.recommendation!.topicName} (`), tg.last(l.chat).text);
});

test("S26 stress read as \"something else\" with no topic is answered as a feeling: worded, no card, no buttons", async () => {
  const l = await seed("Zed");
  const { tg, ai, send } = harness();
  await send(l, "/today");
  ai.read("ugh this is too much, kuch aur", { ...BASE, intent: "emotional_vent", emotion: "overwhelmed", request: { ...REQ, action: "something_else" } });
  const trace = await send(l, "ugh this is too much, kuch aur");
  assert.equal(trace.decision, "converse:feeling_not_alternative");
  assert.ok(tg.last(l.chat).text.startsWith("WORDED("));
  assert.deepEqual(tg.labels(l.chat), []);
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. Progress
// ══════════════════════════════════════════════════════════════════════════════

test("S27 /progress with nothing counted: says so plainly, with the rule for what counts; no streak, no card", async () => {
  const l = await seed("Abe");
  const { tg, ai, send } = harness();
  await send(l, "/progress");
  const text = tg.last(l.chat).text;
  assert.ok(text.startsWith("No counted study sessions on record yet"), text);
  assert.ok(!/streak/i.test(text));
  assert.deepEqual(tg.labels(l.chat), []);
  assert.equal(ai.seen.length, 0);
});

test("S28 progress after one counted and one short session: this week, today, since when, and the short one listed as not counted", async () => {
  // Midday in their zone, so the sessions cannot cross their midnight or week.
  const l = await seed("Bea", { zone: zoneWhereHourIs(12) });
  await runNovaSessionCommand(l.chat, { action: "start", topicName: "Deadlocks", subjectName: "Operating Systems", plannedMinutes: 30 }, clock, "web");
  await runNovaSessionCommand(l.chat, { action: "end", outcome: "good" }, tick(30), "web");
  await runNovaSessionCommand(l.chat, { action: "start", topicName: "Paging", subjectName: "Operating Systems", plannedMinutes: 25 }, tick(5), "web");
  await runNovaSessionCommand(l.chat, { action: "end", outcome: "okay" }, tick(4), "web");
  const { tg, ai, send } = harness();
  ai.read("How is my progress going?", { ...BASE, intent: "progress_check", request: { ...REQ, action: "progress", asks: "about_me" } });
  assert.equal((await send(l, "How is my progress going?")).decision, "show_progress:asked_progress");
  const text = tg.last(l.chat).text;
  assert.ok(text.includes("This week so far: 1 session, 30 min, 1 active day."), text);
  assert.ok(text.includes(`Since ${dayLabel(dayKey(clock, l.zone))}: 1 session, 30 min`), text);
  assert.ok(text.includes("Not counted: 1 under 10 minutes."), text);
});

test("S29 Hinglish \"kitna progress hua mera\" is the same progress, read-only", async () => {
  const l = await seed("Cai");
  const { tg, ai, send } = harness();
  const before = await state(l);
  ai.read("kitna progress hua mera", { ...BASE, intent: "progress_check", request: { ...REQ, action: "progress", asks: "about_me", language: "hinglish" } });
  assert.equal((await send(l, "kitna progress hua mera")).decision, "show_progress:asked_progress");
  assert.ok(tg.last(l.chat).text.startsWith("No counted study sessions on record yet"));
  const { outbox: _o, ...after } = await state(l);
  const { outbox: _b, ...was } = before;
  assert.deepEqual(after.sessions, was.sessions);
  assert.deepEqual(after.topics, was.topics);
});

// ══════════════════════════════════════════════════════════════════════════════
// 7. Focus sessions
// ══════════════════════════════════════════════════════════════════════════════

test("S30 /focus then Start 25: one canonical session, in progress, the web sees it", async () => {
  const l = await seed("Dov");
  const { tg, send, tap } = harness();
  await send(l, "/focus");
  assert.ok(tg.labels(l.chat).includes("Start 25 min"));
  await tap(l, "Start 25 min");
  const rows = await sessions(l);
  assert.deepEqual(rows.map(r => [r.status, r.plannedDurationMinutes, r.subjectId]), [["in_progress", 25, l.os]]);
  assert.equal((await loadNovaSession(l.chat, clock))?.id, rows[0]!.id);
  assert.deepEqual(tg.labels(l.chat), ["Pause", "End"]);
});

test("S31 typed \"pause\" and \"back\" pause and resume the running session; a second \"pause\" while paused changes nothing", async () => {
  const l = await seed("Eva");
  const { ai, send, tap } = harness();
  await send(l, "/focus");
  await tap(l, "Start 25 min");
  tick(10);
  ai.read("pause", { ...BASE, request: { ...REQ, action: "pause_session" } });
  assert.equal((await send(l, "pause")).decision, "pause_session:pause_requested");
  assert.equal((await loadNovaSession(l.chat, clock))?.status, "paused");
  assert.equal((await send(l, "pause")).decision, "show_status:pause_not_applicable");
  tick(5);
  ai.read("back", { ...BASE, request: { ...REQ, action: "resume_session" } });
  assert.equal((await send(l, "back")).decision, "resume_session:resume_paused");
  assert.equal((await loadNovaSession(l.chat, clock))?.status, "in_progress");
});

test("S32 /done asks how it went; Good ends the session once, moves the topic's record, and a second Good is closed", async () => {
  const l = await seed("Fin");
  const { tg, send, tap, tapData } = harness();
  await send(l, "/focus");
  await tap(l, "Start 25 min");
  const reviewed = (await prisma.novaTopicMastery.findUniqueOrThrow({ where: { id: l.deadlocks } })).reviewCount;
  tick(26);
  await send(l, "/done");
  assert.deepEqual(tg.labels(l.chat), ["Struggled", "Okay", "Good", "Crushed it"]);
  const good = tg.data(l.chat, "Good");
  await tap(l, "Good");
  const [row] = await sessions(l);
  assert.equal(row!.status, "completed");
  assert.equal((row!.executionReport as { outcome: string }).outcome, "good");
  assert.equal((await prisma.novaTopicMastery.findUniqueOrThrow({ where: { id: l.deadlocks } })).reviewCount, reviewed + 1);
  assert.equal((await tapData(l, good)).failure, "stale_prompt");
  assert.equal((await prisma.novaTopicMastery.findUniqueOrThrow({ where: { id: l.deadlocks } })).reviewCount, reviewed + 1);
});

test("S33 asking to start while a session runs shows that session; still one session", async () => {
  const l = await seed("Gus");
  const { ai, send, tap } = harness();
  await send(l, "/focus");
  await tap(l, "Start 25 min");
  ai.read("start paging now", { ...BASE, topic: "Paging", topicConfidence: 0.9, request: { ...REQ, action: "start_session", confidence: 0.95 } });
  assert.equal((await send(l, "start paging now")).decision, "show_status:already_running");
  assert.equal((await sessions(l)).length, 1);
});

test("S34 /done with nothing running says so, and ends nothing", async () => {
  const l = await seed("Hal");
  const { tg, send } = harness();
  await send(l, "/done");
  assert.equal(tg.last(l.chat).text, TEXT.nothingRunning);
  assert.equal((await sessions(l)).length, 0);
});

test("S35 a session ended under ten minutes is kept and said so, and moves no mastery", async () => {
  const l = await seed("Ida");
  const { tg, send, tap } = harness();
  await send(l, "/focus");
  await tap(l, "Start 25 min");
  const before = await prisma.novaTopicMastery.findUniqueOrThrow({ where: { id: l.deadlocks } });
  tick(5);
  await send(l, "/done");
  await tap(l, "Okay");
  assert.ok(tg.last(l.chat).text.includes("Under 10 minutes"), tg.last(l.chat).text);
  const afterRow = await prisma.novaTopicMastery.findUniqueOrThrow({ where: { id: l.deadlocks } });
  assert.deepEqual([afterRow.reviewCount, afterRow.masteryProbability], [before.reviewCount, before.masteryProbability]);
});

test("S36 declining: \"Later\" pauses nothing; typed \"not today\" quiets nudges until the learner's midnight", async () => {
  const l = await seed("Jai");
  const { tg, ai, send, tap } = harness();
  await send(l, "/today");
  await tap(l, "Later");
  assert.equal(tg.last(l.chat).text, TEXT.later);
  assert.equal((await state(l)).channel?.proactivePausedUntil, null);
  ai.read("not today", { ...BASE, request: { ...REQ, action: "not_now", deferUntil: "tomorrow" } });
  await send(l, "not today");
  const paused = (await state(l)).channel!.proactivePausedUntil!;
  assert.ok(paused > clock && dayKey(paused, l.zone) !== dayKey(clock, l.zone));
  assert.equal((await sessions(l)).length, 0);
});

// ══════════════════════════════════════════════════════════════════════════════
// 8–9. Pending prompts, unsupported, reminders
// ══════════════════════════════════════════════════════════════════════════════

test("S37 with \"How did it go?\" open, asking for the week shows the week; the session keeps running and the question stays open", async () => {
  const l = await seed("Kai");
  const { ai, send, tap } = harness();
  await send(l, "/focus");
  await tap(l, "Start 25 min");
  tick(20);
  await send(l, "/done");
  const question = await loadOpenPrompt(l.profileId, clock);
  assert.equal(question?.kind, "session_outcome");
  ai.read("what's my week looking like", { ...BASE, request: { ...REQ, action: "week_plan", promptAnswer: "b" } });
  assert.equal((await send(l, "what's my week looking like")).decision, "show_week:asked_week");
  assert.equal((await loadNovaSession(l.chat, clock))?.status, "in_progress", "not ended by the attached option");
  assert.equal((await loadOpenPrompt(l.profileId, clock))?.id, question!.id);
});

test("S38 with a start card open, \"how am I doing\" carrying the card's Start option shows progress and starts nothing", async () => {
  const l = await seed("Lea");
  const { ai, send } = harness();
  await send(l, "/today");
  const card = await loadOpenPrompt(l.profileId, clock);
  ai.read("how am I doing", { ...BASE, request: { ...REQ, action: "progress", promptAnswer: "b" } });
  assert.equal((await send(l, "how am I doing")).decision, "show_progress:asked_progress");
  assert.equal((await sessions(l)).length, 0);
  assert.equal((await loadOpenPrompt(l.profileId, clock))?.id, card!.id);
});

test("S39 a reminder request, even with the card's Later attached, says nothing was scheduled, stores nothing, and keeps the card", async () => {
  const l = await seed("Mo");
  const { tg, ai, send } = harness();
  await send(l, "/today");
  const card = await loadOpenPrompt(l.profileId, clock);
  ai.read("remind me at 8 pm to study", { ...BASE, intent: "schedule_query", request: { ...REQ, action: "set_reminder", promptAnswer: "e" } });
  assert.equal((await send(l, "remind me at 8 pm to study")).decision, "reminder_unavailable:reminder_not_supported");
  assert.equal(tg.last(l.chat).text, TEXT.reminderUnavailable);
  assert.equal((await state(l)).outbox, 0);
  assert.equal((await state(l)).channel?.proactivePausedUntil, null, "not read as a \"not today\"");
  assert.equal((await loadOpenPrompt(l.profileId, clock))?.id, card!.id);
});

test("S40 an unsupported request is refused honestly, with what Nova does do, and changes no record", async () => {
  const l = await seed("Nia");
  const { tg, ai, send } = harness();
  await send(l, "/today");
  const before = await state(l);
  ai.read("write my history essay", { ...BASE, request: { ...REQ, clarity: "unsupported" } });
  assert.equal((await send(l, "write my history essay")).decision, "unsupported:unsupported_request");
  assert.equal(tg.last(l.chat).text, TEXT.unsupported);
  assert.deepEqual(tg.labels(l.chat), []);
  const after = await state(l);
  assert.deepEqual([after.sessions, after.overrides, after.topics, after.tasks, after.profile], [before.sessions, before.overrides, before.topics, before.tasks, before.profile]);
});

// ══════════════════════════════════════════════════════════════════════════════
// 10–11. Callbacks: ownership and forgery
// ══════════════════════════════════════════════════════════════════════════════

test("S41 another learner's Start button in my chat is refused, and neither of us gets a session", async () => {
  const a = await seed("Oli");
  const b = await seed("Pam");
  const { tg, send, tapData } = harness();
  await send(a, "/today");
  const theirs = tg.data(a.chat, "Start 25 min");
  assert.equal((await tapData(b, theirs)).failure, "forged_callback");
  assert.deepEqual([(await sessions(a)).length, (await sessions(b)).length], [0, 0]);
  // a's own button still works afterwards.
  assert.equal((await tapData(a, theirs)).failure, "none");
});

test("S42 a tap from someone other than the chat's owner is refused; malformed and unknown data change nothing", async () => {
  const l = await seed("Qiu");
  const { tg, send, tapData } = harness();
  await send(l, "/today");
  const start = tg.data(l.chat, "Start 25 min");
  assert.equal((await tapData(l, start, "123456789")).failure, "forged_callback");
  assert.equal((await tapData(l, "garbage")).failure, "forged_callback");
  assert.equal((await tapData(l, encodeCallback("cnotarealpromptid000000", "a"))).failure, "forged_callback");
  assert.equal(normalizeTelegramUpdate({ update_id: 1, callback_query: { id: "x", data: "p:".padEnd(80, "a"), from: { id: Number(l.chat) }, message: { message_id: 1, chat: { id: Number(l.chat), type: "private" } } } }).kind, "ignored");
  assert.equal((await sessions(l)).length, 0);
});

// ══════════════════════════════════════════════════════════════════════════════
// 12. Tasks in the proactive tick
// ══════════════════════════════════════════════════════════════════════════════

test("S43 an open task due today is the evening's message, once, naming the task with no Start button", async () => {
  const l = await seed("Raj", { zone: zoneWhereHourIs(18), study: "evening" });
  await prisma.novaTask.create({ data: { profileId: l.profileId, title: "Submit lab 3", dueDay: dayKey(clock, l.zone) } });
  const { tg, run } = proactive();
  await run(); await run();
  const rows = await outbox(l);
  assert.deepEqual(rows.map(r => [r.eventType, r.status]), [["task_due", "sent"]]);
  assert.equal(tg.to(l.chat).length, 1);
  assert.ok(!tg.to(l.chat)[0]!.buttons.flat().some(b => b.text.startsWith("Start")));
});

test("S44 a task finished before the tick is not a reason any more: the message is about something still due", async () => {
  const l = await seed("Sol", { zone: zoneWhereHourIs(18), study: "evening" });
  await prisma.novaTask.create({ data: { profileId: l.profileId, title: "Submit lab 3", dueDay: dayKey(clock, l.zone), status: "done", completedAt: clock } });
  const { run } = proactive();
  await run();
  assert.ok((await outbox(l)).every(r => r.eventType !== "task_due"));
});

// ══════════════════════════════════════════════════════════════════════════════
// 13. Model failure
// ══════════════════════════════════════════════════════════════════════════════

test("S45 the reading model down (503): words get \"I can't read messages right now\" and no card; /today, /week, /progress and buttons still work", async () => {
  const l = await seed("Tia");
  const { tg, ai, send, tap } = harness();
  ai.breakUnderstanding("throw");
  const trace = await send(l, "what's the plan");
  assert.deepEqual([trace.failure, tg.last(l.chat).text], ["understanding_failed", TEXT.notUnderstood]);
  assert.deepEqual(tg.labels(l.chat), []);
  for (const c of ["/week", "/progress", "/today"]) assert.equal((await send(l, c)).send.status, "sent");
  await tap(l, "Start 25 min");
  assert.equal((await sessions(l)).length, 1);
});

test("S46 the reading model timing out is the same: an honest line, nothing written", async () => {
  const l = await seed("Udo");
  const { tg, ai, send } = harness();
  const before = await state(l);
  ai.breakUnderstanding("timeout");
  assert.equal((await send(l, "change today's plan")).failure, "understanding_failed");
  assert.equal(tg.last(l.chat).text, TEXT.notUnderstood);
  assert.deepEqual((await state(l)).overrides, before.overrides);
});

test("S47 a malformed reading proposes nothing: no change flow, no session, no override", async () => {
  const l = await seed("Val");
  const { tg, ai, send } = harness();
  const before = await state(l);
  ai.breakUnderstanding("garbage");
  assert.equal((await send(l, "skip deadlocks today")).failure, "understanding_malformed");
  assert.equal(tg.last(l.chat).text, TEXT.notUnderstood);
  const after = await state(l);
  assert.deepEqual([after.sessions, after.overrides], [before.sessions, before.overrides]);
});

test("S48 the wording model failing on a conversation turn sends the plain fallback, and says so in the trace", async () => {
  const l = await seed("Wes");
  const { tg, ai, send } = harness();
  ai.breakResponse(true);
  ai.read("ok thanks", { ...BASE, request: { ...REQ } });
  const trace = await send(l, "ok thanks");
  assert.equal(trace.failure, "response_failed");
  assert.equal(tg.last(l.chat).text, TEXT.converseFallback);
});

// ══════════════════════════════════════════════════════════════════════════════
// 14–15. Duplicate updates, scheduler retries, quiet hours, preferences
// ══════════════════════════════════════════════════════════════════════════════

test("S49 the same Telegram update_id twice is admitted once; a wrong webhook secret is refused", async () => {
  const id = Number(`${STAMP}`.slice(-9));
  assert.deepEqual(await admitTelegramUpdate({ secretHeader: null, updateId: id }), { admit: true, status: 200, reason: "ok" });
  assert.deepEqual(await admitTelegramUpdate({ secretHeader: null, updateId: id }), { admit: false, status: 200, reason: "duplicate_update" });
  process.env.TELEGRAM_WEBHOOK_SECRET = "test-secret-value";
  try {
    assert.deepEqual(await admitTelegramUpdate({ secretHeader: "wrong", updateId: id + 1 }), { admit: false, status: 401, reason: "bad_secret" });
    assert.equal((await admitTelegramUpdate({ secretHeader: "test-secret-value", updateId: id + 1 })).admit, true);
  } finally {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
  }
});

test("S50 a due review at the usual hour goes out once however many ticks run; a failed send is retried once and delivered once", async () => {
  const l = await seed("Xan", { zone: zoneWhereHourIs(18), study: "evening" });
  const { tg, run } = proactive();
  tg.failNext({ ok: false, kind: "server", detail: "Bad Gateway" }, l.chat);
  await run();
  assert.equal((await outbox(l))[0]?.status, "failed");
  await run(); await run(); await run();
  const rows = await outbox(l);
  assert.equal(rows.length, 1, "one logical message");
  assert.equal(rows[0]!.status, "sent");
  assert.equal(tg.to(l.chat).filter(m => m.messageId !== null).length, 1, "delivered once");
});

test("S51 quiet hours: a learner at 23:00 local is not messaged and nothing is claimed", async () => {
  const l = await seed("Yas", { zone: zoneWhereHourIs(23), study: "night" });
  const { tg, run } = proactive();
  await run();
  assert.deepEqual([tg.to(l.chat).length, (await outbox(l)).length], [0, 0]);
});

test("S52 nudges turned off in /settings: the tick sends nothing; turned back on, it may", async () => {
  const l = await seed("Zoe", { zone: zoneWhereHourIs(18), study: "evening" });
  const { tg, send, tap } = harness();
  await send(l, "/settings");
  await tap(l, "Turn nudges off");
  assert.equal((await state(l)).channel?.proactiveEnabled, false);
  const p = proactive();
  await p.run();
  assert.equal(p.tg.to(l.chat).length, 0);
  assert.equal(tg.last(l.chat).text, TEXT.nudgesOff);
});

test("S53 a learner who wrote a moment ago is not nudged by the next tick", async () => {
  const l = await seed("Ari", { zone: zoneWhereHourIs(18), study: "evening" });
  const { ai, send } = harness();
  ai.read("hey", { ...BASE, request: { ...REQ } });
  await send(l, "hey");
  const p = proactive();
  await p.run();
  assert.equal(p.tg.to(l.chat).length, 0);
});

// ══════════════════════════════════════════════════════════════════════════════
// 16. Empty and unfinished learners
// ══════════════════════════════════════════════════════════════════════════════

test("S54 setup not finished: /today, /week and /progress ask for what Nova needs, and a sentence about subjects is offered back, not saved", async () => {
  const l = await seed("Bo", { onboarded: false });
  const { tg, ai, send } = harness();
  for (const c of ["/today", "/week", "/progress"]) {
    await send(l, c);
    assert.ok(tg.last(l.chat).text.startsWith("I'm Nova. Before I can plan anything"), `${c}: ${tg.last(l.chat).text}`);
  }
  ai.read("this sem I have OS and DBMS", { ...BASE, request: { ...REQ, setup: { subjects: ["OS", "DBMS"], subject: null, topics: [], dailyMinutes: null, studyTime: null } } });
  await send(l, "this sem I have OS and DBMS");
  assert.equal((await loadOpenPrompt(l.profileId, clock))?.kind, "confirm_setup");
  assert.equal(await prisma.novaSubject.count({ where: { profileId: l.profileId } }), 0);
});

test("S55 every topic archived: today has nothing planned, the week says why, progress says nothing is counted; nothing invented", async () => {
  const l = await seed("Cy");
  await prisma.novaTopicMastery.updateMany({ where: { subjectId: l.os }, data: { archivedAt: clock } });
  const { tg, send } = harness();
  await send(l, "/today");
  assert.deepEqual(tg.labels(l.chat), []);
  await send(l, "/week");
  assert.ok(tg.last(l.chat).text.includes("- Planned: nothing (no topics on record yet)"), tg.last(l.chat).text);
  assert.ok(!tg.last(l.chat).text.includes("Deadlocks"));
  await send(l, "/progress");
  assert.ok(tg.last(l.chat).text.startsWith("No counted study sessions"));
});

// ══════════════════════════════════════════════════════════════════════════════
// 17–19. Boundaries, long input, commands and the menu
// ══════════════════════════════════════════════════════════════════════════════

test("S56 the week turns over at the learner's midnight, not the server's", async () => {
  const l = await seed("Dee", { zone: zoneWhereHourIs(23) });
  const { tg, send } = harness();
  await send(l, "/week");
  const before = dayKey(clock, l.zone);
  assert.ok(tg.last(l.chat).text.startsWith(`Next 7 days, ${dayLabel(before)}`));
  while (dayKey(clock, l.zone) === before) tick(15);
  await send(l, "/week");
  assert.ok(tg.last(l.chat).text.startsWith(`Next 7 days, ${dayLabel(dayKey(clock, l.zone))}`), tg.last(l.chat).text);
});

test("S57 a 1,500-character message is cut to 1,000 before it is read, and still routed by its reading", async () => {
  const l = await seed("Eko");
  const { ai, send } = harness();
  const long = `what is my plan for the next week? ${"also, ".repeat(300)}`.slice(0, 1500);
  ai.read(long.trim().slice(0, 1000), { ...BASE, request: { ...REQ, action: "week_plan" } });
  const trace = await send(l, long);
  assert.equal(trace.textLength, 1000);
  assert.equal(trace.decision, "show_week:asked_week");
});

test("S58 commands are read whatever their case or bot suffix (\"/WEEK@KivoBot\", \"/Progress\"), with no model", async () => {
  const l = await seed("Fox");
  const { tg, ai, send } = harness();
  await send(l, "/WEEK@KivoBot");
  assert.ok(tg.last(l.chat).text.startsWith("Next 7 days"));
  await send(l, "/Progress");
  assert.ok(tg.last(l.chat).text.startsWith("No counted study sessions"));
  assert.equal(ai.seen.length, 0);
});

test("S59 an unknown command lists the ones that exist, including /week and /progress", async () => {
  const l = await seed("Gil");
  const { tg, send } = harness();
  await send(l, "/streak");
  assert.equal(tg.last(l.chat).text, TEXT.unknownCommand);
  assert.ok(TEXT.unknownCommand.includes("/week") && TEXT.unknownCommand.includes("/progress"));
});

test("S60 /help lists /week and /progress and resets this chat's menu; /start after first use is today's plan and resets it too; other commands leave the menu", async () => {
  const l = await seed("Hux");
  await prisma.novaTelegramChannel.upsert({ where: { profileId: l.profileId }, create: { profileId: l.profileId, lastDeliveredAt: clock }, update: { lastDeliveredAt: clock } });
  const { tg, send } = harness();
  await send(l, "/today");
  assert.equal(tg.menus.length, 0);
  await send(l, "/help");
  assert.ok(tg.last(l.chat).text.includes("/week: the next seven days") && tg.last(l.chat).text.includes("/progress"));
  await send(l, "/start");
  assert.ok(tg.last(l.chat).text.startsWith("Deadlocks (Operating Systems)"), tg.last(l.chat).text);
  assert.deepEqual(tg.menus.map(m => m.chatId), [l.chat, l.chat]);
  assert.ok(tg.menus.every(m => m.commands.includes("week") && m.commands.includes("progress")));
});

// ══════════════════════════════════════════════════════════════════════════════
// 20. Regression: what worked before still works
// ══════════════════════════════════════════════════════════════════════════════

test("S61 regression: \"make it 15\" against an open offer re-offers it at 15 and starts nothing", async () => {
  const l = await seed("Ian");
  const { tg, ai, send } = harness();
  await send(l, "/today");
  ai.read("make it 15", { ...BASE, request: { ...REQ, availableMinutes: 15 } });
  assert.equal((await send(l, "make it 15")).decision, "show_today:offer_changed");
  assert.ok(tg.labels(l.chat).includes("Start 15 min"));
  assert.equal((await sessions(l)).length, 0);
});

test("S62 regression: \"yes\" against an open offer answers it (the typed answer resolves the prompt once)", async () => {
  const l = await seed("Jed");
  const { tg, ai, send, tapData } = harness();
  await send(l, "/today");
  const button = tg.data(l.chat, "Start 25 min");
  ai.read("yes let's do 25", { ...BASE, request: { ...REQ, action: "start_session", promptAnswer: "b" } });
  assert.equal((await send(l, "yes let's do 25")).decision, "answer_prompt:answered_open_prompt");
  assert.equal((await sessions(l))[0]?.plannedDurationMinutes, 25);
  assert.equal((await tapData(l, button)).failure, "stale_prompt");
  assert.equal((await sessions(l)).length, 1);
});

test("S63 regression: \"what is deadlock?\" is explained by the model and reads or writes nothing of the learner's", async () => {
  const l = await seed("Kit");
  const { tg, ai, send } = harness();
  const before = await state(l);
  ai.read("what is deadlock?", { ...BASE, intent: "topic_question", topic: "Deadlocks", topicConfidence: 0.9, request: { ...REQ, asks: "knowledge" } });
  assert.equal((await send(l, "what is deadlock?")).decision, "explain:general_question");
  assert.ok(tg.last(l.chat).text.startsWith("WORDED("));
  const after = await state(l);
  assert.deepEqual([after.sessions, after.overrides, after.topics], [before.sessions, before.overrides, before.topics]);
});

test("S64 regression: an exam named with a date is offered, added only on the tap, and only once", async () => {
  const l = await seed("Lux");
  const { tg, ai, send, tap, tapData } = harness();
  const date = dayKey(new Date(clock.getTime() + 10 * DAY), l.zone);
  ai.read("my OS exam is on that day", { ...BASE, request: { ...REQ, exam: { title: "OS exam", date } } });
  await send(l, "my OS exam is on that day");
  assert.equal(await prisma.novaExam.count({ where: { profileId: l.profileId } }), 0);
  const add = tg.data(l.chat, `Add exam (${date})`);
  await tap(l, `Add exam (${date})`);
  assert.equal(await prisma.novaExam.count({ where: { profileId: l.profileId } }), 1);
  assert.equal((await tapData(l, add)).failure, "stale_prompt");
  assert.equal(await prisma.novaExam.count({ where: { profileId: l.profileId } }), 1);
});

// ══════════════════════════════════════════════════════════════════════════════
// 21. Reply language across a conversation (staging, 18 October)
// ══════════════════════════════════════════════════════════════════════════════
// On staging, "How is my progress going?" and "remind me at 8 pm to study"
// came back from the reading with no language after a Hinglish message, and
// were answered in Hinglish. The readings below reproduce that: language null.

const lastLogged = async (l: Learner) =>
  (await prisma.companionMessage.findFirst({ where: { userId: l.userId, role: "user" }, orderBy: { createdAt: "desc" }, select: { metadata: true } }))?.metadata as { language?: string } | null;
// A minute apart, as real messages are: the log is read newest first.
const sendLater = (h: ReturnType<typeof harness>, l: Learner, text: string) => { tick(1); return h.send(l, text); };
const hinglishFirst = async (h: ReturnType<typeof harness>, l: Learner) => {
  h.ai.read("Aaj ke plans update karne hain", { ...BASE, request: { ...REQ, action: "change_plan", language: "hinglish" } });
  await sendLater(h, l, "Aaj ke plans update karne hain");
  assert.equal((await lastLogged(l))?.language, "hinglish");
};

test(`S65 Hinglish, then "How is my progress going?" read with no language: answered in English, no Hinglish rendering asked for, logged as English`, async () => {
  const l = await seed("Ama");
  const h = harness();
  await hinglishFirst(h, l);
  const before = h.ai.rendered.length;
  h.ai.read("How is my progress going?", { ...BASE, intent: "progress_check", request: { ...REQ, action: "progress", asks: "about_me", language: null } });
  const trace = await sendLater(h, l, "How is my progress going?");
  assert.equal(trace.decision, "show_progress:asked_progress");
  assert.ok(h.tg.last(l.chat).text.startsWith("No counted study sessions on record yet"), h.tg.last(l.chat).text);
  assert.equal(h.ai.rendered.length, before, "nothing was sent to be said in Hinglish");
  assert.equal(trace.language, undefined);
  assert.equal((await lastLogged(l))?.language, "english");
});

test(`S66 Hinglish, then "remind me at 8 pm to study" read with no language: the English refusal, nothing scheduled, nudges not paused`, async () => {
  const l = await seed("Bao");
  const h = harness();
  await hinglishFirst(h, l);
  h.ai.read("remind me at 8 pm to study", { ...BASE, intent: "schedule_query", request: { ...REQ, action: "set_reminder", language: null } });
  assert.equal((await sendLater(h, l, "remind me at 8 pm to study")).decision, "reminder_unavailable:reminder_not_supported");
  assert.equal(h.tg.last(l.chat).text, TEXT.reminderUnavailable);
  const s = await state(l);
  assert.deepEqual([s.outbox, s.channel?.proactivePausedUntil ?? null], [0, null]);
});

test(`S67 English, then a clear Hinglish reminder request: the Hinglish refusal`, async () => {
  const l = await seed("Cas");
  const h = harness();
  h.ai.read("How is my progress going?", { ...BASE, request: { ...REQ, action: "progress", language: "english" } });
  await sendLater(h, l, "How is my progress going?");
  h.ai.read("mujhe raat 8 baje padhai ke liye yaad dila dena", { ...BASE, intent: "schedule_query", request: { ...REQ, action: "set_reminder", language: "hinglish" } });
  await sendLater(h, l, "mujhe raat 8 baje padhai ke liye yaad dila dena");
  assert.equal(h.tg.last(l.chat).text, TEXT_HINGLISH.reminderUnavailable);
  assert.equal((await lastLogged(l))?.language, "hinglish");
});

test(`S68 a message too short to tell keeps the conversation's language: "remind me" after Hinglish gets the Hinglish refusal`, async () => {
  const l = await seed("Dia");
  const h = harness();
  await hinglishFirst(h, l);
  h.ai.read("remind me", { ...BASE, request: { ...REQ, action: "set_reminder", language: null } });
  await sendLater(h, l, "remind me");
  assert.equal(h.tg.last(l.chat).text, TEXT_HINGLISH.reminderUnavailable);
});

test(`S69 the same English sentence after a Hinglish message, five times over: English every time`, async () => {
  const l = await seed("Edo");
  const h = harness();
  h.ai.read("remind me at 8 pm to study", { ...BASE, request: { ...REQ, action: "set_reminder", language: null } });
  for (let i = 0; i < 5; i++) {
    await hinglishFirst(h, l);
    await sendLater(h, l, "remind me at 8 pm to study");
    assert.equal(h.tg.last(l.chat).text, TEXT.reminderUnavailable, `round ${i + 1}`);
  }
});

test(`S70 after an English sentence answered in English, a short reply stays English: the log follows the conversation`, async () => {
  const l = await seed("Fen");
  const h = harness();
  await hinglishFirst(h, l);
  h.ai.read("remind me at 8 pm to study", { ...BASE, request: { ...REQ, action: "set_reminder", language: null } });
  await sendLater(h, l, "remind me at 8 pm to study");
  h.ai.read("remind me", { ...BASE, request: { ...REQ, action: "set_reminder", language: null } });
  await sendLater(h, l, "remind me");
  assert.equal(h.tg.last(l.chat).text, TEXT.reminderUnavailable);
});

test(`S71 no reading at all (model down, or unreadable output) after Hinglish: a sentence gets the English line, a short message the Hinglish one`, async () => {
  const l = await seed("Gao");
  const h = harness();
  await hinglishFirst(h, l);
  h.ai.breakUnderstanding("throw");
  await sendLater(h, l, "How is my progress going?");
  assert.equal(h.tg.last(l.chat).text, TEXT.notUnderstood);
  await sendLater(h, l, "ok bhai");
  assert.equal(h.tg.last(l.chat).text, TEXT_HINGLISH.notUnderstood);
  h.ai.breakUnderstanding("garbage");
  await sendLater(h, l, "remind me at 8 pm to study");
  assert.equal(h.tg.last(l.chat).text, TEXT.notUnderstood);
});

test(`S72 a clear Hinglish message is still answered in Hinglish: the change-plan list is sent to be said in Hinglish`, async () => {
  const l = await seed("Hiro");
  const h = harness();
  const before = h.ai.rendered.length;
  h.ai.read("Aaj ke plans update karne hain", { ...BASE, request: { ...REQ, action: "change_plan", language: "hinglish" } });
  await sendLater(h, l, "Aaj ke plans update karne hain");
  assert.equal(h.ai.rendered.length, before + 1, "one Hinglish rendering");
  assert.ok(h.ai.rendered.at(-1)!.startsWith("What do you want to change about today?"));
});
