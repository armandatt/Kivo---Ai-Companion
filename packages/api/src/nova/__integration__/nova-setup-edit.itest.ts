/**
 * Editing subjects and topics — real Postgres integration test.
 *
 * What it proves: a rename or a move keeps the topic's own row (its mastery,
 * review schedule and history) and takes its notes, tasks and saved pages
 * with it, while past sessions keep the name they were recorded under; a
 * topic with recorded study is never removed; removing one without history
 * leaves its notes under the subject; a batch applies whole or not at all,
 * only against the version it was made from; two batches at once apply one;
 * another learner's ids change nothing; Knowledge shows the result.
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
const { resolveNoteLearner, createNote } = await import("../product/notes.js");
const { createTask }               = await import("../product/tasks.js");
const { loadStudyStructure, applyStudyEdits } = await import("../product/setup-edit.js");
const { loadNovaKnowledge }        = await import("../product/knowledge.js");
const { archiveTopic }             = await import("../product/topic-archive.js");

const STAMP = Date.now();
const now = new Date();
const accounts: string[] = [];
let n = 0;

async function learner() {
  const user = await prisma.user.create({ data: { email: `sedit_${STAMP}_${++n}@test.local`, name: "Asha" }, select: { id: true } });
  accounts.push(user.id);
  await prisma.userProfile.create({ data: { userId: user.id, primaryPersona: "nova", onboardingComplete: true, secondaryDomains: [], aspirationWords: [] } });
  const web = (await resolveLearnerForAccount(user.id, "Asha")) as { platformChatId: string };
  await saveSetup(web.platformChatId, {
    subjects: [{ name: "SDE / AI engineer", topics: ["What the role asks for", "Core knowledge", "Practice questions"] }, { name: "Deep learning", topics: ["Transformers"] }],
    exams: [], dailyMinutes: 60, studyTime: null,
  }, now);
  const resolved = await resolveNoteLearner(web.platformChatId);
  const profileId = resolved.status === "ready" ? resolved.profileId : "";
  const s = await loadStudyStructure(profileId);
  const subject = (name: string) => s.subjects.find(x => x.name === name)!;
  const topic = (subjectName: string, name: string) => subject(subjectName).topics.find(t => t.name === name)!;
  return { chat: web.platformChatId, profileId, structure: s, subject, topic };
}

before(async () => { await prisma.$queryRaw`SELECT 1`; });
after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: accounts } } });
  await prisma.$disconnect();
});

test("a rename keeps the topic's own record and takes its notes, tasks and saved pages with it", async () => {
  const l = await learner();
  const sde = l.subject("SDE / AI engineer");
  const core = l.topic("SDE / AI engineer", "Core knowledge");
  // History on the topic: a studied state, a session recorded under its old name.
  await prisma.novaTopicMastery.update({ where: { id: core.id }, data: { masteryProbability: 0.6, reviewCount: 2, lastStudiedAt: now } });
  await prisma.novaStudySession.create({ data: { profileId: l.profileId, subjectId: sde.id, topicId: core.id, topicName: "Core knowledge", sessionDate: now, status: "completed", durationMinutes: 30, plannedDurationMinutes: 30, activityType: "practice" } });
  const note = await createNote(l.profileId, { title: "OOP notes", body: "x", subjectId: sde.id, topicName: "core knowledge" });
  const task = await createTask(l.profileId, { title: "Revise OOP", subjectId: sde.id, topicName: "Core knowledge" }, { now });
  await prisma.novaLearningEvent.create({ data: { profileId: l.profileId, clientEventId: `e${STAMP}`, eventType: "resource_saved", url: "https://x.test/oop", title: "OOP", domain: "x.test", subjectId: sde.id, topicName: "Core knowledge", occurredAt: now, source: "web" } });

  const r = await applyStudyEdits(l.profileId, { version: l.structure.version, edits: [{ op: "rename_topic", topicId: core.id, name: "CS fundamentals" }] });
  assert.ok(r.ok, JSON.stringify(r));

  const row = await prisma.novaTopicMastery.findUniqueOrThrow({ where: { id: core.id } });
  assert.deepEqual([row.name, row.masteryProbability, row.reviewCount, row.subjectId], ["CS fundamentals", 0.6, 2, sde.id], "same row, same mastery");
  assert.equal((await prisma.novaNote.findUniqueOrThrow({ where: { id: note.ok ? note.note.id : "" } })).topicName, "CS fundamentals");
  assert.equal((await prisma.novaTask.findUniqueOrThrow({ where: { id: task.ok ? task.task.id : "" } })).topicName, "CS fundamentals");
  assert.equal((await prisma.novaLearningEvent.findFirstOrThrow({ where: { profileId: l.profileId } })).topicName, "CS fundamentals");
  const session = await prisma.novaStudySession.findFirstOrThrow({ where: { profileId: l.profileId } });
  assert.deepEqual([session.topicId, session.topicName], [core.id, "Core knowledge"], "a past session keeps the name it was recorded with, and its topic");

  // Knowledge shows the new name, with its level intact.
  const k = await loadNovaKnowledge(l.chat, { now });
  assert.ok(k.status === "ready");
  if (k.status === "ready") assert.ok(k.subjects.find(s => s.subjectId === sde.id)!.topics.some(t => t.topicName === "CS fundamentals" && t.id === core.id));
});

test("a move keeps the row and re-files with it; removal refuses history and keeps notes otherwise; a subject goes last", async () => {
  const l = await learner();
  const sde = l.subject("SDE / AI engineer"), dl = l.subject("Deep learning");
  const practice = l.topic("SDE / AI engineer", "Practice questions");
  const role = l.topic("SDE / AI engineer", "What the role asks for");
  const transformers = l.topic("Deep learning", "Transformers");
  const note = await createNote(l.profileId, { title: "Role list", body: "x", subjectId: sde.id, topicName: "What the role asks for" });
  await prisma.novaTopicMastery.update({ where: { id: transformers.id }, data: { reviewCount: 1, lastStudiedAt: now } });

  // History: refused, and nothing in the batch is applied.
  const refused = await applyStudyEdits(l.profileId, { version: l.structure.version, edits: [
    { op: "move_topic", topicId: practice.id, toSubjectId: dl.id },
    { op: "remove_topic", topicId: transformers.id },
  ] });
  assert.ok(!refused.ok && refused.error === "invalid" && refused.issues?.[0]?.index === 1);
  assert.equal((await prisma.novaTopicMastery.findUniqueOrThrow({ where: { id: practice.id } })).subjectId, sde.id, "nothing applied");

  const moved = await applyStudyEdits(l.profileId, { version: l.structure.version, edits: [
    { op: "move_topic", topicId: practice.id, toSubjectId: dl.id },
    { op: "remove_topic", topicId: role.id },
    { op: "add_topics", subjectId: dl.id, names: ["CNNs", "cnns", "Attention"] },
  ] });
  assert.ok(moved.ok, JSON.stringify(moved));
  assert.equal((await prisma.novaTopicMastery.findUniqueOrThrow({ where: { id: practice.id } })).subjectId, dl.id);
  assert.equal(await prisma.novaTopicMastery.count({ where: { id: role.id } }), 0);
  const kept = await prisma.novaNote.findUniqueOrThrow({ where: { id: note.ok ? note.note.id : "" } });
  assert.deepEqual([kept.subjectId, kept.topicName], [sde.id, null], "the note stays under the subject");
  // A moved topic keeps its row, so its place is its creation time; "cnns" is "CNNs" once.
  assert.deepEqual((await prisma.novaTopicMastery.findMany({ where: { subjectId: dl.id } })).map(t => t.name).sort(), ["Attention", "CNNs", "Practice questions", "Transformers"]);

  // The subject goes once it is empty: its note stays, unfiled.
  const s2 = await loadStudyStructure(l.profileId);
  const last = s2.subjects.find(s => s.id === sde.id)!.topics;
  const emptied = await applyStudyEdits(l.profileId, { version: s2.version, edits: [
    ...last.map(t => ({ op: "move_topic" as const, topicId: t.id, toSubjectId: dl.id })),
    { op: "remove_subject", subjectId: sde.id },
  ] });
  assert.ok(emptied.ok, JSON.stringify(emptied));
  assert.equal(await prisma.novaSubject.count({ where: { id: sde.id } }), 0);
  assert.equal((await prisma.novaNote.findUniqueOrThrow({ where: { id: note.ok ? note.note.id : "" } })).subjectId, null);
});

test("a stale version writes nothing; two batches from one version apply one; another learner's ids change nothing", async () => {
  const l = await learner();
  const core = l.topic("SDE / AI engineer", "Core knowledge");
  const stale = await applyStudyEdits(l.profileId, { version: "not-the-version", edits: [{ op: "rename_topic", topicId: core.id, name: "X" }] });
  assert.ok(!stale.ok && stale.error === "stale" && stale.structure?.version === l.structure.version);

  const results = await Promise.all([
    applyStudyEdits(l.profileId, { version: l.structure.version, edits: [{ op: "rename_topic", topicId: core.id, name: "First" }] }),
    applyStudyEdits(l.profileId, { version: l.structure.version, edits: [{ op: "rename_topic", topicId: core.id, name: "Second" }] }),
  ]);
  assert.equal(results.filter(r => r.ok).length, 1, JSON.stringify(results.map(r => r.ok ? "ok" : r.error)));
  assert.ok(results.some(r => !r.ok && r.error === "stale"));

  const other = await learner();
  const theirs = await applyStudyEdits(other.profileId, { version: other.structure.version, edits: [{ op: "rename_topic", topicId: core.id, name: "Hijacked" }] });
  assert.ok(!theirs.ok && theirs.error === "invalid");
  assert.notEqual((await prisma.novaTopicMastery.findUniqueOrThrow({ where: { id: core.id } })).name, "Hijacked");
});

test("adding a subject goes through setup's writer and merges by name", async () => {
  const l = await learner();
  const r = await applyStudyEdits(l.profileId, { version: l.structure.version, edits: [{ op: "add_subject", name: "  GenAI ", topics: ["RAG", "rag", "Agents"] }] });
  assert.ok(r.ok, JSON.stringify(r));
  const genai = r.ok ? r.structure.subjects.find(s => s.name === "GenAI") : undefined;
  assert.deepEqual(genai?.topics.map(t => t.name), ["RAG", "Agents"]);
  assert.ok(genai?.topics.every(t => !t.hasHistory), "a new topic records no study");
});

test("archived topics in Subject Studio: listed as archived, a batch from before is stale, adding the name restores the same row", async () => {
  const l = await learner();
  const core = l.topic("SDE / AI engineer", "Core knowledge");
  assert.ok((await archiveTopic(l.profileId, { topicId: core.id, archived: true }, now)).ok);

  const s = await loadStudyStructure(l.profileId);
  assert.notEqual(s.version, l.structure.version, "archiving changed the version");
  assert.equal(s.subjects.flatMap(x => x.topics).find(t => t.id === core.id)?.archived, true);
  const stale = await applyStudyEdits(l.profileId, { version: l.structure.version, edits: [{ op: "add_topics", subjectId: l.subject("SDE / AI engineer").id, names: ["X"] }] });
  assert.ok(!stale.ok && stale.error === "stale");

  // Renaming another topic onto the archived name is refused with the reason.
  const practice = l.topic("SDE / AI engineer", "Practice questions");
  const clash = await applyStudyEdits(l.profileId, { version: s.version, edits: [{ op: "rename_topic", topicId: practice.id, name: "core knowledge" }] });
  assert.ok(!clash.ok && clash.issues?.[0]?.message.includes("archived topic"));

  // Adding the name restores the same row.
  const back = await applyStudyEdits(l.profileId, { version: s.version, edits: [{ op: "add_topics", subjectId: l.subject("SDE / AI engineer").id, names: ["Core Knowledge"] }] });
  assert.ok(back.ok, JSON.stringify(back));
  assert.ok(back.ok && back.applied.some(x => x.startsWith("Restore in SDE / AI engineer: Core knowledge")));
  const rows = await prisma.novaTopicMastery.findMany({ where: { subjectId: l.subject("SDE / AI engineer").id, name: { equals: "Core knowledge", mode: "insensitive" } } });
  assert.deepEqual(rows.map(r => [r.id, r.archivedAt]), [[core.id, null]]);
});
