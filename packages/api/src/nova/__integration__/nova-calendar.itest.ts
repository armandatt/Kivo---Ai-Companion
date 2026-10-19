/**
 * The calendar and its reminders — real Postgres integration test.
 *
 * What it proves:
 *   • a learner creates, reads, changes and deletes their own events, and
 *     another learner can do none of those to them;
 *   • a create carrying the same key (a retry, a double click, two at once)
 *     makes one event;
 *   • tasks with a due day and dated deadlines appear on the calendar from
 *     their own tables, with no copy made, and a task an event is for can be
 *     deleted without losing the event;
 *   • all-day events keep their day and timed events their local time;
 *   • a reminder goes out once at its local time, however many ticks run,
 *     including two at once; a moved or deleted event leaves no stale
 *     reminder; a failed send is retried and then stops; a refused chat and
 *     a learner with no Telegram are not sent anything, and the page says so;
 *     a reminder past its window is not sent late;
 *   • reminders do not use up the proactive messages' daily allowance.
 *
 *   NOVA_TEST_DATABASE_URL=postgresql://... npm run test:integration
 */

import "./test-database.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

process.env.TELEGRAM_BOT_TOKEN = "";
process.env.GEMINI_API_KEY = "";
process.env.OPENAI_API_KEY = "";
delete process.env.NOVA_PROACTIVE_DISABLED;

const { prisma } = await import("@repo/db/client");
const { createEvent, updateEvent, deleteEvent, loadCalendar } = await import("../product/calendar.js");
const { runEventReminders } = await import("../proactive/event-reminders.js");
const { createTask, deleteTask } = await import("../product/tasks.js");
const { addExam } = await import("../product/exams.js");
const { loadDelivered } = await import("../proactive/proactive-outbox.js");
const { dayKey } = await import("../engines/learner-calendar.js");

import type { SendResult, TelegramClient } from "../telegram/telegram.types.js";

const STAMP = Date.now();
const ZONE = "Asia/Kolkata";   // UTC+5:30, no daylight saving
// A day well ahead, so every date is in the future and the clock is ours.
const DAY0 = Math.floor(Date.now() / 86_400_000) + 10;
const day = (n = 0) => new Date((DAY0 + n) * 86_400_000).toISOString().slice(0, 10);
// The instant it is HH:MM in Kolkata on day(n).
const ist = (hhmm: string, n = 0): Date => {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return new Date((DAY0 + n) * 86_400_000 + (h * 60 + m - 330) * 60_000);
};
const before0 = ist("00:01", -9);   // "now" for writes: well before everything

// ── Telegram, stood in ────────────────────────────────────────────────────────
const sent: Array<{ chatId: string; text: string }> = [];
const refuse = new Map<string, SendResult>();
let messageId = 70_000;
const client: TelegramClient = {
  async sendMessage(chatId, text) {
    const refused = refuse.get(chatId);
    if (refused) return refused;
    sent.push({ chatId, text });
    return { ok: true as const, messageId: ++messageId };
  },
  async answerCallback() {}, async clearButtons() {}, async setChatCommands() {},
};
const tick = (now: Date) => runEventReminders(now, { client });
const sentTo = (chatId: string) => sent.filter(s => s.chatId === chatId);

// ── Learners ──────────────────────────────────────────────────────────────────
const chats: string[] = [];
async function learner(kind: "telegram" | "web" = "telegram"): Promise<{ profileId: string; chatId: string }> {
  const chatId = kind === "telegram" ? `cal_${STAMP}_${chats.length}` : `web:cal_${STAMP}_${chats.length}`;
  chats.push(chatId);
  const u = await prisma.messengerUser.create({
    data: { platform: kind, platformChatId: chatId, persona: "nova", novaAcademicProfile: { create: { timezone: ZONE, onboardingComplete: true } } },
    select: { novaAcademicProfile: { select: { id: true } } },
  });
  return { profileId: u.novaAcademicProfile!.id, chatId };
}

const make = async (profileId: string, raw: Record<string, unknown>) => {
  const r = await createEvent(profileId, { timezone: ZONE, ...raw }, before0);
  assert.ok(r.ok, r.ok ? "" : `${r.error}: ${r.message}`);
  return r.ok ? r.event : null!;
};
const view = async (profileId: string, from = day(-3), to = day(10), now = before0) => {
  const r = await loadCalendar(profileId, from, to, now);
  assert.ok(r.ok);
  return r.ok ? r.view : null!;
};

before(async () => { await prisma.$queryRaw`SELECT 1`; });
after(async () => {
  await prisma.messengerUser.deleteMany({ where: { platformChatId: { in: chats } } });
  await prisma.$disconnect();
});

// ── Events and who may touch them ─────────────────────────────────────────────

