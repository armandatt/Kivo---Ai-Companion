/**
 * Adding and deleting from the Knowledge Map — real Postgres.
 *
 * The map's adds and deletes are the web's own planner (apps/web
 * components/nova/knowledge-map/map-structure.ts, pure, imported here as it
 * is) played through the routes' functions: Subject Studio's batch, the task
 * routes and the archive. Proves each lands on the stored records and is what
 * the map (that workspace's and everything) and Build with Nova's workspace
 * then show; a topic deleted alone hands its topics up in its place; a branch
 * goes deepest first; nothing studied is deleted (it is archived instead);
 * a task's steps are kept or go with it, and waits on it go; a stale view,
 * another learner's ids, a loop and a repeated add change nothing.
 *
 *   NOVA_TEST_DATABASE_URL=postgresql://... npx tsx --test src/nova/__integration__/nova-map-editing.itest.ts
 */

import "./test-database.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";

process.env.TELEGRAM_BOT_TOKEN = "";
process.env.GEMINI_API_KEY = "";
process.env.OPENAI_API_KEY = "";

const { prisma } = await import("@repo/db/client");
const { ensureSetupProfile } = await import("../product/setup.js");
const { applyStudyEdits, loadStudyStructure } = await import("../product/setup-edit.js");
const { loadNovaKnowledgeMap } = await import("../product/knowledge-map.js");
const { createTask, deleteTask, updateTask } = await import("../product/tasks.js");
const { archiveTopic } = await import("../product/topic-archive.js");
const { workspaceDetail } = await import("../product/workspaces.js");
const plan = await import("../../../../../apps/web/components/nova/knowledge-map/map-structure.js");

import type { MapNode, NovaKnowledgeMapReady } from "../product/knowledge-map.types.js";
import type { StudyStructure } from "../product/setup-edit.types.js";

const STAMP = Date.now();
const ids: string[] = [];
let n = 0;

async function learner() {
  const id = `web:mapedit_${STAMP}_${n++}`;
  ids.push(id);
  await prisma.messengerUser.create({ data: { platform: "web", platformChatId: id, persona: "nova", displayName: "Asha" } });
  const profileId = (await ensureSetupProfile(id))!.profileId;
  await prisma.novaAcademicProfile.update({ where: { id: profileId }, data: { onboardingComplete: true } });
  return { id, profileId };
}

async function map(id: string, workspace?: string): Promise<NovaKnowledgeMapReady> {
  const v = await loadNovaKnowledgeMap(id, { workspace: workspace ?? "all" });
  assert.equal(v.status, "ready");
  return v as NovaKnowledgeMapReady;
}
const nodeNamed = (m: NovaKnowledgeMapReady, label: string): MapNode => {
  const hit = m.nodes.find(x => x.label === label);
  assert.ok(hit, `no card "${label}" on the map`);
  return hit;
};
const childrenOf = (m: NovaKnowledgeMapReady, label: string) => {
  const from = nodeNamed(m, label).id;
  return m.edges.filter(e => e.from === from && e.kind !== "links_to" && e.kind !== "depends_on").map(e => m.nodes.find(x => x.id === e.to)!.label);
};
// The tree the web lays out, from the map's own edges.
const treeOf = (m: NovaKnowledgeMapReady) => {
  const children = new Map<string, string[]>();
  for (const e of m.edges) if (!["links_to", "depends_on"].includes(e.kind)) children.set(e.from, [...(children.get(e.from) ?? []), e.to]);
  return { children };
};
async function structure(profileId: string): Promise<StudyStructure> { return loadStudyStructure(profileId); }
async function study(profileId: string, edits: unknown[], version?: string) {
  return applyStudyEdits(profileId, { version: version ?? (await structure(profileId)).version, edits });
}

// Operating Systems: Intro, Unit 1 › (Paging, Segmentation), Later; a task
// "Revise unit 1" under Unit 1 with steps (Read › Notes, Practise); a task
// that waits on it; a workspace holding the subject.
async function seed() {
  const who = await learner();
  const made = await study(who.profileId, [
    { op: "add_subject", name: "Operating Systems", topics: ["Intro", "Unit 1", "Later"] },
  ]);
  assert.ok(made.ok, made.ok ? "" : made.message);
  const os = made.structure.subjects.find(s => s.name === "Operating Systems")!;
  const unit = os.topics.find(t => t.name === "Unit 1")!;
  const inner = await study(who.profileId, [{ op: "add_topics", subjectId: os.id, names: ["Paging", "Segmentation"], parentId: unit.id }]);
  assert.ok(inner.ok, inner.ok ? "" : inner.message);
  const task = await createTask(who.profileId, { title: "Revise unit 1", subjectId: os.id, topicName: "Unit 1" });
  assert.ok(task.ok);
  const read = await createTask(who.profileId, { title: "Read", parentId: task.task.id });
  const practise = await createTask(who.profileId, { title: "Practise", parentId: task.task.id });
  assert.ok(read.ok && practise.ok);
  const notes = await createTask(who.profileId, { title: "Notes", parentId: read.task.id });
  const waiting = await createTask(who.profileId, { title: "Mock test", subjectId: os.id });
  assert.ok(notes.ok && waiting.ok);
  await prisma.novaTaskDependency.create({ data: { taskId: waiting.task.id, dependsOnId: task.task.id } });
  const ws = await prisma.novaWorkspace.create({ data: { profileId: who.profileId, kind: "custom", title: "OS exam", plan: {}, subjectIds: [os.id], clientKey: `mapedit-${STAMP}-${n++}` } });
  return { ...who, os: os.id, workspace: ws.id };
}

