/**
 * Drafts: the capture inbox — real Postgres.
 *
 * Proves: captures accumulate in one draft per reading session, each passage
 * keeping its own source; a retry or the same passage again adds nothing;
 * concurrent captures all land; a session gap or "new draft" starts another;
 * edits are guarded on the draft's version; discard and restore; merge into a
 * new note and into an existing one (nothing there is lost, a source is named
 * once, a double press makes one note); another learner reaches nothing.
 *
 *   NOVA_TEST_DATABASE_URL=postgresql://... npx tsx --test src/nova/__integration__/nova-capture-drafts.itest.ts
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
const { captureToDraft, currentDraft, editDraft, getDraft, listDrafts, mergeDraft, setDiscarded } = await import("../product/capture-drafts.js");
const { SESSION_GAP_MS } = await import("../product/capture-draft-rules.js");

const STAMP = Date.now();
const ids: string[] = [];
let n = 0;

async function learner() {
  const id = `web:drafts_${STAMP}_${n++}`;
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

let k = 0;
const key = () => `capture-key-${STAMP}-${k++}`;
const PAPER = { url: "https://arxiv.org/abs/1706.03762", title: "Attention Is All You Need" };
const DOCS  = { url: "https://pytorch.org/docs/stable/nn.html", title: "torch.nn" };

test("captures from one sitting accumulate in one draft, each keeping its own source", async () => {
  const { profileId } = await learner();
  const a = await captureToDraft(profileId, { key: key(), ...PAPER, text: "The Transformer relies entirely on attention." });
  const b = await captureToDraft(profileId, { key: key(), ...DOCS, text: "nn.MultiheadAttention allows the model to jointly attend." });
  const c = await captureToDraft(profileId, { key: key(), ...PAPER, text: "Scaled dot-product attention." });
  assert.ok(a.ok && b.ok && c.ok);
  assert.equal(a.draft.id, b.draft.id); assert.equal(b.draft.id, c.draft.id);
  const draft = (await getDraft(profileId, a.draft.id))!;
  assert.equal(draft.passages, 3); assert.equal(draft.sources, 2);
  assert.deepEqual(draft.items.map(i => i.url), [PAPER.url, DOCS.url, PAPER.url]);
  assert.ok(draft.items.every(i => i.capturedAt && i.title));
  assert.equal((await currentDraft(profileId)).current?.id, a.draft.id);
});

test("a retry and the same passage again add nothing; concurrent captures all land", async () => {
  const { profileId } = await learner();
  const same = { key: key(), ...PAPER, text: "Once." };
  const first = await captureToDraft(profileId, same);
  const retry = await captureToDraft(profileId, same);
  const again = await captureToDraft(profileId, { ...same, key: key() });
  assert.ok(first.ok && retry.ok && again.ok);
  assert.equal(retry.action, "already_in_draft"); assert.equal(again.action, "already_in_draft");
  const many = await Promise.all([1, 2, 3, 4, 5].map(i => captureToDraft(profileId, { key: key(), ...PAPER, text: `Passage ${i}` })));
  assert.ok(many.every(r => r.ok), JSON.stringify(many));
  assert.equal((await getDraft(profileId, first.draft.id))!.passages, 6);
});

test("a new sitting, or New draft, starts another draft", async () => {
  const { profileId } = await learner();
  const old = await captureToDraft(profileId, { key: key(), ...PAPER, text: "Yesterday." }, new Date(Date.now() - SESSION_GAP_MS - 60_000));
  const now = await captureToDraft(profileId, { key: key(), ...PAPER, text: "Today." });
  const fresh = await captureToDraft(profileId, { key: key(), ...DOCS, text: "Fresh.", newDraft: true });
  assert.ok(old.ok && now.ok && fresh.ok);
  assert.notEqual(old.draft.id, now.draft.id); assert.notEqual(now.draft.id, fresh.draft.id);
  assert.equal((await listDrafts(profileId)).length, 3);
});

test("edits are guarded on the version; discard and restore", async () => {
  const { profileId } = await learner();
  const a = await captureToDraft(profileId, { key: key(), ...PAPER, text: "One." });
  await captureToDraft(profileId, { key: key(), ...PAPER, text: "Two." });
  assert.ok(a.ok);
  const draft = (await getDraft(profileId, a.draft.id))!;
  const [one, two] = draft.items;
  const edited = await editDraft(profileId, draft.id, { version: draft.version, edits: [{ op: "edit", id: one!.id, text: "One, edited.", note: "My thought." }, { op: "move", id: two!.id, to: 0 }] });
  assert.ok(edited.ok);
  assert.deepEqual(edited.draft.items.map(i => i.text), ["Two.", "One, edited."]);
  const stale = await editDraft(profileId, draft.id, { version: draft.version, edits: [{ op: "remove", id: one!.id }] });
  assert.ok(!stale.ok && stale.error === "conflict" && stale.draft!.items.length === 2, "a stale edit removes nothing");
  assert.ok((await setDiscarded(profileId, draft.id, true)).ok);
  assert.equal((await listDrafts(profileId)).length, 0);
  assert.ok((await setDiscarded(profileId, draft.id, false)).ok);
  assert.equal((await listDrafts(profileId)).length, 1);
});

test("merge into a new note: one note, each source once; a double press makes one", async () => {
  const { profileId } = await learner();
  const a = await captureToDraft(profileId, { key: key(), ...PAPER, text: "Attention." });
  await captureToDraft(profileId, { key: key(), ...DOCS, text: "MultiheadAttention." });
  await captureToDraft(profileId, { key: key(), ...PAPER, text: "Positional encoding." });
  assert.ok(a.ok);
  const target = { kind: "new", title: "Attention reading" };
  const preview = await mergeDraft(profileId, a.draft.id, { target, preview: true, day: "2026-11-13" });
  assert.ok(preview.ok && preview.preview);
  assert.equal(await prisma.novaNote.count({ where: { profileId } }), 0, "a preview writes nothing");
  const version = (await getDraft(profileId, a.draft.id))!.version;
  const [m1, m2] = await Promise.all([mergeDraft(profileId, a.draft.id, { target, version, day: "2026-11-13" }), mergeDraft(profileId, a.draft.id, { target, version, day: "2026-11-13" })]);
  assert.ok(m1.ok && !m1.preview && m2.ok && !m2.preview);
  assert.equal(await prisma.novaNote.count({ where: { profileId } }), 1);
  const note = (await getNote(profileId, m1.noteId))!;
  assert.equal(note.body.split(`[View source](${PAPER.url})`).length - 1, 1);
  assert.equal(note.body.split(`[View source](${DOCS.url})`).length - 1, 1);
  assert.ok(note.body.indexOf("> Positional encoding.") < note.body.indexOf("torch.nn"), "a page's passages stay together");
  assert.equal((await getDraft(profileId, a.draft.id))!.status, "merged");
  assert.equal((await listDrafts(profileId)).length, 0);
});

test("merge into an existing note: nothing there is lost, a cited page joins its section, an edit in between survives", async () => {
  const { profileId } = await learner();
  const made = await createNote(profileId, { title: "Transformers", body: `# Transformers\n\n### ${PAPER.title}\n[View source](${PAPER.url}) · arxiv.org\n\n> Earlier passage.\n\n## My summary\n\nMine.` });
  assert.ok(made.ok);
  const a = await captureToDraft(profileId, { key: key(), ...PAPER, text: "New passage from the paper." });
  await captureToDraft(profileId, { key: key(), ...DOCS, text: "From the docs." });
  assert.ok(a.ok);
  const target = { kind: "existing", noteId: made.note.id };
  const preview = await mergeDraft(profileId, a.draft.id, { target, preview: true, day: "2026-11-13" });
  assert.ok(preview.ok && preview.preview);
  assert.deepEqual(preview.joined, [PAPER.title]);
  // The learner edits the note after the preview; the merge adds to that.
  const latest = (await getNote(profileId, made.note.id))!;
  assert.ok((await updateNote(profileId, made.note.id, { body: `${latest.body}\n\nTyped after the preview.`, baseUpdatedAt: latest.updatedAt })).ok);
  const version = (await getDraft(profileId, a.draft.id))!.version;
  const merged = await mergeDraft(profileId, a.draft.id, { target, version, day: "2026-11-13" });
  assert.ok(merged.ok && !merged.preview);
  const body = (await getNote(profileId, made.note.id))!.body;
  for (const kept of ["# Transformers", "> Earlier passage.", "## My summary", "Mine.", "Typed after the preview."]) assert.ok(body.includes(kept), kept);
  assert.equal(body.split(`[View source](${PAPER.url})`).length - 1, 1, "the paper is named once");
  assert.ok(body.indexOf("> New passage from the paper.") < body.indexOf("## My summary"), "it joined the paper's section");
  assert.ok(body.includes(`[View source](${DOCS.url})`));
});

test("another learner's draft can't be reached", async () => {
  const { profileId } = await learner();
  const other = await learner();
  const a = await captureToDraft(profileId, { key: key(), ...PAPER, text: "Mine." });
  assert.ok(a.ok);
  assert.equal(await getDraft(other.profileId, a.draft.id), null);
  assert.ok(!(await editDraft(other.profileId, a.draft.id, { version: 0, edits: [{ op: "rename", title: "x" }] })).ok);
  assert.ok(!(await setDiscarded(other.profileId, a.draft.id, true)).ok);
  assert.ok(!(await mergeDraft(other.profileId, a.draft.id, { target: { kind: "new", title: "x" } })).ok);
  assert.equal((await getDraft(profileId, a.draft.id))!.status, "open");
});
