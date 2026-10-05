/**
 * Nova Notes — real Postgres integration test.
 *
 * Proves, against real tables:
 *   - a learner can create, read, edit, search, filter and delete their notes
 *   - no learner can reach another's note, by id or by filter
 *   - writing or editing a note changes nothing Nova believes: no memory, no
 *     reality, no pattern, no mastery, no cognitive state, no conversation
 *   - "Study this" is an ordinary session, and the session (not the note) is
 *     what updates Knowledge
 *   - deleting an account takes its Nova profile and notes with it
 *
 * No LLM is involved anywhere in this file.
 *
 * Run from packages/api:
 *   NOVA_TEST_DATABASE_URL=postgresql://... npm run test:integration
 */

import "./test-database.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

const { prisma }  = await import("@repo/db/client");
const { createNote, deleteNote, getNote, listNotes, resolveNoteLearner, updateNote } = await import("../product/notes.js");
const { NOTE_BODY_MAX, NOTE_TITLE_MAX } = await import("../product/notes.types.js");
const { runNovaSessionCommand } = await import("../product/session.js");
const { loadNovaKnowledge }     = await import("../product/knowledge.js");
const { deleteAccount }         = await import("../../services/accountDeletion.service.js");

const STAMP = Date.now();
const CHAT  = { a: `nova_itest_notes_a_${STAMP}`, b: `nova_itest_notes_b_${STAMP}`, c: `nova_itest_notes_c_${STAMP}`, shared: `nova_itest_notes_s_${STAMP}` };
const profile: Record<string, string> = {};
const messenger: Record<string, string> = {};
const subject: Record<string, Record<string, string>> = {};
const webUser: Record<string, string> = {};

const made = async (profileId: string, raw: unknown) => {
  const res = await createNote(profileId, raw);
  assert.ok(res.ok, res.ok ? "" : `${res.error}: ${res.message}`);
  return res.note;
};

// Everything a note must never create or change, counted for one learner.
async function cognitiveState(key: "a" | "b") {
  const userId = messenger[key]!, profileId = profile[key]!;
  const [facts, realities, patterns, mastery, cognitive, dna, sessions, messages, jobs, memory, proactive] = await Promise.all([
    prisma.userFact.count({ where: { userId } }),
    prisma.userReality.count({ where: { userId } }),
    prisma.behavioralPattern.count({ where: { userId } }),
    prisma.novaTopicMastery.findMany({ where: { subject: { profileId } }, orderBy: { name: "asc" },
      select: { name: true, masteryProbability: true, reviewCount: true, nextReviewAt: true, lastStudiedAt: true, intervalDays: true } }),
    prisma.novaCognitiveState.findMany({ where: { profileId } }),
    prisma.novaLearningDNA.findMany({ where: { profileId } }),
    prisma.novaStudySession.count({ where: { profileId } }),
    prisma.companionMessage.count({ where: { userId } }),
    prisma.novaConsolidationJob.count({ where: { userId } }),
    prisma.memoryFact.count({ where: { userId } }),
    prisma.novaProactiveMessage.count({ where: { profileId } }),
  ]);
  return JSON.stringify({ facts, realities, patterns, mastery, cognitive, dna, sessions, messages, jobs, memory, proactive });
}

before(async () => {
  for (const [key, chat] of Object.entries(CHAT)) {
    const user = await prisma.messengerUser.create({
      data: {
        platform: "telegram", platformChatId: chat, persona: "nova",
        novaAcademicProfile: { create: { onboardingComplete: true, subjects: { create: [{ name: "Operating Systems" }, { name: "DBMS" }] } } },
      },
      select: { id: true, novaAcademicProfile: { select: { id: true, subjects: { select: { id: true, name: true } } } } },
    });
    messenger[key] = user.id;
    profile[key]   = user.novaAcademicProfile!.id;
    subject[key]   = Object.fromEntries(user.novaAcademicProfile!.subjects.map(s => [s.name, s.id]));
  }
});

after(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `@notes-itest-${STAMP}.local` } } });
  await prisma.messengerUser.deleteMany({ where: { platformChatId: { in: Object.values(CHAT) } } });
  await prisma.$disconnect();
});

// ── 1–4, 8. CRUD and association ──────────────────────────────────────────────

let deadlockNote = "";