after(async () => {
  await prisma.messengerUser.deleteMany({ where: { platformChatId: { in: ids } } });
  await prisma.$disconnect();
});

test("an add from the map is the stored record, on the map, in its workspace and in Build with Nova's view", async () => {
  const s = await seed();
  let m = await map(s.id, s.workspace);
  const paging = nodeNamed(m, "Paging");
  const [inside] = plan.addChoices(paging, m.nodes);
  const req = plan.addRequest(inside!, paging, "TLB misses", "Why a miss costs a page walk", "k-topic");
  assert.equal(req.route, "study");
  if (req.route !== "study") return;
  const before = await structure(s.profileId);
  const done = await study(s.profileId, req.edits, before.version);
  assert.ok(done.ok, done.ok ? "" : done.message);
  const madeTopic = plan.madeTopic(before, done.structure, req);
  assert.ok(madeTopic, "the new topic is found in what the server sent back");
  const described = await study(s.profileId, [{ op: "update_topic", topicId: madeTopic.id, details: { explanation: req.explanation } }], done.structure.version);
  assert.ok(described.ok);

  m = await map(s.id, s.workspace);
  assert.deepEqual(childrenOf(m, "Paging"), ["TLB misses"], "drawn inside the card it was added to");
  const tlb = nodeNamed(m, "TLB misses");
  assert.equal(tlb.type === "topic" && tlb.details?.explanation, "Why a miss costs a page walk");
  assert.equal(nodeNamed(m, "Paging").type === "topic" && (nodeNamed(m, "Paging") as { studied?: boolean }).studied, false, "Paging now organises what is inside it");
  assert.ok((await map(s.id)).nodes.some(x => x.label === "TLB misses"), "and on the map of everything");
  const detail = await workspaceDetail(s.id, s.profileId, s.workspace);
  assert.ok(JSON.stringify(detail).includes("TLB misses"), "Build with Nova's workspace view reads the same rows");

  // A step, and the same dialog's key twice: one task.
  const read = nodeNamed(m, "Read");
  const step = plan.addRequest(plan.addChoices(read, m.nodes)[0]!, read, "Summarise chapter 8", "", "map:step-1");
  assert.equal(step.route, "task");
  if (step.route !== "task") return;
  const a = await createTask(s.profileId, step.input), b = await createTask(s.profileId, step.input);
  assert.ok(a.ok && b.ok && a.task.id === b.task.id && b.created === false, "a double submit makes one task");
  m = await map(s.id, s.workspace);
  assert.deepEqual(childrenOf(m, "Read").sort(), ["Notes", "Summarise chapter 8"]);
  assert.equal(m.nodes.filter(x => x.label === "Summarise chapter 8").length, 1);

  // A subject inside one of the workspace's subjects is part of its map.
  const sub = plan.addRequest(plan.addChoices(nodeNamed(m, "Operating Systems"), m.nodes)[1]!, nodeNamed(m, "Operating Systems"), "Kernels", "", "k");
  assert.ok(sub.route === "study" && (await study(s.profileId, sub.edits)).ok);
  assert.ok(childrenOf(await map(s.id, s.workspace), "Operating Systems").includes("Kernels"));
});

test("deleting only a topic moves what is inside it up, in its place, and keeps what is filed there", async () => {
  const s = await seed();
  let m = await map(s.id, s.workspace);
  const unit = nodeNamed(m, "Unit 1");
  const st = await structure(s.profileId);
  const p = plan.deletePlan(unit, m.edges, treeOf(m), st);
  assert.ok(p.ok);
  assert.deepEqual(p.options.map(o => o.mode), ["lift", "branch"]);
  const req = plan.deleteRequest(unit, "lift", treeOf(m), st);
  assert.equal(req.route, "study");
  if (req.route !== "study") return;
  const done = await study(s.profileId, req.edits, st.version);
  assert.ok(done.ok, done.ok ? "" : done.message);
  m = await map(s.id, s.workspace);
  assert.equal(m.nodes.some(x => x.label === "Unit 1"), false);
  assert.deepEqual(childrenOf(m, "Operating Systems").filter(l => ["Intro", "Paging", "Segmentation", "Later"].includes(l)), ["Intro", "Paging", "Segmentation", "Later"], "in the deleted topic's place, in order");
  assert.ok(m.nodes.some(x => x.label === "Revise unit 1"), "its task stays, under the subject");
});

