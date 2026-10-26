/**
 * Capturing into Notes and studying a note with Nova — real Postgres.
 *
 * The capture page's own builders (product/note-capture.ts) played through
 * the notes functions the routes call. Proves one notes system: a captured
 * passage is an ordinary note, listed and searchable by its source, a retry
 * of the same capture makes one note, adding to a note keeps what it had
 * (and a stale add is refused, then made against the note as it is), and the
 * tutor reads the note as saved (the passage found, its heading named, the
 * version said) with the model stood in. Another learner's note is not
 * reachable by the tutor or the notes functions.
 *
 *   NOVA_TEST_DATABASE_URL=postgresql://... npx tsx --test src/nova/__integration__/nova-notes-tutor.itest.ts
 */

import "./test-database.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";

process.env.TELEGRAM_BOT_TOKEN = "";
process.env.GEMINI_API_KEY = "";
process.env.OPENAI_API_KEY = "";

const { prisma } = await import("@repo/db/client");
const { ensureSetupProfile } = await import("../product/setup.js");
const { createNote, getNote, listNotes, updateNote } = await import("../product/notes.js");
const { appendToBody, captureBody, captureTitle, readNoteCapture, noteCaptureFragment } = await import("../product/note-capture.js");
const { tutorOnNote } = await import("../product/note-tutor.js");

const STAMP = Date.now();
const ids: string[] = [];
let n = 0;

async function learner() {
  const id = `web:notestutor_${STAMP}_${n++}`;
  ids.push(id);
  await prisma.messengerUser.create({ data: { platform: "web", platformChatId: id, persona: "nova", displayName: "Asha" } });
  const profileId = (await ensureSetupProfile(id))!.profileId;
  await prisma.novaAcademicProfile.update({ where: { id: profileId }, data: { onboardingComplete: true } });
  return { id, profileId };
}

after(async () => {
  await prisma.messengerUser.deleteMany({ where: { platformChatId: { in: ids } } });
  await prisma.$disconnect();
});

const capture = readNoteCapture(noteCaptureFragment({
  url: "https://example.edu/os/ch7", title: "Chapter 7: Deadlocks",
  text: "# Deadlocks\nA deadlock needs four conditions: mutual exclusion, hold and wait, no preemption and circular wait.\n\n## Avoidance\nThe banker's algorithm grants a request only if the state stays safe.",
  via: "extension",
}))!;

test("a captured passage is an ordinary note: listed, searchable by its source, and one note however often it is sent", async () => {
  const { profileId } = await learner();
  const input = { title: captureTitle(capture), body: captureBody(capture, "2026-10-26"), once: true };
  const first = await createNote(profileId, input);
  const again = await createNote(profileId, input);
  assert.ok(first.ok && again.ok);
  assert.equal(again.note.id, first.note.id, "a retry is the same note");
  assert.equal(await prisma.novaNote.count({ where: { profileId } }), 1);
  // Without `once`, an ordinary second save is a second note, as before.
  const plain = await createNote(profileId, { title: input.title, body: input.body });
  assert.ok(plain.ok && plain.note.id !== first.note.id);
  await prisma.novaNote.delete({ where: { id: plain.note.id } });

  const list = await listNotes(profileId, { q: "https://example.edu/os/ch7" });
  assert.deepEqual(list.notes.map(x => x.id), [first.note.id], "found by its source address");
  const note = await getNote(profileId, first.note.id);
  assert.ok(note!.body.startsWith("Source: Chapter 7: Deadlocks https://example.edu/os/ch7\n"));
  assert.ok(note!.body.includes("> A deadlock needs four conditions"), "the passage is kept, quoted");
});

