/**
 * Moving and removing an exam — real Postgres integration test.
 *
 * What it proves: a learner's exams are listed soonest first; moving one
 * changes that row and what Today and the Planner say on the next read;
 * removing one takes it out of both; a change said twice, and a removal sent
 * twice, write once; one learner cannot read, move or remove another's exam;
 * and nothing else Nova knows is touched.
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
const { listExams, updateExam, removeExam } = await import("../product/exams.js");
const { loadNovaToday }            = await import("../product/today.js");
const { loadNovaPlanner }          = await import("../product/planner.js");

const STAMP = Date.now();
const now   = new Date();
const accounts: string[] = [];
let n = 0;

const day = (offset: number) => new Date(now.getTime() + offset * 86_400_000).toISOString().slice(0, 10);

async function learner() {
  const user = await prisma.user.create({ data: { email: `exams_${STAMP}_${++n}@test.local`, name: "Asha" }, select: { id: true } });
  accounts.push(user.id);
  await prisma.userProfile.create({ data: { userId: user.id, primaryPersona: "nova", onboardingComplete: true, secondaryDomains: [], aspirationWords: [] } });
  const web = (await resolveLearnerForAccount(user.id, "Asha")) as { platformChatId: string };
  await saveSetup(web.platformChatId, {
    subjects: [{ name: "Operating Systems", topics: ["Deadlocks", "Paging"] }, { name: "DBMS", topics: ["Indexing"] }],
    exams: [{ subjectName: "Operating Systems", date: day(20), title: null }, { subjectName: "DBMS", date: day(30), title: null }],
    dailyMinutes: 60, studyTime: null,
  }, now);
  const profile = await prisma.novaAcademicProfile.findFirstOrThrow({ where: { user: { platformChatId: web.platformChatId } }, select: { id: true } });
  return { chat: web.platformChatId, profileId: profile.id };
}

// Everything an exam change must never touch, as it stands.
async function elsewhere(profileId: string) {
  const [sessions, mastery, snapshots, tasks, notes, profile] = await Promise.all([
    prisma.novaStudySession.findMany({ where: { profileId }, orderBy: { id: "asc" } }),
    prisma.novaTopicMastery.findMany({ where: { subject: { profileId } }, orderBy: { id: "asc" } }),
    prisma.novaTopicMasterySnapshot.count({ where: { profileId } }),
    prisma.novaTask.findMany({ where: { profileId }, orderBy: { id: "asc" } }),
    prisma.novaNote.findMany({ where: { profileId }, orderBy: { id: "asc" } }),
    prisma.novaAcademicProfile.findUniqueOrThrow({ where: { id: profileId } }),
  ]);
  return JSON.stringify({ sessions, mastery, snapshots, tasks, notes, profile });
}

before(async () => { await prisma.$queryRaw`SELECT 1`; });
after(async () => {
  await prisma.messengerUser.deleteMany({ where: { platformChatId: { startsWith: "web:" }, novaAcademicProfile: null } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: { in: accounts } } });
  await prisma.$disconnect();
});

test("a learner's exams are listed soonest first, with the day they gave", async () => {
  const l = await learner();
  const exams = (await listExams(l.chat, now))!;
  assert.deepEqual(exams.map(e => [e.subjectName, e.date, e.daysUntil]), [["Operating Systems", day(20), 20], ["DBMS", day(30), 30]]);
  assert.equal(await listExams("web:nobody", now), null);
});

test("moving an exam changes that row, and Today and the Planner follow on the next read", async () => {
  const l = await learner();
  const before_ = await elsewhere(l.profileId);
  const os = (await listExams(l.chat, now))!.find(e => e.subjectName === "Operating Systems")!;

  // Twenty days out: no exam is inside the planning window yet.
  const far = await loadNovaPlanner(l.chat, { now });
  assert.equal(far.status, "ready");
  if (far.status === "ready") assert.equal(far.reasoning.mode, "standard");

  const moved = await updateExam(l.chat, os.id, { date: day(1) }, now);
  assert.equal(moved.status, "saved");
  if (moved.status === "saved") assert.deepEqual(moved.exams.map(e => [e.subjectName, e.date]), [["Operating Systems", day(1)], ["DBMS", day(30)]]);
  assert.equal(await prisma.novaExam.count({ where: { profileId: l.profileId } }), 2, "moved, not added");

  const near = await loadNovaPlanner(l.chat, { now });
  if (near.status === "ready") {
    assert.equal(near.reasoning.mode, "exam_crisis", "the plan now works toward the moved exam");
    assert.equal(near.reasoning.budget.minutes, 60, "and is still the learner's own hour");
    assert.ok(near.pressure.some(p => p.title === os.title && p.daysUntil <= 2));
  }
  const today = await loadNovaToday(l.chat, { now });
  if (today.status === "ready") assert.equal(today.upcoming[0]!.title, os.title);

  // Moved away again: the pressure it caused is gone with it.
  await updateExam(l.chat, os.id, { date: day(40) }, now);
  const calm = await loadNovaPlanner(l.chat, { now });
  if (calm.status === "ready") assert.equal(calm.reasoning.mode, "standard");

  assert.equal(await elsewhere(l.profileId), before_, "nothing else Nova knows was touched");
});

test("a change said twice writes once, and a refused change writes nothing", async () => {
  const l  = await learner();
  const os = (await listExams(l.chat, now))!.find(e => e.subjectName === "Operating Systems")!;
  await updateExam(l.chat, os.id, { title: "OS midterm", date: day(12) }, now);
  const stamp = (await prisma.novaExam.findUniqueOrThrow({ where: { id: os.id } })).updatedAt.getTime();
  const again = await updateExam(l.chat, os.id, { title: "OS midterm", date: day(12) }, now);
  assert.equal(again.status, "saved");
  assert.equal((await prisma.novaExam.findUniqueOrThrow({ where: { id: os.id } })).updatedAt.getTime(), stamp, "the repeat wrote nothing");

  for (const [input, reason] of [[{ date: day(-1) }, "in_the_past"], [{ date: "soon" }, "bad_date"], [{ title: " " }, "no_title"], [{ date: day(400) }, "too_far"]] as const) {
    assert.deepEqual(await updateExam(l.chat, os.id, input, now), { status: "invalid", reason });
  }
  const row = await prisma.novaExam.findUniqueOrThrow({ where: { id: os.id } });
  assert.deepEqual([row.title, row.scheduledAt.toISOString().slice(0, 10)], ["OS midterm", day(12)]);
});

test("removing an exam takes it out of the list, the plan and the Planner; removing it again is not found", async () => {
  const l  = await learner();
  const os = (await listExams(l.chat, now))!.find(e => e.subjectName === "Operating Systems")!;
  await updateExam(l.chat, os.id, { date: day(1) }, now);
  const before_ = await elsewhere(l.profileId);

  const removed = await removeExam(l.chat, os.id, now);
  assert.equal(removed.status, "removed");
  if (removed.status === "removed") assert.deepEqual(removed.exams.map(e => e.subjectName), ["DBMS"]);
  assert.deepEqual(await removeExam(l.chat, os.id, now), { status: "not_found" });
  assert.deepEqual(await updateExam(l.chat, os.id, { date: day(5) }, now), { status: "not_found" });

  const planner = await loadNovaPlanner(l.chat, { now });
  if (planner.status === "ready") {
    assert.equal(planner.reasoning.mode, "standard");
    assert.ok(!planner.pressure.some(p => p.title === os.title));
  }
  const today = await loadNovaToday(l.chat, { now });
  if (today.status === "ready") assert.ok(!today.upcoming.some(e => e.title === os.title));
  assert.equal(await elsewhere(l.profileId), before_, "the subject, its topics and everything studied are as they were");
});

test("one learner cannot move or remove another's exam, and never sees it", async () => {
  const mine   = await learner();
  const theirs = await learner();
  const target = (await listExams(theirs.chat, now))![0]!;

  assert.deepEqual(await updateExam(mine.chat, target.id, { date: day(3) }, now), { status: "not_found" });
  assert.deepEqual(await removeExam(mine.chat, target.id, now), { status: "not_found" });
  assert.ok(!(await listExams(mine.chat, now))!.some(e => e.id === target.id));

  const row = await prisma.novaExam.findUniqueOrThrow({ where: { id: target.id } });
  assert.equal(row.scheduledAt.toISOString().slice(0, 10), target.date, "untouched");
  assert.equal(await prisma.novaExam.count({ where: { profileId: theirs.profileId } }), 2);
});

test("a learner twelve or more hours ahead of UTC sees a date on the day they gave, counted from their own today", async () => {
  const l = await learner();
  const zone = "Pacific/Kiritimati";   // UTC+14: noon UTC is already the next day there
  await prisma.novaAcademicProfile.update({ where: { id: l.profileId }, data: { timezone: zone } });
  const localToday = new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(now);
  const inTwo = new Date(Date.parse(`${localToday}T12:00:00Z`) + 2 * 86_400_000).toISOString().slice(0, 10);
  const saved = await saveSetup(l.chat, { subjects: [{ name: "Physics", topics: ["Optics"] }], exams: [{ subjectName: "Physics", date: inTwo, title: null }], dailyMinutes: 30, studyTime: null }, now);
  assert.equal(saved.status, "saved");

  const listed = (await listExams(l.chat, now))!.find(e => e.date === inTwo);
  assert.ok(listed, "listed on the day given");
  assert.equal(listed.daysUntil, 2);
  const today = await loadNovaToday(l.chat, { now });
  assert.ok(today.status === "ready");
  assert.equal(today.nextDeadline?.daysUntil, 2);
  const planner = await loadNovaPlanner(l.chat, { now });
  assert.ok(planner.status === "ready");
  // The week view runs Monday to Sunday: when the date falls in it, it is on its own day.
  const placed = planner.week.filter(d => d.exams.some(e => e.title === listed.title)).map(d => d.date);
  if (planner.week.some(d => d.date === inTwo)) assert.deepEqual(placed, [inTwo]);
  else assert.deepEqual(placed, []);
});
