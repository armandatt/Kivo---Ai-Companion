/**
 * A study session nobody came back to — real Postgres integration test.
 *
 *   an open session → the abandonment rule (engines/session-clock.ts) →
 *   closed as "abandoned" by the tick's sweep → nothing counted, nothing
 *   held back. An End that reaches an open session first ends it as a
 *   session instead: the limit is for timers nobody is attending.
 *
 * Before this, a timer left running kept every proactive message from its
 * learner for as long as it stayed open, and was recorded as that many
 * minutes of study when it was finally ended.
 *
 * Telegram and the wording model are stood in. The clock is passed in.
 *
 *   NOVA_TEST_DATABASE_URL=postgresql://... npm run test:integration
 */

import "./test-database.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";

process.env.TELEGRAM_BOT_TOKEN = "";
process.env.GEMINI_API_KEY = "";
process.env.OPENAI_API_KEY = "";

const { prisma }                = await import("@repo/db/client");
const { runNovaProactiveCron }  = await import("../proactive/nova-proactive-cron.js");
const { saveSetup }             = await import("../product/setup.js");
const { runNovaSessionCommand, loadNovaSession } = await import("../product/session.js");
const { loadNovaProgress }      = await import("../product/progress.js");
const { loadNovaPlanner }       = await import("../product/planner.js");
const { loadNovaToday }         = await import("../product/today.js");
const { abandonStaleSessions, abandonIfStale } = await import("../persistence/nova-persistence.js");

import type { TelegramClient } from "../telegram/telegram.types.js";

const STAMP = Date.now();
// Tomorrow, so nothing a fixture writes "now" counts as recent activity.
const DAY0  = Math.floor(Date.now() / 86_400_000) + 1;
// The instant it is HH:MM in Kolkata (UTC+5:30, no daylight saving), `day` days after DAY0.
const ist = (hhmm: string, day = 0): Date => {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return new Date((DAY0 + day) * 86_400_000 + (h * 60 + m - 330) * 60_000);
};
const plus = (from: Date, minutes: number) => new Date(from.getTime() + minutes * 60_000);

const sent: Array<{ chatId: string; text: string }> = [];
let messageId = 71_000;
const client: TelegramClient = {
  async sendMessage(chatId, text) { sent.push({ chatId, text }); return { ok: true as const, messageId: ++messageId }; },
  async answerCallback() {}, async clearButtons() {}, async setChatCommands() {},
};
const word = (async (input: { type: string }) => ({ text: `SAID:${input.type}`, generated: true })) as never;
const tick = (now: Date) => runNovaProactiveCron(now, { client, word });

let n = 0;
// A Nova learner on Telegram, with a check-in at 11:00 and two topics.
async function learner() {
  const key  = `${STAMP}${++n}`;
  const chat = `6${String(n).padStart(2, "0")}${String(STAMP).slice(-10)}`;
  const name = `Abandon ${key}`;
  const user = await prisma.user.create({ data: { email: `a${key}@abandon-itest.local`, name } });
  await prisma.userProfile.create({
    data: {
      userId: user.id, onboardingComplete: true, primaryPersona: "nova", telegramChatId: chat, telegramConnected: true,
      preferredCheckInTime: "11:00", timezone: "Asia/Kolkata", accountabilityStyle: "soft",
    },
  });
  const messenger = await prisma.messengerUser.create({
    data: { platform: "telegram", platformChatId: chat, persona: "nova", displayName: name, aspirationWords: [], activeModules: [] },
    select: { id: true },
  });
  const saved = await saveSetup(chat, { subjects: [{ name: "Operating Systems", topics: ["Deadlocks", "Paging"] }], exams: [], dailyMinutes: 120, studyTime: null }, ist("08:00"));
  assert.equal(saved.status, "saved", JSON.stringify(saved));
  const profile = await prisma.novaAcademicProfile.findUniqueOrThrow({ where: { userId: messenger.id }, select: { id: true } });
  await prisma.novaAcademicProfile.update({ where: { id: profile.id }, data: { onboardingComplete: true, timezone: "Asia/Kolkata" } });
  return { chat, profileId: profile.id };
}
type L = Awaited<ReturnType<typeof learner>>;