test("a learner creates, reads, changes and deletes their own event", async () => {
  const { profileId } = await learner();
  const e = await make(profileId, { title: "Physics lab", category: "class", startDay: day(1), startTime: "14:30", endTime: "16:00", description: "Bring the kit" });
  assert.equal(e.startAt, ist("14:30", 1).toISOString());
  assert.equal(e.startTime, "14:30");
  assert.deepEqual((await view(profileId)).events.map(x => x.title), ["Physics lab"]);

  const moved = await updateEvent(profileId, e.id, { startDay: day(2), title: "Physics lab (moved)" }, before0);
  assert.ok(moved.ok);
  assert.equal(moved.ok && moved.event.startAt, ist("14:30", 2).toISOString());
  assert.equal(moved.ok && moved.event.description, "Bring the kit", "what was not named is kept");

  // It persists: read back from the database, not from the write's answer.
  const again = await view(profileId);
  assert.equal(again.events[0]!.title, "Physics lab (moved)");
  assert.equal(again.events[0]!.startDay, day(2));

  assert.equal(await deleteEvent(profileId, e.id), true);
  assert.equal(await deleteEvent(profileId, e.id), false, "a second delete finds nothing");
  assert.deepEqual((await view(profileId)).events, []);
});

test("another learner can neither see, change nor delete an event that is not theirs", async () => {
  const owner = await learner();
  const other = await learner();
  const e = await make(owner.profileId, { title: "Private", startDay: day(1), startTime: "10:00" });
  assert.deepEqual((await view(other.profileId)).events, []);
  const changed = await updateEvent(other.profileId, e.id, { title: "Mine now" }, before0);
  assert.ok(!changed.ok && changed.error === "not_found");
  assert.equal(await deleteEvent(other.profileId, e.id), false);
  const still = await prisma.novaCalendarEvent.findUniqueOrThrow({ where: { id: e.id } });
  assert.equal(still.title, "Private");
  assert.equal(still.profileId, owner.profileId);
  // Nor point an event of their own at the owner's task or subject.
  const task = await createTask(owner.profileId, { title: "Owner's task" }, { now: before0 });
  assert.ok(task.ok);
  const linked = await createEvent(other.profileId, { title: "x", startDay: day(1), startTime: "09:00", taskId: task.ok ? task.task.id : "" }, before0);
  assert.ok(!linked.ok && linked.error === "bad_task");
});

test("a create carrying the same key makes one event, even two at once", async () => {
  const { profileId } = await learner();
  const input = { title: "Seminar", startDay: day(1), startTime: "11:00", timezone: ZONE, clientKey: `web:${STAMP}:seminar` };
  const first = await createEvent(profileId, input, before0);
  const repeat = await createEvent(profileId, input, before0);
  assert.ok(first.ok && repeat.ok);
  assert.equal(first.ok && first.created, true);
  assert.equal(repeat.ok && repeat.created, false);
  assert.equal(first.ok && repeat.ok && first.event.id === repeat.event.id, true);

  const racing = { ...input, clientKey: `web:${STAMP}:race` };
  const [a, b] = await Promise.all([createEvent(profileId, racing, before0), createEvent(profileId, racing, before0)]);
  assert.ok(a.ok && b.ok && a.event.id === b.event.id);
  assert.equal(await prisma.novaCalendarEvent.count({ where: { profileId, title: "Seminar" } }), 2, "one per key");
});

// ── One calendar over the records that already exist ─────────────────────────

test("tasks and deadlines appear from their own tables, and nothing is copied", async () => {
  const { profileId, chatId } = await learner();
  await prisma.novaSubject.create({ data: { profileId, name: "Operating Systems" } });
  const task = await createTask(profileId, { title: "Finish assignment 3", dueDay: day(2) }, { now: before0 });
  assert.ok(task.ok);
  const added = await addExam(chatId, { title: "OS midterm", subjectName: "Operating Systems", date: day(5), kind: "exam" }, before0);
  assert.equal(added.status, "added");

  const v = await view(profileId);
  assert.deepEqual(v.tasks.map(t => [t.title, t.dueDay]), [["Finish assignment 3", day(2)]]);
  assert.deepEqual(v.deadlines.map(d => [d.title, d.day, d.kind, d.subjectName]), [["OS midterm", day(5), "exam", "Operating Systems"]]);
  assert.equal(await prisma.novaCalendarEvent.count({ where: { profileId } }), 0, "no event made for a task or a deadline");

  // Time set aside for the task points at it; the task is still one row.
  const block = await make(profileId, { title: "Work on assignment 3", category: "study", startDay: day(1), startTime: "18:00", endTime: "19:30", taskId: task.ok ? task.task.id : "" });
  assert.equal(block.task?.title, "Finish assignment 3");
  assert.equal(await prisma.novaTask.count({ where: { profileId } }), 1);

  // The task goes; the time set aside stays, pointing at nothing.
  assert.equal(await deleteTask(profileId, task.ok ? task.task.id : ""), true);
  const after = await view(profileId);
  assert.deepEqual(after.tasks, []);
  assert.equal(after.events.find(e => e.id === block.id)?.task, null);
});

