/**
 * Connecting cards that exist, from the Knowledge Map — real Postgres.
 *
 * The web's own planner (apps/web components/nova/knowledge-map
 * map-connect.ts, pure, imported as it is) played through the routes'
 * functions. Proves a connection is the same row moved or linked, never a
 * copy: a subject put inside another, a topic moved inside a topic of another
 * subject with its history and what is filed under it, a task made a step,
 * a wait added once (repeats change nothing); and that a loop, a wait round a
 * circle, a wait on itself and another learner's task are refused with
 * nothing written. Each persists across a reload of the map.
 *
 *   NOVA_TEST_DATABASE_URL=postgresql://... npx tsx --test src/nova/__integration__/nova-map-connect.itest.ts
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
const { createTask, updateTask } = await import("../product/tasks.js");
const { createNote } = await import("../product/notes.js");
const connect = await import("../../../../../apps/web/components/nova/knowledge-map/map-connect.js");

import type { MapNode, NovaKnowledgeMapReady } from "../product/knowledge-map.types.js";

const STAMP = Date.now();
const ids: string[] = [];
let n = 0;

async function learner() {
  const id = `web:mapconnect_${STAMP}_${n++}`;
  ids.push(id);
  await prisma.messengerUser.create({ data: { platform: "web", platformChatId: id, persona: "nova", displayName: "Asha" } });
  const profileId = (await ensureSetupProfile(id))!.profileId;
  await prisma.novaAcademicProfile.update({ where: { id: profileId }, data: { onboardingComplete: true } });
  return { id, profileId };
}
async function map(id: string): Promise<NovaKnowledgeMapReady> {
  const v = await loadNovaKnowledgeMap(id, { workspace: "all" });
  assert.equal(v.status, "ready");
  return v as NovaKnowledgeMapReady;
}
const named = (m: NovaKnowledgeMapReady, label: string): MapNode => {
  const hit = m.nodes.filter(x => x.label === label);
  assert.equal(hit.length, 1, `exactly one card "${label}"`);
  return hit[0]!;
};
const treeOf = (m: NovaKnowledgeMapReady) => {
  const children = new Map<string, string[]>(), parent = new Map<string, string>();
  for (const e of m.edges) if (!["links_to", "depends_on"].includes(e.kind) && !parent.has(e.to)) { parent.set(e.to, e.from); children.set(e.from, [...(children.get(e.from) ?? []), e.to]); }
  return { children, parent };
};
const options = (m: NovaKnowledgeMapReady, source: string, target: string) =>
  connect.connectOptions(named(m, source), named(m, target), { nodes: m.nodes, edges: m.edges, tree: treeOf(m) });
async function play(profileId: string, req: NonNullable<ReturnType<typeof options>[number]["request"]>) {
  if (req.route === "study") return applyStudyEdits(profileId, { version: (await loadStudyStructure(profileId)).version, edits: req.edits });
  if (req.route === "task") return updateTask(profileId, req.taskId, req.patch);
  throw new Error(`not played here: ${req.route}`);
}

// Finance (Budgets), AI (Models with a note and study history), tasks a, b.
async function seed() {
  const who = await learner();
  const made = await applyStudyEdits(who.profileId, { version: (await loadStudyStructure(who.profileId)).version, edits: [
    { op: "add_subject", name: "Finance", topics: ["Budgets"] }, { op: "add_subject", name: "AI", topics: ["Models", "Ethics"] },
  ] });
  assert.ok(made.ok, made.ok ? "" : made.message);
  const ai = made.structure.subjects.find(s => s.name === "AI")!;
  const models = ai.topics.find(t => t.name === "Models")!;
  await prisma.novaTopicMastery.update({ where: { id: models.id }, data: { reviewCount: 3, masteryProbability: 0.6, lastStudiedAt: new Date() } });
  const note = await createNote(who.profileId, { title: "Transformer notes", body: "Attention.", subjectId: ai.id, topicName: "Models" });
  assert.ok(note.ok);
  const a = await createTask(who.profileId, { title: "Budget review", subjectId: made.structure.subjects.find(s => s.name === "Finance")!.id });
  const b = await createTask(who.profileId, { title: "Train a model", subjectId: ai.id, topicName: "Models" });
  assert.ok(a.ok && b.ok);
  return { ...who, modelsId: models.id, a: a.task.id, b: b.task.id };
}

after(async () => {
  await prisma.messengerUser.deleteMany({ where: { platformChatId: { in: ids } } });
  await prisma.$disconnect();
});

test("AI connected under Finance is the same subject, moved, with everything in it", async () => {
  const s = await seed();
  let m = await map(s.id);
  const before = named(m, "AI").id;
  const [o] = options(m, "Finance", "AI");
  assert.ok(o!.request && !o!.blocked);
  const done = await play(s.profileId, o!.request!);
  assert.ok(done.ok, (done as { message?: string }).message);
  m = await map(s.id);
  assert.equal(named(m, "AI").id, before, "the same row, not a copy");
  assert.ok(m.edges.some(e => e.kind === "contains" && e.from === named(m, "Finance").id && e.to === before));
  assert.equal(treeOf(m).parent.get(named(m, "Models").id), before, "its topics stay inside it");
  // Now Finance can't go inside AI: a circle. The planner says so and the server refuses it too.
  const back = options(m, "AI", "Finance")[0]!;
  assert.ok((back.blocked!).includes("is inside"));
  const refused = await applyStudyEdits(s.profileId, { version: (await loadStudyStructure(s.profileId)).version, edits: [{ op: "move_subject", subjectId: named(m, "Finance").subjectId!, parentId: before.slice(8) }] });
  assert.equal(refused.ok, false);
  assert.ok(options(m, "Finance", "AI")[0]!.blocked!.includes("already inside"), "connecting again is a repeat");
});

test("a topic from another subject goes inside a topic, keeping its row, history and what is filed under it", async () => {
  const s = await seed();
  let m = await map(s.id);
  const [o] = options(m, "Budgets", "Models");
  assert.ok((o!.moves!).includes("out of “AI”"));
  const done = await play(s.profileId, o!.request!);
  assert.ok(done.ok, (done as { message?: string }).message);
  m = await map(s.id);
  const models = named(m, "Models");
  assert.equal(models.id, `topic:${s.modelsId}`);
  assert.equal(treeOf(m).parent.get(models.id), named(m, "Budgets").id);
  const row = await prisma.novaTopicMastery.findUnique({ where: { id: s.modelsId } });
  assert.equal(row?.reviewCount, 3, "its history stays");
  assert.equal(row?.subjectId, named(m, "Finance").subjectId);
  assert.equal(treeOf(m).parent.get(named(m, "Transformer notes").id), models.id, "its note followed it");
  assert.equal(treeOf(m).parent.get(named(m, "Train a model").id), models.id, "its task followed it");
  assert.ok(named(m, "Ethics"), "the rest of AI stays");
});

test("tasks: a step, then waits; a repeat, a circle, itself and another learner's task change nothing", async () => {
  const s = await seed();
  const other = await learner();
  const theirs = await createTask(other.profileId, { title: "Theirs" });
  assert.ok(theirs.ok);
  let m = await map(s.id);
  const wait = options(m, "Budget review", "Train a model").find(o => o.key === "waits_for")!;
  assert.deepEqual(wait.request, { route: "task", taskId: s.a, patch: { waitFor: s.b } });
  const first = await updateTask(s.profileId, s.a, { waitFor: s.b });
  assert.ok(first.ok && first.task.after?.includes(s.b), "the reply shows the wait");
  const again = await play(s.profileId, wait.request!);
  assert.ok(again.ok);
  assert.equal(await prisma.novaTaskDependency.count({ where: { taskId: s.a } }), 1, "a repeat adds no second wait");
  m = await map(s.id);
  assert.ok(m.edges.some(e => e.kind === "depends_on" && e.from === `task:${s.a}` && e.to === `task:${s.b}`));
  assert.ok((options(m, "Budget review", "Train a model").find(o => o.key === "waits_for")!.blocked!).includes("already there"));
  assert.ok((options(m, "Budget review", "Train a model").find(o => o.key === "waited_on")!.blocked!).includes("circle"));

  const circle = await updateTask(s.profileId, s.b, { waitFor: s.a });
  assert.ok(!circle.ok && circle.error === "bad_wait");
  const self = await updateTask(s.profileId, s.a, { waitFor: s.a });
  assert.ok(!self.ok && self.error === "bad_wait");
  const foreign = await updateTask(s.profileId, s.a, { waitFor: theirs.task.id });
  assert.ok(!foreign.ok && foreign.error === "bad_wait");
  const reached = await updateTask(other.profileId, s.a, { waitFor: theirs.task.id });
  assert.ok(!reached.ok && reached.error === "not_found", "another learner can't reach this task");
  assert.equal(await prisma.novaTaskDependency.count({ where: { OR: [{ taskId: s.a }, { taskId: s.b }] } }), 1, "nothing else was written");

  // A step: the same task, now under the other.
  const step = options(m, "Budget review", "Train a model").find(o => o.key === "step")!;
  assert.ok((await play(s.profileId, step.request!)).ok);
  m = await map(s.id);
  assert.equal(treeOf(m).parent.get(`task:${s.b}`), `task:${s.a}`);
  assert.equal(m.nodes.filter(x => x.label === "Train a model").length, 1);
  const loop = await updateTask(s.profileId, s.a, { parentId: s.b });
  assert.ok(!loop.ok && loop.error === "bad_parent", "a task can't become a step of its own step");
});
