/**
 * Nova Knowledge loop — real Postgres integration test.
 *
 *   start (subject known) → end with "How did it go?" → execution report
 *   → topic mastery + review schedule → GET knowledge reflects it
 *
 * Everything is real here: the session commands, the Topic Mastery Engine's
 * writes (including its case-insensitive topic lookup, which an in-memory
 * table can only imitate), consolidation, and the Knowledge read model.
 * No LLM is involved in any of it.
 *
 * Run from packages/api:
 *   NOVA_TEST_DATABASE_URL=postgresql://... npm run test:integration
 */

import "./test-database.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

const { prisma }                = await import("@repo/db/client");
const { runNovaSessionCommand } = await import("../product/session.js");
const { loadNovaKnowledge }     = await import("../product/knowledge.js");
const { loadNovaToday }         = await import("../product/today.js");
const { loadNovaPlanner }       = await import("../product/planner.js");
const { openStudySession }      = await import("../persistence/nova-persistence.js");
const { applyMasteryObservation, applySessionObservation } = await import("../consolidation/stores/academic-observation-store.js");

const STAMP  = Date.now();
const CHAT   = `nova_itest_know_${STAMP}`;
const OTHER  = `nova_itest_know_other_${STAMP}`;
const DAY    = 86_400_000;
const T0     = new Date(Date.now() - 30 * DAY);
const at     = (days: number, minutes = 0) => new Date(T0.getTime() + days * DAY + minutes * 60_000);

let profileId = "";
const subjects: Record<string, string> = {};

type Ready = Extract<Awaited<ReturnType<typeof loadNovaKnowledge>>, { status: "ready" }>;
const knowledge = async (chat = CHAT, now = new Date()) => {
  const view = await loadNovaKnowledge(chat, { now });
  assert.equal(view.status, "ready");
  return view as Ready;
};
const topicOf = (view: Ready, subject: string, topic: string) =>
  view.subjects.find(s => s.subjectName === subject)?.topics.find(t => t.topicName === topic);

async function session(subjectName: string, topicName: string, start: Date, outcome: "struggled" | "okay" | "good" | "crushed_it" | null, minutes = 30) {
  const started = await runNovaSessionCommand(CHAT, { action: "start", topicName, subjectName, plannedMinutes: 25 }, start);
  assert.ok(started.ok && started.session, "session started");
  const ended = await runNovaSessionCommand(CHAT, { action: "end", outcome }, new Date(start.getTime() + minutes * 60_000));
  assert.ok(ended.ok && ended.ended, "session ended");
  return ended.ended;
}

before(async () => {
  for (const chat of [CHAT, OTHER]) {
    const user = await prisma.messengerUser.create({
      data: {
        platform: "telegram", platformChatId: chat, persona: "nova",
        novaAcademicProfile: { create: { onboardingComplete: true, subjects: { create: [
          { name: "Operating Systems" }, { name: "Design and Analysis of Algorithms" }, { name: "DBMS" },
        ] } } },
      },
      select: { novaAcademicProfile: { select: { id: true, subjects: { select: { id: true, name: true } } } } },
    });
    if (chat === CHAT) {
      profileId = user.novaAcademicProfile!.id;
      for (const s of user.novaAcademicProfile!.subjects) subjects[s.name] = s.id;
    }
  }
});

after(async () => {
  await prisma.messengerUser.deleteMany({ where: { platformChatId: { in: [CHAT, OTHER] } } });
  await prisma.$disconnect();
});

test("a learner with subjects and no sessions has no topics, and none are made up", async () => {
  const view = await knowledge();
  assert.deepEqual(view.subjects.map(s => [s.subjectName, s.topics.length]),
    [["DBMS", 0], ["Design and Analysis of Algorithms", 0], ["Operating Systems", 0]]);
  assert.deepEqual(view.dueReviews, []);
  assert.deepEqual(view.recentLearning, []);
  assert.deepEqual(view.totals, { subjectCount: 3, topicCount: 0, dueCount: 0 });
});

test("the session's subject decides where the topic goes, whatever the topic is called", async () => {
  await session("Operating Systems", "Deadlocks", at(0), "struggled");
  await session("Design and Analysis of Algorithms", "Dynamic Programming", at(0, 60), "good");
  await session("DBMS", "Normalization", at(0, 120), "crushed_it");

  const view = await knowledge(CHAT, at(0, 180));
  assert.deepEqual(view.totals, { subjectCount: 3, topicCount: 3, dueCount: 0 });
  assert.equal(topicOf(view, "Operating Systems", "Deadlocks")?.reviewCount, 1);
  assert.equal(topicOf(view, "Design and Analysis of Algorithms", "Dynamic Programming")?.reviewCount, 1);
  assert.equal(topicOf(view, "DBMS", "Normalization")?.reviewCount, 1);
});

