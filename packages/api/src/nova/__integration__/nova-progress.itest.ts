/**
 * Nova Progress — real Postgres integration test.
 *
 *   real session commands → execution reports → topic mastery + its history
 *   → GET progress reflects exactly that, for that learner only
 *
 * Everything is real here: the session commands, the Topic Mastery Engine's
 * transaction and the unique key that stops a report moving a topic twice
 * (which a mock cannot show), and the Progress read model. No LLM is
 * involved in any of it.
 *
 * Run from packages/api:
 *   NOVA_TEST_DATABASE_URL=postgresql://... npm run test:integration
 */

import "./test-database.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

const { prisma }                = await import("@repo/db/client");
const { runNovaSessionCommand } = await import("../product/session.js");
const { loadNovaProgress }      = await import("../product/progress.js");
const { loadNovaPlanner }       = await import("../product/planner.js");
const { loadNovaKnowledge }     = await import("../product/knowledge.js");
const { createNote }            = await import("../product/notes.js");
const { updateTopicMastery }    = await import("../engines/topic-mastery-engine.js");
const { applySessionObservation } = await import("../consolidation/stores/academic-observation-store.js");

const STAMP = Date.now();
const CHAT  = {
  a:     `nova_itest_prog_a_${STAMP}`,
  b:     `nova_itest_prog_b_${STAMP}`,
  tz:    `nova_itest_prog_tz_${STAMP}`,
  long:  `nova_itest_prog_long_${STAMP}`,
  rex:   `nova_itest_prog_rex_${STAMP}`,
  fresh: `nova_itest_prog_fresh_${STAMP}`,
};
const DAY = 86_400_000;
// A fixed "now" at noon UTC, so day boundaries do not depend on when the test runs.
const NOW = new Date(Math.floor(Date.now() / DAY) * DAY + 12 * 3_600_000);
const ago = (days: number, minutes = 0) => new Date(NOW.getTime() - days * DAY + minutes * 60_000);

const profile: Record<string, string> = {};
const subject: Record<string, Record<string, string>> = {};

type Ready = Extract<Awaited<ReturnType<typeof loadNovaProgress>>, { status: "ready" }>;
const progress = async (chat: string, now = NOW) => {
  const view = await loadNovaProgress(chat, { now });
  assert.equal(view.status, "ready");
  return view as Ready;
};
const stripped = (view: unknown) => JSON.stringify(view, (k, v) => (k === "generatedAt" ? undefined : v));

async function session(chat: string, subjectName: string, topicName: string, start: Date, outcome: "struggled" | "okay" | "good" | "crushed_it" | null, minutes = 30) {
  const started = await runNovaSessionCommand(chat, { action: "start", topicName, subjectName, plannedMinutes: 25 }, start);
  assert.ok(started.ok && started.session, "session started");
  const ended = await runNovaSessionCommand(chat, { action: "end", outcome }, new Date(start.getTime() + minutes * 60_000));
  assert.ok(ended.ok && ended.ended, "session ended");
}

// Every table a read of Progress could conceivably touch, as it stands.
async function learnerState(chat: string) {
  const user = await prisma.messengerUser.findUniqueOrThrow({
    where:  { platform_platformChatId: { platform: "telegram", platformChatId: chat } },
    select: { id: true, novaAcademicProfile: { select: { id: true } } },
  });
  const profileId = user.novaAcademicProfile!.id;
  const [sessions, topics, snapshots, dna, cognitive, notes, proactive, facts, reality, patterns, messages, jobs, academic] = await Promise.all([
    prisma.novaStudySession.findMany({ where: { profileId }, orderBy: { id: "asc" } }),
    prisma.novaTopicMastery.findMany({ where: { subject: { profileId } }, orderBy: { id: "asc" } }),
    prisma.novaTopicMasterySnapshot.findMany({ where: { profileId }, orderBy: { id: "asc" } }),
    prisma.novaLearningDNA.findMany({ where: { profileId } }),
    prisma.novaCognitiveState.findMany({ where: { profileId } }),
    prisma.novaNote.findMany({ where: { profileId }, orderBy: { id: "asc" } }),
    prisma.novaProactiveMessage.count({ where: { profileId } }),
    prisma.userFact.findMany({ where: { userId: user.id }, orderBy: { id: "asc" } }),
    prisma.userReality.findMany({ where: { userId: user.id }, orderBy: { id: "asc" } }),
    prisma.behavioralPattern.findMany({ where: { userId: user.id }, orderBy: { id: "asc" } }),
    prisma.companionMessage.count({ where: { userId: user.id } }),
    prisma.novaConsolidationJob.count({ where: { userId: user.id } }),
    prisma.novaAcademicProfile.findUniqueOrThrow({ where: { id: profileId } }),
  ]);
  return JSON.stringify({ sessions, topics, snapshots, dna, cognitive, notes, proactive, facts, reality, patterns, messages, jobs, academic });
}