test("a learner is resolved from their chat, and only an onboarded Nova learner has a notebook", async () => {
  assert.deepEqual(await resolveNoteLearner(CHAT.a), { status: "ready", profileId: profile.a });
  assert.deepEqual(await resolveNoteLearner("no_such_chat"), { status: "not_connected" });
});

test("create a note: the body is stored exactly as written", async () => {
  const body = "Deadlocks need four conditions:\n\n  1. mutual exclusion\n  2. hold and wait\n  3. no preemption\n  4. circular wait\n";
  const note = await made(profile.a!, { title: "  Deadlock   basics ", body, subjectId: subject.a!["Operating Systems"], topicName: " deadlocks " });
  deadlockNote = note.id;
  assert.equal(note.title, "Deadlock basics");
  assert.equal(note.body, body);
  assert.equal(note.subjectName, "Operating Systems");
  assert.equal(note.topicName, "deadlocks");
  assert.deepEqual(note.study, { available: true, blockedBy: null, minutes: 25 });

  const stored = await prisma.novaNote.findUniqueOrThrow({ where: { id: note.id } });
  assert.equal(stored.profileId, profile.a);
  assert.equal(stored.body, body);
});

test("read a note back", async () => {
  const note = await getNote(profile.a!, deadlockNote);
  assert.ok(note);
  assert.equal(note.title, "Deadlock basics");
  assert.match(note.body, /circular wait/);
});

test("a note needs no subject or topic, and is not given one", async () => {
  const loose = await made(profile.a!, { title: "Loose thought", body: "I hate studying OS in the morning." });
  assert.equal(loose.subjectId, null);
  assert.equal(loose.topicName, null);
  assert.deepEqual(loose.study, { available: false, blockedBy: "no_subject", minutes: 25 });
  const noTopic = await made(profile.a!, { title: "DBMS misc", body: "", subjectId: subject.a!["DBMS"] });
  assert.equal(noTopic.study.blockedBy, "no_topic");
});

test("a topic typed into a note does not become a mastery row", async () => {
  await made(profile.a!, { title: "Paging notes", body: "TLB, page tables", subjectId: subject.a!["Operating Systems"], topicName: "Paging" });
  assert.equal(await prisma.novaTopicMastery.count({ where: { subject: { profileId: profile.a } } }), 0);
  // …but it is offered as a topic in the pickers, because the learner used it.
  const view = await listNotes(profile.a!);
  assert.deepEqual(view.subjects.find(s => s.name === "Operating Systems")!.topics, ["deadlocks", "Paging"]);
});

test("update a note: only what is named changes", async () => {
  const res = await updateNote(profile.a!, deadlockNote, { topicName: "Deadlocks" });
  assert.ok(res.ok);
  assert.equal(res.note.topicName, "Deadlocks");
  assert.equal(res.note.title, "Deadlock basics");
  assert.match(res.note.body, /mutual exclusion/);

  const edited = await updateNote(profile.a!, deadlockNote, { body: "Four conditions. I finally understand deadlocks." });
  assert.ok(edited.ok);
  assert.equal(edited.note.body, "Four conditions. I finally understand deadlocks.");
  assert.equal(edited.note.topicName, "Deadlocks");
});

// ── 7, 11. Validation ─────────────────────────────────────────────────────────

test("a note cannot be filed under a subject that is not the learner's", async () => {
  const res = await createNote(profile.a!, { title: "x", body: "", subjectId: subject.b!["Operating Systems"] });
  assert.deepEqual(res.ok ? null : res.error, "unknown_subject");
  const moved = await updateNote(profile.a!, deadlockNote, { subjectId: subject.b!["DBMS"] });
  assert.deepEqual(moved.ok ? null : moved.error, "unknown_subject");
  assert.equal((await getNote(profile.a!, deadlockNote))!.subjectName, "Operating Systems");
  assert.deepEqual((await createNote(profile.a!, { title: "x", subjectId: "does-not-exist" })).ok, false);
});