test("an all-day event keeps its day, and a timed one its local time, whatever the clock in UTC", async () => {
  const { profileId } = await learner();
  await make(profileId, { title: "Holiday", allDay: true, startDay: day(3) });
  // 00:30 in Kolkata is the previous day in UTC: it stays on day(4) here.
  const early = await make(profileId, { title: "Early train", startDay: day(4), startTime: "00:30" });
  assert.equal(early.startDay, day(4));
  assert.equal(new Date(early.startAt!).toISOString().slice(0, 10), day(3), "the UTC day differs");
  const v = await view(profileId, day(3), day(4));
  assert.deepEqual(v.events.map(e => [e.title, e.startDay, e.allDay]), [["Holiday", day(3), true], ["Early train", day(4), false]]);
  // A range that ends the day before does not show the early train.
  assert.deepEqual((await view(profileId, day(3), day(3))).events.map(e => e.title), ["Holiday"]);
});

test("the page may only ask for a real range of at most 62 days", async () => {
  const { profileId } = await learner();
  for (const [from, to] of [[day(0), day(70)], [day(2), day(1)], ["2026-13-01", day(1)]]) {
    const r = await loadCalendar(profileId, from, to, before0);
    assert.ok(!r.ok && r.error === "bad_range");
  }
});

// ── Reminders ─────────────────────────────────────────────────────────────────

test("a reminder goes out once, at its local time, however many ticks run", async () => {
  const { profileId, chatId } = await learner();
  const e = await make(profileId, { title: "Viva", category: "class", startDay: day(1), startTime: "15:00", endTime: "15:30", reminderMinutes: 30 });
  assert.equal(e.reminder?.at, ist("14:30", 1).toISOString());
  assert.equal(e.reminder?.status, "scheduled");

  await tick(ist("14:25", 1));
  assert.equal(sentTo(chatId).length, 0, "not before its time");

  // Two ticks at once (a restart overlapping a running one), then more later.
  await Promise.all([tick(ist("14:31", 1)), tick(ist("14:31", 1))]);
  await tick(ist("14:36", 1));
  await tick(ist("14:41", 1));
  assert.deepEqual(sentTo(chatId).map(s => s.text), ["Reminder: Viva at 15:00–15:30 today. Class."]);

  const v = await view(profileId, day(0), day(2), ist("14:45", 1));
  assert.equal(v.events[0]!.reminder?.status, "sent");
});

test("a moved event is reminded at its new time only, and a deleted one not at all", async () => {
  const { profileId, chatId } = await learner();
  const moved = await make(profileId, { title: "Group study", startDay: day(2), startTime: "10:00", reminderMinutes: 10 });
  const r = await updateEvent(profileId, moved.id, { startTime: "12:00" }, before0);
  assert.ok(r.ok && r.event.reminder?.at === ist("11:50", 2).toISOString());
  await tick(ist("09:51", 2));
  assert.equal(sentTo(chatId).length, 0, "the old time is never claimed");
  await tick(ist("11:51", 2));
  assert.equal(sentTo(chatId).length, 1);

  const gone = await make(profileId, { title: "Cancelled", startDay: day(3), startTime: "10:00", reminderMinutes: 0 });
  await deleteEvent(profileId, gone.id);
  await tick(ist("10:01", 3));
  assert.equal(sentTo(chatId).length, 1, "nothing for a deleted event");

  const off = await make(profileId, { title: "No reminder now", startDay: day(4), startTime: "10:00", reminderMinutes: 0 });
  await updateEvent(profileId, off.id, { reminderMinutes: null }, before0);
  await tick(ist("10:01", 4));
  assert.equal(sentTo(chatId).length, 1, "nothing once the reminder is taken off");
});