test("how the learner said it went is what the topic's level starts from", async () => {
  const view = await knowledge(CHAT, at(0, 180));
  const levels = (s: string, t: string) => { const x = topicOf(view, s, t)!; return [x.masteryPercent, x.level]; };
  assert.deepEqual(levels("Operating Systems", "Deadlocks"), [30, "weak"]);
  assert.deepEqual(levels("Design and Analysis of Algorithms", "Dynamic Programming"), [75, "solid"]);
  assert.deepEqual(levels("DBMS", "Normalization"), [90, "solid"]);

  const row = await prisma.novaStudySession.findFirstOrThrow({ where: { profileId, topicName: "Deadlocks" } });
  const report = row.executionReport as { outcome: string; evidenceBasis: string; masteryUpdates: unknown[] };
  assert.equal(report.outcome, "struggled");
  assert.equal(report.evidenceBasis, "learner_outcome");
  assert.deepEqual(report.masteryUpdates, [{ topicName: "Deadlocks", subjectId: subjects["Operating Systems"], confidence: 0.3 }]);
});

test("the session is shown as evidence on its topic, with the answer and the measured time", async () => {
  const view = await knowledge(CHAT, at(0, 180));
  const deadlocks = topicOf(view, "Operating Systems", "Deadlocks")!;
  assert.equal(deadlocks.recentSessions.length, 1);
  assert.deepEqual(
    { ...deadlocks.recentSessions[0], id: "", date: "" },
    { id: "", topicName: "Deadlocks", subjectName: "Operating Systems", date: "", measured: true, minutes: 30, outcome: "struggled", confusionPoints: [] },
  );
});

test("struggling brings the topic back for review; Home, Planner and Knowledge agree it is due", async () => {
  // "Struggled" schedules the next review a day later. It becomes due once
  // retention has also faded: five days after the session.
  const early = await knowledge(CHAT, at(2));
  assert.equal(topicOf(early, "Operating Systems", "Deadlocks")!.reviewState, "scheduled");
  assert.deepEqual(early.dueReviews, []);

  const now  = at(6);
  const view = await knowledge(CHAT, now);
  const due  = view.dueReviews.map(t => t.topicName);
  // By day 6 all three have faded past their dates. The one the learner
  // struggled with came due first.
  assert.deepEqual([...due].sort(), ["Deadlocks", "Dynamic Programming", "Normalization"]);
  const deadlocks = view.dueReviews.find(t => t.topicName === "Deadlocks")!;
  assert.equal(deadlocks.reviewState, "due");
  assert.equal(deadlocks.reviewMinutes, 25);
  assert.ok(view.dueReviews.every(t => t.daysOverdue <= deadlocks.daysOverdue), "nothing has been due longer than the topic that was struggled with");
  for (const t of view.dueReviews) assert.ok(t.retentionPercent < 85, `${t.topicName} retention ${t.retentionPercent}`);

  // The same topics, in the same order, on Home and in the Planner.
  const home    = await loadNovaToday(CHAT, { now });
  const planner = await loadNovaPlanner(CHAT, { now });
  assert.ok(home.status === "ready" && planner.status === "ready");
  assert.deepEqual(home.reviewDue.topics.map(t => t.topicName), due);
  assert.equal(home.reviewDue.count, due.length);
  assert.equal(home.recommendation?.topicName, due[0]);
  assert.deepEqual(planner.today.blocks.filter(b => b.activityType === "review" && b.urgency === "high").map(b => b.topicName), due);
  assert.equal(planner.today.blocks[0]?.durationMinutes, deadlocks.reviewMinutes);
});

test("a review on the same topic updates the same row, and a good answer raises it and pushes the next review out", async () => {
  const before = topicOf(await knowledge(CHAT, at(6)), "Operating Systems", "Deadlocks")!;
  await session("Operating Systems", "deadlocks", at(6), "good");                     // typed in lower case

  const view  = await knowledge(CHAT, at(6, 60));
  const after = topicOf(view, "Operating Systems", "Deadlocks")!;
  assert.equal(view.totals.topicCount, 3, "no second Deadlocks topic");
  assert.equal(after.id, before.id);
  assert.equal(after.reviewCount, 2);
  assert.ok(after.masteryPercent > before.masteryPercent, `${before.masteryPercent} → ${after.masteryPercent}`);
  assert.equal(after.reviewState, "scheduled");
  assert.ok(!view.dueReviews.some(t => t.topicName === "Deadlocks"), "the reviewed topic is no longer due");
  assert.equal(view.dueReviews.length, 2, "the two that were not reviewed still are");
  assert.deepEqual(after.recentSessions.map(s => s.outcome), ["good", "struggled"]);
  assert.equal(await prisma.novaTopicMastery.count({ where: { subjectId: subjects["Operating Systems"] } }), 1);
});