test("size limits are enforced, and nothing oversized is stored", async () => {
  const before = await prisma.novaNote.count({ where: { profileId: profile.a } });
  const tooLong  = await createNote(profile.a!, { title: "t", body: "x".repeat(NOTE_BODY_MAX + 1) });
  const bigTitle = await createNote(profile.a!, { title: "x".repeat(NOTE_TITLE_MAX + 1) });
  const noTitle  = await createNote(profile.a!, { title: "   ", body: "text" });
  assert.deepEqual([tooLong.ok ? "" : tooLong.error, bigTitle.ok ? "" : bigTitle.error, noTitle.ok ? "" : noTitle.error],
    ["body_too_long", "title_too_long", "title_required"]);
  const grown = await updateNote(profile.a!, deadlockNote, { body: "x".repeat(NOTE_BODY_MAX + 1) });
  assert.equal(grown.ok ? "" : grown.error, "body_too_long");
  assert.equal(await prisma.novaNote.count({ where: { profileId: profile.a } }), before);

  const atLimit = await made(profile.a!, { title: "At the limit", body: "y".repeat(NOTE_BODY_MAX) });
  assert.equal(atLimit.body.length, NOTE_BODY_MAX);
  assert.equal(await deleteNote(profile.a!, atLimit.id), true);
});

// ── 9, 10. Search and filters ─────────────────────────────────────────────────

test("search is a case-insensitive substring of title or body", async () => {
  const titles = async (q: string) => (await listNotes(profile.a!, { q })).notes.map(n => n.title).sort();
  assert.deepEqual(await titles("DEADLOCK"), ["Deadlock basics"]);            // title
  assert.deepEqual(await titles("page tables"), ["Paging notes"]);            // body
  assert.deepEqual(await titles("os"), ["Loose thought"]);                    // "OS in the morning"
  assert.deepEqual(await titles("nothing matches this"), []);
  assert.deepEqual(await titles("  "), (await listNotes(profile.a!)).notes.map(n => n.title).sort());
  assert.deepEqual(await titles("%"), [], "a wildcard character is matched literally");
  assert.deepEqual(await titles("_"), []);
  assert.deepEqual(await titles("dead_ock"), []);
  const odd = await made(profile.a!, { title: "50% rule", body: "snake_case and a\\backslash", topicName: null });
  assert.deepEqual(await titles("50%"), ["50% rule"]);
  assert.deepEqual(await titles("snake_case"), ["50% rule"]);
  assert.deepEqual(await titles("a\\back"), ["50% rule"]);
  assert.equal(await deleteNote(profile.a!, odd.id), true);
});

test("the list carries a preview, never the full body, and reports the total", async () => {
  await made(profile.a!, { title: "Long one", body: "word ".repeat(400), subjectId: subject.a!["DBMS"], topicName: "Normalization" });
  const view = await listNotes(profile.a!, { q: "long one" });
  assert.equal(view.notes.length, 1);
  assert.equal(view.total, 5, "the total is every note, whatever the search");
  assert.equal("body" in view.notes[0]!, false);
  assert.ok(view.notes[0]!.preview.length <= 181);
  assert.deepEqual(Object.keys(view.notes[0]!).sort(), ["createdAt", "id", "preview", "subjectId", "subjectName", "title", "topicName", "updatedAt"]);
});

test("filter by subject and by topic, most recently updated first", async () => {
  const os = await listNotes(profile.a!, { subjectId: subject.a!["Operating Systems"] });
  assert.deepEqual(os.notes.map(n => n.title).sort(), ["Deadlock basics", "Paging notes"]);
  const topic = await listNotes(profile.a!, { subjectId: subject.a!["Operating Systems"], topic: "deadlocks" });
  assert.deepEqual(topic.notes.map(n => n.title), ["Deadlock basics"]);
  const both = await listNotes(profile.a!, { topic: "PAGING", q: "tlb" });
  assert.deepEqual(both.notes.map(n => n.title), ["Paging notes"]);
  const all = (await listNotes(profile.a!)).notes;
  assert.deepEqual(all.map(n => n.updatedAt), [...all.map(n => n.updatedAt)].sort().reverse());
});

// ── 5, 6. Ownership ───────────────────────────────────────────────────────────

test("learner B cannot read, change, or delete learner A's note", async () => {
  const before = await prisma.novaNote.findUniqueOrThrow({ where: { id: deadlockNote } });

  assert.equal(await getNote(profile.b!, deadlockNote), null);
  const edit = await updateNote(profile.b!, deadlockNote, { title: "Taken over", body: "rewritten" });
  assert.equal(edit.ok ? "" : edit.error, "not_found");
  assert.equal(await deleteNote(profile.b!, deadlockNote), false);

  const after = await prisma.novaNote.findUniqueOrThrow({ where: { id: deadlockNote } });
  assert.deepEqual(after, before, "the note is untouched");
});

