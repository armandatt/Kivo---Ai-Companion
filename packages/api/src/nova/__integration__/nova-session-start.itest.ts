/**
 * Nova session commands — real Postgres integration test.
 *
 * The invariant: one learner cannot have two open study sessions. It is held
 * by a row lock in Postgres, so it can only be proven against Postgres:
 * concurrent starts here are real concurrent transactions.
 *
 * Also runs one whole session through the web commands (start, pause, resume,
 * end) with nothing stood in, which is the path the unit tests cover against
 * an in-memory table.
 *
 * Run from packages/api (schema must already be pushed, see
 * nova-persist-turn.itest.ts):
 *   NOVA_TEST_DATABASE_URL=postgresql://... npm run test:integration
 */

import "./test-database.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

const { prisma }                = await import("@repo/db/client");
const { runNovaSessionCommand, loadNovaSession, saveReflection } = await import("../product/session.js");
const { loadFocusContext }      = await import("../product/focus-context.js");
const { openStudySession }      = await import("../persistence/nova-persistence.js");

const STAMP  = Date.now();
const CHAT_A = `nova_itest_start_a_${STAMP}`;
const CHAT_B = `nova_itest_start_b_${STAMP}`;
const profiles: Record<string, string> = {};
const users:    Record<string, string> = {};

const START = (topicName: string) =>
  ({ action: "start", topicName, subjectName: "Operating Systems", plannedMinutes: 25 } as const);

const openSessions = (chat: string) => prisma.novaStudySession.findMany({
  where:  { profileId: profiles[chat], status: { in: ["in_progress", "paused"] } },
  select: { id: true, topicName: true },
});
const closeAll = () => prisma.novaStudySession.updateMany({
  where: { profileId: { in: Object.values(profiles) } }, data: { status: "completed" },
});

before(async () => {
  for (const chat of [CHAT_A, CHAT_B]) {
    const user = await prisma.messengerUser.create({
      data: {
        platform: "telegram", platformChatId: chat, persona: "nova",
        novaAcademicProfile: {
          create: { onboardingComplete: true, subjects: { create: { name: "Operating Systems" } } },
        },
      },
      select: { id: true, novaAcademicProfile: { select: { id: true } } },
    });
    users[chat]    = user.id;
    profiles[chat] = user.novaAcademicProfile!.id;
  }
});

after(async () => {
  await prisma.messengerUser.deleteMany({ where: { platformChatId: { in: [CHAT_A, CHAT_B] } } });
  await prisma.$disconnect();
});

test("two start requests, one after the other, open one session", async () => {
  const first  = await runNovaSessionCommand(CHAT_A, START("Deadlocks"));
  const second = await runNovaSessionCommand(CHAT_A, START("Paging"));
  assert.ok(first.ok && second.ok);
  assert.equal(second.ok && second.session?.id, first.ok && first.session?.id, "the second start returns the first session");
  assert.deepEqual((await openSessions(CHAT_A)).map(s => s.topicName), ["Deadlocks"]);
  await closeAll();
});

test("start requests arriving together open one session", async () => {
  const results = await Promise.all(
    ["Deadlocks", "Paging", "Scheduling", "Threads", "Memory", "Files", "Sync", "IPC"]
      .map(topic => runNovaSessionCommand(CHAT_A, START(topic))),
  );
  assert.ok(results.every(r => r.ok), "every request gets an answer");
  const open = await openSessions(CHAT_A);
  assert.equal(open.length, 1, `expected one open session, found ${open.length}`);
  const ids = new Set(results.map(r => (r.ok ? r.session?.id : null)));
  assert.deepEqual([...ids], [open[0]!.id], "every request is told about the same session");
  await closeAll();
});

test("the writer itself holds the invariant, whoever calls it", async () => {
  // A chat turn (/study) and the web app both end up here.
  const now = new Date();
  await Promise.all(Array.from({ length: 12 }, (_, i) =>
    openStudySession(profiles[CHAT_A]!, `Topic ${i}`, [], now)));
  assert.equal((await openSessions(CHAT_A)).length, 1);
  await closeAll();
});

test("a start while a session is open, or paused, changes nothing", async () => {
  const first = await runNovaSessionCommand(CHAT_A, START("Deadlocks"));
  await runNovaSessionCommand(CHAT_A, { action: "pause" });
  const again = await runNovaSessionCommand(CHAT_A, START("Paging"));
  assert.ok(first.ok && again.ok);
  assert.equal(again.ok && again.session?.topicName, "Deadlocks");
  assert.equal(again.ok && again.session?.status, "paused");
  assert.equal((await openSessions(CHAT_A)).length, 1);
  await closeAll();
});

test("different learners start independently, even at the same moment", async () => {
  const [a, b] = await Promise.all([
    runNovaSessionCommand(CHAT_A, START("Deadlocks")),
    runNovaSessionCommand(CHAT_B, START("Paging")),
  ]);
  assert.ok(a.ok && b.ok);
  assert.deepEqual((await openSessions(CHAT_A)).map(s => s.topicName), ["Deadlocks"]);
  assert.deepEqual((await openSessions(CHAT_B)).map(s => s.topicName), ["Paging"]);
  await closeAll();
});

