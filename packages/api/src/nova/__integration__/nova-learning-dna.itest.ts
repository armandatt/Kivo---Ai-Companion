/**
 * Nova Learning DNA — real Postgres integration test.
 *
 *   real session commands → execution reports → Learning DNA recomputed and
 *   stored → GET learning-dna reflects exactly that, for that learner only
 *
 * Everything is real here: the session commands, the refresh that runs when
 * a session ends, the stored row and its memory of earlier conclusions, the
 * timezone write, and the read model. No LLM is involved in any of it.
 *
 * Run from packages/api:
 *   NOVA_TEST_DATABASE_URL=postgresql://... npm run test:integration
 */

import "./test-database.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

const { prisma }                = await import("@repo/db/client");
const { runNovaSessionCommand } = await import("../product/session.js");
const { loadNovaLearningDna, recordLearnerTimezone } = await import("../product/learning-dna.js");
const { loadNovaProgress }      = await import("../product/progress.js");
const { loadNovaPlanner }       = await import("../product/planner.js");
const { refreshLearningDna }    = await import("../persistence/learning-dna-store.js");
const { applySessionObservation } = await import("../consolidation/stores/academic-observation-store.js");

const STAMP = Date.now();
const CHAT  = {
  a:     `nova_itest_dna_a_${STAMP}`,
  b:     `nova_itest_dna_b_${STAMP}`,
  c:     `nova_itest_dna_c_${STAMP}`,
  rex:   `nova_itest_dna_rex_${STAMP}`,
  fresh: `nova_itest_dna_fresh_${STAMP}`,
};
const DAY = 86_400_000;
// Noon UTC today, so day and hour boundaries do not depend on when the test runs.
const NOW = new Date(Math.floor(Date.now() / DAY) * DAY + 12 * 3_600_000);
const ago = (days: number, hourUtc = 10) => new Date(Math.floor(NOW.getTime() / DAY) * DAY - days * DAY + hourUtc * 3_600_000);

const profile: Record<string, string> = {};
const user: Record<string, string> = {};

type Ready = Extract<Awaited<ReturnType<typeof loadNovaLearningDna>>, { status: "ready" }>;
const dna = async (chat: string, now = NOW) => {
  const view = await loadNovaLearningDna(chat, { now });
  assert.equal(view.status, "ready");
  return view as Ready;
};
const signal = (view: Ready, key: string) => view.signals.find(s => s.key === key)!;
const stripped = (view: unknown) => JSON.stringify(view, (k, v) => (k === "generatedAt" ? undefined : v));

type Outcome = "struggled" | "okay" | "good" | "crushed_it" | null;
async function session(chat: string, start: Date, minutes: number, outcome: Outcome, topicName = "Deadlocks", subjectName = "Operating Systems", plannedMinutes = 25) {
  const started = await runNovaSessionCommand(chat, { action: "start", topicName, subjectName, plannedMinutes }, start);
  assert.ok(started.ok && started.session, "session started");
  const ended = await runNovaSessionCommand(chat, { action: "end", outcome }, new Date(start.getTime() + minutes * 60_000));
  assert.ok(ended.ok && ended.ended, "session ended");
}

// Everything except the Learning DNA row, as it stands.
async function everythingElse(key: string) {
  const profileId = profile[key]!, userId = user[key]!;
  const [sessions, topics, history, cognitive, notes, proactive, facts, reality, patterns, messages, jobs, academic] = await Promise.all([
    prisma.novaStudySession.findMany({ where: { profileId }, orderBy: { id: "asc" } }),
    prisma.novaTopicMastery.findMany({ where: { subject: { profileId } }, orderBy: { id: "asc" } }),
    prisma.novaTopicMasterySnapshot.findMany({ where: { profileId }, orderBy: { id: "asc" } }),
    prisma.novaCognitiveState.findMany({ where: { profileId } }),
    prisma.novaNote.count({ where: { profileId } }),
    prisma.novaProactiveMessage.count({ where: { profileId } }),
    prisma.userFact.findMany({ where: { userId }, orderBy: { id: "asc" } }),
    prisma.userReality.findMany({ where: { userId }, orderBy: { id: "asc" } }),
    prisma.behavioralPattern.findMany({ where: { userId }, orderBy: { id: "asc" } }),
    prisma.companionMessage.count({ where: { userId } }),
    prisma.novaConsolidationJob.count({ where: { userId } }),
    prisma.novaAcademicProfile.findUniqueOrThrow({ where: { id: profileId } }),
  ]);
  return JSON.stringify({ sessions, topics, history, cognitive, notes, proactive, facts, reality, patterns, messages, jobs, academic });
}
const dnaRow = (key: string) => prisma.novaLearningDNA.findUnique({ where: { profileId: profile[key]! } });