const start = async (l: L, at: Date, plannedMinutes: number | null) => {
  const r = await runNovaSessionCommand(l.chat, { action: "start", topicName: "Deadlocks", subjectName: "Operating Systems", plannedMinutes }, at);
  assert.equal(r.ok, true, JSON.stringify(r));
};
const command = (l: L, action: "pause" | "resume", at: Date) => runNovaSessionCommand(l.chat, { action }, at);
const end     = (l: L, at: Date) => runNovaSessionCommand(l.chat, { action: "end", outcome: "good" }, at);
const sweep   = (l: L, at: Date) => abandonStaleSessions(at, l.profileId);

const rows = (l: L) => prisma.novaStudySession.findMany({
  where: { profileId: l.profileId }, orderBy: { createdAt: "asc" },
  select: { id: true, status: true, durationMinutes: true, plannedDurationMinutes: true, executionReport: true, pausedAt: true, totalPausedSeconds: true },
});
const statuses = async (l: L) => (await rows(l)).map(r => [r.status, r.durationMinutes]);
// Everything a session can leave on the learner's record of what they know.
const learned = async (l: L) => {
  const [history, topics] = await Promise.all([
    prisma.novaTopicMasterySnapshot.count({ where: { profileId: l.profileId } }),
    prisma.novaTopicMastery.findMany({ where: { subject: { profileId: l.profileId } }, orderBy: { name: "asc" } }),
  ]);
  return { history, topics: JSON.stringify(topics, (_k, v) => typeof v === "bigint" ? Number(v) : v) };
};

after(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: "@abandon-itest.local" } } });
  await prisma.messengerUser.deleteMany({ where: { displayName: { startsWith: `Abandon ${STAMP}` } } });
  await prisma.$disconnect();
});

// ── The limits ────────────────────────────────────────────────────────────────

test("a 25-minute session is still a session at 54 minutes and is abandoned at 55, kept as 25 minutes and no more", async () => {
  const l = await learner();
  const t0 = ist("14:00");
  await start(l, t0, 25);
  const before = await learned(l);

  assert.equal(await sweep(l, plus(t0, 54)), 0);
  assert.deepEqual(await statuses(l), [["in_progress", 0]]);

  assert.equal(await sweep(l, plus(t0, 55)), 1);
  const [row] = await rows(l);
  assert.deepEqual([row!.status, row!.durationMinutes, row!.executionReport], ["abandoned", 25, null]);
  assert.deepEqual(await learned(l), before, "no mastery moved, no review scheduled, no mastery history");
  assert.equal(await loadNovaSession(l.chat, plus(t0, 56)), null, "nothing is running any more");
});

test("paused time does not bring the limit closer", async () => {
  const l = await learner();
  const t0 = ist("14:00");
  await start(l, t0, 25);
  assert.equal((await command(l, "pause", plus(t0, 10))).ok, true);
  assert.equal((await command(l, "resume", plus(t0, 70))).ok, true);      // an hour's break
  // 100 minutes on the wall, 40 of study.
  assert.equal(await sweep(l, plus(t0, 100)), 0);
  assert.deepEqual(await statuses(l), [["in_progress", 0]]);
  // 115 on the wall, 55 of study.
  assert.equal(await sweep(l, plus(t0, 115)), 1);
  const [row] = await rows(l);
  assert.deepEqual([row!.status, row!.durationMinutes, row!.totalPausedSeconds], ["abandoned", 25, 3600], "the pause that was taken is still on the row");
});

test("a session started with no length is held to sixty minutes: open at 89, abandoned at 90", async () => {
  const l = await learner();
  const t0 = ist("14:00");
  await start(l, t0, null);
  assert.equal((await rows(l))[0]!.plannedDurationMinutes, null);
  assert.equal(await sweep(l, plus(t0, 89)), 0);
  assert.equal(await sweep(l, plus(t0, 90)), 1);
  assert.deepEqual(await statuses(l), [["abandoned", 60]]);
  const progress = await loadNovaProgress(l.chat, { now: plus(t0, 91) });
  assert.equal(progress.status === "ready" && progress.overview.learningMinutes, 0, "the sixty minutes are a limit, not study");
});

