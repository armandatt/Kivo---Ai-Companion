/**
 * Skipping the database on idle ticks (Nova), on real Postgres, with the real
 * tick (apps/api/lib/checkin-cron.ts), the real reads of upcoming Nova work
 * (schedulerDueSources.ts) and the real write signal at the Prisma driver
 * (packages/db/src/write-signal.ts). Telegram is stood in by a fetch that
 * records what would have been sent. The clock is passed in.
 *
 *   - a skipped tick sends no statement to the database at all
 *   - a calendar reminder made by this process is seen at once (the write
 *     signal) and sent once, at the first tick after its time
 *   - one this process could not see (another process's write) is still
 *     sent, by the reconciliation tick, well inside its 30-minute grace
 *   - a restart starts with a full tick; a second full tick at the same moment
 *     sends nothing twice
 *   - the database dropping every connection between ticks (as a compute
 *     scaling to zero does) changes nothing
 *   - a Nova learner's check-in: ticks outside its window are skipped, the
 *     check-in still goes out on the first tick at its time, once
 *
 *   NOVA_TEST_DATABASE_URL=postgresql://... npx tsx --test src/services/__integration__/scheduler-idle.itest.ts
 */

import "../../nova/__integration__/test-database.js";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.TELEGRAM_BOT_TOKEN = "0:TEST";
process.env.TELEGRAM_API_BASE  = "http://127.0.0.1:9";
for (const k of ["ANTHROPIC_API_KEY", "CLAUDE_API_KEY", "GEMINI_API_KEY", "OPENAI_API_KEY"]) process.env[k] = "";

// Count every statement that reaches Postgres.
const pg = (await import("pg")).default;
let statements = 0;
const query = pg.Client.prototype.query as (...a: unknown[]) => unknown;
(pg.Client.prototype as unknown as { query: (...a: unknown[]) => unknown }).query = function (this: unknown, ...args: unknown[]) { statements++; return query.apply(this, args); };

// Telegram, stood in: every sendMessage is recorded and accepted.
const sent: Array<{ chat: string; text: string }> = [];
globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
  const u = String(url);
  if (u.includes("/sendMessage")) {
    const body = JSON.parse(String(init?.body ?? "{}")) as { chat_id?: string | number; text?: string };
    sent.push({ chat: String(body.chat_id), text: String(body.text ?? "") });
    return new Response(JSON.stringify({ ok: true, result: { message_id: sent.length } }), { status: 200 });
  }
  return new Response(JSON.stringify({ ok: true, result: true }), { status: 200 });
}) as typeof fetch;

const { prisma } = await import("@repo/db/client");
const { runWithoutWriteSignal } = await import("@repo/db/write-signal");
const { IdleScheduler, TICK_MS, RECONCILE_MS } = await import("../schedulerIdle.js");
const { loadDueSources } = await import("../schedulerDueSources.js");
const { createEvent } = await import("../../nova/product/calendar.js");
const { runCheckinCron } = await import("../../../../../apps/api/lib/checkin-cron.ts");

const ZONE = "Asia/Kolkata";
// A day well ahead, so every date is in the future and the clock is ours.
const DAY0 = Math.floor(Date.now() / 86_400_000) + 10;
const dayStr = (n = 0) => new Date((DAY0 + n) * 86_400_000).toISOString().slice(0, 10);
const istAt  = (h: number, m: number, s = 0, n = 0) => new Date((DAY0 + n) * 86_400_000 + ((h * 60 + m - 330) * 60 + s) * 1000);
const T0  = istAt(16, 2, 40).getTime();   // no learner here has a window then
const at  = (ms: number) => new Date(T0 + ms);
const MIN = 60_000;
const hhmm = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(11, 16);

type Mode = "on" | "shadow" | "off";
function scheduler(mode: Mode = "on") {
  const lines: Array<Record<string, unknown>> = [];
  const idle = new IdleScheduler({
    runFull: async (now: Date) => { const r = await runCheckinCron(now); return { work: r.work, legacyWork: r.legacyWork, nova: r.novaOutlooks }; },
    loadDue: (now: Date) => loadDueSources(now),
    mode:    () => mode,
    log:     line => lines.push(line),
    quietly: work => runWithoutWriteSignal("scheduler", work),
  });
  return { idle, lines };
}

// A Nova learner on Telegram, set up as the calendar tests set one up.
let CHAT = "", profileId = "";
async function reset() {
  await prisma.messengerUser.deleteMany({ where: { platformChatId: { startsWith: "itest-idle" } } });
  CHAT = `itest-idle-${Date.now()}`;
  const u = await prisma.messengerUser.create({
    data: { platform: "telegram", platformChatId: CHAT, persona: "nova", novaAcademicProfile: { create: { timezone: ZONE, onboardingComplete: true } } },
    select: { novaAcademicProfile: { select: { id: true } } },
  });
  profileId = u.novaAcademicProfile!.id;
  sent.length = 0;
}