before(async () => {
  for (const [key, chat] of Object.entries(CHAT)) {
    if (key === "fresh") continue;
    const created = await prisma.messengerUser.create({
      data: {
        platform: "telegram", platformChatId: chat, persona: key === "rex" ? "rex" : "nova",
        ...(key === "rex" ? {} : {
          novaAcademicProfile: { create: {
            onboardingComplete: true, preferredStudyTime: key === "a" ? "evening" : null,
            subjects: { create: [{ name: "Operating Systems" }, { name: "DBMS" }] },
          } },
        }),
      },
      select: { id: true, novaAcademicProfile: { select: { id: true } } },
    });
    user[key] = created.id;
    if (created.novaAcademicProfile) profile[key] = created.novaAcademicProfile.id;
  }
});

after(async () => {
  await prisma.messengerUser.deleteMany({ where: { platformChatId: { in: Object.values(CHAT) } } });
  await prisma.$disconnect();
});

// ── Who gets a view ───────────────────────────────────────────────────────────

test("only an onboarded Nova learner has Learning DNA", async () => {
  assert.deepEqual(await loadNovaLearningDna(CHAT.fresh), { status: "not_connected" });
  assert.deepEqual(await loadNovaLearningDna(CHAT.rex), { status: "onboarding_incomplete" });
  assert.deepEqual(await loadNovaLearningDna("'; DROP TABLE \"NovaLearningDNA\"; --"), { status: "not_connected" });
});

test("a learner with no sessions has no beliefs about them, and no row is made by looking", async () => {
  const view = await dna(CHAT.a);
  assert.equal(view.sessionsConsidered, 0);
  assert.equal(view.timezone, null);
  assert.equal(view.statedStudyTime, "evening");
  assert.equal(view.signals.length, 8);
  assert.ok(view.signals.every(s => s.level === "unknown" && s.value === null && s.headline === null && s.trend === null));
  assert.deepEqual(view.changing, []);
  assert.equal(await dnaRow("a"), null);
});

// ── One session is not a trait ────────────────────────────────────────────────

test("one real session, however unusual, concludes nothing", async () => {
  // A three-hour session at 2am UTC that went brilliantly, planned for 25 minutes.
  await session(CHAT.a, ago(80, 2), 180, "crushed_it");

  const row = await dnaRow("a");
  assert.ok(row, "ending a session refreshes Learning DNA");
  assert.deepEqual(
    [row.optimalSessionMinutes, row.planAdherenceProfile, row.dataPointCount, row.confidence, row.signals],
    [null, null, 1, "low", {}],
  );
  assert.deepEqual([row.peakStudyHours, row.attentionCurve, row.preferredReviewStyle], [[], null, null]);

  const view = await dna(CHAT.a, ago(79));
  assert.equal(view.sessionsConsidered, 1);
  assert.equal(view.answeredSessions, 1);
  assert.ok(view.signals.every(s => s.level === "unknown" && s.value === null), "no signal has a value");
  assert.equal(signal(view, "typical_session").explanation, "Nova needs 5 finished sessions before it says anything here. It has 1.");
});

test("sessions Progress does not count are not evidence here either", async () => {
  await session(CHAT.a, ago(79), 4, "good");                     // stopped inside ten minutes
  await applySessionObservation(prisma, profile.a!, {
    action: "CREATE", reason: "itest", write: { target: "academic_observation", op: "self_reported_session" },
  } as never, ago(79, 15));                                      // "I studied" in chat
  await refreshLearningDna(profile.a!, ago(78));

  assert.equal((await dna(CHAT.a, ago(78))).sessionsConsidered, 1);
  assert.equal((await dnaRow("a"))!.dataPointCount, 1);
});

// ── Evidence accumulates into beliefs ─────────────────────────────────────────