before(async () => {
  for (const [key, chat] of Object.entries(CHAT)) {
    if (key === "fresh") continue;
    const user = await prisma.messengerUser.create({
      data: {
        platform: "telegram", platformChatId: chat, persona: key === "rex" ? "rex" : "nova",
        ...(key === "rex" ? {} : {
          novaAcademicProfile: { create: {
            onboardingComplete: true,
            timezone: key === "tz" ? "Asia/Kolkata" : null,
            goals: key === "a" ? ["Crack GATE 2027"] : [],
            subjects: { create: [{ name: "Operating Systems" }, { name: "DBMS" }] },
          } },
        }),
      },
      select: { novaAcademicProfile: { select: { id: true, subjects: { select: { id: true, name: true } } } } },
    });
    if (user.novaAcademicProfile) {
      profile[key] = user.novaAcademicProfile.id;
      subject[key] = Object.fromEntries(user.novaAcademicProfile.subjects.map(s => [s.name, s.id]));
    }
  }
});

after(async () => {
  await prisma.messengerUser.deleteMany({ where: { platformChatId: { in: Object.values(CHAT) } } });
  await prisma.$disconnect();
});

// ── Who gets a view ───────────────────────────────────────────────────────────

test("only an onboarded Nova learner has a progress view", async () => {
  assert.deepEqual(await loadNovaProgress(CHAT.fresh), { status: "not_connected" });
  assert.deepEqual(await loadNovaProgress(CHAT.rex), { status: "onboarding_incomplete" });
  assert.deepEqual(await loadNovaProgress("'; DROP TABLE \"NovaStudySession\"; --"), { status: "not_connected" });
});

test("a learner with no sessions gets an empty view and nothing invented", async () => {
  const view = await progress(CHAT.a);
  assert.equal(view.hasEvidence, false);
  assert.deepEqual(view.overview, {
    since: null, sessions: 0, learningMinutes: 0, activeDays: 0, topicsImproved: 0,
    notCounted: { selfReported: 0, underTenMinutes: 0 },
  });
  assert.deepEqual(view.journey, []);
  assert.deepEqual(view.changes, []);
  assert.deepEqual(view.growth, { improving: [], steady: [], needsAttention: [], justStarted: [] });
  assert.equal(view.consistency.trend, "not_enough_history");
  assert.deepEqual(view.goals, ["Crack GATE 2027"]);
  assert.equal(view.usualSession, null);
});

// ── Real sessions become progress ─────────────────────────────────────────────