test("a session paused for two hours is abandoned, however little was studied", async () => {
  const l = await learner();
  const t0 = ist("14:00");
  await start(l, t0, 45);
  assert.equal((await command(l, "pause", plus(t0, 5))).ok, true);
  assert.equal(await sweep(l, plus(t0, 5 + 119)), 0);
  assert.deepEqual(await statuses(l), [["paused", 0]]);
  assert.equal(await sweep(l, plus(t0, 5 + 120)), 1);
  assert.deepEqual(await statuses(l), [["abandoned", 5]], "five minutes were studied; the two hours were not");
});

test("resuming starts the pause count again", async () => {
  const l = await learner();
  const t0 = ist("14:00");
  await start(l, t0, 45);
  await command(l, "pause", plus(t0, 5));
  assert.equal((await command(l, "resume", plus(t0, 5 + 110))).ok, true);   // 110 minutes paused: under the limit
  await command(l, "pause", plus(t0, 5 + 110 + 10));                          // 15 minutes studied in all
  // 30 minutes into the second pause: 140 minutes paused altogether, 30 in this one.
  assert.equal(await sweep(l, plus(t0, 5 + 110 + 10 + 30)), 0);
  assert.deepEqual(await statuses(l), [["paused", 0]]);
  assert.equal(await sweep(l, plus(t0, 5 + 110 + 10 + 120)), 1);
  assert.deepEqual(await statuses(l), [["abandoned", 15]]);
});

// ── What an abandoned session leaves, and does not ────────────────────────────

test("a session ended in the ordinary way is completed as before: counted, with its report, its mastery record and its review", async () => {
  const l = await learner();
  const t0 = ist("14:00");
  await start(l, t0, 25);
  const before = await learned(l);
  const ended = await end(l, plus(t0, 25));
  assert.equal(ended.ok && ended.ended?.minutes, 25);
  assert.equal(ended.ok && ended.ended?.counted, true);

  const [row] = await rows(l);
  assert.deepEqual([row!.status, row!.durationMinutes, row!.executionReport !== null], ["completed", 25, true]);
  const after = await learned(l);
  assert.equal(after.history, before.history + 1, "one mastery record");
  assert.notEqual(after.topics, before.topics, "the topic moved and has a review date");

  // Every later sweep leaves it alone.
  assert.equal(await sweep(l, plus(t0, 60 * 24 * 3)), 0);
  assert.deepEqual(await statuses(l), [["completed", 25]]);
  const progress = await loadNovaProgress(l.chat, { now: plus(t0, 30) });
  assert.ok(progress.status === "ready");
  assert.deepEqual([progress.overview.sessions, progress.overview.learningMinutes, progress.overview.notCounted], [1, 25, { selfReported: 0, underTenMinutes: 0 }]);
});

test("an abandoned session is in none of Progress's numbers, is named as not counted, and is not a session on Today or the Planner", async () => {
  const l = await learner();
  const t0 = ist("14:00");
  // One real session, then one left running for three days.
  await start(l, t0, 25);
  await end(l, plus(t0, 25));
  await start(l, plus(t0, 60), 25);
  const before = await learned(l);
  const later = plus(t0, 60 * 24 * 3);
  assert.equal(await sweep(l, later), 1);
  assert.deepEqual(await statuses(l), [["completed", 25], ["abandoned", 25]]);
  assert.deepEqual(await learned(l), before);

  const progress = await loadNovaProgress(l.chat, { now: later });
  assert.ok(progress.status === "ready");
  assert.deepEqual([progress.overview.sessions, progress.overview.learningMinutes], [1, 25], "three days of open timer added nothing");
  assert.deepEqual(progress.overview.notCounted, { selfReported: 0, underTenMinutes: 0, abandoned: 1 });

  const today = await loadNovaToday(l.chat, { now: later });
  assert.ok(today.status === "ready");
  assert.equal(today.activeSession, null);
  assert.equal(today.progress.lastSession?.minutes, 25);
  assert.equal(new Date(today.progress.lastSession!.date).getTime(), t0.getTime(), "the last session is the one that was studied");

  const planner = await loadNovaPlanner(l.chat, { now: later });
  assert.ok(planner.status === "ready");
  const listed = planner.week.flatMap(d => d.sessions).filter(s => s.status === "abandoned" || s.status === "completed");
  assert.ok(listed.every(s => s.status !== "completed" || s.minutes === 25), "no abandoned session is shown as a completed one");
});