// A one-off event whose reminder fires at the minute of `when`; returns it.
async function reminderAt(when: Date): Promise<Date> {
  const remindAt = new Date(Math.floor(when.getTime() / MIN) * MIN);   // calendar times are whole minutes
  const start = new Date(remindAt.getTime() + 10 * MIN);
  const r = await createEvent(profileId, { timezone: ZONE, title: "Viva", startDay: dayStr(0), startTime: hhmm(start), endTime: hhmm(new Date(start.getTime() + 30 * MIN)), reminderMinutes: 10 }, istAt(0, 1, 0, -9));
  assert.ok(r.ok, r.ok ? "" : JSON.stringify(r));
  const row = await prisma.novaCalendarEvent.findUniqueOrThrow({ where: { id: r.ok ? r.event.id : "" }, select: { remindAt: true } });
  assert.equal(row.remindAt?.toISOString(), remindAt.toISOString());
  return remindAt;
}
const toChat = () => sent.filter(s => s.chat === CHAT).length;

beforeEach(async () => { await reset(); });
after(async () => {
  await prisma.messengerUser.deleteMany({ where: { platformChatId: { startsWith: "itest-idle" } } });
  await prisma.$disconnect();
});

test("an idle tick between reconciliations is skipped and sends nothing to the database", async () => {
  const { idle } = scheduler();
  assert.deepEqual((await idle.tick(at(0))).decision.reasons, ["no_cache"]);
  const before = statements;
  const second = await idle.tick(at(TICK_MS));
  assert.equal(second.ran, false, `expected a skip, got ${JSON.stringify(second.decision)}`);
  assert.equal(statements - before, 0, "a skipped tick must not touch the database");
  assert.equal((await idle.tick(at(2 * TICK_MS))).decision.reasons.includes("reconcile"), true);
});

test("a calendar reminder this process made is seen at once and sent once, on time", async () => {
  const { idle } = scheduler();
  await idle.tick(at(0));
  await reminderAt(at(7 * MIN));                     // a normal write: the signal sees it
  const runs: string[][] = [];
  for (let i = 1; i <= 6; i++) runs.push((await idle.tick(at(i * TICK_MS))).decision.reasons);
  assert.deepEqual(runs[0], ["write"], "the tick after the write runs in full");
  assert.ok(runs[1]!.includes("due:calendar_reminder"), `the tick after its time knows it is due: ${JSON.stringify(runs[1])}`);
  assert.equal(toChat(), 1);
});

test("a calendar reminder written where this process cannot see it is still sent inside its grace", async () => {
  const { idle } = scheduler();
  await idle.tick(at(0));
  // As if another process wrote it: not counted by this process's signal.
  const remindAt = await runWithoutWriteSignal("other-process", () => reminderAt(at(1 * MIN)));
  let sentAt: number | null = null;
  for (let i = 1; i <= 4 && sentAt === null; i++) {
    const now = at(i * TICK_MS);
    const { ran } = await idle.tick(now);
    if (ran && toChat() > 0) sentAt = now.getTime();
  }
  assert.ok(sentAt !== null, "never sent");
  const late = sentAt! - remindAt.getTime();
  assert.ok(late <= RECONCILE_MS, `sent ${late / MIN} min late`);
  assert.equal(toChat(), 1);
});

test("a restart runs in full at once; a second full tick at the same moment sends nothing twice", async () => {
  await reminderAt(at(-1 * MIN));
  const first = scheduler();
  await first.idle.tick(at(0));
  assert.equal(toChat(), 1);
  const restarted = scheduler();
  assert.deepEqual((await restarted.idle.tick(at(0))).decision.reasons, ["no_cache"]);
  const off = scheduler("off");
  await off.idle.tick(at(0));
  assert.equal(toChat(), 1, "the same reminder is not sent again by a second or third full tick");
});