test("real sessions, and how the learner said they went, are what progress shows", async () => {
  await session(CHAT.a, "Operating Systems", "Deadlocks", ago(20), "struggled", 30);
  await session(CHAT.a, "Operating Systems", "Deadlocks", ago(18), "okay", 25);
  await session(CHAT.a, "Operating Systems", "Deadlocks", ago(12), "good", 40);       // six days later
  await session(CHAT.a, "DBMS", "Normalization", ago(12, 120), "crushed_it", 20);
  await session(CHAT.a, "DBMS", "Indexing", ago(11), "good", 4);                       // stopped within ten minutes
  // "I studied for a while" in chat: a row with a placeholder duration and no timer.
  await applySessionObservation(prisma, profile.a!, {
    action: "CREATE", reason: "itest",
    write: { target: "academic_observation", op: "self_reported_session" },
  } as never, ago(10));

  const view = await progress(CHAT.a);
  assert.equal(view.hasEvidence, true);
  assert.equal(view.overview.sessions, 4);
  assert.equal(view.overview.learningMinutes, 30 + 25 + 40 + 20);
  assert.equal(view.overview.activeDays, 3);
  assert.equal(view.overview.since, ago(20).toISOString());
  assert.deepEqual(view.overview.notCounted, { selfReported: 1, underTenMinutes: 1 });

  assert.equal(view.consistency.lastActiveDay, ago(12).toISOString().slice(0, 10));
  assert.equal(view.consistency.daysSinceLastActive, 12);
  assert.deepEqual(view.consistency.comebacks, [{ date: ago(12).toISOString(), gapDays: 6, topicName: "Deadlocks" }]);
  const weekTotals = view.consistency.weeks.reduce((sum, w) => ({ s: sum.s + w.sessions, m: sum.m + w.minutes, d: sum.d + w.activeDays }), { s: 0, m: 0, d: 0 });
  assert.deepEqual(weekTotals, { s: 4, m: 115, d: 3 });
});

test("the Topic Mastery Engine's record of its changes is what topic growth is drawn from", async () => {
  const deadlocks = await prisma.novaTopicMastery.findFirstOrThrow({ where: { subjectId: subject.a!["Operating Systems"], name: "Deadlocks" } });
  const records   = await prisma.novaTopicMasterySnapshot.findMany({ where: { topicId: deadlocks.id }, orderBy: { recordedAt: "asc" } });
  assert.deepEqual(
    records.map(r => [r.source, r.masteryBefore, r.masteryAfter, r.confidence, r.reviewCount]),
    [["session_report", null, 0.3, 0.3, 1], ["session_report", 0.3, 0.42, 0.6, 2], ["session_report", 0.42, 0.55, 0.75, 3]],
  );
  assert.ok(records.every(r => r.profileId === profile.a && r.sessionId), "each record names its learner and its session");
  assert.equal(records[2]!.masteryAfter, deadlocks.masteryProbability, "the last record is the topic's current value");
  const ownSessions = new Set((await prisma.novaStudySession.findMany({ where: { profileId: profile.a }, select: { id: true } })).map(s => s.id));
  assert.ok(records.every(r => ownSessions.has(r.sessionId!)));

  const view = await progress(CHAT.a);
  assert.deepEqual(view.growth.improving.map(t => [t.topicName, t.reason, t.sessions]), [["Deadlocks", "Up from 30% to 55%", 3]]);
  assert.deepEqual(view.growth.improving[0]!.change, {
    fromPercent: 30, toPercent: 55, fromLevel: "weak", toLevel: "developing", since: records[0]!.recordedAt.toISOString(),
  });
  assert.deepEqual(view.growth.improving[0]!.outcomes, ["struggled", "okay", "good"]);
  assert.deepEqual(view.growth.justStarted.map(t => t.topicName), ["Indexing", "Normalization"]);
  assert.equal(view.overview.topicsImproved, 1);

  // Progress and Knowledge show the same number for the same topic.
  const knowledge = await loadNovaKnowledge(CHAT.a, { now: NOW });
  assert.equal(knowledge.status, "ready");
  const known = knowledge.status === "ready" ? knowledge.subjects.flatMap(s => s.topics) : [];
  for (const t of [...view.growth.improving, ...view.growth.justStarted]) {
    const same = known.find(k => k.id === t.topicId)!;
    assert.deepEqual([t.masteryPercent, t.level, t.sessions], [same.masteryPercent, same.level, same.reviewCount]);
  }
});

test("the journey holds only moments with a record behind them, and every record is the learner's own", async () => {
  const view = await progress(CHAT.a);
  assert.deepEqual(view.journey.map(e => e.type), ["breakthrough", "comeback", "topic_level_up", "first_session"]);
  assert.deepEqual(view.journey.map(e => e.title), [
    "Deadlocks: from Struggled to Good", "Back after 6 days away", "Deadlocks: weak to developing", "Your first session",
  ]);

  const sessions  = new Set((await prisma.novaStudySession.findMany({ where: { profileId: profile.a }, select: { id: true } })).map(s => s.id));
  const snapshots = new Set((await prisma.novaTopicMasterySnapshot.findMany({ where: { profileId: profile.a }, select: { id: true } })).map(s => s.id));
  for (const e of view.journey) {
    assert.ok((e.source.kind === "session" ? sessions : snapshots).has(e.source.id), `${e.type} points at one of the learner's own records`);
  }
  assert.deepEqual(view.changes.map(c => c.kind), ["topic_improved", "comeback", "sessions"]);
  assert.equal(view.changes[0]!.text, "Deadlocks moved from 30% to 55% (weak to developing).");
  assert.equal(view.changes[2]!.text, "You've completed 4 focused sessions in the last 30 days.");
});