test("a session left running no longer holds back the check-in", async () => {
  const l = await learner();
  // Started at 10:00 for 25 minutes and forgotten.
  await start(l, ist("10:00"), 25);

  // 10:50, fifty minutes in: it is still a session, and it is not yet check-in time.
  await tick(ist("10:50"));
  assert.deepEqual(await statuses(l), [["in_progress", 0]]);

  // 11:05: past its limit. The tick closes it and the check-in goes out.
  await tick(ist("11:05"));
  assert.deepEqual(await statuses(l), [["abandoned", 25]]);
  assert.deepEqual(sent.filter(s => s.chatId === l.chat).map(s => s.text), ["SAID:daily_checkin"]);
  assert.equal(await prisma.novaProactiveMessage.count({ where: { profileId: l.profileId, status: "sent" } }), 1);
});

test("a session that is really running still holds the check-in back", async () => {
  const l = await learner();
  await start(l, ist("10:50"), 45);
  await tick(ist("11:05"));
  assert.deepEqual(await statuses(l), [["in_progress", 0]]);
  assert.equal(sent.filter(s => s.chatId === l.chat).length, 0);
});

// ── Once, whoever gets there ──────────────────────────────────────────────────

test("sweeping again changes nothing", async () => {
  const l = await learner();
  const t0 = ist("14:00");
  await start(l, t0, 25);
  assert.equal(await sweep(l, plus(t0, 200)), 1);
  const first = JSON.stringify(await rows(l));
  const before = await learned(l);
  for (const later of [201, 500, 60 * 24 * 7]) assert.equal(await sweep(l, plus(t0, later)), 0);
  assert.equal(await abandonIfStale((await rows(l))[0]!.id, plus(t0, 900)), false);
  assert.equal(JSON.stringify(await rows(l)), first, "the row is exactly as the first sweep left it");
  assert.deepEqual(await learned(l), before);
});

// End and the sweep race on one row. The database lets one through; that one
// owns the outcome, whole: a session with its report and its mastery record,
// or an abandoned one with neither. Never a mixture, never both.
test("an End and two sweeps arriving together leave one outcome, whole: a counted session or an abandoned one", async () => {
  for (let round = 0; round < 6; round++) {
    const l = await learner();
    const t0 = ist("14:00");
    await start(l, t0, 25);
    const before = await learned(l);
    const at = plus(t0, 70);
    const [a, b, ended] = await Promise.all([sweep(l, at), sweep(l, at), end(l, at)]);
    const [row, ...rest] = await rows(l);
    const after = await learned(l);
    assert.equal(rest.length, 0);
    assert.ok(a + b <= 1, "at most one sweep closed it");

    if (row!.status === "completed") {
      assert.equal(a + b, 0, "the End won: no sweep closed it");
      assert.ok(ended.ok && ended.ended, "and the End reports the session");
      assert.deepEqual([row!.durationMinutes, row!.executionReport !== null, after.history], [70, true, before.history + 1]);
    } else {
      assert.equal(row!.status, "abandoned");
      assert.equal(a + b, 1, "a sweep won");
      assert.deepEqual([ended.ok, !ended.ok && ended.error], [false, "session_abandoned"], "and the End is told so");
      assert.deepEqual([row!.durationMinutes, row!.executionReport], [25, null]);
      assert.deepEqual(after, before, "nothing counted");
    }
    assert.equal(await prisma.novaTopicMasterySnapshot.count({ where: { profileId: l.profileId } }) <= before.history + 1, true, "never counted twice");
  }
});