test("a branch goes deepest first; one with study in it can't go whole, and a studied topic is archived instead", async () => {
  const s = await seed();
  let m = await map(s.id);
  const st = await structure(s.profileId);
  const branch = plan.deleteRequest(nodeNamed(m, "Unit 1"), "branch", treeOf(m), st);
  assert.ok(branch.route === "study");

  // Study recorded on Segmentation: the planner blocks the branch, and so does the server.
  const seg = st.subjects.flatMap(x => x.topics).find(t => t.name === "Segmentation")!;
  await prisma.novaTopicMastery.update({ where: { id: seg.id }, data: { reviewCount: 1, lastStudiedAt: new Date() } });
  const fresh = await structure(s.profileId);
  const blocked = plan.deletePlan(nodeNamed(m, "Unit 1"), m.edges, treeOf(m), fresh);
  assert.ok(blocked.ok && blocked.options[1]!.blocked);
  const refused = await study(s.profileId, (branch as { edits: unknown[] }).edits, fresh.version);
  assert.equal(refused.ok, false, "the server refuses it whole");
  m = await map(s.id);
  assert.deepEqual(childrenOf(m, "Unit 1").sort(), ["Paging", "Segmentation", "Revise unit 1"].sort(), "nothing went");

  const segPlan = plan.deletePlan(nodeNamed(m, "Segmentation"), m.edges, treeOf(m), fresh);
  assert.ok(!segPlan.ok && segPlan.archive);
  const archived = await archiveTopic(s.profileId, { topicId: segPlan.archive.topicId, archived: true });
  assert.ok(archived.ok);
  m = await map(s.id);
  assert.equal(m.nodes.some(x => x.label === "Segmentation"), false, "off the map");
  assert.ok(await prisma.novaTopicMastery.findUnique({ where: { id: seg.id } }), "its row and history stay");

  // Archived, it is still inside Unit 1 with its history: the branch still
  // can't go whole, and the planner says so; deleting Unit 1 alone moves both
  // topics up, the archived one too, and its history stays.
  const now = await structure(s.profileId);
  const still = plan.deletePlan(nodeNamed(m, "Unit 1"), m.edges, treeOf(m), now);
  assert.ok(still.ok && still.options[1]!.blocked?.includes("Segmentation” (archived)"));
  const lift = plan.deleteRequest(nodeNamed(m, "Unit 1"), "lift", treeOf(m), now);
  assert.ok(lift.route === "study");
  const gone = await study(s.profileId, lift.edits, now.version);
  assert.ok(gone.ok, gone.ok ? "" : gone.message);
  m = await map(s.id);
  assert.equal(m.nodes.some(x => x.label === "Unit 1"), false);
  assert.ok(childrenOf(m, "Operating Systems").includes("Paging"));
  const kept = await prisma.novaTopicMastery.findUnique({ where: { id: seg.id } });
  assert.ok(kept && kept.archivedAt && kept.reviewCount === 1 && kept.parentId === null, "archived, its history kept, at the top of the subject");

  // A branch with no study in it goes whole, deepest first.
  const st2 = await structure(s.profileId);
  const made = await study(s.profileId, [{ op: "add_topics", subjectId: s.os, names: ["Unit 2"] }], st2.version);
  assert.ok(made.ok);
  const unit2 = made.structure.subjects.find(x => x.id === s.os)!.topics.find(t => t.name === "Unit 2")!;
  const deeper = await study(s.profileId, [{ op: "add_topics", subjectId: s.os, names: ["Files"], parentId: unit2.id }, { op: "add_topics", subjectId: s.os, names: ["Inodes"], parentName: "Files" }]);
  assert.ok(deeper.ok, deeper.ok ? "" : deeper.message);
  m = await map(s.id);
  const st3 = await structure(s.profileId);
  const whole = plan.deleteRequest(nodeNamed(m, "Unit 2"), "branch", treeOf(m), st3);
  assert.ok(whole.route === "study");
  assert.deepEqual(whole.edits.map(e => (e as { topicId: string }).topicId).map(id => st3.subjects.flatMap(x => x.topics).find(t => t.id === id)!.name), ["Inodes", "Files", "Unit 2"]);
  const branchGone = await study(s.profileId, whole.edits, st3.version);
  assert.ok(branchGone.ok, branchGone.ok ? "" : branchGone.message);
  m = await map(s.id);
  assert.equal(m.nodes.some(x => ["Unit 2", "Files", "Inodes"].includes(x.label)), false);
  assert.ok(m.nodes.some(x => x.label === "Intro") && m.nodes.some(x => x.label === "Paging"), "unrelated topics stay");
});