test("Learning DNA is shown only once it has marked itself as more than a single session", async () => {
  const dna = await prisma.novaLearningDNA.findUniqueOrThrow({ where: { profileId: profile.a } });
  assert.ok(dna.dataPointCount >= 3 && dna.confidence !== "low");
  const view = await progress(CHAT.a);
  assert.deepEqual(view.usualSession, { minutes: dna.optimalSessionMinutes, basedOnSessions: dna.dataPointCount });

  await session(CHAT.b, "DBMS", "Joins", ago(2), "good", 30);
  assert.equal((await progress(CHAT.b)).usualSession, null, "one session is not a pattern");
});

// ── A report moves a topic once ───────────────────────────────────────────────

test("replaying a session's report neither moves the topic again nor adds a second record", async () => {
  const subjectId = subject.b!["Operating Systems"]!;
  await updateTopicMastery(subjectId, "Paging", 0.3, ago(5), "session_report", "replayed-session");
  const once = await prisma.novaTopicMastery.findFirstOrThrow({ where: { subjectId, name: "Paging" } });

  await updateTopicMastery(subjectId, "Paging", 0.9, ago(4), "session_report", "replayed-session");
  await updateTopicMastery(subjectId, "paging ", 0.9, ago(3), "session_report", "replayed-session");
  const again = await prisma.novaTopicMastery.findFirstOrThrow({ where: { subjectId, name: "Paging" } });
  assert.deepEqual(again, once, "the topic row is untouched by the replays");
  assert.equal(await prisma.novaTopicMasterySnapshot.count({ where: { topicId: once.id } }), 1);
});

test("two copies of the same report arriving together move the topic once", async () => {
  const subjectId = subject.b!["Operating Systems"]!;
  await Promise.all(Array.from({ length: 6 }, () => updateTopicMastery(subjectId, "Paging", 0.75, ago(2), "session_report", "raced-session")));
  const topic = await prisma.novaTopicMastery.findFirstOrThrow({ where: { subjectId, name: "Paging" } });
  assert.equal(topic.reviewCount, 2);
  assert.equal(topic.masteryProbability, 0.48);   // 0.6 × 0.30 + 0.4 × 0.75
  const records = await prisma.novaTopicMasterySnapshot.findMany({ where: { topicId: topic.id }, orderBy: { recordedAt: "asc" } });
  assert.deepEqual(records.map(r => [r.sessionId, r.masteryBefore, r.masteryAfter]), [["replayed-session", null, 0.3], ["raced-session", 0.3, 0.48]]);
});

test("a conversation observation is recorded as one, and is not a session", async () => {
  const subjectId = subject.b!["Operating Systems"]!;
  await updateTopicMastery(subjectId, "Paging", 0.9, ago(1), "conversation_signal");
  await updateTopicMastery(subjectId, "Paging", 0.9, ago(1, 5), "conversation_signal");
  const topic   = await prisma.novaTopicMastery.findFirstOrThrow({ where: { subjectId, name: "Paging" } });
  const records = await prisma.novaTopicMasterySnapshot.findMany({ where: { topicId: topic.id, source: "conversation_signal" } });
  assert.equal(records.length, 2);
  assert.ok(records.every(r => r.sessionId === null && r.reviewCount === 2));
  assert.equal(topic.reviewCount, 2, "no session was added");
  assert.ok(!(await progress(CHAT.b)).journey.some(e => e.type === "topic_level_up" && e.topicName === "Paging" && e.date >= ago(1).toISOString()));
});

// ── Isolation ─────────────────────────────────────────────────────────────────

