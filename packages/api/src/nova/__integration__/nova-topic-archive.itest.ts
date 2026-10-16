/**
 * Archiving and restoring a topic — real Postgres integration test.
 *
 * What it proves: an archived topic leaves every active workflow (the plan
 * Home, the Planner, Telegram and the proactive tick share; Knowledge; the
 * map; the extension's topic list; setup; due reviews; today's changes) while
 * its row, mastery, history and sessions stay and Progress still shows it;
 * restoring brings it back, and so does naming it again in setup; a repeat
 * changes nothing; another learner's id is not found.
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
const { saveSetup, loadSetup }     = await import("../product/setup.js");
const { resolveNoteLearner }       = await import("../product/notes.js");
const { archiveTopic, listArchivedTopics } = await import("../product/topic-archive.js");
const { changeTodayPlan }          = await import("../product/plan-overrides.js");
const { loadNovaToday }            = await import("../product/today.js");
const { loadNovaKnowledge }        = await import("../product/knowledge.js");
const { loadNovaKnowledgeMap }     = await import("../product/knowledge-map.js");
const { loadExtensionContext }     = await import("../product/learning-events.js");
const { loadNovaProgress }         = await import("../product/progress.js");
const { loadOverdueTopics }        = await import("../proactive/nova-proactive-cron.js");

const STAMP = Date.now();
const now = new Date();
const accounts: string[] = [];
let n = 0;

async function learner() {
  const user = await prisma.user.create({ data: { email: `tarch_${STAMP}_${++n}@test.local`, name: "Asha" }, select: { id: true } });
  accounts.push(user.id);
  await prisma.userProfile.create({ data: { userId: user.id, primaryPersona: "nova", onboardingComplete: true, secondaryDomains: [], aspirationWords: [] } });
  const web = (await resolveLearnerForAccount(user.id, "Asha")) as { platformChatId: string };
  await saveSetup(web.platformChatId, { subjects: [{ name: "Operating Systems", topics: ["Deadlocks", "Paging", "Scheduling"] }], exams: [], dailyMinutes: 60, studyTime: null }, now);
  const resolved = await resolveNoteLearner(web.platformChatId);
  const profileId = resolved.status === "ready" ? resolved.profileId : "";
  await prisma.novaAcademicProfile.update({ where: { id: profileId }, data: { timezone: "UTC" } });
  const topics = await prisma.novaTopicMastery.findMany({ where: { subject: { profileId } }, select: { id: true, name: true, subjectId: true } });
  return { chat: web.platformChatId, profileId, topic: (name: string) => topics.find(t => t.name === name)! };
}

const planned = async (chat: string) => {
  const v = await loadNovaToday(chat, { now });
  return v.status === "ready" ? [v.recommendation, ...v.alternatives].filter(Boolean).map(a => a!.topicName) : [];
};

before(async () => { await prisma.$queryRaw`SELECT 1`; });
after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: accounts } } });
  await prisma.$disconnect();
});

test("an archived topic leaves every active list, keeps its record, and comes back on restore", async () => {
  const l = await learner();
  const deadlocks = l.topic("Deadlocks");
  // History: studied, overdue for review, a session and a mastery record.
  const studied = new Date(now.getTime() - 5 * 86_400_000);
  await prisma.novaTopicMastery.update({ where: { id: deadlocks.id }, data: { masteryProbability: 0.5, reviewCount: 2, lastStudiedAt: studied, nextReviewAt: new Date(now.getTime() - 86_400_000) } });
  const session = await prisma.novaStudySession.create({ data: { profileId: l.profileId, subjectId: deadlocks.subjectId, topicId: deadlocks.id, topicName: "Deadlocks", sessionDate: studied, status: "completed", durationMinutes: 30, plannedDurationMinutes: 30, activityType: "practice" } });
  await prisma.novaTopicMasterySnapshot.create({ data: { topicId: deadlocks.id, profileId: l.profileId, sessionId: session.id, masteryBefore: 0.3, masteryAfter: 0.5, confidence: 0.5, reviewCount: 2, source: "session_report", recordedAt: studied } });
  assert.ok((await planned(l.chat)).includes("Deadlocks"));
  assert.ok((await loadOverdueTopics(l.profileId, now)).some(t => t.topicName === "Deadlocks"));
  assert.ok((await changeTodayPlan(l.profileId, { action: "pin", topicId: deadlocks.id }, now)).ok);

  const r = await archiveTopic(l.profileId, { topicId: deadlocks.id, archived: true }, now);
  assert.deepEqual(r, { ok: true, archived: true, changed: true });
  assert.deepEqual(await archiveTopic(l.profileId, { topicId: deadlocks.id, archived: true }, now), { ok: true, archived: true, changed: false }, "a repeat changes nothing");

  // Gone from every active list.
  assert.ok(!(await planned(l.chat)).includes("Deadlocks"), "not planned, even though it was added to today");
  assert.ok(!(await loadOverdueTopics(l.profileId, now)).some(t => t.topicName === "Deadlocks"), "no review reminder");
  const k = await loadNovaKnowledge(l.chat, { now });
  assert.ok(k.status === "ready" && !k.subjects.flatMap(s => s.topics).some(t => t.topicName === "Deadlocks"));
  const map = await loadNovaKnowledgeMap(l.chat);
  assert.ok(map.status === "ready" && !map.nodes.some(nd => nd.label === "Deadlocks"));
  const ext = await loadExtensionContext(l.chat, null);
  assert.ok(ext.status === "ready" && !ext.subjects.flatMap(s => s.topics).includes("Deadlocks"));
  assert.ok(!(await loadSetup(l.chat, now))!.subjects.flatMap(s => s.topics).includes("Deadlocks"));
  const overrideRefused = await changeTodayPlan(l.profileId, { action: "skip", topicId: deadlocks.id }, now);
  assert.ok(!overrideRefused.ok && overrideRefused.error === "not_found");

  // The record stays, and Progress still shows it.
  const row = await prisma.novaTopicMastery.findUniqueOrThrow({ where: { id: deadlocks.id } });
  assert.deepEqual([row.masteryProbability, row.reviewCount, row.archivedAt !== null], [0.5, 2, true]);
  assert.equal(await prisma.novaTopicMasterySnapshot.count({ where: { topicId: deadlocks.id } }), 1);
  assert.equal(await prisma.novaStudySession.count({ where: { topicId: deadlocks.id } }), 1);
  const progress = await loadNovaProgress(l.chat, { now });
  assert.ok(progress.status === "ready" && JSON.stringify(progress).includes("Deadlocks"), "history still shown");
  assert.deepEqual((await listArchivedTopics(l.profileId)).map(t => [t.topicName, t.studied]), [["Deadlocks", true]]);

  // Restore: back in the plan with its history.
  assert.deepEqual(await archiveTopic(l.profileId, { topicId: deadlocks.id, archived: false }, now), { ok: true, archived: false, changed: true });
  assert.ok((await planned(l.chat)).includes("Deadlocks"));
  assert.equal((await prisma.novaTopicMastery.findUniqueOrThrow({ where: { id: deadlocks.id } })).reviewCount, 2);
});

test("naming an archived topic again in setup restores it, with its row", async () => {
  const l = await learner();
  const paging = l.topic("Paging");
  assert.ok((await archiveTopic(l.profileId, { topicId: paging.id, archived: true }, now)).ok);
  await saveSetup(l.chat, { subjects: [{ name: "Operating Systems", topics: ["paging"] }], exams: [], dailyMinutes: 60, studyTime: null }, now, "merge");
  const rows = await prisma.novaTopicMastery.findMany({ where: { subjectId: paging.subjectId, name: { equals: "Paging", mode: "insensitive" } } });
  assert.deepEqual(rows.map(r => [r.id, r.archivedAt]), [[paging.id, null]], "the same row, restored, no duplicate");
});

test("another learner's topic is not found, and a bad request is refused", async () => {
  const owner = await learner();
  const other = await learner();
  const theirs = owner.topic("Scheduling");
  const r = await archiveTopic(other.profileId, { topicId: theirs.id, archived: true }, now);
  assert.ok(!r.ok && r.error === "not_found");
  assert.equal((await prisma.novaTopicMastery.findUniqueOrThrow({ where: { id: theirs.id } })).archivedAt, null);
  for (const body of [null, { topicId: theirs.id }, { topicId: theirs.id, archived: "yes" }]) {
    const x = await archiveTopic(other.profileId, body, now);
    assert.ok(!x.ok && x.error === "invalid");
  }
});
