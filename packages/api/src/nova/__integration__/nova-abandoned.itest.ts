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
const { runNovaSessionCommand, loadNovaSession, loadNovaSessionState } = await import("../product/session.js");
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

// PR #113 B.1 (owner, 28 Nov): a timer left running past its plan is saved
// with the time on its clock, never abandoned; more than two hours past its
// plan, it is kept "unconfirmed" until the learner confirms or trims it.
test("a 25-minute session is still a session at 54 minutes and is saved at 55, with the 55 minutes on its clock", async () => {
  const l = await learner();
  const t0 = ist("14:00");
  await start(l, t0, 25);
  const before = await learned(l);

  assert.equal(await sweep(l, plus(t0, 54)), 0);
  assert.deepEqual(await statuses(l), [["in_progress", 0]]);

  assert.equal(await sweep(l, plus(t0, 55)), 1);
  const [row] = await rows(l);
  assert.deepEqual([row!.status, row!.durationMinutes, (row!.executionReport as { autoClosed?: string }).autoClosed], ["completed", 55, "ran_past_plan"]);
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
  assert.deepEqual([row!.status, row!.durationMinutes, row!.totalPausedSeconds], ["completed", 55, 3600], "55 of study, the hour's pause still on the row");
});

test("a session started with no length is held to sixty minutes: open at 89, saved at 90 with its 90 minutes", async () => {
  const l = await learner();
  const t0 = ist("14:00");
  await start(l, t0, null);
  assert.equal((await rows(l))[0]!.plannedDurationMinutes, null);
  assert.equal(await sweep(l, plus(t0, 89)), 0);
  assert.equal(await sweep(l, plus(t0, 90)), 1);
  assert.deepEqual(await statuses(l), [["completed", 90]]);
  const progress = await loadNovaProgress(l.chat, { now: plus(t0, 91) });
  assert.equal(progress.status === "ready" && progress.overview.learningMinutes, 90, "saved, so counted");
});

test("a session paused for two hours is saved (not abandoned) with the time studied before the pause", async () => {
  const l = await learner();
  const t0 = ist("14:00");
  await start(l, t0, 45);
  assert.equal((await command(l, "pause", plus(t0, 5))).ok, true);
  assert.equal(await sweep(l, plus(t0, 5 + 119)), 0);
  assert.deepEqual(await statuses(l), [["paused", 0]]);
  assert.equal(await sweep(l, plus(t0, 5 + 120)), 1);
  assert.deepEqual(await statuses(l), [["completed", 5]], "five minutes were studied; the two hours were not");
});

// Bug batch 28 Nov, item 1: the 27 Nov case. An untimed Quick Focus, 38
// minutes studied, paused, swept after two hours. It must be saved, counted
// by Progress, and the learner told on their next visit.
test("REGRESSION item 1: a paused Quick Focus swept after two hours is saved, counted and announced", async () => {
  const l = await learner();
  const t0 = ist("08:18");
  assert.equal((await runNovaSessionCommand(l.chat, { action: "start", topicName: null, subjectName: null, plannedMinutes: 0, label: "Quick focus" }, t0)).ok, true);
  await command(l, "pause", plus(t0, 38));
  assert.equal(await sweep(l, plus(t0, 38 + 125)), 1);
  const [row] = await rows(l);
  assert.equal(row!.status, "completed");
  assert.equal(row!.durationMinutes, 38);
  assert.equal((row!.executionReport as { autoClosed?: string }).autoClosed, "paused_too_long");

  const progress = await loadNovaProgress(l.chat, { now: plus(t0, 200) });
  assert.ok(progress.status === "ready");
  assert.deepEqual([progress.overview.sessions, progress.overview.learningMinutes], [1, 38], "the 38 minutes count");

  const state = await loadNovaSessionState(l.chat, plus(t0, 200));
  assert.equal(state.session, null);
  assert.deepEqual([state.autoSaved?.sessionId, state.autoSaved?.minutes, state.autoSaved?.counted, state.autoSaved?.label], [row!.id, 38, true, "Quick focus"]);

  // Resume after the sweep: told it was saved, not that it was lost.
  const resumed = await command(l, "resume", plus(t0, 201));
  assert.ok(resumed.ok && resumed.session === null && resumed.autoSaved?.minutes === 38);

  // Starting again clears the notice.
  await runNovaSessionCommand(l.chat, { action: "start", topicName: null, subjectName: null, plannedMinutes: 0, label: "Quick focus" }, plus(t0, 300));
  assert.equal((await loadNovaSessionState(l.chat, plus(t0, 301))).autoSaved, null);
});