test("one learner's progress never contains another's", async () => {
  const a = await progress(CHAT.a);
  const b = await progress(CHAT.b);

  const text = JSON.stringify(b);
  for (const word of ["Deadlocks", "Normalization", "Indexing", "Crack GATE"]) assert.ok(!text.includes(word), `${word} is learner A's`);
  assert.ok(!JSON.stringify(a).includes("Paging") && !JSON.stringify(a).includes("Joins"));

  const own = async (key: "a" | "b") => ({
    topics:    new Set((await prisma.novaTopicMastery.findMany({ where: { subject: { profileId: profile[key] } }, select: { id: true } })).map(r => r.id)),
    sessions:  new Set((await prisma.novaStudySession.findMany({ where: { profileId: profile[key] }, select: { id: true } })).map(r => r.id)),
    snapshots: new Set((await prisma.novaTopicMasterySnapshot.findMany({ where: { profileId: profile[key] }, select: { id: true } })).map(r => r.id)),
  });
  for (const [view, key] of [[a, "a"], [b, "b"]] as const) {
    const mine = await own(key);
    const topics = [...view.growth.improving, ...view.growth.steady, ...view.growth.needsAttention, ...view.growth.justStarted];
    assert.ok(topics.length > 0);
    assert.ok(topics.every(t => mine.topics.has(t.topicId)), "every topic returned is the learner's own");
    assert.ok(view.journey.every(e => (e.source.kind === "session" ? mine.sessions : mine.snapshots).has(e.source.id)), "every journey record is the learner's own");
  }
  assert.equal(b.overview.sessions, 1);
});

test("a mastery record cannot be read through another learner's profile", async () => {
  // B's topics have records; none carries A's profile, and A's query finds none of them.
  const bTopics = (await prisma.novaTopicMastery.findMany({ where: { subject: { profileId: profile.b } }, select: { id: true } })).map(t => t.id);
  assert.equal(await prisma.novaTopicMasterySnapshot.count({ where: { profileId: profile.a, topicId: { in: bTopics } } }), 0);
  assert.ok(await prisma.novaTopicMasterySnapshot.count({ where: { profileId: profile.b, topicId: { in: bTopics } } }) > 0);
});

// ── Read-only, and independent of its neighbours ──────────────────────────────

test("loading progress changes nothing the learner has", async () => {
  const before = await learnerState(CHAT.a);
  await progress(CHAT.a);
  await progress(CHAT.a, new Date(NOW.getTime() + 40 * DAY));
  await Promise.all([progress(CHAT.a), progress(CHAT.a), progress(CHAT.a)]);
  assert.equal(await learnerState(CHAT.a), before);
});

test("the same evidence gives the same view", async () => {
  assert.equal(stripped(await progress(CHAT.a)), stripped(await progress(CHAT.a)));
});

test("a note changes nothing on Progress, and Progress changes no note", async () => {
  const before = stripped(await progress(CHAT.a));
  const made = await createNote(profile.a!, {
    title: "Deadlocks: I finally understand this, 100% mastered", subjectId: subject.a!["Operating Systems"], topicName: "Deadlocks",
    body: "Studied for 6 hours today. Completed 50 sessions. Breakthrough!",
  });
  assert.ok(made.ok);
  assert.equal(stripped(await progress(CHAT.a)), before);
  assert.equal(await prisma.novaNote.count({ where: { profileId: profile.a } }), 1);
});

test("Planner and Progress do not move each other", async () => {
  const planBefore = stripped(await loadNovaPlanner(CHAT.a, { now: NOW }));
  const progBefore = stripped(await progress(CHAT.a));
  await loadNovaPlanner(CHAT.a, { now: NOW, availableMinutes: 20 });
  assert.equal(stripped(await progress(CHAT.a)), progBefore);
  assert.equal(stripped(await loadNovaPlanner(CHAT.a, { now: NOW })), planBefore);
});

// ── Timezone ──────────────────────────────────────────────────────────────────

