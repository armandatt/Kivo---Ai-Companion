/**
 * Getting back on track — real Postgres integration test.
 *
 * What it proves: reading where a learner is writes nothing and gives the
 * same proposal however often it is asked; nothing in the plan or the
 * tasks changes while a proposal waits; an accept moves exactly the
 * proposed tasks, once, even when sent twice or from two tabs at once; a
 * proposal the record no longer gives is refused with nothing written;
 * undo puts back exactly what was moved, and refuses when a task changed;
 * a removed date changes the proposal; another learner cannot act on it;
 * a first day back is planned shorter, and stops being so after a session.
 *
 *   NOVA_TEST_DATABASE_URL=postgresql://... npm run test:integration
 */

import "./test-database.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

process.env.TELEGRAM_BOT_TOKEN = "";
process.env.GEMINI_API_KEY = "";
process.env.OPENAI_API_KEY = "";

const { prisma }                   = await import("@repo/db/client");
const { resolveLearnerForAccount } = await import("../product/learner-identity.js");
const { saveSetup }                = await import("../product/setup.js");
const { createTask, updateTask, listTasks } = await import("../product/tasks.js");
const { resolveNoteLearner }       = await import("../product/notes.js");
const { getRecovery, actOnRecovery } = await import("../product/recovery.js");
const { loadNovaToday }            = await import("../product/today.js");
const { removeExam, listExams }    = await import("../product/exams.js");
const { dayKey, dayKeyOfNumber, dayNumber } = await import("../engines/learner-calendar.js");

const STAMP = Date.now();
const now   = new Date();
const accounts: string[] = [];
let n = 0;
const today = dayKey(now, "UTC");
const day = (offset: number) => dayKeyOfNumber(dayNumber(today) + offset);
const at  = (offset: number) => new Date(Date.parse(`${day(offset)}T12:00:00Z`));

async function learner(opts: { dailyMinutes?: number | null; exams?: Array<{ subject: string; date: string; type?: string }> } = {}) {
  const user = await prisma.user.create({ data: { email: `rec_${STAMP}_${++n}@test.local`, name: "Asha" }, select: { id: true } });
  accounts.push(user.id);
  await prisma.userProfile.create({ data: { userId: user.id, primaryPersona: "nova", onboardingComplete: true, secondaryDomains: [], aspirationWords: [] } });
  const web = (await resolveLearnerForAccount(user.id, "Asha")) as { platformChatId: string };
  await saveSetup(web.platformChatId, {
    subjects: [{ name: "Operating Systems", topics: ["Deadlocks", "Paging"] }, { name: "DBMS", topics: ["Indexing"] }],
    exams: (opts.exams ?? []).map(e => ({ subjectName: e.subject, date: e.date, title: `${e.subject} final`, type: e.type ?? "exam" })),
    dailyMinutes: opts.dailyMinutes === undefined ? 60 : opts.dailyMinutes, studyTime: null,
  } as never, now);
  const resolved = await resolveNoteLearner(web.platformChatId);
  assert.equal(resolved.status, "ready");
  const profileId = resolved.status === "ready" ? resolved.profileId : "";
  await prisma.novaAcademicProfile.update({ where: { id: profileId }, data: { timezone: "UTC" } });
  const rows = await prisma.novaSubject.findMany({ where: { profileId }, select: { id: true, name: true } });
  return { chat: web.platformChatId, profileId, subject: Object.fromEntries(rows.map(r => [r.name, r.id])) as Record<string, string> };
}

async function task(profileId: string, title: string, dueDay: string, extra: Record<string, unknown> = {}) {
  const r = await createTask(profileId, { title, dueDay, ...extra }, { now });
  assert.ok(r.ok);
  return r.ok ? r.task.id : "";
}

async function session(profileId: string, daysAgo: number, extra: Record<string, unknown> = {}) {
  await prisma.novaStudySession.create({ data: {
    profileId, topicName: "Deadlocks", sessionDate: at(-daysAgo), status: "completed",
    durationMinutes: 30, plannedDurationMinutes: 30, activityType: "practice", ...extra,
  } });
}

const dueDays = async (profileId: string) =>
  Object.fromEntries((await listTasks(profileId, { now })).tasks.map(t => [t.title, t.dueDay]));

// Everything recovery must never touch, as it stands.
async function elsewhere(profileId: string) {
  const [sessions, mastery, exams, notes, profile] = await Promise.all([
    prisma.novaStudySession.findMany({ where: { profileId }, orderBy: { id: "asc" } }),
    prisma.novaTopicMastery.findMany({ where: { subject: { profileId } }, orderBy: { id: "asc" } }),
    prisma.novaExam.findMany({ where: { profileId }, orderBy: { id: "asc" } }),
    prisma.novaNote.findMany({ where: { profileId }, orderBy: { id: "asc" } }),
    prisma.novaAcademicProfile.findUniqueOrThrow({ where: { id: profileId } }),
  ]);
  return JSON.stringify({ sessions, mastery, exams, notes, profile });
}

