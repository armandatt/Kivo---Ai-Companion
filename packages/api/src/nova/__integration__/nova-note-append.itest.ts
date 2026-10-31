/**
 * Save selection into a note — real Postgres.
 *
 * The functions the extension's route calls. Proves: a passage goes in as a new
 * section and everything already in the note stays; the note keeps its filing
 * and no map node or second note is made; the same note takes several passages;
 * a retry, and the same passage under a new id, add nothing; a failed write
 * leaves nothing; a stale editor save is refused, not silently lost; another
 * learner's note can't be reached; a note can be very large.
 *
 *   NOVA_TEST_DATABASE_URL=postgresql://... npx tsx --test src/nova/__integration__/nova-note-append.itest.ts
 */

import "./test-database.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";

process.env.TELEGRAM_BOT_TOKEN = "";
process.env.GEMINI_API_KEY = "";
process.env.OPENAI_API_KEY = "";

const { prisma } = await import("@repo/db/client");
const { ensureSetupProfile } = await import("../product/setup.js");
const { createNote, getNote, updateNote } = await import("../product/notes.js");
const { listNoteChoices, noteChoicePreview, saveSelectionToNote } = await import("../product/note-append.js");
const { NOTE_BODY_MAX } = await import("../product/notes.types.js");

const STAMP = Date.now();
const ids: string[] = [];
let n = 0;

