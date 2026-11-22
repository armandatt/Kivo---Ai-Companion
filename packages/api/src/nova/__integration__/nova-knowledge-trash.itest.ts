/**
 * Deleting part of the Knowledge Map, and bringing it back — real Postgres.
 *
 * Proves: deleting a subject leaves every other subject and the rest of the
 * map; Nova's context (the workspaces it is told about, the "similar
 * workspace" check, what a conversation can name) forgets a workspace whose
 * subjects are gone, including one left stale before this change; the map's
 * default view is a map that still holds something; a delete is kept in
 * Recently deleted, and restoring puts the same rows back, refiles the notes
 * that stayed, brings the workspace record back, and Nova sees it again;
 * restoring twice restores once.
 *
 *   NOVA_TEST_DATABASE_URL=postgresql://... npx tsx --test src/nova/__integration__/nova-knowledge-trash.itest.ts
 */

import "./test-database.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";

process.env.TELEGRAM_BOT_TOKEN = "";
process.env.GEMINI_API_KEY = "";
process.env.OPENAI_API_KEY = "";

const { prisma } = await import("@repo/db/client");
const { ensureSetupProfile } = await import("../product/setup.js");
const { createNote, getNote } = await import("../product/notes.js");
const { deleteMap, previewMapDeletion, listDeletedKnowledge, restoreKnowledge, recentWorkspaceTitles, similarWorkspaces, resourceCandidates, listWorkspaces } = await import("../product/workspaces.js");
const { loadNovaKnowledgeMap } = await import("../product/knowledge-map.js");

const STAMP = Date.now();
const ids: string[] = [];
let n = 0;

