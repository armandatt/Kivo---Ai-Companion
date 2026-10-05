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
const { loadOverdueTopics, checkCooldown, persistProactiveDecision } = await import("../proactive/nova-proactive-cron.js");

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

// Sessions in this file last 30 minutes, so a review scheduled N days after
// one that started at(0) falls at at(N, 30).
const everywhere = async (now: Date) => {
  const [know, home, planner, telegram] = await Promise.all([
    knowledge(CHAT, now),
    loadNovaToday(CHAT, { now }),
    loadNovaPlanner(CHAT, { now }),
    loadOverdueTopics(profileId, now),
  ]);
  assert.ok(home.status === "ready" && planner.status === "ready");
  return {
    knowledge: know.dueReviews.map(t => t.topicName),
    home:      home.reviewDue.topics.map(t => t.topicName),
    planner:   planner.today.blocks.filter(b => b.activityType === "review" && b.urgency === "high").map(b => b.topicName),
    telegram:  telegram.map(t => t.topicName),
    view: know, homeView: home, plannerView: planner,
  };
};

test("Struggled: next review is tomorrow, and tomorrow it is due on every surface, still fresh", async () => {
  const row = await prisma.novaTopicMastery.findFirstOrThrow({ where: { name: "Deadlocks", subjectId: subjects["Operating Systems"] } });
  assert.equal(row.intervalDays, 1);
  assert.equal(row.nextReviewAt!.getTime(), at(1, 30).getTime(), "scheduled one day after the session ended");

  const before = await everywhere(at(1, 29));                  // a minute before the date
  assert.deepEqual([before.knowledge, before.home, before.planner, before.telegram], [[], [], [], []]);
  assert.equal(topicOf(before.view, "Operating Systems", "Deadlocks")!.reviewState, "scheduled");

  const due = await everywhere(at(1, 31));                     // tomorrow
  assert.deepEqual(due.knowledge, ["Deadlocks"]);
  assert.deepEqual(due.home,      ["Deadlocks"]);
  assert.deepEqual(due.planner,   ["Deadlocks"]);
  assert.deepEqual(due.telegram,  ["Deadlocks"]);
  const deadlocks = due.view.dueReviews[0]!;
  assert.equal(deadlocks.reviewState, "due");
  assert.equal(deadlocks.daysOverdue, 0);
  assert.ok(deadlocks.retentionPercent >= 85, `still fresh: retention ${deadlocks.retentionPercent}%`);
  assert.equal(deadlocks.reviewMinutes, 25);
  assert.equal(due.homeView.recommendation?.topicName, "Deadlocks");
  assert.equal(due.plannerView.today.blocks[0]?.topicName, "Deadlocks");
});

test("Good and Crushed it: not due before their scheduled dates, due on them", async () => {
  const dp   = await prisma.novaTopicMastery.findFirstOrThrow({ where: { name: "Dynamic Programming" } });
  const norm = await prisma.novaTopicMastery.findFirstOrThrow({ where: { name: "Normalization", subjectId: subjects["DBMS"] } });
  assert.equal(dp.nextReviewAt!.getTime(),   at(3, 90).getTime());     // Good, session at(0, 60)
  assert.equal(norm.nextReviewAt!.getTime(), at(3, 150).getTime());    // Crushed it, session at(0, 120)

  const early = await everywhere(at(2, 600));
  assert.deepEqual(early.knowledge, ["Deadlocks"], "only the topic that was struggled with");
  assert.deepEqual([early.home, early.planner, early.telegram], [["Deadlocks"], ["Deadlocks"], ["Deadlocks"]]);
  assert.equal(topicOf(early.view, "Operating Systems", "Deadlocks")!.daysOverdue, 1);

  const between = await everywhere(at(3, 100));                // Good's date has come, Crushed it's has not
  assert.deepEqual([...between.knowledge].sort(), ["Deadlocks", "Dynamic Programming"]);

  const later = await everywhere(at(6));
  assert.deepEqual([...later.knowledge].sort(), ["Deadlocks", "Dynamic Programming", "Normalization"]);
  // One list, in one order, on every surface.
  assert.deepEqual(later.home, later.knowledge);
  assert.deepEqual(later.planner, later.knowledge);
  assert.deepEqual(later.telegram, later.knowledge);
  assert.equal(later.homeView.reviewDue.count, 3);
  assert.equal(later.homeView.recommendation?.topicName, later.knowledge[0]);
  assert.equal(new Set(later.telegram).size, later.telegram.length, "each due topic once");
});

test("a due review is not announced twice: the reminder's cooldown holds", async () => {
  const now = at(6, 600);
  assert.ok((await loadOverdueTopics(profileId, now)).length > 0, "there is something to remind about");
  assert.equal(await checkCooldown(profileId, "revision_reminder", now), false, "nothing sent yet");

  // The cron records every reminder it approves, with a cooldown.
  await persistProactiveDecision(profileId,
    { approved: true, finalInterventionType: "revision_reminder", suppressReason: null, priority: 4, confidence: 0.8 },
    "revision_reminder", now);
  const fired = await prisma.novaProactiveMessage.findFirstOrThrow({ where: { profileId, eventType: "revision_reminder" } });
  const cooldownMs = fired.cooldownUntil.getTime() - now.getTime();
  assert.ok(cooldownMs >= 3_600_000, `cooldown of ${cooldownMs / 3_600_000} h`);

  // Every later run inside the cooldown (the cron fires every five minutes)
  // finds it and is suppressed by the proactive decision graph; the topics
  // being still due does not send another.
  for (const minutes of [5, 10, 60]) {
    const later = new Date(now.getTime() + minutes * 60_000);
    if (later.getTime() >= fired.cooldownUntil.getTime()) break;
    assert.ok((await loadOverdueTopics(profileId, later)).length > 0);
    assert.equal(await checkCooldown(profileId, "revision_reminder", later), true);
  }
  assert.equal(await checkCooldown(profileId, "revision_reminder", new Date(fired.cooldownUntil.getTime() + 1000)), false);
  await prisma.novaProactiveMessage.deleteMany({ where: { profileId } });
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

test("a topic name is matched as literal text: % and _ are not wildcards", async () => {
  // "CPU_Scheduling" must not be taken for the existing "CPUxScheduling".
  await session("Operating Systems", "CPUxScheduling", at(20), "good");
  await session("Operating Systems", "CPU_Scheduling", at(20, 60), "struggled");
  await session("Operating Systems", "100% coverage", at(20, 120), "okay");
  await session("Operating Systems", "100x coverage", at(20, 180), "okay");
  const names = (await prisma.novaTopicMastery.findMany({ where: { subjectId: subjects["Operating Systems"] }, select: { name: true, reviewCount: true } }))
    .filter(t => /CPU|100/.test(t.name)).map(t => `${t.name}:${t.reviewCount}`).sort();
  assert.deepEqual(names, ["100% coverage:1", "100x coverage:1", "CPU_Scheduling:1", "CPUxScheduling:1"]);
});