before(async () => { await prisma.$queryRaw`SELECT 1`; });
after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: accounts } } });
  await prisma.$disconnect();
});

test("where the learner is comes from counted sessions on their calendar; a self-report or a short session is not one", async () => {
  const l = await learner();
  assert.equal((await getRecovery(l.profileId, now)).situation, "no_history");
  await session(l.profileId, 6);
  await session(l.profileId, 1, { activityType: "self_reported" });
  await session(l.profileId, 0, { durationMinutes: 5 });
  const back = await getRecovery(l.profileId, now);
  assert.equal(back.situation, "returning");
  assert.equal(back.daysSinceStudy, 6);
  assert.equal(back.reentryDay, true);
  assert.match(back.headline, /last session was 6 days ago/);

  await session(l.profileId, 2);
  assert.deepEqual((({ situation, missedDays }) => ({ situation, missedDays }))(await getRecovery(l.profileId, now)), { situation: "missed_one", missedDays: 1 });
});

test("a first day back is planned shorter on Today, and is a normal day again after a session", async () => {
  const l = await learner({ dailyMinutes: 60 });
  await session(l.profileId, 5);
  const back = await loadNovaToday(l.chat, { now });
  assert.ok(back.status === "ready");
  if (back.status !== "ready") return;
  assert.equal(back.plan.budgetBasis, "reentry");
  assert.ok(back.plan.budgetMinutes <= 30);

  await session(l.profileId, 0);
  const after = await loadNovaToday(l.chat, { now });
  assert.ok(after.status === "ready" && after.plan.budgetBasis === "preferred");
});

test("reading writes nothing, gives the same proposal every time, and leaves the tasks as they are while it waits", async () => {
  const l = await learner();
  await task(l.profileId, "Lab 3", day(-3));
  await task(l.profileId, "Read ch. 5", day(-1), { priority: "high" });
  const before = await dueDays(l.profileId);
  const state  = await elsewhere(l.profileId);

  const one = await getRecovery(l.profileId, now);
  const two = await getRecovery(l.profileId, now);
  assert.ok(one.proposal);
  assert.equal(one.proposal!.id, two.proposal!.id);
  assert.deepEqual(one.proposal!.moves.map(m => [m.title, m.to]), [["Read ch. 5", day(0)], ["Lab 3", day(1)]]);
  assert.deepEqual(await dueDays(l.profileId), before);
  assert.equal(await elsewhere(l.profileId), state);
});

test("accept moves exactly the proposed tasks once; a retry and a second tab are told it is done; undo puts them back once", async () => {
  const l = await learner();
  await task(l.profileId, "Lab 3", day(-3));
  await task(l.profileId, "Read ch. 5", day(-1));
  await task(l.profileId, "Not overdue", day(4));
  const state = await elsewhere(l.profileId);
  const proposal = (await getRecovery(l.profileId, now)).proposal!;
  const body = { action: "accept", proposalId: proposal.id, moves: proposal.moves.map(({ taskId, from, to }) => ({ taskId, from, to })) };

  const first = await actOnRecovery(l.profileId, body, now);
  assert.ok(first.ok && first.outcome === "applied");
  assert.deepEqual(await dueDays(l.profileId), { "Lab 3": day(0), "Read ch. 5": day(1), "Not overdue": day(4) });
  assert.equal(first.ok && first.view.proposal, null);

  const retry = await actOnRecovery(l.profileId, body, now);
  assert.ok(retry.ok && retry.outcome === "already_applied");
  assert.deepEqual(await dueDays(l.profileId), { "Lab 3": day(0), "Read ch. 5": day(1), "Not overdue": day(4) });

  const undo = { action: "undo", moves: first.ok ? first.undo : [] };
  const back = await actOnRecovery(l.profileId, undo, now);
  assert.ok(back.ok && back.outcome === "undone");
  assert.deepEqual(await dueDays(l.profileId), { "Lab 3": day(-3), "Read ch. 5": day(-1), "Not overdue": day(4) });
  const again = await actOnRecovery(l.profileId, undo, now);
  assert.ok(again.ok && again.outcome === "already_undone");
  // The same proposal is offered again, as it was.
  assert.equal((await getRecovery(l.profileId, now)).proposal!.id, proposal.id);
  assert.equal(await elsewhere(l.profileId), state);
});

test("two accepts at once move each task once", async () => {
  const l = await learner();
  await task(l.profileId, "A", day(-2));
  await task(l.profileId, "B", day(-2));
  const p = (await getRecovery(l.profileId, now)).proposal!;
  const body = { action: "accept", proposalId: p.id, moves: p.moves.map(({ taskId, from, to }) => ({ taskId, from, to })) };
  const results = await Promise.all([actOnRecovery(l.profileId, body, now), actOnRecovery(l.profileId, body, now)]);
  assert.deepEqual(results.map(r => r.ok && r.outcome).sort(), ["already_applied", "applied"]);
  assert.deepEqual(await dueDays(l.profileId), { A: day(0), B: day(1) });
});