async function learner() {
  const id = `web:trash_${STAMP}_${n++}`;
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

async function twoMaps() {
  const who = await learner();
  const tf = await prisma.novaSubject.create({ data: { profileId: who.profileId, name: "Transformers" } });
  const inner = await prisma.novaSubject.create({ data: { profileId: who.profileId, name: "Attention", parentId: tf.id } });
  const a = await prisma.novaTopicMastery.create({ data: { subjectId: tf.id, name: "Self-attention" } });
  await prisma.novaTopicMastery.create({ data: { subjectId: tf.id, name: "Scaled dot product", parentId: a.id } });
  await prisma.novaTopicMastery.create({ data: { subjectId: inner.id, name: "Multi-head" } });
  const fin = await prisma.novaSubject.create({ data: { profileId: who.profileId, name: "Finance" } });
  await prisma.novaTopicMastery.create({ data: { subjectId: fin.id, name: "WACC" } });
  const ws = await prisma.novaWorkspace.create({ data: { profileId: who.profileId, title: "Transformers", kind: "custom", plan: {}, subjectIds: [tf.id], clientKey: `tf-${STAMP}-${n}` } });
  const wf = await prisma.novaWorkspace.create({ data: { profileId: who.profileId, title: "Finance", kind: "custom", plan: {}, subjectIds: [fin.id], clientKey: `fin-${STAMP}-${n}` } });
  const note = await createNote(who.profileId, { title: "My attention note", body: "Mine.", subjectId: tf.id, topicName: "Self-attention" });
  assert.ok(note.ok);
  return { ...who, tf, inner, fin, ws, wf, noteId: note.note.id };
}

test("deleting one subject leaves the rest of the map, and Nova forgets it", async () => {
  const m = await twoMaps();
  assert.ok((await recentWorkspaceTitles(m.profileId, 6)).some(w => w.title === "Transformers"), "Nova is told about it while it exists");
  const scope = await previewMapDeletion(m.id, m.profileId, { subjectId: m.tf.id });
  const out = await deleteMap(m.id, m.profileId, { subjectId: m.tf.id }, scope!.fingerprint);
  assert.ok(out.ok, JSON.stringify(out));
  // Only what was meant went.
  assert.equal(await prisma.novaSubject.count({ where: { id: { in: [m.tf.id, m.inner.id] } } }), 0);
  assert.equal(await prisma.novaSubject.count({ where: { id: m.fin.id } }), 1);
  assert.equal(await prisma.novaTopicMastery.count({ where: { subjectId: m.fin.id } }), 1);
  const note = await getNote(m.profileId, m.noteId);
  assert.equal(note!.body, "Mine."); assert.equal(note!.subjectId, null, "the note stays, unfiled");
  // Nova's context: not told about it, not "similar", not nameable.
  assert.ok(!(await recentWorkspaceTitles(m.profileId, 6)).some(w => w.title === "Transformers"));
  assert.deepEqual(await similarWorkspaces(m.profileId, { templateId: null, title: "Transformers" }), []);
  assert.ok(!(await resourceCandidates(m.profileId)).workspaces.some(w => w.title === "Transformers"));
  assert.ok(!(await listWorkspaces(m.profileId)).workspaces.some(w => w.title === "Transformers"));
  assert.equal(await prisma.novaWorkspace.count({ where: { id: m.ws.id } }), 0, "a workspace left with nothing goes too");
  // The map opens on a map that holds something, and still has Finance.
  const map = await loadNovaKnowledgeMap(m.id);
  assert.ok(map.status === "ready" && map.nodes.some(x => x.label === "Finance") && !map.nodes.some(x => x.label === "Transformers"));
  const whole = await loadNovaKnowledgeMap(m.id, { workspace: m.ws.id });
  assert.ok(whole.status === "ready" && whole.nodes.some(x => x.label === "Finance"), "an old link to the deleted map shows everything, not an empty map");
});

test("restoring brings it back as it was, Nova sees it again, and twice restores once", async () => {
  const m = await twoMaps();
  const scope = await previewMapDeletion(m.id, m.profileId, { subjectId: m.tf.id });
  assert.ok((await deleteMap(m.id, m.profileId, { subjectId: m.tf.id }, scope!.fingerprint)).ok);
  const trash = await listDeletedKnowledge(m.profileId);
  assert.equal(trash.length, 1);
  assert.equal(trash[0]!.title, "Transformers");
  assert.deepEqual(trash[0]!.holds, { subjects: 2, topics: 3, dates: 0 });
  const [a, b] = await Promise.all([restoreKnowledge(m.profileId, trash[0]!.id), restoreKnowledge(m.profileId, trash[0]!.id)]);
  assert.equal([a, b].filter(r => r.ok).length, 1, JSON.stringify([a, b]));
  const tf = await prisma.novaSubject.findUnique({ where: { id: m.tf.id } });
  assert.equal(tf!.name, "Transformers");
  assert.equal((await prisma.novaSubject.findUnique({ where: { id: m.inner.id } }))!.parentId, m.tf.id, "the subject inside is inside again");
  const topics = await prisma.novaTopicMastery.findMany({ where: { subjectId: m.tf.id }, select: { name: true, parentId: true, id: true } });
  const sa = topics.find(t => t.name === "Self-attention")!;
  assert.ok(topics.some(t => t.name === "Scaled dot product" && t.parentId === sa.id), "nested topics keep their place");
  assert.equal((await getNote(m.profileId, m.noteId))!.subjectId, m.tf.id, "the note that stayed is filed back");
  assert.ok((await recentWorkspaceTitles(m.profileId, 6)).some(w => w.title === "Transformers"), "Nova is told about it again");
  assert.equal((await listDeletedKnowledge(m.profileId)).length, 0);
});

test("a restore never undoes a later choice, and a taken name comes back renamed", async () => {
  const m = await twoMaps();
  const scope = await previewMapDeletion(m.id, m.profileId, { subjectId: m.tf.id });
  assert.ok((await deleteMap(m.id, m.profileId, { subjectId: m.tf.id }, scope!.fingerprint)).ok);
  await prisma.novaNote.update({ where: { id: m.noteId }, data: { subjectId: m.fin.id } });
  await prisma.novaSubject.create({ data: { profileId: m.profileId, name: "Transformers" } });
  const item = (await listDeletedKnowledge(m.profileId))[0]!;
  const out = await restoreKnowledge(m.profileId, item.id);
  assert.ok(out.ok && out.renamed[0] === "Transformers (restored)", JSON.stringify(out));
  assert.equal((await getNote(m.profileId, m.noteId))!.subjectId, m.fin.id, "the note they refiled stays where they put it");
});

test("a workspace left stale before this change is not shown to Nova or as the default map", async () => {
  const m = await twoMaps();
  // As the old delete left it: the subjects gone, the workspace record still naming them.
  await prisma.novaTopicMastery.deleteMany({ where: { subjectId: { in: [m.tf.id, m.inner.id] } } });
  await prisma.novaSubject.deleteMany({ where: { id: { in: [m.inner.id, m.tf.id] } } });
  await prisma.novaWorkspace.update({ where: { id: m.ws.id }, data: { title: "Transformers" } });
  assert.ok(!(await recentWorkspaceTitles(m.profileId, 6)).some(w => w.title === "Transformers"));
  assert.deepEqual(await similarWorkspaces(m.profileId, { templateId: null, title: "Transformers" }), []);
  const map = await loadNovaKnowledgeMap(m.id);
  assert.ok(map.status === "ready" && map.workspaceId === m.wf.id && map.nodes.length > 0, "the default is a map that holds something");
});

test("deleting a whole workspace's map goes to the trash too, and comes back", async () => {
  const m = await twoMaps();
  const scope = await previewMapDeletion(m.id, m.profileId, { workspaceId: m.ws.id });
  assert.ok((await deleteMap(m.id, m.profileId, { workspaceId: m.ws.id }, scope!.fingerprint)).ok);
  assert.equal(await prisma.novaWorkspace.count({ where: { id: m.ws.id } }), 0);
  const item = (await listDeletedKnowledge(m.profileId))[0]!;
  assert.equal(item.kind, "workspace");
  assert.ok((await restoreKnowledge(m.profileId, item.id)).ok);
  const back = await prisma.novaWorkspace.findUnique({ where: { id: m.ws.id } });
  assert.ok(back && back.subjectIds.includes(m.tf.id));
});

test("another learner can't see or restore it", async () => {
  const m = await twoMaps();
  const scope = await previewMapDeletion(m.id, m.profileId, { subjectId: m.tf.id });
  assert.ok((await deleteMap(m.id, m.profileId, { subjectId: m.tf.id }, scope!.fingerprint)).ok);
  const item = (await listDeletedKnowledge(m.profileId))[0]!;
  const other = await learner();
  assert.equal((await listDeletedKnowledge(other.profileId)).length, 0);
  assert.ok(!(await restoreKnowledge(other.profileId, item.id)).ok);
  assert.equal(await prisma.novaSubject.count({ where: { id: m.tf.id } }), 0);
});

// 12 Nov: deleted map content kept showing in Notes and the extension. The
// database's SET NULL cleared only a record's subject, so a topic name stayed
// on notes, tasks and saved pages filed under a deleted subject. Persisted
// state checked after each step a learner takes.
test("what stays after a subject is deleted is filed under nothing, topic name included, everywhere; a restore puts it back; a repeat deletes nothing more", async () => {
  const m = await twoMaps();
  const { loadExtensionContext, loadSavedResources } = await import("../product/learning-events.js");
  const { createTask } = await import("../product/tasks.js");
  // Filed by a name the map does not hold as a topic (typed in the extension or a note).
  const loose = await createNote(m.profileId, { title: "Positional encoding notes", body: "Sinusoids.", subjectId: m.tf.id, topicName: "Positional encoding" });
  assert.ok(loose.ok);
  const page = await prisma.novaLearningEvent.create({ data: { profileId: m.profileId, eventType: "resource_saved", source: "browser_extension", clientEventId: `pe-${STAMP}`, url: "https://example.com/pe", domain: "example.com", title: "PE explained", subjectId: m.tf.id, topicName: "Positional encoding", occurredAt: new Date() } });
  const task = await createTask(m.profileId, { title: "Read PE paper", subjectId: m.tf.id, topicName: "Positional encoding" });
  assert.ok(task.ok);
  // A task, a note and a page under the subject that stays are not touched.
  const keep = await createNote(m.profileId, { title: "WACC note", body: "x", subjectId: m.fin.id, topicName: "WACC" });
  assert.ok(keep.ok);

  const scope = await previewMapDeletion(m.id, m.profileId, { subjectId: m.tf.id });
  const out = await deleteMap(m.id, m.profileId, { subjectId: m.tf.id }, scope!.fingerprint);
  assert.ok(out.ok, JSON.stringify(out));

  // Notes page: the notes are there, filed under nothing.
  for (const id of [m.noteId, loose.note.id]) {
    const n = await prisma.novaNote.findUnique({ where: { id }, select: { subjectId: true, topicName: true, body: true } });
    assert.deepEqual([n!.subjectId, n!.topicName], [null, null], "no deleted topic name left on the note");
    assert.ok(n!.body.length > 0, "the learner's text is kept");
  }
  const t = await prisma.novaTask.findUnique({ where: { id: task.task.id }, select: { subjectId: true, topicName: true } });
  assert.deepEqual([t!.subjectId, t!.topicName], [null, null]);
  const p = await prisma.novaLearningEvent.findUnique({ where: { id: page.id }, select: { subjectId: true, topicName: true } });
  assert.deepEqual([p!.subjectId, p!.topicName], [null, null]);
  // The rest of the map is untouched.
  const k = await prisma.novaNote.findUnique({ where: { id: keep.note.id }, select: { subjectId: true, topicName: true } });
  assert.deepEqual([k!.subjectId, k!.topicName], [m.fin.id, "WACC"]);

  // Browser extension sync: the deleted subject and its topics are not offered.
  const ctx = await loadExtensionContext(m.id, null);
  assert.ok(ctx.status === "ready");
  const offered = JSON.stringify(ctx);
  for (const gone of ["Transformers", "Attention", "Self-attention", "Multi-head", "Positional encoding"]) assert.ok(!offered.includes(gone), `${gone} is not offered`);
  const saved = await loadSavedResources(m.id);
  assert.ok(saved.status === "ready" && saved.resources.every(r => r.topicName !== "Positional encoding"));
  // The map, read fresh, has none of it.
  const map = JSON.stringify(await loadNovaKnowledgeMap(m.id));
  for (const gone of ["Self-attention", "Multi-head", "Positional encoding"]) assert.ok(!map.includes(`"${gone}"`), `${gone} is not on the map`);

  // The same delete again (a double click, a retry, a second tab): nothing more goes.
  const again = await deleteMap(m.id, m.profileId, { subjectId: m.tf.id }, scope!.fingerprint);
  assert.ok(!again.ok);
  assert.equal(await prisma.novaSubject.count({ where: { id: m.fin.id } }), 1);
  assert.equal((await listDeletedKnowledge(m.profileId)).length, 1, "one trash item, not two");

  // Restore: the filings come back as they were.
  const trash = (await listDeletedKnowledge(m.profileId))[0]!;
  assert.ok((await restoreKnowledge(m.profileId, trash.id)).ok);
  const back = await prisma.novaNote.findUnique({ where: { id: loose.note.id }, select: { subjectId: true, topicName: true } });
  assert.deepEqual([back!.subjectId, back!.topicName], [m.tf.id, "Positional encoding"]);
  const backPage = await prisma.novaLearningEvent.findUnique({ where: { id: page.id }, select: { subjectId: true, topicName: true } });
  assert.deepEqual([backPage!.subjectId, backPage!.topicName], [m.tf.id, "Positional encoding"]);
});

// ── Phase 1 (20 Nov): clearing a map, and maps that are not workspaces ───────

test("clearing a subject's map keeps the subject, empty; what stays is unfiled; Recently deleted puts it all back", async () => {
  const m = await twoMaps();
  const scope = await previewMapDeletion(m.id, m.profileId, { subjectId: m.tf.id }, "clear");
  assert.ok(scope, "a preview");
  assert.deepEqual(scope!.clears, [m.tf.id], "the subject itself stays");
  assert.deepEqual(scope!.removes.subjects.map(s => s.name), ["Attention"], "the subject inside it goes");
  assert.deepEqual(scope!.removes.topics.map(t => t.name).sort(), ["Multi-head", "Scaled dot product", "Self-attention"]);
  // A delete's preview of the same map is a different scope (its fingerprint differs).
  const asDelete = await previewMapDeletion(m.id, m.profileId, { subjectId: m.tf.id });
  assert.notEqual(asDelete!.fingerprint, scope!.fingerprint);
  // The delete's fingerprint does not clear, and the clear's does not delete.
  assert.equal((await deleteMap(m.id, m.profileId, { subjectId: m.tf.id }, asDelete!.fingerprint, new Date(), "clear")).ok, false);

  const out = await deleteMap(m.id, m.profileId, { subjectId: m.tf.id }, scope!.fingerprint, new Date(), "clear");
  assert.ok(out.ok, JSON.stringify(out));
  assert.equal(await prisma.novaSubject.count({ where: { id: m.tf.id } }), 1, "the map stays");
  assert.equal(await prisma.novaSubject.count({ where: { id: m.inner.id } }), 0);
  assert.equal(await prisma.novaTopicMastery.count({ where: { subjectId: m.tf.id } }), 0, "emptied");
  assert.equal(await prisma.novaWorkspace.count({ where: { id: m.ws.id } }), 1, "its workspace record stays");
  assert.equal(await prisma.novaTopicMastery.count({ where: { subjectId: m.fin.id } }), 1, "another map untouched");
  const note = await getNote(m.profileId, m.noteId);
  assert.equal(note!.body, "Mine.");
  assert.equal(note!.subjectId, null, "the note stays, unfiled");
  assert.equal(note!.topicName, null, "no topic name left behind");

  const item = (await listDeletedKnowledge(m.profileId)).find(t => t.title === "Transformers (cleared)");
  assert.ok(item, "in Recently deleted, marked as a clear");
  const back = await restoreKnowledge(m.profileId, item!.id);
  assert.ok(back.ok, JSON.stringify(back));
  assert.equal(await prisma.novaTopicMastery.count({ where: { subjectId: m.tf.id } }), 2, "its topics are back in it");
  assert.equal(await prisma.novaSubject.count({ where: { id: m.inner.id } }), 1, "the subject inside it is back");
  const refiled = await getNote(m.profileId, m.noteId);
  assert.equal(refiled!.subjectId, m.tf.id, "the note is filed back");
  assert.equal(refiled!.topicName, "Self-attention");
});

test("clearing a workspace's map keeps its record and its subjects, empty", async () => {
  const m = await twoMaps();
  const scope = await previewMapDeletion(m.id, m.profileId, { workspaceId: m.ws.id }, "clear");
  assert.deepEqual(scope!.clears, [m.tf.id]);
  const out = await deleteMap(m.id, m.profileId, { workspaceId: m.ws.id }, scope!.fingerprint, new Date(), "clear");
  assert.ok(out.ok, JSON.stringify(out));
  assert.equal(await prisma.novaWorkspace.count({ where: { id: m.ws.id } }), 1, "the workspace stays");
  assert.equal(await prisma.novaSubject.count({ where: { id: m.tf.id } }), 1);
  assert.equal(await prisma.novaTopicMastery.count({ where: { subjectId: { in: [m.tf.id, m.inner.id] } } }), 0);
  const view = await loadNovaKnowledgeMap(m.id, { workspace: m.ws.id });
  assert.equal(view.status, "ready");
  if (view.status !== "ready") return;
  assert.deepEqual(view.nodes.map(n => n.label), ["Transformers"], "the map opens, with only its subject");
});

test("a subject an assistant made (Kivo Connect's build_knowledge_map) is a map of its own: listed, opened by name, alone, and still there after a reload", async () => {
  const m = await twoMaps();
  const { applyChanges } = await import("../../connect/changes.js");
  // Exactly what build_knowledge_map writes: a subject and its topics, through Subject Studio. No workspace record.
  const made = await applyChanges(m.profileId, [{ op: "add_subject", name: "AI Roadmap", topics: ["Python", "Linear algebra"] }]);
  assert.equal(made.status, "completed", JSON.stringify(made));
  const sid = made.items[0]!.resource!.id;
  const workspacesBefore = await prisma.novaWorkspace.count({ where: { profileId: m.profileId } });

  const all = await loadNovaKnowledgeMap(m.id, { workspace: "all" });
  assert.equal(all.status, "ready");
  if (all.status !== "ready") return;
  const listed = all.workspaces!.find(w => w.id === `subject:${sid}`);
  assert.deepEqual(listed, { id: `subject:${sid}`, title: "AI Roadmap", kind: "subject" }, "listed among the maps");
  assert.ok(!all.workspaces!.some(w => w.id === `subject:${m.tf.id}`), "a subject that belongs to a workspace is not listed twice");
  assert.ok(all.workspaces!.some(w => w.id === m.ws.id && w.kind === "workspace"));

  for (let reload = 0; reload < 2; reload++) {
    const one = await loadNovaKnowledgeMap(m.id, { workspace: `subject:${sid}` });
    assert.equal(one.status, "ready");
    if (one.status !== "ready") return;
    assert.equal(one.workspaceId, `subject:${sid}`, "opened by its own id");
    assert.deepEqual(one.nodes.map(n => n.label).sort(), ["AI Roadmap", "Linear algebra", "Python"], "only its own cards");
    const subj = one.nodes.find(n => n.type === "subject");
    assert.equal(subj?.type === "subject" ? subj.studyTopics : null, 2);
  }
  assert.equal(await prisma.novaWorkspace.count({ where: { profileId: m.profileId } }), workspacesBefore, "no record was made to list it");

  // Another learner's subject id opens nothing of theirs.
  const other = await learner();
  const theirs = await loadNovaKnowledgeMap(other.id, { workspace: `subject:${sid}` });
  assert.equal(theirs.status === "ready" ? theirs.nodes.length : 0, 0);
});

// K-02: a topic deleted on its own (the map, Subject Studio, an assistant)
// was gone for good. Now it is kept in Recently deleted, with what was filed
// under it, and Undo / Restore puts it back where it was.
test("K-02: deleting a topic keeps it in Recently deleted; restoring puts it back in its place with its notes, tasks and saved pages; twice restores once", async () => {
  const { applyStudyEdits, loadStudyStructure } = await import("../product/setup-edit.js");
  const { createTask } = await import("../product/tasks.js");
  const { recordLearningEvent } = await import("../product/learning-events.js");
  const who = await learner();
  const os = await prisma.novaSubject.create({ data: { profileId: who.profileId, name: "Operating Systems" } });
  const unit = await prisma.novaTopicMastery.create({ data: { subjectId: os.id, name: "Memory", position: 0 } });
  const paging = await prisma.novaTopicMastery.create({ data: { subjectId: os.id, name: "Paging", parentId: unit.id, position: 0 } });
  await prisma.novaTopicMastery.create({ data: { subjectId: os.id, name: "Deadlock", position: 1 } });
  const note = await createNote(who.profileId, { title: "Paging notes", body: "Page tables.", subjectId: os.id, topicName: "Paging" });
  assert.ok(note.ok);
  const task = await createTask(who.profileId, { title: "Paging exercises", subjectId: os.id, topicName: "Paging" });
  assert.ok(task.ok, JSON.stringify(task));
  const page = await recordLearningEvent(who.profileId, { clientEventId: `k02-${STAMP}`, eventType: "resource_saved", url: "https://example.com/paging", title: "Paging explained", subjectId: os.id, topicName: "Paging" }, { source: "web" });
  assert.ok(page.success, JSON.stringify(page));

  const s = await loadStudyStructure(who.profileId);
  const out = await applyStudyEdits(who.profileId, { version: s.version, edits: [{ op: "remove_topic", topicId: paging.id }] });
  assert.ok(out.ok, JSON.stringify(out));
  assert.ok(out.ok && out.trashId, "the delete names its Recently deleted item, for Undo");
  assert.equal(await prisma.novaTopicMastery.count({ where: { id: paging.id } }), 0, "the topic is out of the active tables");
  assert.equal((await getNote(who.profileId, note.note.id))!.topicName, null, "its note stays, under the subject");
  assert.equal((await getNote(who.profileId, note.note.id))!.subjectId, os.id);
  const listed = (await listDeletedKnowledge(who.profileId)).find(i => i.id === (out as { trashId: string }).trashId);
  assert.ok(listed, "listed in Recently deleted");
  assert.equal(listed!.kind, "topic");
  assert.equal(listed!.holds.topics, 1);
  assert.ok(listed!.title.startsWith("Paging"), listed!.title);
  // Not in any active view.
  const map = await loadNovaKnowledgeMap(who.id);
  assert.ok(!JSON.stringify(map).includes(paging.id), "not on the map");

  // A choice made since is kept: the task is moved elsewhere before restoring.
  await prisma.novaTask.update({ where: { id: task.task.id }, data: { topicName: "Deadlock" } });
  const back = await restoreKnowledge(who.profileId, (out as { trashId: string }).trashId);
  assert.ok(back.ok, JSON.stringify(back));
  const row = await prisma.novaTopicMastery.findUnique({ where: { id: paging.id } });
  assert.equal(row?.name, "Paging", "the same row, same id");
  assert.equal(row?.parentId, unit.id, "back inside the topic it was in, which stayed");
  assert.equal((await getNote(who.profileId, note.note.id))!.topicName, "Paging", "its note is filed under it again");
  assert.equal((await prisma.novaLearningEvent.findUnique({ where: { id: (page as { eventId: string }).eventId } }))?.topicName, "Paging", "its saved page too");
  assert.equal((await prisma.novaTask.findUnique({ where: { id: task.task.id } }))?.topicName, "Deadlock", "a later choice is never undone");
  const again = await restoreKnowledge(who.profileId, (out as { trashId: string }).trashId);
  assert.equal(again.ok, false, "twice restores once");
  assert.equal(await prisma.novaTopicMastery.count({ where: { subjectId: os.id, name: "Paging" } }), 1);
});

test("K-02: a topic's name taken since comes back renamed; a topic whose subject is gone says so", async () => {
  const { applyStudyEdits, loadStudyStructure } = await import("../product/setup-edit.js");
  const who = await learner();
  const os = await prisma.novaSubject.create({ data: { profileId: who.profileId, name: "OS" } });
  const t = await prisma.novaTopicMastery.create({ data: { subjectId: os.id, name: "Scheduling" } });
  let s = await loadStudyStructure(who.profileId);
  const out = await applyStudyEdits(who.profileId, { version: s.version, edits: [{ op: "remove_topic", topicId: t.id }] });
  assert.ok(out.ok && out.trashId);
  await prisma.novaTopicMastery.create({ data: { subjectId: os.id, name: "Scheduling" } });
  const back = await restoreKnowledge(who.profileId, (out as { trashId: string }).trashId);
  assert.ok(back.ok);
  assert.deepEqual(back.ok && back.renamed, ["Scheduling (restored)"]);

  const db = await prisma.novaSubject.create({ data: { profileId: who.profileId, name: "Databases" } });
  const n2 = await prisma.novaTopicMastery.create({ data: { subjectId: db.id, name: "Indexes" } });
  s = await loadStudyStructure(who.profileId);
  const gone = await applyStudyEdits(who.profileId, { version: s.version, edits: [{ op: "remove_topic", topicId: n2.id }] });
  assert.ok(gone.ok && gone.trashId);
  await prisma.novaSubject.delete({ where: { id: db.id } });
  const r = await restoreKnowledge(who.profileId, (gone as { trashId: string }).trashId);
  assert.ok(r.ok);
  assert.deepEqual(r.ok && r.left, ["Indexes"], "said, not silently dropped");
});

test("K-02: another learner can't restore someone's deleted topic", async () => {
  const { applyStudyEdits, loadStudyStructure } = await import("../product/setup-edit.js");
  const a = await learner(), b = await learner();
  const sub = await prisma.novaSubject.create({ data: { profileId: a.profileId, name: "Maths" } });
  const t = await prisma.novaTopicMastery.create({ data: { subjectId: sub.id, name: "Limits" } });
  const s = await loadStudyStructure(a.profileId);
  const out = await applyStudyEdits(a.profileId, { version: s.version, edits: [{ op: "remove_topic", topicId: t.id }] });
  assert.ok(out.ok && out.trashId);
  const theirs = await restoreKnowledge(b.profileId, (out as { trashId: string }).trashId);
  assert.equal(theirs.ok, false);
  assert.equal(await prisma.novaTopicMastery.count({ where: { id: t.id } }), 0);
});