test("a chat-started session on a topic the learner already has goes to that topic's subject", async () => {
  await openStudySession(profileId, "dynamic programming", Object.entries(subjects).map(([name, id]) => ({ id, name })), at(8));
  const open = await prisma.novaStudySession.findFirstOrThrow({ where: { profileId, status: "in_progress" } });
  assert.equal(open.subjectId, subjects["Design and Analysis of Algorithms"]);
  assert.equal(open.topicName, "Dynamic Programming", "stored under the topic's existing spelling");
  await runNovaSessionCommand(CHAT, { action: "end", outcome: null }, at(8, 30));

  const dp = topicOf(await knowledge(CHAT, at(8, 60)), "Design and Analysis of Algorithms", "Dynamic Programming")!;
  assert.equal(dp.reviewCount, 2);
  assert.equal(dp.recentSessions[0]!.outcome, null, "no answer was given, and none is shown");
});

test("a chat-started session on an unknown topic with no subject records no topic", async () => {
  const all = Object.entries(subjects).map(([name, id]) => ({ id, name }));
  await openStudySession(profileId, "Paging", all, at(9));
  const ended = await runNovaSessionCommand(CHAT, { action: "end", outcome: "good" }, at(9, 30));
  assert.ok(ended.ok && ended.ended);
  assert.equal(ended.ended.topicRecorded, false);
  assert.equal((await knowledge(CHAT, at(9, 60))).totals.topicCount, 3);
});

test("'a' is not a subject", async () => {
  const all = Object.entries(subjects).map(([name, id]) => ({ id, name }));
  await openStudySession(profileId, "a", all, at(10));
  const open = await prisma.novaStudySession.findFirstOrThrow({ where: { profileId, status: "in_progress" } });
  assert.equal(open.subjectId, null);
  await runNovaSessionCommand(CHAT, { action: "end", outcome: "okay" }, at(10, 10));
  assert.equal(await prisma.novaTopicMastery.count({ where: { subject: { profileId } } }), 3);
});

test("a session the learner only reported in chat is never shown as timed study", async () => {
  // What consolidation writes for a corroborated "I studied X" with no live
  // session: a completed row with a placeholder duration, and a soft nudge.
  const decision = (op: "self_reported_session" | "mastery_observation") => ({
    action: "CREATE" as const, target: "academic_observation" as const, reason: op, targetId: null,
    write: { target: "academic_observation" as const, op, topic: "Normalization", confidence: 0.6 },
    provenance: { source: "signal_engine" as const, sourceMessageId: null, observedAt: at(11).toISOString(), confidence: 0.9 },
  });
  await applySessionObservation(prisma, profileId, decision("self_reported_session"), at(11));
  const before = topicOf(await knowledge(CHAT, at(11)), "DBMS", "Normalization")!;
  await applyMasteryObservation(decision("mastery_observation"), Object.entries(subjects).map(([name, id]) => ({ id, name })), at(11));

  const view = await knowledge(CHAT, at(11, 1));
  const reported = view.recentLearning.find(s => !s.measured);
  assert.ok(reported, "the self-reported session is listed");
  assert.equal(reported.minutes, null);
  const stored = await prisma.novaStudySession.findFirstOrThrow({ where: { profileId, activityType: "self_reported" } });
  assert.ok(stored.durationMinutes > 0, "the table does hold a placeholder duration");
  for (const s of view.recentLearning) assert.equal(s.minutes === null, !s.measured);

  // The conversational nudge found the existing topic by name alone, moved it
  // a little, and did not count as a session or change its schedule.
  const after = topicOf(view, "DBMS", "Normalization")!;
  assert.equal(after.id, before.id);
  assert.equal(after.reviewCount, before.reviewCount);
  assert.ok(after.masteryPercent < before.masteryPercent && after.masteryPercent >= 85, `${before.masteryPercent} → ${after.masteryPercent}`);
  assert.equal(after.recentSessions.every(s => s.measured), true);
});

test("one learner's knowledge is not another's", async () => {
  const other = await knowledge(OTHER);
  assert.deepEqual(other.totals, { subjectCount: 3, topicCount: 0, dueCount: 0 });
  assert.deepEqual(other.recentLearning, []);
  assert.deepEqual(await loadNovaKnowledge("nobody_such_chat"), { status: "not_connected" });
});