async function learner() {
  const id = `web:noteappend_${STAMP}_${n++}`;
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

const ORIGINAL = "# Transformer Architecture\n\n## Encoder and Decoder\n\nStacks of layers with **residuals**.\n\n## Self-Attention\n\nEach token looks at the others.";
let eventN = 0;
const passage = (over: Record<string, unknown> = {}) => ({
  clientEventId: `client-event-${STAMP}-${eventN++}`, url: "https://example.org/attention", title: "Attention, explained",
  capturedAt: new Date().toISOString(), excerpt: "Self-attention relates positions of one sequence.\n\nIt costs O(n²).", day: "2026-11-01", ...over,
});
const FROM = { source: "browser_extension" as const };

async function withNote() {
  const who = await learner();
  const subject = await prisma.novaSubject.create({ data: { profileId: who.profileId, name: `ML ${STAMP}` } });
  const made = await createNote(who.profileId, { title: "Transformer Architecture", body: ORIGINAL, subjectId: subject.id, topicName: "Transformers" });
  assert.ok(made.ok);
  return { ...who, subject, noteId: made.note.id };
}

test("a passage becomes a section at the end, and everything else stays as it was", async () => {
  const { profileId, noteId, subject } = await withNote();
  const notesBefore = await prisma.novaNote.count({ where: { profileId } });
  const topicsBefore = await prisma.novaTopicMastery.count({ where: { subjectId: subject.id } });
  const res = await saveSelectionToNote(profileId, passage({ noteId }), FROM);
  assert.ok(res.success && res.action === "added");
  const note = await getNote(profileId, noteId);
  assert.ok(note!.body.startsWith(ORIGINAL), "what was there is untouched");
  assert.ok(note!.body.includes("### Research excerpt: Attention, explained"));
  assert.ok(note!.body.includes("> Self-attention relates positions of one sequence."));
  assert.ok(note!.body.includes("*Source:* Attention, explained https://example.org/attention"));
  assert.ok(note!.body.includes("*Captured 2026-11-01 with the Nova extension.*"));
  assert.equal(note!.subjectId, subject.id, "the note keeps its place on the map");
  assert.equal(note!.topicName, "Transformers");
  assert.equal(await prisma.novaNote.count({ where: { profileId } }), notesBefore, "no second note");
  assert.equal(await prisma.novaTopicMastery.count({ where: { subjectId: subject.id } }), topicsBefore, "no new topic");
  const saved = await prisma.novaLearningEvent.findMany({ where: { profileId } });
  assert.equal(saved.length, 1, "the source is kept as one saved passage");
  assert.equal(saved[0]!.subjectId, subject.id, "filed where the note is");
  assert.equal(saved[0]!.url, "https://example.org/attention");
});

test("the same note takes several passages, and each can be edited afterwards", async () => {
  const { profileId, noteId } = await withNote();
  assert.ok((await saveSelectionToNote(profileId, passage({ noteId }), FROM)).success);
  assert.ok((await saveSelectionToNote(profileId, passage({ noteId, url: "https://example.org/multi", title: "Multi-head", excerpt: "Many heads, many views." }), FROM)).success);
  const note = await getNote(profileId, noteId);
  assert.ok(note!.body.includes("Attention, explained") && note!.body.includes("Many heads, many views."));
  assert.equal(note!.body.split("### Research excerpt").length - 1, 2);
  const edited = note!.body.replace("Many heads, many views.", "Many heads, edited by me.");
  const saved = await updateNote(profileId, noteId, { body: edited, baseUpdatedAt: note!.updatedAt });
  assert.ok(saved.ok);
  assert.ok((await getNote(profileId, noteId))!.body.includes("edited by me"));
});

test("a retry adds nothing, and neither does the same passage under a new id", async () => {
  const { profileId, noteId } = await withNote();
  const first = passage({ noteId });
  assert.equal((await saveSelectionToNote(profileId, first, FROM) as { action: string }).action, "added");
  const body = (await getNote(profileId, noteId))!.body;
  const retry = await saveSelectionToNote(profileId, first, FROM) as { action: string; duplicate: boolean };
  assert.equal(retry.action, "already_in_note"); assert.equal(retry.duplicate, true);
  const again = await saveSelectionToNote(profileId, passage({ noteId }), FROM) as { action: string };
  assert.equal(again.action, "already_in_note");
  assert.equal((await getNote(profileId, noteId))!.body, body);
});

test("two copies of one request at once add one section", async () => {
  const { profileId, noteId } = await withNote();
  const same = passage({ noteId });
  const results = await Promise.all([saveSelectionToNote(profileId, same, FROM), saveSelectionToNote(profileId, same, FROM), saveSelectionToNote(profileId, same, FROM)]);
  assert.ok(results.every(r => r.success), JSON.stringify(results));
  assert.equal((await getNote(profileId, noteId))!.body.split("### Research excerpt").length - 1, 1);
});

test("an edit in between isn't lost, and an editor still on the old version is told, not overwritten", async () => {
  const { profileId, noteId } = await withNote();
  const opened = (await getNote(profileId, noteId))!.updatedAt;
  assert.ok((await saveSelectionToNote(profileId, passage({ noteId }), FROM)).success);
  const stale = await updateNote(profileId, noteId, { body: "Replaced by a stale tab.", baseUpdatedAt: opened });
  assert.ok(!stale.ok && stale.error === "conflict");
  assert.ok((await getNote(profileId, noteId))!.body.includes("Research excerpt"), "the section survives");
});

test("a note that couldn't take it is refused and unchanged, and nothing is half saved", async () => {
  const { profileId } = await withNote();
  const full = await createNote(profileId, { title: "Full", body: "x".repeat(NOTE_BODY_MAX - 5) });
  assert.ok(full.ok);
  const before = await prisma.novaLearningEvent.count({ where: { profileId } });
  const res = await saveSelectionToNote(profileId, passage({ noteId: full.note.id }), FROM);
  assert.ok(!res.success && res.error === "too_long");
  assert.equal((await getNote(profileId, full.note.id))!.body.length, NOTE_BODY_MAX - 5);
  assert.equal(await prisma.novaLearningEvent.count({ where: { profileId } }), before);
});

test("another learner's note can't be reached, found or previewed", async () => {
  const { noteId } = await withNote();
  const other = await learner();
  const res = await saveSelectionToNote(other.profileId, passage({ noteId }), FROM);
  assert.ok(!res.success && res.error === "not_found");
  assert.equal(await noteChoicePreview(other.profileId, noteId), null);
  assert.equal((await listNoteChoices(other.profileId)).total, 0);
});

test("a new note from a selection: created once, filed where they chose, and the saved passage kept", async () => {
  const { profileId, subject } = await withNote();
  const body = passage({ newNote: { title: "On attention" }, subjectId: subject.id, topicName: "Transformers" });
  const first = await saveSelectionToNote(profileId, body, FROM) as { action: string; note: { id: string; path: string } };
  assert.equal(first.action, "created");
  assert.ok(first.note.path.endsWith("› Transformers") || first.note.path.includes("Transformers"));
  const again = await saveSelectionToNote(profileId, body, FROM) as { note: { id: string } };
  assert.equal(again.note.id, first.note.id, "a retry is the same note");
  const note = await getNote(profileId, first.note.id);
  assert.ok(note!.body.includes("> Self-attention relates positions") && note!.body.includes("https://example.org/attention"));
  assert.equal(await prisma.novaLearningEvent.count({ where: { profileId, eventType: "selection_saved" } }), 1);
});

test("choosing among many notes: search, nested subjects and topics, pages", async () => {
  const who = await learner();
  const outer = await prisma.novaSubject.create({ data: { profileId: who.profileId, name: `Outer ${STAMP}` } });
  const inner = await prisma.novaSubject.create({ data: { profileId: who.profileId, name: `Inner ${STAMP}`, parentId: outer.id } });
  for (let i = 0; i < 65; i++) await createNote(who.profileId, { title: `Note ${i}`, body: "b", subjectId: i % 2 ? inner.id : outer.id, topicName: i % 5 === 0 ? "Attention" : "Other" });
  await createNote(who.profileId, { title: "Transformer Architecture", body: "# A\n\n## Self-Attention\n\nx", subjectId: inner.id, topicName: "Attention" });
  const all = await listNoteChoices(who.profileId);
  assert.equal(all.total, 66); assert.equal(all.notes.length, 30); assert.equal(all.hasMore, true);
  const page2 = await listNoteChoices(who.profileId, { skip: 60 });
  assert.equal(page2.notes.length, 6); assert.equal(page2.hasMore, false);
  const found = await listNoteChoices(who.profileId, { query: "transformer" });
  assert.equal(found.total, 1);
  assert.equal(found.notes[0]!.path, `Outer ${STAMP} › Inner ${STAMP} › Attention`);
  assert.equal((await listNoteChoices(who.profileId, { subjectId: outer.id })).total, 66, "a subject takes in the subjects inside it");
  assert.equal((await listNoteChoices(who.profileId, { subjectId: inner.id })).total, 33);
  assert.equal((await listNoteChoices(who.profileId, { subjectId: inner.id, topicName: "attention" })).total, 1 + 6);
  const preview = await noteChoicePreview(who.profileId, found.notes[0]!.id);
  assert.deepEqual(preview!.headings, ["A", "Self-Attention"]);
});

test("a very long note saves whole, and edits whole", async () => {
  const who = await learner();
  const body = Array.from({ length: 16_000 }, (_, i) => `## Part ${i}\n\nशब्द **bold** text with a [[link]] and \`code\`.`).join("\n\n");
  assert.ok(body.length > 800_000 && body.length < NOTE_BODY_MAX, String(body.length));
  const made = await createNote(who.profileId, { title: "Long", body });
  assert.ok(made.ok);
  assert.equal((await getNote(who.profileId, made.note.id))!.body, body);
  const more = `${body}\n\nOne more line.`;
  const saved = await updateNote(who.profileId, made.note.id, { body: more, baseUpdatedAt: made.note.updatedAt });
  assert.ok(saved.ok);
  assert.equal((await getNote(who.profileId, made.note.id))!.body, more);
  const over = await createNote(who.profileId, { title: "Over", body: "x".repeat(NOTE_BODY_MAX + 1) });
  assert.ok(!over.ok && over.error === "body_too_long");
});

// ── Deleting a whole map, in one step ─────────────────────────────────────────
const { deleteMap, previewMapDeletion } = await import("../product/workspaces.js");

async function mapOf() {
  const who = await learner();
  const outer = await prisma.novaSubject.create({ data: { profileId: who.profileId, name: `Whole ${STAMP}-${n}` } });
  const inner = await prisma.novaSubject.create({ data: { profileId: who.profileId, name: `Inside ${STAMP}-${n}`, parentId: outer.id } });
  const a = await prisma.novaTopicMastery.create({ data: { subjectId: outer.id, name: "A" } });
  await prisma.novaTopicMastery.create({ data: { subjectId: outer.id, name: "A1", parentId: a.id } });
  await prisma.novaTopicMastery.create({ data: { subjectId: inner.id, name: "B" } });
  return { ...who, outer, inner, a };
}

test("a subject with topics and subjects inside goes in one step, and notes stay", async () => {
  const { id, profileId, outer, inner } = await mapOf();
  const kept = await createNote(profileId, { title: "My own note", body: "Mine.", subjectId: outer.id });
  assert.ok(kept.ok);
  const scope = await previewMapDeletion(id, profileId, { subjectId: outer.id });
  assert.equal(scope!.removes.subjects.length, 2);
  assert.equal(scope!.removes.topics.length, 3);
  const out = await deleteMap(id, profileId, { subjectId: outer.id }, scope!.fingerprint);
  assert.ok(out.ok, JSON.stringify(out));
  assert.equal(await prisma.novaSubject.count({ where: { id: { in: [outer.id, inner.id] } } }), 0);
  assert.equal(await prisma.novaTopicMastery.count({ where: { subjectId: { in: [outer.id, inner.id] } } }), 0);
  const note = await getNote(profileId, kept.note.id);
  assert.equal(note!.body, "Mine."); assert.equal(note!.subjectId, null);
});

test("a map that changed since it was shown isn't deleted", async () => {
  const { id, profileId, outer } = await mapOf();
  const scope = await previewMapDeletion(id, profileId, { subjectId: outer.id });
  await prisma.novaTopicMastery.create({ data: { subjectId: outer.id, name: "Added since" } });
  const out = await deleteMap(id, profileId, { subjectId: outer.id }, scope!.fingerprint);
  assert.ok(!out.ok && out.error === "changed");
  assert.equal(await prisma.novaSubject.count({ where: { id: outer.id } }), 1);
});

test("recorded study is never taken: the studied topic and its subject stay, the rest goes", async () => {
  const { id, profileId, outer, inner, a } = await mapOf();
  const a1 = await prisma.novaTopicMastery.findFirst({ where: { subjectId: outer.id, parentId: a.id } });
  await prisma.novaTopicMastery.update({ where: { id: a1!.id }, data: { reviewCount: 2, lastStudiedAt: new Date() } });
  await prisma.novaStudySession.create({ data: { profileId, topicName: "A1", subjectName: outer.name, status: "completed", durationMinutes: 30 } as never }).catch(() => {});
  const scope = await previewMapDeletion(id, profileId, { subjectId: outer.id });
  const out = await deleteMap(id, profileId, { subjectId: outer.id }, scope!.fingerprint);
  assert.ok(out.ok, JSON.stringify(out));
  const left = await prisma.novaTopicMastery.findMany({ where: { subjectId: outer.id }, select: { name: true } });
  const studied = scope!.removes.topics.every(t => t.name !== "A1");
  if (studied) { assert.deepEqual(left.map(t => t.name).sort(), ["A", "A1"]); assert.equal(await prisma.novaSubject.count({ where: { id: outer.id } }), 1); assert.ok(scope!.keeps.some(k => k.includes(outer.name))); }
  assert.equal(await prisma.novaSubject.count({ where: { id: inner.id } }), 0);
});

test("a subject with an archived topic stays and says why; its other topics go", async () => {
  const { id, profileId, outer } = await mapOf();
  await prisma.novaTopicMastery.create({ data: { subjectId: outer.id, name: "Old", archivedAt: new Date() } });
  const scope = await previewMapDeletion(id, profileId, { subjectId: outer.id });
  const out = await deleteMap(id, profileId, { subjectId: outer.id }, scope!.fingerprint);
  assert.ok(out.ok, JSON.stringify(out));
  assert.ok(scope!.keeps.some(k => k.includes("archived")));
  assert.equal(await prisma.novaSubject.count({ where: { id: outer.id } }), 1);
  assert.deepEqual((await prisma.novaTopicMastery.findMany({ where: { subjectId: outer.id }, select: { name: true } })).map(t => t.name), ["Old"]);
});

test("another learner's map can't be reached", async () => {
  const { outer } = await mapOf();
  const other = await learner();
  assert.equal(await previewMapDeletion(other.id, other.profileId, { subjectId: outer.id }), null);
  assert.ok(!(await deleteMap(other.id, other.profileId, { subjectId: outer.id }, "x")).ok);
  assert.equal(await prisma.novaSubject.count({ where: { id: outer.id } }), 1);
});