test("five sessions give a first, tentative belief; the three-hour one does not set it", async () => {
  for (const d of [78, 77, 76]) await session(CHAT.a, ago(d), 30, "struggled");
  assert.equal(signal(await dna(CHAT.a, ago(75)), "typical_session").level, "unknown", "four sessions: still nothing");

  await session(CHAT.a, ago(75), 30, "struggled");
  const view    = await dna(CHAT.a, ago(74));
  const typical = signal(view, "typical_session");
  assert.equal(typical.level, "emerging");
  assert.equal(typical.evidenceCount, 5);
  assert.deepEqual(typical.value, { kind: "minutes", typical: 30, low: 30, high: 30 });
  assert.equal(typical.trend, "new");
  assert.equal(typical.lastUpdated, ago(75).toISOString());

  const row = (await dnaRow("a"))!;
  assert.deepEqual([row.optimalSessionMinutes, row.dataPointCount, row.confidence], [30, 5, "low"]);
  const memory = row.signals as Record<string, { valueKey: string; level: string; since: string; previous: unknown }>;
  // Deadlocks, "Struggled" four times running, is flagged as well.
  assert.deepEqual(Object.keys(memory).sort(), ["needs_more_retrieval", "plan_follow_through", "typical_session"]);
  assert.equal(memory.typical_session!.valueKey, "medium");
  assert.equal(memory.typical_session!.previous, null);
  assert.equal(typical.heldSince, memory.typical_session!.since);
});

test("a comparison appears only when both sides have answers, and comes from the learner's own answers", async () => {
  // So far: one 180-minute "Crushed it", four 30-minute "Struggled". One side is too thin.
  assert.equal(signal(await dna(CHAT.a, ago(74)), "best_session_size").level, "unknown");

  for (const d of [70, 69, 68, 67, 66]) await session(CHAT.a, ago(d), 55, "good", "Paging");
  const view = await dna(CHAT.a, ago(65));
  const best = signal(view, "best_session_size");
  assert.equal(best.level, "emerging");
  assert.equal(best.headline, "45–74 minutes");
  assert.deepEqual(best.value, {
    kind: "comparison", label: "45–74 minutes", wentWell: 5, of: 5,
    against: [{ label: "25–44 minutes", wentWell: 0, of: 4 }],
  });
  assert.equal(best.evidenceUnit, "answered sessions");
  assert.equal(view.answeredSessions, 10);
});

test("a topic's own mastery record travels with the struggle that flags it", async () => {
  const view = await dna(CHAT.a, ago(65));
  const hard = signal(view, "needs_more_retrieval");
  assert.equal(hard.level, "supported");
  const topic = await prisma.novaTopicMastery.findFirstOrThrow({ where: { subject: { profileId: profile.a }, name: "Deadlocks" } });
  assert.deepEqual(hard.value, { kind: "topics", topics: [{
    topicName: "Deadlocks", subjectName: "Operating Systems", struggled: 4, answered: 5,
    masteryPercent: Math.round(topic.masteryProbability * 100),
  }] });

  // Two good sessions on it, and it is no longer flagged.
  await session(CHAT.a, ago(64), 30, "good");
  await session(CHAT.a, ago(63), 30, "crushed_it");
  const after = signal(await dna(CHAT.a, ago(62)), "needs_more_retrieval");
  assert.equal(after.value, null);
  assert.equal(after.explanation, "No topic shows repeated struggle in your recent answers.");
});

test("a belief that the evidence turns against is replaced, and Nova remembers what it was", async () => {
  const before = (await dnaRow("a"))!.signals as Record<string, { valueKey: string; valueLabel: string }>;
  assert.equal(before.typical_session!.valueKey, "medium");

  // Fourteen 60-minute sessions in the last three weeks.
  for (let d = 20; d >= 7; d--) await session(CHAT.a, ago(d), 60, "good", "Semaphores");

  const row    = (await dnaRow("a"))!;
  const memory = row.signals as Record<string, { valueKey: string; valueLabel: string; previous: { label: string } | null; previousLevel: string }>;
  assert.equal(memory.typical_session!.valueKey, "long");
  assert.equal(memory.typical_session!.previous?.label, before.typical_session!.valueLabel);
  assert.deepEqual([row.optimalSessionMinutes, row.confidence], [60, "high"]);

  const typical = signal(await dna(CHAT.a), "typical_session");
  assert.equal(typical.headline, "About 60 minutes");
  assert.equal(typical.level, "strong");
  assert.equal(typical.trend, "changed");
  assert.equal(typical.previous?.label, before.typical_session!.valueLabel);
  assert.ok((await dna(CHAT.a)).changing.includes("typical_session"));
});

