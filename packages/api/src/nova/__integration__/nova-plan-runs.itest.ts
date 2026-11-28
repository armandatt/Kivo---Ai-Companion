/**
 * Plan your time (28 Nov): proposals write nothing, every Apply is a run that
 * Undo / Clear / Unschedule take back, with blocks the learner changed and
 * blocks already under way kept. Real Postgres.
 *
 *   NOVA_TEST_DATABASE_URL=postgresql://... npm run test:integration
 */
import "./test-database.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";

process.env.TELEGRAM_BOT_TOKEN = ""; process.env.GEMINI_API_KEY = ""; process.env.OPENAI_API_KEY = ""; process.env.ANTHROPIC_API_KEY = "";
delete process.env.NOVA_PROACTIVE_DISABLED; delete process.env.TELEGRAM_PROACTIVE_SENDS;

const { prisma } = await import("@repo/db/client");
const { planCalendar } = await import("../product/calendar-planner.js");
const { applyPlanRun, undoPlanRun, clearAutoBlocks, unscheduleBlock, recentRuns, savePlanSettings } = await import("../product/plan-runs.js");
const { createEvent, updateEvent, loadCalendar } = await import("../product/calendar.js");
const { zonedInstant, dayKey, dayKeyOfNumber, dayNumber } = await import("../engines/learner-calendar.js");
const { runEventReminders } = await import("../proactive/event-reminders.js");

const STAMP = Date.now();
const ZONE = "Asia/Kolkata";
const chats: string[] = [];
// A Monday morning, so "this week" has days left in it.
const now = zonedInstant("2026-11-30", 8 * 60, ZONE);
const today = dayKey(now, ZONE);
const plus = (n: number) => dayKeyOfNumber(dayNumber(today) + n);

async function learner(tasks: number, zone = ZONE) {
  const chatId = `plan_${STAMP}_${chats.length}`;
  chats.push(chatId);
  const u = await prisma.messengerUser.create({
    data: { platform: "telegram", platformChatId: chatId, persona: "nova", novaAcademicProfile: { create: { timezone: zone, onboardingComplete: true } } },
    select: { novaAcademicProfile: { select: { id: true } } },
  });
  const profileId = u.novaAcademicProfile!.id;
  for (let i = 0; i < tasks; i++) {
    await prisma.novaTask.create({ data: { profileId, title: `Task ${i}`, estimatedMinutes: [25, 45, 90, 60][i % 4], dueDay: i % 3 === 0 ? dayKeyOfNumber(dayNumber(today) - 10) : i % 3 === 1 ? plus(5) : null, priority: (["high", "medium", "low", null] as const)[i % 4] } });
  }
  return { profileId, chatId };
}
const events = (profileId: string) => prisma.novaCalendarEvent.findMany({ where: { profileId }, orderBy: { startAt: "asc" } });
async function propose(profileId: string, taskIds?: string[]) {
  const r = await planCalendar(profileId, taskIds ? { taskIds } : {}, now);
  assert.ok(r.ok);
  if (!r.ok) throw new Error();
  return { placed: r.proposals.filter(p => p.day), unplaced: r.proposals.filter(p => !p.day), view: r };
}
const blocksOf = (placed: Array<{ taskId: string; startAt: string | null; endAt: string | null }>) => placed.map(p => ({ taskId: p.taskId, startAt: p.startAt!, endAt: p.endAt! }));

after(async () => {
  await prisma.messengerUser.deleteMany({ where: { platformChatId: { in: chats } } });
  await prisma.$disconnect();
});

test("a proposal (and Cancel) changes nothing", async () => {
  const l = await learner(6);
  const before = await events(l.profileId);
  const p = await propose(l.profileId);
  assert.ok(p.placed.length > 0);
  assert.deepEqual(await events(l.profileId), before);
  assert.equal(await prisma.novaPlanRun.count({ where: { profileId: l.profileId } }), 0);
});