test("not accepting changes nothing; a proposal the record no longer gives is refused and nothing is written", async () => {
  const l = await learner();
  const a = await task(l.profileId, "A", day(-2));
  await task(l.profileId, "B", day(-1));
  const stale = (await getRecovery(l.profileId, now)).proposal!;
  // The learner moves one themselves meanwhile.
  await updateTask(l.profileId, a, { dueDay: day(3) }, { now });
  const before = await dueDays(l.profileId);

  const r = await actOnRecovery(l.profileId, { action: "accept", proposalId: stale.id, moves: stale.moves.map(({ taskId, from, to }) => ({ taskId, from, to })) }, now);
  assert.ok(!r.ok && r.error === "changed");
  assert.ok(!r.ok && r.view && r.view.proposal && r.view.proposal.id !== stale.id);
  assert.deepEqual(await dueDays(l.profileId), before);
});

test("undo refuses, and writes nothing, when a moved task changed since", async () => {
  const l = await learner();
  const a = await task(l.profileId, "A", day(-2));
  await task(l.profileId, "B", day(-1));
  const p = (await getRecovery(l.profileId, now)).proposal!;
  const done = await actOnRecovery(l.profileId, { action: "accept", proposalId: p.id, moves: [] }, now);
  assert.ok(done.ok && done.outcome === "applied");
  await updateTask(l.profileId, a, { status: "done" }, { now });
  const before = await dueDays(l.profileId);
  const r = await actOnRecovery(l.profileId, { action: "undo", moves: done.ok ? done.undo : [] }, now);
  assert.ok(!r.ok && r.error === "changed");
  assert.deepEqual(await dueDays(l.profileId), before);
});

test("a date today leaves its subject's task unplaced; removing the date changes the proposal and the old one is refused", async () => {
  const l = await learner({ exams: [{ subject: "Operating Systems", date: today }] });
  await task(l.profileId, "OS lab", day(-2), { subjectId: l.subject["Operating Systems"] });
  const withExam = (await getRecovery(l.profileId, now)).proposal!;
  assert.deepEqual(withExam.moves, []);
  assert.equal(withExam.unplaced[0]!.why, "deadline_conflict");

  const exam = (await listExams(l.chat, now))!.find(e => e.date === today)!;
  assert.equal((await removeExam(l.chat, exam.id, now)).status, "removed");
  const without = (await getRecovery(l.profileId, now)).proposal!;
  assert.notEqual(without.id, withExam.id);
  assert.deepEqual(without.moves.map(m => m.to), [today]);

  const r = await actOnRecovery(l.profileId, { action: "accept", proposalId: withExam.id, moves: [] }, now);
  assert.ok(!r.ok && r.error === "changed");
  assert.equal((await dueDays(l.profileId))["OS lab"], day(-2));
});

test("an exam day ahead is left free and its subject's task goes before it", async () => {
  const l = await learner({ exams: [{ subject: "Operating Systems", date: day(2) }] });
  await task(l.profileId, "Other", day(0));
  await task(l.profileId, "OS lab", day(-2), { subjectId: l.subject["Operating Systems"] });
  await task(l.profileId, "DB lab", day(-1), { subjectId: l.subject.DBMS });
  const p = (await getRecovery(l.profileId, now)).proposal!;
  assert.deepEqual(Object.fromEntries(p.moves.map(m => [m.title, m.to])), { "OS lab": day(1), "DB lab": day(3) });
});

test("another learner cannot accept or undo someone else's proposal", async () => {
  const owner = await learner();
  const other = await learner();
  await task(owner.profileId, "Mine", day(-2));
  const p = (await getRecovery(owner.profileId, now)).proposal!;
  const moves = p.moves.map(({ taskId, from, to }) => ({ taskId, from, to }));
  const r = await actOnRecovery(other.profileId, { action: "accept", proposalId: p.id, moves }, now);
  assert.ok(!r.ok);
  const u = await actOnRecovery(other.profileId, { action: "undo", moves: moves.map(m => ({ ...m, from: m.to, to: m.from })) }, now);
  assert.ok(!u.ok);
  assert.equal((await dueDays(owner.profileId)).Mine, day(-2));
});

test("a request that is not a change is refused", async () => {
  const l = await learner();
  for (const body of [null, [], { action: "accept" }, { action: "accept", proposalId: "x", moves: [{ taskId: "t", from: "yesterday", to: today }] }, { action: "delete", moves: [] }, { action: "undo", moves: [] }]) {
    const r = await actOnRecovery(l.profileId, body, now);
    assert.ok(!r.ok && r.error === "invalid", JSON.stringify(body));
  }
});