test("a send that failed is retried, and a reminder moved meanwhile is not sent for its old time", async () => {
  const { profileId, chatId } = await learner();
  const e = await make(profileId, { title: "Lab report", startDay: day(5), startTime: "09:00", reminderMinutes: 60 });
  refuse.set(chatId, { ok: false, kind: "server", detail: "502" });
  await tick(ist("08:01", 5));
  assert.equal(sentTo(chatId).length, 0);
  refuse.delete(chatId);
  await tick(ist("08:06", 5));
  await tick(ist("08:11", 5));
  assert.equal(sentTo(chatId).length, 1, "retried once and delivered once");
  const row = await prisma.novaProactiveMessage.findFirstOrThrow({ where: { profileId, eventType: "event_reminder" } });
  assert.equal(row.status, "sent");
  assert.equal(row.attempts, 2);

  // Failed, then the event moved: the old occurrence is closed, not sent.
  const later = await make(profileId, { title: "Moved after failing", startDay: day(6), startTime: "09:00", reminderMinutes: 60 });
  refuse.set(chatId, { ok: false, kind: "rate_limited", detail: "429" });
  await tick(ist("08:01", 6));
  refuse.delete(chatId);
  await updateEvent(profileId, later.id, { startTime: "17:00" }, before0);
  await tick(ist("08:06", 6));
  assert.equal(sentTo(chatId).length, 1, "the old time was dropped");
  const closed = await prisma.novaProactiveMessage.findFirstOrThrow({ where: { profileId, occurrenceKey: `event:${later.id}:${ist("08:00", 6).toISOString()}` } });
  assert.equal(closed.status, "abandoned");
  await tick(ist("16:01", 6));
  assert.equal(sentTo(chatId).length, 2, "the new time goes out");
  void e;
});

test("a chat that refuses delivery is marked and not sent to again", async () => {
  const { profileId, chatId } = await learner();
  await prisma.novaTelegramChannel.create({ data: { profileId } });
  await make(profileId, { title: "First", startDay: day(1), startTime: "07:00", reminderMinutes: 0 });
  await make(profileId, { title: "Second", startDay: day(1), startTime: "08:00", reminderMinutes: 0 });
  refuse.set(chatId, { ok: false, kind: "blocked", detail: "403" });
  await tick(ist("07:01", 1));
  refuse.delete(chatId);
  await tick(ist("08:01", 1));
  assert.equal(sentTo(chatId).length, 0);
  const channel = await prisma.novaTelegramChannel.findUniqueOrThrow({ where: { profileId } });
  assert.ok(channel.undeliverableSince, "the chat is marked as refusing");
  const v = await view(profileId, day(0), day(2), ist("08:05", 1));
  assert.deepEqual(v.reminders, { channel: "none", reason: "blocked" });
});

test("a learner with no Telegram is sent nothing, and the page says reminders cannot go anywhere", async () => {
  const { profileId, chatId } = await learner("web");
  const e = await make(profileId, { title: "Web only", startDay: day(1), startTime: "10:00", reminderMinutes: 0 });
  assert.equal(e.reminder?.status, "unavailable");
  const result = await tick(ist("10:01", 1));
  assert.equal(sentTo(chatId).length, 0);
  assert.ok((result.outcomes["not_connected"] ?? 0) >= 1);
  assert.equal(await prisma.novaProactiveMessage.count({ where: { profileId } }), 0, "nothing claimed, nothing pretended");
  assert.deepEqual((await view(profileId)).reminders, { channel: "none", reason: "not_connected" });
});

test("nudges turned off do not stop a reminder the learner set", async () => {
  const { profileId, chatId } = await learner();
  await prisma.novaTelegramChannel.create({ data: { profileId, proactiveEnabled: false } });
  await make(profileId, { title: "Wanted anyway", startDay: day(1), startTime: "12:00", reminderMinutes: 0 });
  await tick(ist("12:01", 1));
  assert.equal(sentTo(chatId).length, 1);
});

test("a reminder whose time passed while nothing ran is not sent late", async () => {
  const { profileId, chatId } = await learner();
  const e = await make(profileId, { title: "Missed one", startDay: day(1), startTime: "10:00", reminderMinutes: 0 });
  await tick(ist("10:45", 1));   // past the 30-minute window
  assert.equal(sentTo(chatId).length, 0);
  const v = await view(profileId, day(0), day(2), ist("10:45", 1));
  assert.equal(v.events.find(x => x.id === e.id)?.reminder?.status, "missed");
});

test("an all-day reminder is 09:00 local, the day before when asked", async () => {
  const { profileId, chatId } = await learner();
  await make(profileId, { title: "Fees due", category: "personal", allDay: true, startDay: day(3), reminderMinutes: 1440 });
  await tick(ist("08:59", 2));
  assert.equal(sentTo(chatId).length, 0);
  await tick(ist("09:01", 2));
  assert.deepEqual(sentTo(chatId).map(s => s.text), ["Reminder: Fees due, tomorrow. Personal."]);
});

test("reminders do not use up the proactive messages' daily allowance", async () => {
  const { profileId, chatId } = await learner();
  await make(profileId, { title: "Counted?", startDay: day(1), startTime: "09:00", reminderMinutes: 0 });
  await tick(ist("09:01", 1));
  assert.equal(sentTo(chatId).length, 1);
  const delivered = await loadDelivered(profileId, dayKey(ist("09:01", 1), ZONE));
  assert.deepEqual(delivered.today, []);
  assert.equal(delivered.lastSentAt, null);
});