test("a task deleted alone keeps its steps as tasks; with its steps, they go; waits on it go either way", async () => {
  const s = await seed();
  let m = await map(s.id, s.workspace);
  const task = nodeNamed(m, "Revise unit 1");
  const p = plan.deletePlan(task, m.edges, treeOf(m), null);
  assert.ok(p.ok && p.options[0]!.mode === "keep_steps");
  assert.ok(p.stays.some(x => x.includes("1 task waiting on it")));
  const req = plan.deleteRequest(task, "keep_steps", treeOf(m), null);
  assert.ok(req.route === "task");
  for (const id of req.lift) assert.ok((await updateTask(s.profileId, id, { parentId: null })).ok);
  assert.equal(await deleteTask(s.profileId, req.remove), true);
  m = await map(s.id, s.workspace);
  assert.equal(m.nodes.some(x => x.label === "Revise unit 1"), false);
  for (const label of ["Read", "Practise"]) {
    const t = nodeNamed(m, label);
    assert.ok(t.type === "task" && !t.parentId, `${label} is a task of its own`);
  }
  assert.deepEqual(childrenOf(m, "Read"), ["Notes"], "its own steps stay under it");
  const mock = nodeNamed(m, "Mock test");
  assert.ok(mock.type === "task" && mock.waitsOn === 0 && !m.edges.some(e => e.kind === "depends_on"), "the wait on it went with it");

  const read = nodeNamed(m, "Read");
  const withSteps = plan.deleteRequest(read, "with_steps", treeOf(m), null);
  assert.ok(withSteps.route === "task" && withSteps.lift.length === 0);
  assert.equal(await deleteTask(s.profileId, withSteps.remove), true);
  m = await map(s.id, s.workspace);
  assert.equal(m.nodes.some(x => x.label === "Read" || x.label === "Notes"), false);
  assert.ok(m.nodes.some(x => x.label === "Practise"), "a task beside it stays");
});

test("a stale view, another learner's ids, a loop and an empty subject check", async () => {
  const s = await seed();
  const other = await learner();
  const m = await map(s.id);
  const st = await structure(s.profileId);

  // Something changed after the dialog read the structure: nothing is deleted.
  assert.ok((await study(s.profileId, [{ op: "add_topics", subjectId: s.os, names: ["Elsewhere"] }])).ok);
  const late = plan.deleteRequest(nodeNamed(m, "Later"), "only", treeOf(m), st);
  assert.ok(late.route === "study");
  const stale = await study(s.profileId, late.edits, st.version);
  assert.ok(!stale.ok && stale.error === "stale");
  assert.ok((await map(s.id)).nodes.some(x => x.label === "Later"));

  // Another learner can't reach these rows through any of the routes.
  const later = st.subjects.flatMap(x => x.topics).find(t => t.name === "Later")!;
  const foreign = await study(other.profileId, [{ op: "remove_topic", topicId: later.id }]);
  assert.equal(foreign.ok, false);
  const task = nodeNamed(m, "Revise unit 1");
  assert.equal(await deleteTask(other.profileId, plan.rowId(task.id)), false);
  const step = await createTask(other.profileId, { title: "x", parentId: plan.rowId(task.id) });
  assert.ok(!step.ok && step.error === "bad_parent");
  assert.ok((await map(s.id)).nodes.some(x => x.label === "Revise unit 1"));

  // No loops: a topic inside its own child, a task under its own step.
  const unit = st.subjects.flatMap(x => x.topics).find(t => t.name === "Unit 1")!;
  const paging = st.subjects.flatMap(x => x.topics).find(t => t.name === "Paging")!;
  assert.equal((await study(s.profileId, [{ op: "move_topic", topicId: unit.id, parentId: paging.id }])).ok, false);
  const read = nodeNamed(m, "Read");
  assert.equal((await updateTask(s.profileId, plan.rowId(task.id), { parentId: plan.rowId(read.id) })).ok, false);

  // A subject with topics is not deleted from the map; the planner says why.
  const full = plan.deletePlan(nodeNamed(m, "Operating Systems"), m.edges, treeOf(m), await structure(s.profileId));
  assert.ok(!full.ok && full.why.includes("topics"));
});