test("ownership cannot be reassigned through an edit or a create", async () => {
  const forged = await updateNote(profile.a!, deadlockNote, { title: "Deadlock basics", profileId: profile.b, userId: messenger.b, id: "other" } as never);
  assert.ok(forged.ok);
  assert.equal((await prisma.novaNote.findUniqueOrThrow({ where: { id: deadlockNote } })).profileId, profile.a);

  const planted = await made(profile.b!, { title: "B's own", body: "private to B", profileId: profile.a, subjectId: subject.b!["DBMS"], topicName: "Deadlocks" } as never);
  assert.equal((await prisma.novaNote.findUniqueOrThrow({ where: { id: planted.id } })).profileId, profile.b);
});

test("B's list, search and filters never reach A's notes, even with A's subject id or topic", async () => {
  const mine = (await listNotes(profile.b!)).notes.map(n => n.title);
  assert.deepEqual(mine, ["B's own"]);
  assert.equal((await listNotes(profile.b!)).total, 1);
  assert.deepEqual((await listNotes(profile.b!, { q: "deadlock" })).notes, []);
  assert.deepEqual((await listNotes(profile.b!, { subjectId: subject.a!["Operating Systems"] })).notes, [], "A's subject id");
  assert.deepEqual((await listNotes(profile.b!, { topic: "Deadlocks" })).notes.map(n => n.title), ["B's own"], "the topic filter stays inside B's notes");
  assert.deepEqual((await listNotes(profile.b!, { topic: "Paging" })).notes, []);
  // And A does not see B's.
  assert.equal((await listNotes(profile.a!, { q: "private to B" })).notes.length, 0);
  // The pickers offer only the learner's own subjects and topic names.
  const options = (await listNotes(profile.b!)).subjects;
  assert.deepEqual(options.map(s => s.id).sort(), Object.values(subject.b!).sort());
  assert.deepEqual(options.flatMap(s => s.topics), ["Deadlocks"]);
});

// ── 12–17. A note is not memory, reality, pattern, mastery or evidence ────────

test("writing and editing notes changes nothing Nova believes about the learner", async () => {
  const before = await cognitiveState("a");

  // Sentences that would each become durable state if they were said to Nova
  // in conversation: a preference, a circumstance, a mastery claim, a study
  // report, a commitment, a correct technical statement.
  const lines = [
    "I hate studying OS in the morning.",
    "I've got the flu and I'm working night shifts this month.",
    "I finally understand deadlocks. I know this cold now.",
    "Today I studied Deadlocks for two hours and finished chapter 6.",
    "I will revise paging every day this week, I promise.",
    "Deadlocks use mutual exclusion, hold-and-wait, no preemption and circular wait.",
    "I keep skipping sessions and making excuses. I'm so behind.",
  ];
  const created = [];
  for (const [i, line] of lines.entries()) {
    created.push(await made(profile.a!, { title: `Boundary ${i}`, body: line, subjectId: subject.a!["Operating Systems"], topicName: "Deadlocks" }));
  }
  assert.equal(await cognitiveState("a"), before, "creating notes");

  for (const note of created) {
    const res = await updateNote(profile.a!, note.id, { body: `${lines.join("\n")}\n(edited)`, topicName: "Banker's Algorithm" });
    assert.ok(res.ok);
  }
  assert.equal(await cognitiveState("a"), before, "editing notes");

  await listNotes(profile.a!, { q: "understand" });
  await getNote(profile.a!, created[0]!.id);
  for (const note of created) assert.equal(await deleteNote(profile.a!, note.id), true);
  assert.equal(await cognitiveState("a"), before, "reading, searching and deleting notes");

  // Spelled out, for the tables that matter most:
  assert.equal(await prisma.userFact.count({ where: { userId: messenger.a } }), 0);
  assert.equal(await prisma.userReality.count({ where: { userId: messenger.a } }), 0);
  assert.equal(await prisma.behavioralPattern.count({ where: { userId: messenger.a } }), 0);
  assert.equal(await prisma.novaTopicMastery.count({ where: { subject: { profileId: profile.a } } }), 0);
  assert.equal(await prisma.novaCognitiveState.count({ where: { profileId: profile.a } }), 0);
  assert.equal(await prisma.novaLearningDNA.count({ where: { profileId: profile.a } }), 0);
  assert.equal(await prisma.companionMessage.count({ where: { userId: messenger.a } }), 0, "note text never became a message to Nova");
  assert.equal(await prisma.novaConsolidationJob.count({ where: { userId: messenger.a } }), 0, "nothing entered consolidation");
});