// ── Ending a session that ran long ────────────────────────────────────────────

test("End at 54 minutes on a 25-minute plan ends it as a session, with its 54 minutes", async () => {
  const l = await learner();
  const t0 = ist("14:00");
  await start(l, t0, 25);
  const before = await learned(l);
  const ended = await end(l, plus(t0, 54));
  assert.deepEqual([ended.ok, ended.ok && ended.ended?.minutes, ended.ok && ended.ended?.counted], [true, 54, true]);
  assert.deepEqual(await statuses(l), [["completed", 54]]);
  assert.equal((await learned(l)).history, before.history + 1);
});

test("End at 55 minutes, before any sweep has closed it, still ends it as a session: the limit is not a maximum", async () => {
  const l = await learner();
  const t0 = ist("14:00");
  await start(l, t0, 25);
  const before = await learned(l);
  // Past the limit, and nothing has swept.
  const ended = await end(l, plus(t0, 55));
  assert.deepEqual([ended.ok, ended.ok && ended.ended?.minutes, ended.ok && ended.ended?.counted], [true, 55, true]);
  const [row] = await rows(l);
  assert.deepEqual([row!.status, row!.durationMinutes, row!.executionReport !== null], ["completed", 55, true]);
  const after = await learned(l);
  assert.equal(after.history, before.history + 1, "it moved mastery as any session does");
  // And a sweep afterwards leaves a completed session alone.
  assert.equal(await sweep(l, plus(t0, 500)), 0);
  assert.deepEqual(await statuses(l), [["completed", 55]]);
});

test("a long session the learner ends themselves is recorded at its real length: two hours on a 45-minute plan", async () => {
  const l = await learner();
  const t0 = ist("14:00");
  await start(l, t0, 45);
  const ended = await end(l, plus(t0, 120));
  assert.equal(ended.ok && ended.ended?.minutes, 120);
  assert.deepEqual(await statuses(l), [["completed", 120]]);
  const progress = await loadNovaProgress(l.chat, { now: plus(t0, 121) });
  assert.ok(progress.status === "ready");
  assert.deepEqual([progress.overview.sessions, progress.overview.learningMinutes, progress.overview.notCounted], [1, 120, { selfReported: 0, underTenMinutes: 0 }]);
});

test("End after a pause and a resume records the study time and leaves the break out", async () => {
  const l = await learner();
  const t0 = ist("14:00");
  await start(l, t0, 25);
  assert.equal((await command(l, "pause", plus(t0, 20))).ok, true);
  assert.equal((await command(l, "resume", plus(t0, 50))).ok, true);     // half an hour away
  // 100 minutes on the wall, 70 of study: well past 55, and the learner is here to end it.
  const ended = await end(l, plus(t0, 100));
  assert.equal(ended.ok && ended.ended?.minutes, 70);
  const [row] = await rows(l);
  assert.deepEqual([row!.status, row!.durationMinutes, row!.totalPausedSeconds], ["completed", 70, 1800]);
});

test("End while paused past the two hours, before any sweep, ends it with the study time only", async () => {
  const l = await learner();
  const t0 = ist("14:00");
  await start(l, t0, 45);
  await command(l, "pause", plus(t0, 30));
  const ended = await end(l, plus(t0, 30 + 180));
  assert.equal(ended.ok && ended.ended?.minutes, 30, "three hours paused are not study");
  assert.deepEqual(await statuses(l), [["completed", 30]]);
});