test("every connection dropped between ticks (a compute scaling to zero): the next tick still works", async () => {
  const { idle } = scheduler();
  await idle.tick(at(0));
  await reminderAt(at(3 * MIN));
  // What a suspended compute does to open connections.
  await runWithoutWriteSignal("test", () => prisma.$executeRawUnsafe(
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()"));
  for (let i = 1; i <= 3 && toChat() === 0; i++) {
    try { await idle.tick(at(i * TICK_MS)); } catch { /* a tick may fail once on a dead connection */ }
  }
  assert.equal(toChat(), 1, "the reminder went out once after the connections were dropped");
});

test("shadow: every tick runs, and the logs say which ones a skip would have taken", async () => {
  const { idle, lines } = scheduler("shadow");
  await idle.tick(at(0));
  const second = await idle.tick(at(TICK_MS));
  assert.equal(second.ran, true);
  assert.equal(second.decision.run, "skip");
  assert.ok(lines.some(l => l.tick === "full" && l.wouldSkip === true));
  assert.equal(idle.status().unpredictedWork, 0);
});

// ── A Nova learner with a chosen check-in time ─────────────────────────────────

const { saveSetup } = await import("../../nova/product/setup.js");

test("Nova: ticks before the check-in window are skipped; the check-in still goes out on the first tick at its time, once", async () => {
  // Tomorrow, so nothing the fixture writes "now" counts as recent activity.
  const day0 = Math.floor(Date.now() / 86_400_000) + 1;
  const ist  = (h: number, m: number, s = 0) => new Date(day0 * 86_400_000 + ((h * 60 + m - 330) * 60 + s) * 1000);
  const stamp = `${Date.now()}`;
  const chat  = `itest-idle-nova-${stamp}`;
  const user = await prisma.user.create({ data: { email: `idle${stamp}@idle-itest.local`, name: "Idle Learner" } });
  await prisma.userProfile.create({ data: {
    userId: user.id, onboardingComplete: true, primaryPersona: "nova", telegramChatId: chat, telegramConnected: true,
    preferredCheckInTime: "11:00", timezone: "Asia/Kolkata",
  } });
  const messenger = await prisma.messengerUser.create({ data: { platform: "telegram", platformChatId: chat, persona: "nova", displayName: "Idle Learner", aspirationWords: [], activeModules: [] } });
  const saved = await saveSetup(chat, { subjects: [{ name: "Operating Systems", topics: ["Deadlocks", "Paging"] }], exams: [], dailyMinutes: 120, studyTime: null }, ist(9, 0));
  assert.equal(saved.status, "saved");
  await prisma.novaAcademicProfile.update({ where: { userId: messenger.id }, data: { timezone: "Asia/Kolkata", onboardingComplete: true } });

  const { idle } = scheduler("on");
  const log: Array<{ at: string; ran: boolean; reasons: string[]; sent: number }> = [];
  for (let i = 0; i < 12; i++) {
    const now = ist(10, 32, 40 + i * 300);
    const { ran, decision } = await idle.tick(now);
    log.push({ at: now.toISOString(), ran, reasons: decision.reasons, sent: sent.filter(s => s.chat === chat).length });
  }
  const firstSent = log.find(l => l.sent > 0);
  assert.ok(firstSent, `never sent: ${JSON.stringify(log)}`);
  assert.equal(firstSent!.at, ist(11, 2, 40).toISOString(), `sent at ${firstSent!.at}: ${JSON.stringify(log)}`);
  assert.equal(log.at(-1)!.sent, 1, "once");
  assert.ok(log.slice(1, 6).some(l => !l.ran), "some ticks before the window were skipped");
  assert.ok(log.slice(7).some(l => !l.ran), "after the day's check-in went, ticks are skipped again");

  await prisma.user.deleteMany({ where: { email: { endsWith: "@idle-itest.local" } } });
  await prisma.messengerUser.deleteMany({ where: { platformChatId: chat } });
});

// ── Rex is not part of the scheduler ──────────────────────────────────────────

test("no Rex job runs: a due Rex check-in, custom reminder and gym time are left alone by full ticks", async () => {
  const rexChat = `itest-idle-rex-${Date.now()}`;
  const nineIst = istAt(9, 2, 40);   // inside Rex's 09:00 window and its 08:30 + 30 gym cue
  const rex = await prisma.messengerUser.create({ data: {
    platform: "telegram", platformChatId: rexChat, persona: "rex", intakeComplete: true, timezone: ZONE,
    preferredCheckInTime: "09:00", intakeAnswers: {}, nextCheckInAt: new Date(nineIst.getTime() - 60_000),
  } });
  const reminder = await prisma.customReminder.create({ data: { userId: rex.id, messageContext: "stretch", triggerTime: new Date(nineIst.getTime() - 60_000) } });

  for (const mode of ["off", "shadow", "on"] as const) {
    const { idle } = scheduler(mode);
    await idle.tick(nineIst);
    await idle.tick(new Date(nineIst.getTime() + TICK_MS));
  }
  assert.equal(sent.filter(s => s.chat === rexChat).length, 0, "nothing was sent to the Rex chat");
  const after = await prisma.messengerUser.findUniqueOrThrow({ where: { id: rex.id }, select: { nextCheckInAt: true } });
  assert.equal(after.nextCheckInAt?.toISOString(), new Date(nineIst.getTime() - 60_000).toISOString(), "the Rex check-in was not advanced");
  assert.equal((await prisma.customReminder.findUniqueOrThrow({ where: { id: reminder.id } })).fired, false, "the Rex reminder was not fired");
  assert.equal(await prisma.companionMessage.count({ where: { userId: rex.id } }), 0, "no Rex message was recorded");
  await prisma.messengerUser.deleteMany({ where: { id: rex.id } });
});
