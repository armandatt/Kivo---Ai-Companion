/**
 * Tasks, the Knowledge Map and templates — real Postgres integration test.
 *
 * What it proves: a task belongs to its learner and is only a task (moving
 * one changes that row and nothing about sessions, mastery, exams or the
 * plan); a create with a key is made once however often it is sent; the map
 * is exactly the links on record, per learner, and reading it writes
 * nothing; a template applied twice leaves one of everything.
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
const { createTask, updateTask, deleteTask, listTasks } = await import("../product/tasks.js");
const { createNote, resolveNoteLearner } = await import("../product/notes.js");
const { loadNovaKnowledgeMap }     = await import("../product/knowledge-map.js");
const { loadNovaToday }            = await import("../product/today.js");
const { loadNovaPlanner }          = await import("../product/planner.js");
const { STUDY_TEMPLATES, templateTaskKey } = await import("../product/templates.js");

const STAMP = Date.now();
const now   = new Date();
const accounts: string[] = [];
let n = 0;

async function learner(subjects: Array<{ name: string; topics: string[] }> = [{ name: "Operating Systems", topics: ["Deadlocks", "Paging"] }, { name: "DBMS", topics: ["Indexing"] }]) {
  const user = await prisma.user.create({ data: { email: `work_${STAMP}_${++n}@test.local`, name: "Asha" }, select: { id: true } });
  accounts.push(user.id);
  await prisma.userProfile.create({ data: { userId: user.id, primaryPersona: "nova", onboardingComplete: true, secondaryDomains: [], aspirationWords: [] } });
  const web = (await resolveLearnerForAccount(user.id, "Asha")) as { platformChatId: string };
  if (subjects.length > 0) await saveSetup(web.platformChatId, { subjects, exams: [], dailyMinutes: null, studyTime: null }, now);
  const resolved = await resolveNoteLearner(web.platformChatId);
  const profileId = resolved.status === "ready" ? resolved.profileId : "";
  const rows = profileId ? await prisma.novaSubject.findMany({ where: { profileId }, select: { id: true, name: true } }) : [];
  return { chat: web.platformChatId, profileId, subject: Object.fromEntries(rows.map(r => [r.name, r.id])) as Record<string, string> };
}

// Everything a task must never touch, as it stands.
async function elsewhere(profileId: string) {
  const [sessions, mastery, snapshots, exams, notes, events, profile, dna] = await Promise.all([
    prisma.novaStudySession.findMany({ where: { profileId }, orderBy: { id: "asc" } }),
    prisma.novaTopicMastery.findMany({ where: { subject: { profileId } }, orderBy: { id: "asc" } }),
    prisma.novaTopicMasterySnapshot.count({ where: { profileId } }),
    prisma.novaExam.findMany({ where: { profileId }, orderBy: { id: "asc" } }),
    prisma.novaNote.findMany({ where: { profileId }, orderBy: { id: "asc" } }),
    prisma.novaLearningEvent.count({ where: { profileId } }),
    prisma.novaAcademicProfile.findUniqueOrThrow({ where: { id: profileId } }),
    prisma.novaLearningDNA.findMany({ where: { profileId } }),
  ]);
  return JSON.stringify({ sessions, mastery, snapshots, exams, notes, events, profile, dna });
}

before(async () => { await prisma.$queryRaw`SELECT 1`; });
after(async () => {
  await prisma.messengerUser.deleteMany({ where: { platformChatId: { startsWith: "web:" }, novaAcademicProfile: null } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: { in: accounts } } });
  await prisma.$disconnect();
});

// ══════════════════════════════════════════════════════════════════════════════
// Tasks
// ══════════════════════════════════════════════════════════════════════════════

test("a task is created, moved across the board, edited and deleted, and each change is what is read back", async () => {
  const l = await learner();
  const made = await createTask(l.profileId, { title: "  Finish OS   assignment 3 ", subjectId: l.subject["Operating Systems"], topicName: "Deadlocks", priority: "high", dueDay: "2099-01-10" }, { now });
  assert.ok(made.ok && made.created);
  if (!made.ok) return;
  assert.deepEqual(
    { title: made.task.title, status: made.task.status, subject: made.task.subjectName, topic: made.task.topicName, priority: made.task.priority, due: made.task.dueDay, completedAt: made.task.completedAt },
    { title: "Finish OS assignment 3", status: "todo", subject: "Operating Systems", topic: "Deadlocks", priority: "high", due: "2099-01-10", completedAt: null },
  );

  // To Do → In Progress → Done → back to In Progress.
  const started = await updateTask(l.profileId, made.task.id, { status: "in_progress" }, { now });
  assert.equal(started.ok && started.task.status, "in_progress");
  const finished = await updateTask(l.profileId, made.task.id, { status: "done" }, { now });
  assert.ok(finished.ok && finished.task.status === "done" && finished.task.completedAt !== null);
  const reopened = await updateTask(l.profileId, made.task.id, { status: "in_progress" }, { now });
  assert.ok(reopened.ok && reopened.task.completedAt === null, "leaving Done clears when it was finished");
  // The move kept everything else.
  assert.deepEqual(reopened.ok && [reopened.task.title, reopened.task.subjectName, reopened.task.dueDay, reopened.task.priority], ["Finish OS assignment 3", "Operating Systems", "2099-01-10", "high"]);

  // What the board and Today both read.
  const view = await listTasks(l.profileId, { now });
  assert.deepEqual(view.counts, { todo: 0, in_progress: 1, done: 0 });
  assert.deepEqual(view.tasks.map(t => [t.id, t.status]), [[made.task.id, "in_progress"]]);
  assert.deepEqual(view.subjects.map(s => s.name), ["DBMS", "Operating Systems"]);

  const edited = await updateTask(l.profileId, made.task.id, { title: "Submit OS assignment 3", dueDay: null, subjectId: null }, { now });
  assert.deepEqual(edited.ok && [edited.task.title, edited.task.dueDay, edited.task.subjectName, edited.task.status], ["Submit OS assignment 3", null, null, "in_progress"]);

  assert.equal(await deleteTask(l.profileId, made.task.id), true);
  assert.equal(await deleteTask(l.profileId, made.task.id), false, "deleting again finds nothing");
  assert.deepEqual((await listTasks(l.profileId, { now })).tasks, []);
});

test("a task is only a task: making, moving and finishing one changes nothing else Nova knows, and the plan does not read it", async () => {
  const l = await learner();
  const before = await elsewhere(l.profileId);
  const [todayBefore, plannerBefore] = await Promise.all([loadNovaToday(l.chat, { now }), loadNovaPlanner(l.chat, { now })]);

  const a = await createTask(l.profileId, { title: "Revise Deadlocks", subjectId: l.subject["Operating Systems"], topicName: "Deadlocks", dueDay: "2099-02-01" }, { now });
  assert.ok(a.ok);
  if (!a.ok) return;
  await updateTask(l.profileId, a.task.id, { status: "in_progress" }, { now });
  await updateTask(l.profileId, a.task.id, { status: "done" }, { now });

  assert.equal(await elsewhere(l.profileId), before, "no session, no mastery, no exam, no profile field");
  const [todayAfter, plannerAfter] = await Promise.all([loadNovaToday(l.chat, { now }), loadNovaPlanner(l.chat, { now })]);
  const plan = (v: unknown) => JSON.stringify(v).replace(/"generatedAt":"[^"]*"/g, "");
  assert.equal(plan(todayAfter), plan(todayBefore), "Today's recommendation is the same");
  assert.equal(plan(plannerAfter), plan(plannerBefore), "and so is the plan");
  // A finished task about Deadlocks is not a session on Deadlocks.
  const topic = await prisma.novaTopicMastery.findFirstOrThrow({ where: { subject: { profileId: l.profileId }, name: "Deadlocks" }, select: { reviewCount: true } });
  assert.equal(topic.reviewCount, 0);
});

test("a create with a key is made once: sent again, and sent twice at the same moment", async () => {
  const l = await learner();
  const first = await createTask(l.profileId, { title: "Collect the syllabus", clientKey: "web:abc" }, { now });
  const again = await createTask(l.profileId, { title: "Collect the syllabus (retry)", clientKey: "web:abc" }, { now });
  assert.ok(first.ok && first.created === true);
  assert.ok(again.ok && again.created === false && first.ok && again.task.id === first.task.id);
  assert.equal(again.ok && again.task.title, "Collect the syllabus", "the retry changed nothing");

  const both = await Promise.all([
    createTask(l.profileId, { title: "Past paper", clientKey: "web:race" }, { now }),
    createTask(l.profileId, { title: "Past paper", clientKey: "web:race" }, { now }),
  ]);
  assert.ok(both.every(r => r.ok));
  assert.equal(await prisma.novaTask.count({ where: { profileId: l.profileId, clientKey: "web:race" } }), 1);

  // A done task stays done when its create is replayed: it is not made again.
  if (first.ok) await updateTask(l.profileId, first.task.id, { status: "done" }, { now });
  const replay = await createTask(l.profileId, { title: "Collect the syllabus", clientKey: "web:abc" }, { now });
  assert.ok(replay.ok && replay.created === false && replay.task.status === "done");
  assert.equal(await prisma.novaTask.count({ where: { profileId: l.profileId } }), 2);
});

test("one learner cannot read, move, edit or delete another's task, or file a task under another's subject", async () => {
  const mine   = await learner();
  const theirs = await learner();
  const task = await createTask(theirs.profileId, { title: "Theirs" }, { now });
  assert.ok(task.ok);
  if (!task.ok) return;

  assert.deepEqual(await updateTask(mine.profileId, task.task.id, { status: "done", title: "Mine now" }, { now }), { ok: false, error: "not_found", message: "That task doesn't exist." });
  assert.equal(await deleteTask(mine.profileId, task.task.id), false);
  assert.deepEqual((await listTasks(mine.profileId, { now })).tasks, []);
  const still = await prisma.novaTask.findUniqueOrThrow({ where: { id: task.task.id } });
  assert.deepEqual([still.title, still.status, still.profileId], ["Theirs", "todo", theirs.profileId]);

  const stolen = await createTask(mine.profileId, { title: "Under their subject", subjectId: theirs.subject["DBMS"] }, { now });
  assert.equal(!stolen.ok && stolen.error, "unknown_subject");
  const moved = await createTask(mine.profileId, { title: "Mine" }, { now });
  assert.ok(moved.ok);
  if (moved.ok) assert.equal((await updateTask(mine.profileId, moved.task.id, { subjectId: theirs.subject["DBMS"] }, { now })).ok, false);
  // The same key in two learners' lists is two tasks.
  const k1 = await createTask(mine.profileId, { title: "K", clientKey: "same" }, { now });
  const k2 = await createTask(theirs.profileId, { title: "K", clientKey: "same" }, { now });
  assert.ok(k1.ok && k2.ok && k1.task.id !== k2.task.id);
});

test("due days are counted on the learner's own calendar", async () => {
  const l = await learner();
  await prisma.novaAcademicProfile.update({ where: { id: l.profileId }, data: { timezone: "Asia/Kolkata" } });
  // 20:00 UTC is already the next day in India.
  const at = new Date("2026-10-08T20:00:00Z");
  await createTask(l.profileId, { title: "Due their today", dueDay: "2026-10-09" }, { now: at });
  await createTask(l.profileId, { title: "Overdue", dueDay: "2026-10-07" }, { now: at });
  const view = await listTasks(l.profileId, { now: at });
  assert.equal(view.today, "2026-10-09");
  assert.deepEqual(view.tasks.map(t => [t.title, t.dueInDays]), [["Overdue", -2], ["Due their today", 0]]);
});

// ══════════════════════════════════════════════════════════════════════════════
// Knowledge Map
// ══════════════════════════════════════════════════════════════════════════════

test("the map is the learner's own items and exactly the links on record, and reading it writes nothing", async () => {
  const l     = await learner();
  const other = await learner([{ name: "Physics", topics: ["Optics"] }]);

  const filed  = await createNote(l.profileId, { title: "Banker's algorithm", body: "private text the map must not carry", subjectId: l.subject["Operating Systems"], topicName: "deadlocks" });
  const subj   = await createNote(l.profileId, { title: "DBMS reading list", body: "", subjectId: l.subject["DBMS"], topicName: "Query plans" });
  const loose  = await createNote(l.profileId, { title: "Loose thought", body: "" });
  assert.ok(filed.ok && subj.ok && loose.ok);
  await prisma.novaLearningEvent.create({ data: {
    profileId: l.profileId, eventType: "resource_saved", source: "browser_extension", clientEventId: `ev-${STAMP}-1-padding-padding`,
    url: "https://example.org/paging", domain: "example.org", title: "Paging explained", subjectId: l.subject["Operating Systems"], topicName: "Paging", occurredAt: now,
  } });
  await createNote(other.profileId, { title: "Their note", body: "", subjectId: other.subject["Physics"], topicName: "Optics" });

  const before = await elsewhere(l.profileId);
  const map = await loadNovaKnowledgeMap(l.chat);
  assert.equal(map.status, "ready");
  if (map.status !== "ready") return;
  assert.equal(await elsewhere(l.profileId), before, "a read model");

  assert.deepEqual(map.counts, { subject: 2, topic: 3, note: 3, resource: 1 });
  const label = new Map(map.nodes.map(n => [n.id, n.label]));
  const edges = map.edges.map(e => `${label.get(e.from)} -${e.kind}-> ${label.get(e.to)}`).sort();
  assert.deepEqual(edges, [
    "DBMS -filed_under-> DBMS reading list",        // "Query plans" is not a topic of DBMS: joined to the subject only
    "DBMS -has_topic-> Indexing",
    "Deadlocks -about_topic-> Banker's algorithm",  // named in another case, still that topic
    "Operating Systems -has_topic-> Deadlocks",
    "Operating Systems -has_topic-> Paging",
    "Paging -about_topic-> Paging explained",
  ]);
  assert.equal(edges.some(e => e.includes("Loose thought")), false, "filed under nothing: no line");
  assert.equal(map.unconnected, 1);

  // Nothing of another learner's, and nothing of what a note says.
  const text = JSON.stringify(map);
  for (const word of ["Physics", "Optics", "Their note", "private text"]) assert.equal(text.includes(word), false, word);

  // Each node opens the real item.
  const note = map.nodes.find(n => n.label === "Banker's algorithm")!;
  assert.equal(note.href, `/notes/${filed.ok ? filed.note.id : ""}`);
  assert.deepEqual(map.nodes.filter(n => n.type === "topic").map(n => n.type === "topic" && [n.label, n.sessions, n.level]), [["Deadlocks", 0, null], ["Indexing", 0, null], ["Paging", 0, null]]);

  // The other learner's map is theirs alone.
  const theirs = await loadNovaKnowledgeMap(other.chat);
  assert.deepEqual(theirs.status === "ready" && theirs.counts, { subject: 1, topic: 1, note: 1, resource: 0 });
});

test("a learner with nothing yet has an empty map, and one still setting up has none", async () => {
  const empty = await learner([]);
  assert.deepEqual(await loadNovaKnowledgeMap(empty.chat), { status: "onboarding_incomplete" });
  assert.deepEqual(await loadNovaKnowledgeMap("web:nobody"), { status: "not_connected" });
});

// ══════════════════════════════════════════════════════════════════════════════
// Templates
// ══════════════════════════════════════════════════════════════════════════════

test("a template applied twice leaves one of every subject, topic and task, all unstudied and to do", async () => {
  const l = await learner([]);
  const template = STUDY_TEMPLATES.find(t => t.id === "engineering-semester")!;
  const apply = async () => {
    const saved = await saveSetup(l.chat, { subjects: template.subjects, exams: [], dailyMinutes: null, studyTime: null }, now);
    assert.equal(saved.status, "saved");
    const profileId = (await resolveNoteLearner(l.chat) as { profileId: string }).profileId;
    for (const task of template.tasks) {
      const made = await createTask(profileId, { title: task.title, priority: task.priority ?? null, clientKey: templateTaskKey(template.id, task.key) }, { now });
      assert.ok(made.ok);
    }
    return profileId;
  };
  const profileId = await apply();
  await apply();

  const subjects = await prisma.novaSubject.findMany({ where: { profileId }, select: { name: true, topics: { select: { name: true, reviewCount: true, masteryProbability: true, nextReviewAt: true } } } });
  assert.deepEqual(subjects.map(s => s.name).sort(), template.subjects.map(s => s.name).sort());
  for (const s of subjects) {
    const wanted = template.subjects.find(t => t.name === s.name)!.topics;
    assert.deepEqual(s.topics.map(t => t.name).sort(), [...wanted].sort(), `${s.name}: each topic once`);
    assert.ok(s.topics.every(t => t.reviewCount === 0 && t.masteryProbability === 0 && t.nextReviewAt === null), "no progress came with the template");
  }
  const tasks = await prisma.novaTask.findMany({ where: { profileId }, select: { title: true, status: true, completedAt: true } });
  assert.deepEqual(tasks.map(t => t.title).sort(), template.tasks.map(t => t.title).sort());
  assert.ok(tasks.every(t => t.status === "todo" && t.completedAt === null));
  assert.equal(await prisma.novaStudySession.count({ where: { profileId } }), 0);
  assert.equal(await prisma.novaTopicMasterySnapshot.count({ where: { profileId } }), 0);

  // The workspace is usable at once: a plan, and a map of what was made.
  const today = await loadNovaToday(l.chat, { now });
  assert.equal(today.status === "ready" && today.recommendation !== null, true);
  const map = await loadNovaKnowledgeMap(l.chat);
  assert.equal(map.status === "ready" && map.counts.subject, template.subjects.length);
});