test("an End that arrives after the sweep cannot bring an abandoned session back, and is told why", async () => {
  const l = await learner();
  const t0 = ist("14:00");
  await start(l, t0, 25);
  assert.equal(await sweep(l, plus(t0, 300)), 1);
  const before = await learned(l);
  const row0 = JSON.stringify(await rows(l));

  for (const later of [301, 302, 60 * 24]) {
    const late = await end(l, plus(t0, later));
    assert.deepEqual([late.ok, !late.ok && late.error], [false, "session_abandoned"]);
    assert.ok(!late.ok && late.message.includes("not counted"));
  }
  assert.equal(JSON.stringify(await rows(l)), row0, "the abandoned row is untouched");
  assert.deepEqual(await learned(l), before, "no mastery, no review, no history");
  const progress = await loadNovaProgress(l.chat, { now: plus(t0, 60 * 24) });
  assert.ok(progress.status === "ready");
  assert.deepEqual([progress.overview.sessions, progress.overview.learningMinutes, progress.overview.notCounted], [0, 0, { selfReported: 0, underTenMinutes: 0, abandoned: 1 }]);
});

test("Pause and Resume past the limit close it as abandoned; once the learner starts again, nothing more is said about it", async () => {
  const l = await learner();
  const t0 = ist("14:00");
  // Running past its limit: a Pause does not rescue it.
  await start(l, t0, 25);
  const paused = await command(l, "pause", plus(t0, 500));
  assert.deepEqual([paused.ok, !paused.ok && paused.error], [false, "session_abandoned"]);
  assert.deepEqual(await statuses(l), [["abandoned", 25]]);

  // Paused for more than two hours: a Resume does not either.
  await start(l, plus(t0, 1000), 25);
  await command(l, "pause", plus(t0, 1005));
  const resumed = await command(l, "resume", plus(t0, 1005 + 121));
  assert.deepEqual([resumed.ok, !resumed.ok && resumed.error], [false, "session_abandoned"]);
  assert.deepEqual((await statuses(l)).at(-1), ["abandoned", 5]);

  // A session started and ended since: "nothing is running" is the whole answer again.
  await start(l, plus(t0, 2000), 25);
  await end(l, plus(t0, 2025));
  const nothing = await end(l, plus(t0, 2030));
  assert.deepEqual([nothing.ok, !nothing.ok && nothing.error], [false, "no_active_session"]);
});

test("a new session can be started over one that was left running", async () => {
  const l = await learner();
  const t0 = ist("14:00");
  await start(l, t0, 25);
  // The next day, with no tick in between.
  await start(l, plus(t0, 60 * 24), 45);
  assert.deepEqual(await statuses(l), [["abandoned", 25], ["in_progress", 0]]);
  const running = await loadNovaSession(l.chat, plus(t0, 60 * 24 + 10));
  assert.equal(running?.plannedDurationMinutes, 45);
});

test("timing that makes no sense never becomes study time", async () => {
  const l = await learner();
  const t0 = ist("14:00");
  await start(l, t0, null);
  const [row] = await rows(l);

  // A start in the future: no study time, and no reason to abandon.
  await prisma.novaStudySession.update({ where: { id: row!.id }, data: { sessionDate: plus(t0, 60 * 24 * 30) } });
  assert.equal(await sweep(l, plus(t0, 500)), 0);
  assert.deepEqual(await statuses(l), [["in_progress", 0]]);

  // Marked paused with no pause time, three days old, more paused time on
  // record than the session has lasted.
  await prisma.novaStudySession.update({ where: { id: row!.id }, data: { sessionDate: t0, status: "paused", pausedAt: null, totalPausedSeconds: 10 * 86_400 } });
  assert.equal(await sweep(l, plus(t0, 60 * 24 * 3)), 0, "no study time at all: nothing to hold against the limit");
  await prisma.novaStudySession.update({ where: { id: row!.id }, data: { totalPausedSeconds: 0 } });
  assert.equal(await sweep(l, plus(t0, 60 * 24 * 3)), 1);
  assert.deepEqual(await statuses(l), [["abandoned", 60]], "sixty at most, not 4,320");
  const progress = await loadNovaProgress(l.chat, { now: plus(t0, 60 * 24 * 3 + 1) });
  assert.equal(progress.status === "ready" && progress.overview.learningMinutes, 0);
});