test("a whole session through the web commands, against the real tables", async () => {
  const t0 = new Date(Date.now() - 40 * 60_000);
  const at = (seconds: number) => new Date(t0.getTime() + seconds * 1000);

  const started = await runNovaSessionCommand(CHAT_A, START("Deadlocks"), t0);
  assert.ok(started.ok && started.session);
  assert.equal(started.session.plannedDurationMinutes, 25);
  assert.equal(started.session.subjectName, "Operating Systems");

  await runNovaSessionCommand(CHAT_A, { action: "pause" }, at(600));
  assert.equal((await loadNovaSession(CHAT_A, at(900)))!.elapsedSeconds, 600, "the clock stands still while paused");

  const resumed = await runNovaSessionCommand(CHAT_A, { action: "resume" }, at(647));   // a 47-second pause
  assert.ok(resumed.ok && resumed.session);
  assert.equal(resumed.session.elapsedSeconds, 600, "no jump on resume");
  assert.equal((await loadNovaSession(CHAT_A, at(707)))!.elapsedSeconds, 660, "a reload reads the same clock from the row");

  const ended = await runNovaSessionCommand(CHAT_A, { action: "end", outcome: "good" }, at(1847));
  assert.ok(ended.ok);
  const { sessionId: endedId, ...endedFacts } = (ended.ok && ended.ended) || { sessionId: null };
  assert.deepEqual(endedFacts, { topicName: "Deadlocks", minutes: 30, outcome: "good", topicRecorded: true, counted: true });
  assert.equal(ended.ok && ended.session, null);

  const row = await prisma.novaStudySession.findFirstOrThrow({
    where: { profileId: profiles[CHAT_A], topicName: "Deadlocks", executionReport: { not: undefined } },
    orderBy: { createdAt: "desc" },
  });
  assert.equal(endedId, row.id, "the ended session is named, so a note can be attached to it");
  assert.equal(row.status, "completed");
  assert.equal(row.durationMinutes, 30);
  assert.equal(row.totalPausedSeconds, 47);
  assert.equal(row.pauseCount, 1);
  assert.deepEqual(row.topicsCompleted, ["Deadlocks"]);
  assert.equal((row.executionReport as { actualDurationMinutes: number }).actualDurationMinutes, 30);

  // The same evidence /done leaves: the command in the log, and a completed
  // consolidation job that points at it.
  const message = await prisma.companionMessage.findFirstOrThrow({ where: { userId: users[CHAT_A], role: "user" } });
  assert.equal(message.intent, "study_report");
  assert.deepEqual((message.metadata as { signals: string[]; surface: string }).signals, ["study_report"]);
  assert.equal((message.metadata as { surface: string }).surface, "web");
  const job = await prisma.novaConsolidationJob.findUniqueOrThrow({ where: { messageId: message.id } });
  assert.equal(job.status, "completed");

  // Mastery was fed from the execution report.
  const subject = await prisma.novaSubject.findFirstOrThrow({ where: { profileId: profiles[CHAT_A] }, select: { id: true } });
  const mastery = await prisma.novaTopicMastery.findFirst({ where: { name: "Deadlocks", subjectId: subject.id } });
  assert.ok(mastery, "the session's topic has a mastery record");

  // A second end finds nothing to end and writes nothing.
  const again = await runNovaSessionCommand(CHAT_A, { action: "end", outcome: null }, at(1900));
  assert.equal(again.ok, false);
  assert.equal(await prisma.companionMessage.count({ where: { userId: users[CHAT_A], role: "user" } }), 1);
});

// ── The note after a session ──────────────────────────────────────────────────

test("a session note is written once, on the learner's own finished session, and read back beside the topic", async () => {
  const session = await prisma.novaStudySession.findFirstOrThrow({
    where: { profileId: profiles[CHAT_A], topicName: "Deadlocks", status: "completed", executionReport: { not: undefined } },
    orderBy: { createdAt: "desc" },
  });
  const note = { did: "Worked the banker's algorithm", blocked: "", next: "Two past questions" };
  const masteryBefore = await prisma.novaTopicMastery.findMany({ where: { subjectId: session.subjectId! }, orderBy: { id: "asc" } });

  // Another learner cannot attach a note to it, and nothing is written.
  assert.deepEqual(await saveReflection(CHAT_B, session.id, note), { ok: false, error: "not_found", message: "That session isn't on your record." });
  // Nor is an empty one kept.
  assert.equal((await saveReflection(CHAT_A, session.id, { did: " ", blocked: "", next: "" })).ok, false);
  assert.equal((await prisma.novaStudySession.findUniqueOrThrow({ where: { id: session.id } })).reflectionText, null);

  assert.deepEqual(await saveReflection(CHAT_A, session.id, note), { ok: true, saved: true });
  // A second save, and two at once, leave the first note as it was.
  const again = await Promise.all([
    saveReflection(CHAT_A, session.id, { ...note, did: "Something else" }),
    saveReflection(CHAT_A, session.id, { ...note, did: "And another" }),
  ]);
  assert.deepEqual(again, [{ ok: true, saved: false }, { ok: true, saved: false }]);
  assert.deepEqual(JSON.parse((await prisma.novaStudySession.findUniqueOrThrow({ where: { id: session.id } })).reflectionText!), note);

  // A session still running takes no note.
  const running = await runNovaSessionCommand(CHAT_A, START("Paging"));
  assert.ok(running.ok && running.session);
  assert.equal((await saveReflection(CHAT_A, running.session.id, note)).ok, false);
  await closeAll();

  // It is shown back beside the topic, to its owner only.
  const own = await loadFocusContext(CHAT_A, { subjectName: "Operating Systems", topicName: "deadlocks" });
  assert.ok(own.status === "ready" && own.lastNote);
  assert.deepEqual([own.lastNote.did, own.lastNote.blocked, own.lastNote.next], [note.did, "", note.next]);
  const other = await loadFocusContext(CHAT_B, { subjectName: "Operating Systems", topicName: "Deadlocks" });
  assert.ok(other.status === "ready");
  assert.equal(other.lastNote, null);

  // A note is words, not evidence: mastery and the review schedule are untouched.
  assert.deepEqual(await prisma.novaTopicMastery.findMany({ where: { subjectId: session.subjectId! }, orderBy: { id: "asc" } }), masteryBefore);
});