test("adding to a note keeps what it had; a stale add writes nothing and is made again against the note as it is", async () => {
  const { profileId } = await learner();
  const made = await createNote(profileId, { title: "OS notes", body: "My own lines." });
  assert.ok(made.ok);
  const addition = captureBody(capture, "2026-10-26");
  // Someone edits the note in another tab after the capture page read it.
  const opened = made.note;
  const edited = await updateNote(profileId, opened.id, { body: "My own lines.\nAnd one more.", baseUpdatedAt: opened.updatedAt });
  assert.ok(edited.ok);
  const stale = await updateNote(profileId, opened.id, { body: appendToBody(opened.body, addition, "2026-10-26")!, baseUpdatedAt: opened.updatedAt });
  assert.equal(stale.ok, false);
  assert.equal(!stale.ok && stale.error, "conflict");
  const now = (await getNote(profileId, opened.id))!;
  const added = await updateNote(profileId, opened.id, { body: appendToBody(now.body, addition, "2026-10-26")!, baseUpdatedAt: now.updatedAt });
  assert.ok(added.ok);
  assert.ok(added.note.body.startsWith("My own lines.\nAnd one more.\n\n---\n\n*Added 2026-10-26*\n\nSource: "), "nothing lost, the capture after a divider");
});

test("the tutor reads the note as saved: the passage found under its heading, the version said, only the learner's notes as sources", async () => {
  const asha = await learner();
  const ravi = await learner();
  const note = await createNote(asha.profileId, { title: "Deadlocks", body: captureBody(capture, "2026-10-26") });
  const linked = await createNote(asha.profileId, { title: "Banker's algorithm", body: "Links back to [[Deadlocks]]." });
  const theirs = await createNote(ravi.profileId, { title: "Ravi's secret", body: "Not Asha's. [[Deadlocks]]" });
  assert.ok(note.ok && linked.ok && theirs.ok);

  const prompts: string[] = [];
  const generate = async (input: { prompt: string }) => {
    prompts.push(input.prompt);
    return JSON.stringify({ sections: [{ basis: "notes", heading: "Safe states", text: "Your note says a request is granted only if the state stays safe [S1]." }], steps: [], exercise: null, quiz: [], ideas: [], cards: [], verdict: null, organize: null, related: [{ source: "S2", why: "It is the algorithm." }], followUps: ["What is a safe state?"], notInSources: false });
  };
  const out = await tutorOnNote(asha.profileId, note.note.id, {
    mode: "explain", selection: "The banker's algorithm grants a request only if the state stays safe.", noteVersion: note.note.updatedAt,
  }, generate as never);
  assert.ok(out.ok);
  assert.deepEqual(out.passage, { text: "The banker's algorithm grants a request only if the state stays safe.", heading: "Avoidance", found: true });
  assert.equal(out.versionDiffers, false);
  assert.equal(out.sections[0]!.basis, "notes");
  assert.deepEqual(out.sources.map(s => s.title), ["Deadlocks", "Banker's algorithm"], "the linked note of theirs, never Ravi's");
  assert.ok(!prompts.join("\n").includes("Not Asha's"), "another learner's note never reaches the model");

  // The note changes after the page loaded it: the answer says so.
  await updateNote(asha.profileId, note.note.id, { body: `${note.note.body}\n\nMore.` });
  const later = await tutorOnNote(asha.profileId, note.note.id, { mode: "summary", noteVersion: note.note.updatedAt }, generate as never);
  assert.ok(later.ok && later.versionDiffers);

  // Ravi cannot reach Asha's note through the tutor, and nothing was written.
  const before = await prisma.novaNote.findMany({ where: { profileId: asha.profileId }, select: { id: true, updatedAt: true } });
  const denied = await tutorOnNote(ravi.profileId, note.note.id, { mode: "explain" }, generate as never);
  assert.deepEqual(denied, { ok: false, error: "not_found", message: "That note doesn't exist." });
  const afterRows = await prisma.novaNote.findMany({ where: { profileId: asha.profileId }, select: { id: true, updatedAt: true } });
  assert.deepEqual(afterRows, before, "the tutor wrote nothing");
});