test("Progress shows the same session length, from the same owner", async () => {
  const progress = await loadNovaProgress(CHAT.a, { now: NOW });
  assert.equal(progress.status, "ready");
  const typical = signal(await dna(CHAT.a), "typical_session");
  if (progress.status === "ready") {
    assert.deepEqual(progress.usualSession, { minutes: 60, basedOnSessions: typical.evidenceCount });
  }
  // And a learner with only a few sessions gets none on Progress.
  for (const d of [5, 4, 3]) await session(CHAT.b, ago(d), 40, "good", "Joins", "DBMS");
  const few = await loadNovaProgress(CHAT.b, { now: NOW });
  assert.equal(few.status === "ready" && few.usualSession, null);
});

test("evidence that leaves the 90-day window stops supporting a belief", async () => {
  // Looked at 100 days from now, nothing is inside the window.
  const later = await dna(CHAT.a, new Date(NOW.getTime() + 100 * DAY));
  assert.equal(later.sessionsConsidered, 0);
  assert.ok(later.signals.every(s => s.level === "unknown" && s.value === null));
});

// ── Timezone ──────────────────────────────────────────────────────────────────

test("no timezone, no claim about time of day", async () => {
  const view = await dna(CHAT.a);
  for (const key of ["usual_study_window", "best_study_window"]) {
    assert.equal(signal(view, key).value, null);
    assert.match(signal(view, key).explanation, /doesn't know your timezone/);
  }
});

test("a timezone that is not one is refused and nothing is stored", async () => {
  const junk: unknown[] = ["", "Mars/Olympus", "../../etc/passwd", "Asia/Kolkata; DROP TABLE x", "x".repeat(500), 330, null, undefined, { tz: "UTC" }, ["Asia/Kolkata"], "<script>"];
  for (const value of junk) {
    assert.deepEqual(await recordLearnerTimezone(CHAT.a, value), { ok: false, error: "invalid_timezone" }, `refused: ${JSON.stringify(value)?.slice(0, 40)}`);
  }
  assert.equal((await prisma.novaAcademicProfile.findUniqueOrThrow({ where: { id: profile.a } })).timezone, null);
});

test("the first valid timezone is stored on the caller's own learner, and cannot be moved afterwards", async () => {
  assert.deepEqual(await recordLearnerTimezone(CHAT.a, "Asia/Kolkata"), { ok: true, timezone: "Asia/Kolkata", changed: true });
  assert.deepEqual(await recordLearnerTimezone(CHAT.a, "America/New_York"), { ok: true, timezone: "Asia/Kolkata", changed: false });
  assert.deepEqual(await recordLearnerTimezone(CHAT.a, "UTC"), { ok: true, timezone: "Asia/Kolkata", changed: false });

  const zones = await prisma.novaAcademicProfile.findMany({ where: { id: { in: [profile.a!, profile.b!, profile.c!] } }, select: { id: true, timezone: true } });
  assert.deepEqual(Object.fromEntries(zones.map(z => [z.id, z.timezone])), { [profile.a!]: "Asia/Kolkata", [profile.b!]: null, [profile.c!]: null });

  assert.deepEqual(await recordLearnerTimezone(CHAT.rex, "Asia/Kolkata"), { ok: false, error: "onboarding_incomplete" });
  assert.deepEqual(await recordLearnerTimezone(CHAT.fresh, "Asia/Kolkata"), { ok: false, error: "not_connected" });
});

test("six tabs reporting different zones at once leave exactly one, and it is one of theirs", async () => {
  const zones = ["Europe/Paris", "Asia/Tokyo", "America/Chicago", "Europe/Paris", "Asia/Tokyo", "Australia/Sydney"];
  const results = await Promise.all(zones.map(z => recordLearnerTimezone(CHAT.c, z)));
  const stored  = (await prisma.novaAcademicProfile.findUniqueOrThrow({ where: { id: profile.c } })).timezone;
  assert.ok(stored && zones.includes(stored));
  assert.ok(results.every(r => r.ok && r.timezone === stored), "every tab is told the zone that was kept");
});

test("a stored zone that is not a real one is treated as unknown and can be replaced", async () => {
  await prisma.novaAcademicProfile.update({ where: { id: profile.b }, data: { timezone: "Not/AZone" } });
  assert.equal((await dna(CHAT.b)).timezone, null);
  // Chrome reports India as "Asia/Calcutta"; the current name is what is kept.
  assert.deepEqual(await recordLearnerTimezone(CHAT.b, "Asia/Calcutta"), { ok: true, timezone: "Asia/Kolkata", changed: true });
  assert.equal((await dna(CHAT.b)).timezone, "Asia/Kolkata");
});

test("with a timezone, the usual study time is read on the learner's clock", async () => {
  const view  = await dna(CHAT.a);
  const usual = signal(view, "usual_study_window");
  assert.equal(view.timezone, "Asia/Kolkata");
  // The sessions started at 10:00 UTC, which is 15:30 in Kolkata.
  assert.equal(usual.headline, "Afternoon (noon–5pm)");
  assert.equal(usual.level, "strong");
  assert.equal(usual.value?.kind === "window" && usual.value.of, view.sessionsConsidered);
  // Stated in setup as "evening": shown as a statement, and not what Nova concluded.
  assert.equal(view.statedStudyTime, "evening");
});

// ── Isolation ─────────────────────────────────────────────────────────────────

test("one learner's Learning DNA never contains another's", async () => {
  const a = stripped(await dna(CHAT.a)), b = stripped(await dna(CHAT.b));
  for (const word of ["Deadlocks", "Paging", "Semaphores", "evening"]) assert.ok(!b.includes(word), `${word} is learner A's`);
  assert.ok(!a.includes("Joins"));
  assert.equal((await dna(CHAT.b)).sessionsConsidered, 3);
  assert.equal((await dnaRow("b"))!.dataPointCount, 3);
  assert.equal((await dnaRow("b"))!.optimalSessionMinutes, null);
  assert.equal(await prisma.novaLearningDNA.count({ where: { profileId: { in: [profile.a!, profile.b!] } } }), 2);
});

// ── Read-only, and no writes outside its own table ────────────────────────────

test("reading Learning DNA changes nothing, including Learning DNA", async () => {
  const before = [await everythingElse("a"), JSON.stringify(await dnaRow("a"))];
  await dna(CHAT.a);
  await dna(CHAT.a, new Date(NOW.getTime() + 30 * DAY));
  await Promise.all([dna(CHAT.a), dna(CHAT.a), dna(CHAT.a)]);
  assert.deepEqual([await everythingElse("a"), JSON.stringify(await dnaRow("a"))], before);
});

test("the same evidence gives the same view", async () => {
  assert.equal(stripped(await dna(CHAT.a)), stripped(await dna(CHAT.a)));
});

test("refreshing Learning DNA writes its own row and nothing else", async () => {
  const before = await everythingElse("a");
  await refreshLearningDna(profile.a!, NOW);
  await Promise.all([refreshLearningDna(profile.a!, NOW), refreshLearningDna(profile.a!, NOW)]);
  assert.equal(await everythingElse("a"), before);
  assert.equal(await prisma.novaLearningDNA.count({ where: { profileId: profile.a } }), 1);
  // No memory system gained a "learning style" of its own.
  assert.equal(await prisma.userFact.count({ where: { userId: user.a } }), 0);
  assert.equal(await prisma.behavioralPattern.count({ where: { userId: user.a } }), 0);
});

test("refreshing twice at the same moment keeps the memory of when a belief began", async () => {
  const before = (await dnaRow("a"))!.signals;
  await refreshLearningDna(profile.a!, NOW);
  assert.deepEqual((await dnaRow("a"))!.signals, before);
});

test("Planner is not moved by Learning DNA, nor Learning DNA by Planner", async () => {
  const view = stripped(await dna(CHAT.a));
  const plan = stripped(await loadNovaPlanner(CHAT.a, { now: NOW }));
  await loadNovaPlanner(CHAT.a, { now: NOW, availableMinutes: 20 });
  await refreshLearningDna(profile.a!, NOW);
  assert.equal(stripped(await dna(CHAT.a)), view);
  assert.equal(stripped(await loadNovaPlanner(CHAT.a, { now: NOW })), plan);
});

// ── Lifetime ──────────────────────────────────────────────────────────────────

test("Learning DNA goes when its learner goes", async () => {
  assert.ok(await dnaRow("b"));
  await prisma.messengerUser.deleteMany({ where: { platformChatId: CHAT.b } });
  assert.equal(await prisma.novaLearningDNA.count({ where: { profileId: profile.b } }), 0);
});