// ── 18–21. Study this ─────────────────────────────────────────────────────────

test("Study this is an ordinary session on the note's subject and topic, and the session is what updates Knowledge", async () => {
  const note = (await getNote(profile.a!, deadlockNote))!;
  assert.equal(note.study.available, true);
  const knowledgeBefore = await loadNovaKnowledge(CHAT.a);
  assert.ok(knowledgeBefore.status === "ready");
  assert.equal(knowledgeBefore.totals.topicCount, 0, "the note alone put nothing in Knowledge");

  // What the page sends: the note's own subject and topic, through the session route's command.
  const start = { action: "start" as const, topicName: note.topicName!, subjectName: note.subjectName!, plannedMinutes: note.study.minutes };
  const t0 = new Date(Date.now() - 30 * 60_000);
  const [first, second] = await Promise.all([runNovaSessionCommand(CHAT.a, start, t0), runNovaSessionCommand(CHAT.a, start, t0)]);
  assert.ok(first.ok && second.ok);
  const open = await prisma.novaStudySession.findMany({ where: { profileId: profile.a, status: { in: ["in_progress", "paused"] } } });
  assert.equal(open.length, 1, "exactly one session");
  assert.equal(open[0]!.subjectId, subject.a!["Operating Systems"]);
  assert.equal(open[0]!.topicName, "Deadlocks");
  assert.equal(open[0]!.plannedDurationMinutes, 25);
  assert.equal((await listNotes(profile.a!)).activeSession?.topicName, "Deadlocks");

  // Starting changed nothing in Knowledge either. Ending, with an answer, does.
  assert.equal(await prisma.novaTopicMastery.count({ where: { subject: { profileId: profile.a } } }), 0);
  const ended = await runNovaSessionCommand(CHAT.a, { action: "end", outcome: "good" });
  assert.ok(ended.ok && ended.ended);
  assert.equal(ended.ended.topicRecorded, true);

  const knowledge = await loadNovaKnowledge(CHAT.a);
  assert.ok(knowledge.status === "ready");
  const topic = knowledge.subjects.find(s => s.subjectName === "Operating Systems")!.topics.find(t => t.topicName === "Deadlocks")!;
  assert.equal(topic.masteryPercent, 75);
  assert.equal(topic.reviewCount, 1);
  assert.equal(topic.reviewState, "scheduled");
  assert.equal(topic.recentSessions[0]!.outcome, "good");
  const report = (await prisma.novaStudySession.findFirstOrThrow({ where: { profileId: profile.a, status: "completed" } })).executionReport as { evidenceBasis: string };
  assert.equal(report.evidenceBasis, "learner_outcome");
});

test("after that, editing the note still does not move the topic", async () => {
  const before = await prisma.novaTopicMastery.findFirstOrThrow({ where: { name: "Deadlocks", subject: { profileId: profile.a } } });
  const res = await updateNote(profile.a!, deadlockNote, { body: "I have completely mastered deadlocks. 100%. Crushed it." });
  assert.ok(res.ok);
  await made(profile.a!, { title: "Another on deadlocks", body: "struggling badly, I don't get any of this", subjectId: subject.a!["Operating Systems"], topicName: "Deadlocks" });
  const after = await prisma.novaTopicMastery.findFirstOrThrow({ where: { id: before.id } });
  assert.deepEqual(after, before);
});

test("the note outlives its subject being removed, unfiled rather than deleted", async () => {
  const note = await made(profile.b!, { title: "Under DBMS", body: "keep me", subjectId: subject.b!["DBMS"], topicName: "Joins" });
  await prisma.novaSubject.delete({ where: { id: subject.b!["DBMS"] } });
  const kept = await getNote(profile.b!, note.id);
  assert.ok(kept, "the learner's text is not lost");
  assert.equal(kept.subjectId, null);
  assert.equal(kept.study.blockedBy, "no_subject");
});

// ── 4. Delete ─────────────────────────────────────────────────────────────────