test("REGRESSION item 1: a paused session under ten minutes is saved but not counted, and says so", async () => {
  const l = await learner();
  const t0 = ist("14:00");
  await start(l, t0, 25);
  await command(l, "pause", plus(t0, 6));
  const resumed = await command(l, "resume", plus(t0, 6 + 121));
  assert.ok(resumed.ok && resumed.autoSaved && resumed.autoSaved.counted === false);
  assert.match(resumed.ok ? resumed.autoSaved!.message : "", /Under ten minutes/);
  assert.deepEqual(await statuses(l), [["completed", 6]]);
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
  assert.deepEqual(await statuses(l), [["completed", 15]]);
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

test("REGRESSION B.1: a timer left running for days is kept unconfirmed: in none of Progress's numbers until the learner confirms or trims it", async () => {
  const l = await learner();
  const t0 = ist("14:00");
  // One real session, then one left running for three days.
  await start(l, t0, 25);
  await end(l, plus(t0, 25));
  await start(l, plus(t0, 60), 25);
  const before = await learned(l);
  const later = plus(t0, 60 * 24 * 3);
  assert.equal(await sweep(l, later), 1);
  const [, open] = await rows(l);
  assert.equal(open!.status, "unconfirmed");
  assert.deepEqual(await learned(l), before);

  const progress = await loadNovaProgress(l.chat, { now: later });
  assert.ok(progress.status === "ready");
  assert.deepEqual([progress.overview.sessions, progress.overview.learningMinutes], [1, 25], "three days of open timer added nothing yet");
  // On return the learner is asked.
  const state = await loadNovaSessionState(l.chat, later);
  assert.equal(state.autoSaved?.needsConfirm, true);
  // Trimmed to what they say: then it counts, never more than recorded.
  const trimmed = await runNovaSessionCommand(l.chat, { action: "confirm_time", sessionId: open!.id, minutes: 40 }, later);
  assert.ok(trimmed.ok, JSON.stringify(trimmed));
  assert.deepEqual((await rows(l)).map(r => [r.status, r.durationMinutes]), [["completed", 25], ["completed", 40]]);
  const after = await loadNovaProgress(l.chat, { now: later });
  assert.ok(after.status === "ready" && after.overview.learningMinutes === 65);
  assert.equal((await runNovaSessionCommand(l.chat, { action: "confirm_time", sessionId: open!.id, minutes: 10 }, later)).ok, false, "once");

  const today = await loadNovaToday(l.chat, { now: later });
  assert.ok(today.status === "ready");
  assert.equal(today.activeSession, null);
  assert.equal(today.progress.lastSession?.minutes, 40, "the confirmed session is the last one studied");
  assert.equal(new Date(today.progress.lastSession!.date).getTime(), plus(t0, 60).getTime());

  const planner = await loadNovaPlanner(l.chat, { now: later });
  assert.ok(planner.status === "ready");
});

// B.1: the session left running is saved (65 minutes of the day), so the
// check-in sees a day already studied and stays quiet; it no longer holds
// anything back either way.
test("a session left running no longer holds back the check-in: it is saved, and the day counts as studied", async () => {
  const l = await learner();
  // Started at 10:00 for 25 minutes and forgotten.
  await start(l, ist("10:00"), 25);

  // 10:50, fifty minutes in: it is still a session, and it is not yet check-in time.
  await tick(ist("10:50"));
  assert.deepEqual(await statuses(l), [["in_progress", 0]]);

  // 11:05: past its limit. The tick closes it (saved, 65 minutes) and the check-in goes out.
  await tick(ist("11:05"));
  assert.deepEqual(await statuses(l), [["completed", 65]]);
  assert.deepEqual(sent.filter(s => s.chatId === l.chat).map(s => s.text), [], "studied today: no check-in");
  assert.equal(await loadNovaSession(l.chat, ist("11:06")), null, "nothing running holds anything back");
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
test("an End and two sweeps arriving together leave one outcome, whole: the learner's End or the sweep's save", async () => {
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

    const bySweep = (row!.executionReport as { autoClosed?: string } | null)?.autoClosed === "ran_past_plan";
    if (row!.status === "completed" && bySweep) {
      assert.equal(a + b, 1, "a sweep won");
      assert.ok(ended.ok && ended.ended === null && ended.autoSaved?.minutes === 70, "and the End is told it was saved");
      assert.deepEqual(after, before, "no mastery from a sweep");
    } else if (row!.status === "completed") {
      assert.equal(a + b, 0, "the End won: no sweep closed it");
      assert.ok(ended.ok && ended.ended, "and the End reports the session");
      assert.deepEqual([row!.durationMinutes, row!.executionReport !== null, after.history], [70, true, before.history + 1]);
    } else {
      assert.fail(`unexpected status ${row!.status}`);
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

test("an End that arrives after the sweep finds the session already kept, and is told how", async () => {
  const l = await learner();
  const t0 = ist("14:00");
  await start(l, t0, 25);
  assert.equal(await sweep(l, plus(t0, 300)), 1);
  const before = await learned(l);
  const row0 = JSON.stringify(await rows(l));

  for (const later of [301, 302, 60 * 24]) {
    const late = await end(l, plus(t0, later));
    assert.ok(late.ok && late.ended === null && late.autoSaved?.needsConfirm === true, JSON.stringify(late));
  }
  assert.equal(JSON.stringify(await rows(l)), row0, "the kept row is untouched");
  assert.deepEqual(await learned(l), before, "no mastery, no review, no history");
  const progress = await loadNovaProgress(l.chat, { now: plus(t0, 60 * 24) });
  assert.ok(progress.status === "ready");
  assert.deepEqual([progress.overview.sessions, progress.overview.learningMinutes], [0, 0], "300 minutes on a 25-minute plan waits for the learner");
});

test("Pause past the limit keeps a running session (unconfirmed), Resume past the pause limit saves a paused one; once the learner starts again, nothing more is said about it", async () => {
  const l = await learner();
  const t0 = ist("14:00");
  // Running past its limit: a Pause does not rescue it.
  await start(l, t0, 25);
  const paused = await command(l, "pause", plus(t0, 500));
  assert.ok(paused.ok && paused.session === null && paused.autoSaved?.needsConfirm === true);
  assert.deepEqual(await statuses(l), [["unconfirmed", 500]]);

  // Paused for more than two hours: a Resume finds it saved with its study time.
  await start(l, plus(t0, 1000), 25);
  await command(l, "pause", plus(t0, 1005));
  const resumed = await command(l, "resume", plus(t0, 1005 + 121));
  assert.ok(resumed.ok && resumed.session === null && resumed.autoSaved?.minutes === 5);
  assert.deepEqual((await statuses(l)).at(-1), ["completed", 5]);

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
  assert.deepEqual(await statuses(l), [["unconfirmed", 1440], ["in_progress", 0]]);
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
  assert.deepEqual(await statuses(l), [["unconfirmed", 4320]], "kept, but not believed: the learner confirms or trims it");
  const progress = await loadNovaProgress(l.chat, { now: plus(t0, 60 * 24 * 3 + 1) });
  assert.equal(progress.status === "ready" && progress.overview.learningMinutes, 0, "never study time until confirmed");
});

// Bug batch 28 Nov, item 1: the backfill for sessions abandoned while paused
// before the fix. Dry run writes nothing; apply saves each once; a rerun finds nothing.
test("REGRESSION item 1 backfill: abandoned-while-paused rows become saved sessions, once, and a running abandon is left alone", async () => {
  const { backfillPausedAbandoned } = await import("../persistence/session-backfill.js");
  const l = await learner();
  const t0 = ist("08:18");
  // As the old sweep left it: paused at 38 minutes, abandoned, kept as 38 capped... here as 0 to show the recompute.
  const paused = await prisma.novaStudySession.create({ data: {
    profileId: l.profileId, durationMinutes: 0, status: "abandoned", sessionDate: t0, pausedAt: plus(t0, 38),
    plannedDurationMinutes: 0, currentFocus: "Quick focus", totalPausedSeconds: 0,
  } });
  const running = await prisma.novaStudySession.create({ data: {
    profileId: l.profileId, durationMinutes: 25, status: "abandoned", sessionDate: plus(t0, 600), plannedDurationMinutes: 25,
  } });

  const dry = await backfillPausedAbandoned({ apply: false, profileId: l.profileId });
  assert.deepEqual([dry.candidates, dry.saved, dry.wouldCount, dry.minutesRecovered], [1, 0, 1, 38]);
  assert.equal((await prisma.novaStudySession.findUnique({ where: { id: paused.id } }))!.status, "abandoned", "a dry run writes nothing");

  const applied = await backfillPausedAbandoned({ apply: true, profileId: l.profileId });
  assert.equal(applied.saved, 1);
  const after = await prisma.novaStudySession.findUnique({ where: { id: paused.id } });
  assert.deepEqual([after!.status, after!.durationMinutes, after!.pausedAt?.getTime()], ["completed", 38, plus(t0, 38).getTime()]);
  assert.equal((await prisma.novaStudySession.findUnique({ where: { id: running.id } }))!.status, "abandoned", "a timer left running is not touched");

  const again = await backfillPausedAbandoned({ apply: true, profileId: l.profileId });
  assert.deepEqual([again.candidates, again.saved], [0, 0], "idempotent");
  // Old news: the page does not announce a backfilled session.
  assert.equal((await loadNovaSessionState(l.chat, plus(t0, 700))).autoSaved, null);
});

// PR #113 B.1: an End far past the plan records the End in full (report,
// mastery record) and keeps only its TIME waiting; confirming counts it.
test("REGRESSION B.1: End more than two hours past the plan records its evidence, waits for the time, and counts once confirmed", async () => {
  const l = await learner();
  const t0 = ist("09:00");
  await start(l, t0, 25);
  const before = await learned(l);
  const ended = await end(l, plus(t0, 25 + 150));
  assert.ok(ended.ok && ended.ended?.needsConfirm === true && ended.ended.counted === false, JSON.stringify(ended));
  const [row] = await rows(l);
  assert.equal(row!.status, "unconfirmed");
  assert.ok(row!.executionReport !== null, "the End's report is kept");
  assert.equal((await learned(l)).history, before.history + 1, "the End's evidence reached mastery as any End does");
  let progress = await loadNovaProgress(l.chat, { now: plus(t0, 200) });
  assert.ok(progress.status === "ready" && progress.overview.learningMinutes === 0, "not counted yet");
  assert.ok((await runNovaSessionCommand(l.chat, { action: "confirm_time", sessionId: row!.id, minutes: 90 }, plus(t0, 200))).ok);
  progress = await loadNovaProgress(l.chat, { now: plus(t0, 201) });
  assert.ok(progress.status === "ready" && progress.overview.learningMinutes === 90, "counted as confirmed");
  assert.deepEqual(await statuses(l), [["completed", 90]]);
});