test("days are drawn in the learner's stored timezone", async () => {
  // 19:30 UTC is 01:00 the next day in Kolkata.
  const lateUtc = new Date(Math.floor(ago(3).getTime() / DAY) * DAY + 19.5 * 3_600_000);
  await session(CHAT.tz, "DBMS", "Joins", lateUtc, "good", 30);
  await session(CHAT.tz, "DBMS", "Joins", new Date(lateUtc.getTime() + 10 * 3_600_000), "good", 30);   // 05:30 UTC next day

  const view = await progress(CHAT.tz);
  assert.equal(view.consistency.timezone, "Asia/Kolkata");
  assert.equal(view.overview.sessions, 2);
  assert.equal(view.overview.activeDays, 1, "both fall on the same Kolkata day");
  assert.equal(view.consistency.lastActiveDay, new Date(lateUtc.getTime() + DAY).toISOString().slice(0, 10));

  await prisma.novaAcademicProfile.update({ where: { id: profile.tz }, data: { timezone: "Not/AZone" } });
  const utc = await progress(CHAT.tz);
  assert.equal(utc.consistency.timezone, "UTC");
  assert.equal(utc.overview.activeDays, 2);
});

// ── A long history ────────────────────────────────────────────────────────────

test("three thousand sessions over two years load quickly, with totals intact", async () => {
  const profileId = profile.long!;
  const subjectId = subject.long!["Operating Systems"]!;
  const rows = Array.from({ length: 3000 }, (_, i) => ({
    profileId, subjectId, topicName: `Topic ${i % 50}`, status: "completed", activityType: "active",
    durationMinutes: 20 + (i % 3) * 10,
    sessionDate: ago(1 + Math.floor(i / 4.2), (i % 4) * 90),      // about four a day, back ~714 days
    executionReport: { outcome: i % 5 === 0 ? "struggled" : "good" },
  }));
  await prisma.novaStudySession.createMany({ data: rows });
  await prisma.novaStudySession.createMany({ data: [
    { profileId, status: "completed", activityType: "self_reported", durationMinutes: 90, sessionDate: ago(600) },
    { profileId, status: "completed", activityType: "active", durationMinutes: 5, sessionDate: ago(500) },
    { profileId, status: "skipped", activityType: "self_reported", durationMinutes: 0, sessionDate: ago(2) },
    { profileId, status: "in_progress", activityType: "active", durationMinutes: 0, sessionDate: ago(0, -30) },
  ] });

  const started = Date.now();
  const view = await progress(CHAT.long);
  const took = Date.now() - started;

  assert.equal(view.overview.sessions, 3000);
  assert.equal(view.overview.learningMinutes, rows.reduce((sum, r) => sum + r.durationMinutes, 0));
  assert.equal(view.overview.since, rows.reduce((min, r) => (r.sessionDate < min ? r.sessionDate : min), rows[0]!.sessionDate).toISOString());
  assert.deepEqual(view.overview.notCounted, { selfReported: 1, underTenMinutes: 1 });
  assert.ok(view.overview.activeDays <= 366 && view.overview.activeDays >= 360);
  assert.ok(view.journey.length <= 40);
  assert.equal(view.consistency.weeks.length, 9);
  assert.equal(view.consistency.trend, "steady");
  assert.ok(JSON.stringify(view).length < 40_000, "the response does not grow with the history");
  assert.ok(took < 3000, `loaded in ${took} ms`);
});

// ── Lifetime of the history ───────────────────────────────────────────────────

test("mastery history goes when its topic or its learner goes", async () => {
  const topic = await prisma.novaTopicMastery.findFirstOrThrow({ where: { subjectId: subject.b!["Operating Systems"], name: "Paging" } });
  assert.ok(await prisma.novaTopicMasterySnapshot.count({ where: { topicId: topic.id } }) > 0);
  await prisma.novaTopicMastery.delete({ where: { id: topic.id } });
  assert.equal(await prisma.novaTopicMasterySnapshot.count({ where: { topicId: topic.id } }), 0);

  assert.ok(await prisma.novaTopicMasterySnapshot.count({ where: { profileId: profile.b } }) > 0);
  await prisma.messengerUser.deleteMany({ where: { platformChatId: CHAT.b } });
  assert.equal(await prisma.novaTopicMasterySnapshot.count({ where: { profileId: profile.b } }), 0);
});