test("delete removes that note and only that note", async () => {
  const before = await prisma.novaNote.count({ where: { profileId: profile.a } });
  const doomed = await made(profile.a!, { title: "Throwaway", body: "x" });
  assert.equal(await deleteNote(profile.a!, doomed.id), true);
  assert.equal(await getNote(profile.a!, doomed.id), null);
  assert.equal(await deleteNote(profile.a!, doomed.id), false, "deleting twice finds nothing");
  assert.equal(await prisma.novaNote.count({ where: { profileId: profile.a } }), before);
});

// ── 22, 23. Account deletion ──────────────────────────────────────────────────

async function webAccount(key: string, chat: string | null) {
  const user = await prisma.user.create({ data: { email: `${key}@notes-itest-${STAMP}.local`, name: key } });
  await prisma.userProfile.create({ data: { userId: user.id, onboardingComplete: true, primaryPersona: "nova", telegramChatId: chat, telegramConnected: chat !== null } });
  webUser[key] = user.id;
  return user.id;
}

test("deleting an account removes its Nova profile and every note in it", async () => {
  const userId = await webAccount("c", CHAT.c);
  await made(profile.c!, { title: "Private", body: "something personal", subjectId: subject.c!["DBMS"], topicName: "Indexes" });
  await made(profile.c!, { title: "Also private", body: "more" });
  await runNovaSessionCommand(CHAT.c, { action: "start", topicName: "Indexes", subjectName: "DBMS", plannedMinutes: 25 }, new Date(Date.now() - 600_000));
  await runNovaSessionCommand(CHAT.c, { action: "end", outcome: "okay" });
  assert.equal(await prisma.novaNote.count({ where: { profileId: profile.c } }), 2);

  const result = await deleteAccount(userId);
  assert.deepEqual(result, { deleted: true, novaProfileRemoved: true, novaProfileKept: null });

  assert.equal(await prisma.user.count({ where: { id: userId } }), 0);
  assert.equal(await prisma.userProfile.count({ where: { userId } }), 0);
  assert.equal(await prisma.novaAcademicProfile.count({ where: { id: profile.c } }), 0);
  assert.equal(await prisma.novaNote.count({ where: { profileId: profile.c } }), 0);
  assert.equal(await prisma.novaStudySession.count({ where: { profileId: profile.c } }), 0);
  assert.equal(await prisma.novaSubject.count({ where: { profileId: profile.c } }), 0);
  assert.equal(await prisma.novaTopicMastery.count({ where: { subjectId: { in: Object.values(subject.c!) } } }), 0);
});

test("no note is left without an owner anywhere in the database", async () => {
  const orphans = await prisma.$queryRaw<Array<{ n: bigint }>>`
    select count(*) as n from "NovaNote" note
    left join "NovaAcademicProfile" p on p.id = note."profileId"
    where p.id is null`;
  assert.equal(Number(orphans[0]!.n), 0);
});

test("other learners' notes are untouched by that deletion", async () => {
  assert.ok((await prisma.novaNote.count({ where: { profileId: profile.a } })) >= 4);
  assert.ok((await prisma.novaNote.count({ where: { profileId: profile.b } })) >= 2);
});

test("an account with no linked chat deletes cleanly", async () => {
  const userId = await webAccount("nochat", null);
  assert.deepEqual(await deleteAccount(userId), { deleted: true, novaProfileRemoved: false, novaProfileKept: "no_linked_chat" });
  assert.equal(await prisma.user.count({ where: { id: userId } }), 0);
});

test("a chat linked to two accounts is not wiped by deleting one of them", async () => {
  const first  = await webAccount("shared1", CHAT.shared);
  const second = await webAccount("shared2", CHAT.shared);
  await made(profile.shared!, { title: "Shared learner's note", body: "still needed" });

  const one = await deleteAccount(first);
  assert.deepEqual(one, { deleted: true, novaProfileRemoved: false, novaProfileKept: "chat_shared_with_another_account" });
  assert.equal(await prisma.novaNote.count({ where: { profileId: profile.shared } }), 1, "the other account still has its learner");

  // The last account linked to it takes the learner with it.
  const two = await deleteAccount(second);
  assert.equal(two.novaProfileRemoved, true);
  assert.equal(await prisma.novaNote.count({ where: { profileId: profile.shared } }), 0);
});
