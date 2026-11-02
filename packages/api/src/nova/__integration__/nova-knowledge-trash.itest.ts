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