test("Apply makes one run of auto blocks; Undo restores the exact prior state except blocks changed or under way; twice does nothing", async () => {
  const l = await learner(8);
  const mine = await createEvent(l.profileId, { title: "Lecture", category: "class", allDay: false, startDay: plus(1), startTime: "10:00", endTime: "11:00", timezone: ZONE }, now);
  assert.ok(mine.ok);
  const before = (await events(l.profileId)).map(e => e.id);
  const tasksBefore = await prisma.novaTask.findMany({ where: { profileId: l.profileId }, orderBy: { id: "asc" }, select: { id: true, dueDay: true, estimatedMinutes: true, status: true } });
  const p = await propose(l.profileId);
  const r = await applyPlanRun(l.profileId, { scope: "all", blocks: blocksOf(p.placed), unplaced: p.unplaced, remind: false }, now);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.placed, p.placed.length);
  const auto = (await events(l.profileId)).filter(e => e.source === "auto");
  assert.equal(auto.length, r.placed);
  assert.ok(auto.every(e => e.planRunId === r.runId && e.category === "study"));
  // No overlaps with the learner's own lecture, none in the past, none over 4 h a day.
  for (const e of auto) assert.ok(e.startAt! > now && !(e.startAt! < (mine.ok ? new Date(mine.event.endAt!) : now) && e.endAt! > (mine.ok ? new Date(mine.event.startAt!) : now)));
  const perDay = new Map<string, number>();
  for (const e of auto) perDay.set(e.startDay, (perDay.get(e.startDay) ?? 0) + (e.endAt!.getTime() - e.startAt!.getTime()) / 60_000);
  for (const m of perDay.values()) assert.ok(m <= 240);

  // The learner moves one block: it is theirs now. Another one is already under way.
  const [moved, underway] = [auto[0]!, auto[1]!];
  const u = await updateEvent(l.profileId, moved.id, { title: "My OS block" }, now);
  assert.ok(u.ok);
  const later = new Date(underway.startAt!.getTime() + 60_000);
  const undone = await undoPlanRun(l.profileId, r.runId, later);
  assert.ok(undone.ok);
  if (!undone.ok) return;
  assert.equal(undone.kept, 1, "the one you changed stays");
  assert.ok(undone.started >= 1, "under way stays");
  const left = (await events(l.profileId)).map(e => e.id);
  assert.ok(left.includes(moved.id) && left.includes(underway.id) && before.every(id => left.includes(id)));
  assert.equal(left.length, before.length + 1 + undone.started);
  // Tasks untouched.
  assert.deepEqual(await prisma.novaTask.findMany({ where: { profileId: l.profileId }, orderBy: { id: "asc" }, select: { id: true, dueDay: true, estimatedMinutes: true, status: true } }), tasksBefore);
  // Idempotent.
  const again = await undoPlanRun(l.profileId, r.runId, later);
  assert.deepEqual(again.ok && [again.already, again.removed.length], [true, 0]);
});

test("two runs are separate: removing one leaves the other", async () => {
  const l = await learner(6);
  const first = await propose(l.profileId);
  const half = first.placed.slice(0, 3);
  const r1 = await applyPlanRun(l.profileId, { scope: "all", blocks: blocksOf(half), remind: false }, now);
  const second = await propose(l.profileId);
  const r2 = await applyPlanRun(l.profileId, { scope: "all", blocks: blocksOf(second.placed), remind: false }, now);
  assert.ok(r1.ok && r2.ok);
  if (!r1.ok || !r2.ok) return;
  assert.notEqual(r1.runId, r2.runId);
  await undoPlanRun(l.profileId, r1.runId, now);
  const left = await events(l.profileId);
  assert.equal(left.filter(e => e.planRunId === r1.runId).length, 0);
  assert.equal(left.filter(e => e.planRunId === r2.runId).length, r2.placed);
  const runs = await recentRuns(l.profileId);
  assert.deepEqual(runs.map(x => [x.id, x.undoneAt !== null]), [[r2.runId, false], [r1.runId, true]]);
});

test("Apply re-checks: a slot taken since the proposal, or a task done since, is skipped with a reason", async () => {
  const l = await learner(3);
  const p = await propose(l.profileId);
  const [a, b] = p.placed;
  // Something else now sits on a's slot; b's task is done.
  await createEvent(l.profileId, { title: "Dentist", category: "personal", allDay: false, startDay: a!.day!, startTime: a!.startTime!, endTime: a!.endTime!, timezone: ZONE }, now);
  await prisma.novaTask.update({ where: { id: b!.taskId }, data: { status: "done" } });
  const r = await applyPlanRun(l.profileId, { scope: "all", blocks: blocksOf(p.placed), remind: false }, now);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.skipped.map(s => s.reason).sort(), ["It isn't an open task of yours any more.", "Something else is on the calendar then."]);
});

