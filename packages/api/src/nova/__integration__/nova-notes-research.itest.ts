/**
 * Nova's edits that stay saved, and research papers in Notes — real Postgres.
 *
 * Editing: a proposal from Nova's editor (the model stood in) applied the way
 * the notes page applies it (note-outline.ts applyEdits) and saved through the
 * guarded update it uses: the note as read back has the change, every other
 * section exactly as it was; the same apply again changes nothing; a proposal
 * made on an older version never overwrites what was saved since.
 *
 * Papers: an import (the sources' APIs stood in) makes one note through
 * createNote, filed under the subject and topic chosen, listed there, with
 * the paper's card, original link and text; a retry, or the same paper by
 * another link, returns that note; another learner cannot reach it; the
 * tutor is given the paper and told how much of it was imported; the editor
 * changes nothing of the paper's own text.
 *
 *   NOVA_TEST_DATABASE_URL=postgresql://... npx tsx --test src/nova/__integration__/nova-notes-research.itest.ts
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
const { applyEdits, noteSections } = await import("../product/note-outline.js");
const { proposeEdit } = await import("../product/note-edit.js");
const { tutorOnNote } = await import("../product/note-tutor.js");
const { importPaper, previewPaper } = await import("../product/paper-import.js");
const { paperRegion, readPaperCard } = await import("../product/paper-source.js");

const STAMP = Date.now();
const ids: string[] = [];
let n = 0;

async function learner() {
  const id = `web:research_${STAMP}_${n++}`;
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

// ── Edits that stay saved ─────────────────────────────────────────────────────

const SECTIONS = ["Motivation", "Self-Attention", "Multi-Head Attention", "Positional Encoding", "Encoder", "Decoder", "Positional Encoding Again", "Training Complexity", "Limitations", "Questions"];
const BODY = ["# Transformers", "", "Notes from week 6.", "",
  ...SECTIONS.flatMap(s => [`## ${s}`, s === "Limitations" ? "quadratic cost. long docs hard. needs lots of data" : `What I wrote about ${s.toLowerCase()}.`, ""])].join("\n");

const stub = (reply: unknown) => async () => JSON.stringify(reply);
const loadFrom = (profileId: string) => (p: string, id: string) => import("../product/notes.js").then(m => m.noteSources(p === profileId ? p : "nobody", id, { bodyMax: 50_000 }));

test("an approved edit changes the note itself, saved and read back, with every other section exactly as it was", async () => {
  const { profileId } = await learner();
  const made = await createNote(profileId, { title: "Transformers", body: BODY });
  assert.ok(made.ok);
  const before = made.note;
  // The editor proposes a rewrite of one section (the model stood in), on the saved version.
  const limitations = noteSections(BODY).find(s => s.title === "Limitations")!;
  const blocks = (await import("../product/note-outline.js")).noteBlocks(BODY);
  const para = blocks.find(b => b.start > limitations.start && b.kind === "para")!;
  const proposal = await proposeEdit(profileId, before.id, { kind: "custom", instruction: "Rewrite the Limitations section so it reads properly" },
    stub({ summary: "Proper sentences.", changes: [{ op: "replace", blocks: [para.id], text: "Self-attention costs grow quadratically with length, so long documents are hard, and training needs a lot of data.", why: "clearer" }] }),
    loadFrom(profileId));
  assert.ok(proposal.ok && proposal.changes.length === 1);
  assert.equal(proposal.noteVersion, before.updatedAt);

  // Applied as the page applies it, saved through the guarded update.
  const applied = applyEdits(before.body, proposal.changes);
  assert.ok(applied.ok);
  const saved = await updateNote(profileId, before.id, { body: applied.body, baseUpdatedAt: before.updatedAt });
  assert.ok(saved.ok);

  // Read back as a refresh reads it.
  const reread = await getNote(profileId, before.id);
  assert.ok(reread);
  assert.ok(reread.body.includes("costs grow quadratically"));
  assert.ok(!reread.body.includes("long docs hard"));
  for (const s of noteSections(BODY).filter(x => x.title !== "Limitations" && x.level === 2)) {
    assert.ok(reread.body.includes(BODY.slice(s.start, s.end)), `${s.title} is unchanged`);
  }
  assert.deepEqual(noteSections(reread.body).map(x => x.title), noteSections(BODY).map(x => x.title), "no section moved, added or lost");

  // The same apply again (a retried click): nothing changes.
  const again = applyEdits(reread.body, proposal.changes);
  assert.ok(again.ok && again.applied.length === 0 && again.body === reread.body);
});

test("a subsection added under its section, and a duplicate removed, each where it belongs and saved", async () => {
  const { profileId } = await learner();
  const made = await createNote(profileId, { title: "Transformers", body: BODY });
  assert.ok(made.ok);
  const blocks = (await import("../product/note-outline.js")).noteBlocks(BODY);
  const selfPara = blocks.find(b => b.text === "What I wrote about self-attention.")!;
  const dupHead = blocks.find(b => b.text === "## Positional Encoding Again")!;
  const dupPara = blocks.find(b => b.text === "What I wrote about positional encoding again.")!;
  const proposal = await proposeEdit(profileId, made.note.id, { kind: "custom", instruction: "Add scaled dot-product attention under Self-Attention, and remove the duplicate positional encoding section" },
    stub({ summary: "s", changes: [
      { op: "insert", after: selfPara.id, text: "### Scaled dot-product attention\n\n1. Score each query against every key.\n2. Scale by the square root of d_k.", why: "subsection" },
      { op: "delete", blocks: [dupHead.id, dupPara.id], why: "a repeat of Positional Encoding" },
    ] }), loadFrom(profileId));
  assert.ok(proposal.ok && proposal.changes.length === 2);
  const applied = applyEdits(made.note.body, proposal.changes);
  assert.ok(applied.ok);
  const saved = await updateNote(profileId, made.note.id, { body: applied.body, baseUpdatedAt: made.note.updatedAt });
  assert.ok(saved.ok);
  const titles = noteSections(saved.note.body).map(s => s.title);
  assert.ok(titles.indexOf("Scaled dot-product attention") === titles.indexOf("Self-Attention") + 1, "the subsection sits right under its section, not at the end");
  assert.ok(!titles.includes("Positional Encoding Again"));
  assert.ok(saved.note.body.trimEnd().endsWith("## Questions\nWhat I wrote about questions."), "the end of the note is as it was");
});

test("a proposal made on an older version never overwrites what was saved since", async () => {
  const { profileId } = await learner();
  const made = await createNote(profileId, { title: "Transformers", body: BODY });
  assert.ok(made.ok);
  const blocks = (await import("../product/note-outline.js")).noteBlocks(BODY);
  const para = blocks.find(b => b.text.startsWith("quadratic cost"))!;
  const proposal = await proposeEdit(profileId, made.note.id, { kind: "custom", instruction: "rewrite limitations" },
    stub({ summary: "s", changes: [{ op: "replace", blocks: [para.id], text: "Rewritten limitations.", why: "w" }] }), loadFrom(profileId));
  assert.ok(proposal.ok);
  // Meanwhile the learner rewrote that very passage, in another tab, and saved.
  const theirs = await updateNote(profileId, made.note.id, { body: BODY.replace("quadratic cost. long docs hard.", "My own new wording."), baseUpdatedAt: made.note.updatedAt });
  assert.ok(theirs.ok);
  // The page applies to the text as it now stands: refused, nothing written.
  assert.deepEqual(applyEdits(theirs.note.body, proposal.changes), { ok: false, conflicts: ["e1"] });
  // A save from a tab still holding the old version is refused too.
  const stale = await updateNote(profileId, made.note.id, { body: applyEdits(BODY, proposal.changes).ok ? "x" : "", baseUpdatedAt: made.note.updatedAt });
  assert.ok(!stale.ok && stale.error === "conflict");
  assert.ok((await getNote(profileId, made.note.id))!.body.includes("My own new wording."));
});

// ── Research papers ───────────────────────────────────────────────────────────

const ATOM = `<feed><entry><id>http://arxiv.org/abs/1706.03762v7</id><published>2017-06-12T17:57:34Z</published><title>Attention Is All You Need</title>
<summary>The dominant sequence transduction models are based on recurrent networks.</summary><author><name>Ashish Vaswani</name></author></entry></feed>`;
const HTML = `<article><section><h2>1 Introduction</h2><div class="ltx_para"><p>Recurrent models compute hidden states <math alttext="h_t"></math>.</p></div>
<div class="ltx_para"><p>Attention draws global dependencies.</p></div><div class="ltx_para"><p>The Transformer reaches a new state of the art.</p></div></section>
<section><h2>3 Model Architecture</h2><div class="ltx_para"><p>The encoder maps an input sequence to continuous representations.</p></div></section></article>`;
const ok = (body: string, type: string) => ({ status: 200, type, body: Buffer.from(body), url: "x" });
let fetches = 0;
const get = async (url: string) => {
  fetches++;
  if (url.startsWith("https://export.arxiv.org/api/query")) return ok(ATOM, "application/atom+xml");
  if (url.startsWith("https://arxiv.org/html/1706.03762")) return ok(HTML, "text/html");
  if (url.startsWith("https://api.semanticscholar.org/")) return ok(JSON.stringify({ title: "Attention", externalIds: { ArXiv: "1706.03762" } }), "application/json");
  return { status: 404, type: "text/plain", body: Buffer.from(""), url };
};

test("a paper imported under a subject and topic: one note, filed there, with its card, original link and text; a retry or another link to it returns that note", async () => {
  const { profileId } = await learner();
  const subject = await prisma.novaSubject.create({ data: { profileId, name: "AI Engineering" } });
  const preview = await previewPaper(profileId, { url: "https://arxiv.org/abs/1706.03762" }, get);
  assert.ok(preview.ok && preview.status === "full" && preview.existing === null);
  assert.equal(await prisma.novaNote.count({ where: { profileId } }), 0, "a preview makes nothing");

  const imported = await importPaper(profileId, { url: "https://arxiv.org/pdf/1706.03762v7", subjectId: subject.id, topicName: "Agents + Workflows" }, get);
  assert.ok(imported.ok && !imported.existing && imported.status === "full");
  const note = await getNote(profileId, imported.noteId);
  assert.ok(note);
  assert.equal(note.title, "Attention Is All You Need");
  assert.equal(note.subjectId, subject.id);
  assert.equal(note.topicName, "Agents + Workflows");
  assert.ok(note.body.includes("> **Source:** https://arxiv.org/abs/1706.03762"));
  assert.ok(note.body.includes("## 1 Introduction") && note.body.includes("$h_t$"));
  assert.equal(readPaperCard(note.body)?.card.status, "full");
  const listed = await listNotes(profileId, { subjectId: subject.id, topic: "Agents + Workflows" });
  assert.deepEqual(listed.notes.map(x => x.id), [note.id], "listed where it was filed");
  assert.deepEqual((await listNotes(profileId, { q: "transduction" })).notes.map(x => x.id), [note.id], "searchable");

  const retry = await importPaper(profileId, { url: "https://arxiv.org/abs/1706.03762" }, get);
  const viaS2 = await importPaper(profileId, { url: "https://www.semanticscholar.org/paper/204e3073870fae3d05bcbc2f6a8e263d9b72e776" }, get);
  assert.ok(retry.ok && retry.existing && retry.noteId === note.id);
  assert.ok(viaS2.ok && viaS2.existing && viaS2.noteId === note.id);
  assert.equal(await prisma.novaNote.count({ where: { profileId } }), 1, "one note for one paper");
  const p2 = await previewPaper(profileId, { url: "1706.03762" }, get);
  assert.ok(p2.ok && p2.existing?.id === note.id);

  // Another learner: a subject not theirs is refused, and the paper is theirs to import separately.
  const other = await learner();
  const refused = await importPaper(other.profileId, { url: "1706.03762", subjectId: subject.id }, get);
  assert.ok(!refused.ok && refused.error === "unknown_subject");
  assert.equal(await getNote(other.profileId, note.id), null);
});

test("the tutor is given the paper and told how much was imported; the editor changes nothing of the paper's own text", async () => {
  const { profileId } = await learner();
  const imported = await importPaper(profileId, { url: "1706.03762" }, get);
  assert.ok(imported.ok);
  let prompt = "";
  const reply = await tutorOnNote(profileId, imported.noteId, { mode: "explain", message: "What is the main contribution?" },
    async (req: { prompt: string }) => { prompt = req.prompt; return JSON.stringify({ sections: [{ basis: "notes", heading: null, text: "The paper says attention replaces recurrence [S1].", refs: [] }], followUps: [], notInSources: false }); },
    undefined, async () => []);
  assert.ok(reply.ok);
  assert.ok(prompt.includes('S1 holds an imported research paper: "Attention Is All You Need"'));
  assert.ok(prompt.includes("What was imported: its full text, from arXiv's HTML version."));
  assert.ok(prompt.includes("The Transformer reaches a new state of the art."), "the paper's text is what the tutor reads");

  const note = (await getNote(profileId, imported.noteId))!;
  const blocks = (await import("../product/note-outline.js")).noteBlocks(note.body);
  const intro = blocks.find(b => b.text.startsWith("Recurrent models"))!;
  const mine = blocks.find(b => b.text === "## My notes")!;
  const proposal = await proposeEdit(profileId, note.id, { kind: "custom", instruction: "summarise the intro into my notes and tidy the paper" },
    stub({ summary: "s", changes: [
      { op: "replace", blocks: [intro.id], text: "RNNs are slow.", why: "tidy" },
      { op: "insert", after: mine.id, text: "### 1 Introduction\n\n- Attention replaces recurrence.", why: "notes" },
    ] }), loadFrom(profileId));
  assert.ok(proposal.ok);
  assert.deepEqual(proposal.changes.map(c => c.op), ["insert"]);
  const applied = applyEdits(note.body, proposal.changes);
  assert.ok(applied.ok);
  const region = paperRegion(note.body)!;
  assert.ok(applied.body.startsWith(note.body.slice(0, region.end)), "the paper's text is exactly as imported");
  assert.ok(applied.body.trimEnd().endsWith("- Attention replaces recurrence."));
  assert.ok(fetches > 0);
});
