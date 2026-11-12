/**
 * Screenshots in notes, and given to Nova — real Postgres (12 Nov).
 *
 * Proves: a screenshot is stored on the learner's own note, checked by its
 * bytes (a PDF or a fake PNG is refused, an oversized one too); the same key
 * stores it once (a retry); its line in the note survives saving and reading
 * the note back (a refresh) and edits around it; what Nova is given is the
 * stored bytes, of this learner and this note only (another learner's image,
 * or one on another note, is "missing", never read); a removed note takes
 * its images with it, and an image that is gone is "missing", not an error.
 *
 *   NOVA_TEST_DATABASE_URL=postgresql://... npx tsx --test src/nova/__integration__/nova-note-images.itest.ts
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
const { saveNoteImage, readNoteImage, noteImagesForModel, imageRefsIn, NOTE_IMAGE_BYTES_MAX } = await import("../product/note-images.js");
const { applyEdits } = await import("../product/note-outline.js");

const STAMP = Date.now();
const ids: string[] = [];
let n = 0;
async function learner() {
  const id = `web:img_${STAMP}_${n++}`;
  ids.push(id);
  await prisma.messengerUser.create({ data: { platform: "web", platformChatId: id, persona: "nova", displayName: "Asha" } });
  const profileId = (await ensureSetupProfile(id))!.profileId;
  return { id, profileId };
}
after(async () => {
  await prisma.messengerUser.deleteMany({ where: { platformChatId: { in: ids } } });
  await prisma.$disconnect();
});

// A real 2×1 PNG.
const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000002000000010806000000f478d4fa0000000d49444154789c63f8cfc0f01f0005fe02fe0d4c4a4e0000000049454e44ae426082", "hex");
const b64 = (b: Buffer) => b.toString("base64");

test("a screenshot is stored on the learner's note, once, and its line survives saving, reading back and edits around it", async () => {
  const L = await learner();
  const made = await createNote(L.profileId, { title: "Lecture 4", body: "Graphs.\n\nMore later." });
  assert.ok(made.ok);
  const noteId = made.note.id;

  // Pasted twice (a retry with the same key): one image.
  const first = await saveNoteImage(L.profileId, { noteId, data: b64(PNG), clientKey: `note-image:${noteId}:k1` });
  const again = await saveNoteImage(L.profileId, { noteId, data: b64(PNG), clientKey: `note-image:${noteId}:k1` });
  assert.ok(first.ok && again.ok);
  assert.equal(first.image.id, again.image.id);
  assert.equal(await prisma.novaNoteImage.count({ where: { noteId } }), 1);
  assert.deepEqual([first.image.width, first.image.height], [2, 1]);

  // The page puts its line in and saves; a refresh reads the same text back.
  const line = `![Slide 4](${first.image.ref})`;
  const saved = await updateNote(L.profileId, noteId, { title: "Lecture 4", body: `Graphs.\n\n${line}\n\nMore later.`, baseUpdatedAt: made.note.updatedAt });
  assert.ok(saved.ok);
  const read = await getNote(L.profileId, noteId);
  assert.ok(read!.body.includes(line));
  assert.deepEqual((await readNoteImage(L.profileId, first.image.id))!.bytes, PNG);

  // Edits around it (as the editor's changes are applied) keep it.
  let body = read!.body;
  for (let i = 0; i < 5; i++) {
    const blocks = (await import("../product/note-outline.js")).noteBlocks(body);
    const last = blocks.at(-1)!;
    const r = applyEdits(body, [{ id: `e${i}`, op: "insert", start: last.end, end: last.end, before: "", after: `Added line ${i} about shortest paths.`, anchor: null, section: null, why: null }]);
    assert.ok(r.ok); body = r.body;
  }
  const after5 = await updateNote(L.profileId, noteId, { title: "Lecture 4", body, baseUpdatedAt: saved.note.updatedAt });
  assert.ok(after5.ok);
  assert.deepEqual(imageRefsIn((await getNote(L.profileId, noteId))!.body), [first.image.id]);
});

test("only real PNG, JPEG or WebP within the size limit is stored", async () => {
  const L = await learner();
  const made = await createNote(L.profileId, { title: "x", body: "x" });
  assert.ok(made.ok);
  const pdf = await saveNoteImage(L.profileId, { noteId: made.note.id, data: b64(Buffer.from("%PDF-1.7 fake")), clientKey: "note-image:x:pdf" });
  assert.ok(!pdf.ok && pdf.error === "unsupported");
  const fakePng = await saveNoteImage(L.profileId, { noteId: made.note.id, data: b64(Buffer.from("not really a png at all")), clientKey: "note-image:x:fake" });
  assert.ok(!fakePng.ok && fakePng.error === "unsupported");
  const big = await saveNoteImage(L.profileId, { noteId: made.note.id, data: b64(Buffer.concat([PNG, Buffer.alloc(NOTE_IMAGE_BYTES_MAX)])), clientKey: "note-image:x:big" });
  assert.ok(!big.ok && big.error === "too_large");
  assert.equal(await prisma.novaNoteImage.count({ where: { noteId: made.note.id } }), 0);
});

test("what Nova is given: the stored bytes of this learner's image on this note, and nothing else", async () => {
  const L = await learner(), M = await learner();
  const mine = await createNote(L.profileId, { title: "Mine", body: "x" });
  const other = await createNote(L.profileId, { title: "Other note", body: "y" });
  const theirs = await createNote(M.profileId, { title: "Theirs", body: "z" });
  assert.ok(mine.ok && other.ok && theirs.ok);
  const a = await saveNoteImage(L.profileId, { noteId: mine.note.id, data: b64(PNG), clientKey: "test-key:a" });
  const b = await saveNoteImage(L.profileId, { noteId: other.note.id, data: b64(PNG), clientKey: "test-key:b" });
  const c = await saveNoteImage(M.profileId, { noteId: theirs.note.id, data: b64(PNG), clientKey: "test-key:c" });
  assert.ok(a.ok && b.ok && c.ok);
  // Another learner can't store onto my note, or read my image.
  const intrude = await saveNoteImage(M.profileId, { noteId: mine.note.id, data: b64(PNG), clientKey: "test-key:d" });
  assert.ok(!intrude.ok && intrude.error === "not_found");
  assert.equal(await readNoteImage(M.profileId, a.image.id), null);

  const given = await noteImagesForModel(L.profileId, mine.note.id, [a.image.id, b.image.id, c.image.id]);
  assert.deepEqual(given.images.map(i => [i.id, i.mimeType, i.data]), [[a.image.id, "image/png", b64(PNG)]]);
  assert.deepEqual(given.missing, [b.image.id, c.image.id]);

  // A note that goes takes its images; asking for one then is "missing", not an error.
  await prisma.novaNote.delete({ where: { id: mine.note.id } });
  assert.equal(await prisma.novaNoteImage.count({ where: { id: a.image.id } }), 0);
  const gone = await noteImagesForModel(L.profileId, mine.note.id, [a.image.id]);
  assert.deepEqual([gone.images.length, gone.missing], [0, [a.image.id]]);
});