test("Clear this week removes only Kivo's blocks in range (counted first); Unschedule removes one; manual events stay", async () => {
  const l = await learner(12);
  await savePlanSettings(l.profileId, { dayStart: 9 * 60, dayEnd: 21 * 60, focusPerDay: 60, bufferMinutes: 10, avoidDays: [] });
  const own = await createEvent(l.profileId, { title: "Gym", category: "personal", allDay: false, startDay: plus(2), startTime: "07:00", endTime: "08:00", timezone: ZONE }, now);
  assert.ok(own.ok);
  const p = await propose(l.profileId);
  const r = await applyPlanRun(l.profileId, { scope: "all", blocks: blocksOf(p.placed), remind: false }, now);
  assert.ok(r.ok);
  // And one placed next week, for a task still without time.
  const spare = p.unplaced[0]!;
  const nextWeek = await applyPlanRun(l.profileId, { scope: "one", blocks: [{ taskId: spare.taskId, startAt: zonedInstant(plus(9), 10 * 60, ZONE).toISOString(), endAt: zonedInstant(plus(9), 10 * 60 + 25, ZONE).toISOString() }], remind: false }, now);
  assert.ok(nextWeek.ok, JSON.stringify(nextWeek));
  const auto = (await events(l.profileId)).filter(e => e.source === "auto");
  const sunday = zonedInstant(plus(7), 0, ZONE);
  const inWeek = auto.filter(e => e.startAt! < sunday).length;
  assert.ok(inWeek > 0 && inWeek < auto.length, `${inWeek} of ${auto.length} in the week`);
  const preview = await clearAutoBlocks(l.profileId, "week", true, now);
  assert.ok(preview.ok && preview.removed.length === inWeek);
  assert.equal((await events(l.profileId)).length, auto.length + 1, "a preview removes nothing");
  await clearAutoBlocks(l.profileId, "week", false, now);
  const left = await events(l.profileId);
  assert.ok(left.some(e => own.ok && e.id === own.event.id));
  assert.equal(left.filter(e => e.source === "auto").length, auto.length - inWeek);
  const one = left.find(e => e.source === "auto")!;
  const u = await unscheduleBlock(l.profileId, one.id, now);
  assert.ok(u.ok && u.removed.length === 1);
  assert.equal((await unscheduleBlock(l.profileId, own.ok ? own.event.id : "", now)).ok, false, "your own event isn't Kivo's to unschedule");
});

test("Telegram: blocks of a run carry reminders when plan notifications are on, and removing the run retires them", async () => {
  const l = await learner(2);
  const p = await propose(l.profileId);
  const r = await applyPlanRun(l.profileId, { scope: "all", blocks: blocksOf(p.placed), remind: true }, now);
  assert.ok(r.ok);
  const withReminder = (await events(l.profileId)).filter(e => e.remindAt);
  assert.equal(withReminder.length, p.placed.length);
  if (r.ok) await undoPlanRun(l.profileId, r.runId, now);
  const sent: string[] = [];
  const client = { async sendMessage(_c: string, text: string) { sent.push(text); return { ok: true as const, messageId: 1 }; }, async answerCallback() {}, async clearButtons() {}, async setChatCommands() {} };
  for (const e of withReminder) await runEventReminders(e.remindAt!, { client });
  assert.equal(sent.length, 0, "no reminder for a removed block");
});

test("timezone: in New York a block is placed on the learner's own day", async () => {
  const l = await learner(1, "America/New_York");
  const r = await planCalendar(l.profileId, {}, now);
  assert.ok(r.ok);
  if (!r.ok) return;
  const p = r.proposals[0]!;
  assert.equal(dayKey(new Date(p.startAt!), "America/New_York"), p.day);
  const cal = await loadCalendar(l.profileId, p.day!, p.day!, now);
  assert.ok(cal.ok);
});
