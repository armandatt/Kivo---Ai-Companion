/**
 * The planning engine — real Postgres.
 *
 * Proves, from a proposal through approval to the stored rows and the
 * Knowledge Map: every approved unit, topic and subtopic is a row exactly
 * once, under its parent, in its order, and the map draws that same tree for
 * the workspace by default; only leaf topics enter the study queues, and a
 * learner's progress survives a topic gaining and losing topics inside it;
 * waits are rows, drawn as edges, changed by approved operations and gone
 * with their tasks; a proposal is revised by operations, nothing else
 * touched; a plan that contradicts itself is not built; and an older
 * learner's rows (no positions, no parents, an older plan) still read.
 *
 *   NOVA_TEST_DATABASE_URL=postgresql://... npx tsx --test src/nova/__integration__/nova-planning-engine.itest.ts
 */

import "./test-database.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";

process.env.TELEGRAM_BOT_TOKEN = "";
process.env.GEMINI_API_KEY = "";
process.env.OPENAI_API_KEY = "";

const { prisma } = await import("@repo/db/client");
const builder = await import("../product/builder.js");
const { readTurn } = await import("../product/builder-state.js");
const { checkWorkspacePlan, topicRows } = await import("../product/workspace-plan.js");
const { ensureSetupProfile } = await import("../product/setup.js");
const { applyStudyEdits, loadStudyStructure } = await import("../product/setup-edit.js");
const { loadNovaKnowledgeMap } = await import("../product/knowledge-map.js");
const { getAllTopicMasteries } = await import("../engines/knowledge-engine.js");
const { workspaceDetail } = await import("../product/workspaces.js");

import type { BuilderDeps } from "../product/builder.js";
import type { MapEdge, MapNode } from "../product/knowledge-map.types.js";

const STAMP = Date.now();
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const ids: string[] = [];
let n = 0;

async function learner() {
  const id = `web:plan_${STAMP}_${n++}`;
  ids.push(id);
  await prisma.messengerUser.create({ data: { platform: "web", platformChatId: id, persona: "nova", displayName: "Asha" } });
  return { id, profileId: (await ensureSetupProfile(id))!.profileId };
}
const reader = (raw: Record<string, unknown>): NonNullable<BuilderDeps["read"]> => async input =>
  readTurn({ reply: "OK.", facts: [], assumptions: [], suggestions: [], question: null, ...raw }, input.messages.filter(m => m.role === "user").map(m => m.text).join("\n"), []);
const writer = (raw: Record<string, unknown>): NonNullable<BuilderDeps["write"]> => async req => checkWorkspacePlan({ ...raw, kind: "custom" }, { today: req.today, userText: req.learnerText, nova: true });
const noWrite: NonNullable<BuilderDeps["write"]> = async () => { throw new Error("a new plan was written"); };

async function begin(id: string, text: string, deps: BuilderDeps) {
  const started = await builder.startDraft(id, { text, clientKey: `pe-${STAMP}-${n++}-abcdef` });
  assert.ok(started.ok, started.ok ? "" : started.message);
  await builder.runJob(id, started.job!, deps);
  return (await builder.getDraft(id, started.draft.id))!;
}
async function say(id: string, draftId: string, text: string, deps: BuilderDeps) {
  const claimed = await builder.postMessage(id, draftId, { text });
  assert.ok(claimed.ok, claimed.ok ? "" : claimed.message);
  await builder.runJob(id, claimed.job, deps);
  return (await builder.getDraft(id, draftId))!;
}

const SEMESTER = {
  title: "Semester 5 exams", summary: "Five subjects to the end-semester exams",
  subjects: [
    { name: "DSA", topics: [
      { name: "Unit 1: Foundations", topics: [{ name: "Asymptotic analysis", topics: ["Big-O notation", "Master theorem"] }, { name: "Recursion" }] },
      { name: "Unit 2: Trees", topics: [{ name: "Binary search trees" }, { name: "Heaps", topics: ["Heapify", "Heap sort"] }] },
    ] },
    { name: "Operating Systems", topics: [{ name: "Unit 1: Processes", topics: ["Scheduling", "Deadlocks"] }, { name: "Unit 2: Memory", topics: ["Paging", "Segmentation"] }] },
  ],
  tasks: [
    { key: "bigo", title: "Solve 10 Big-O problems", subject: "DSA", topic: "Big-O notation", dueDay: inDays(5), estimatedMinutes: 60 },
    { key: "bst", title: "Implement a BST", subject: "DSA", topic: "Binary search trees", dueDay: inDays(10), estimatedMinutes: 90 },
    { key: "bst-ins", title: "Write insert", parent: "bst", dueDay: inDays(8), estimatedMinutes: 30 },
    { key: "bst-del", title: "Write delete", parent: "bst", dueDay: inDays(9), estimatedMinutes: 30 },
    { key: "heap", title: "Implement a heap", subject: "DSA", topic: "Heaps", after: ["bst"], dueDay: inDays(12), estimatedMinutes: 60 },
    { key: "os", title: "Simulate round-robin scheduling", subject: "Operating Systems", topic: "Scheduling", dueDay: inDays(7), estimatedMinutes: 45 },
  ],
  dates: [{ title: "DSA end-semester exam", subject: "DSA", kind: "exam", day: inDays(30) }],
};

test("an approved semester is its tree in rows, in order, once each, and the map draws that tree for the workspace by default", async () => {
  const me = await learner();
  const draft = await begin(me.id, "Plan my semester 5: DSA and OS, exam in a month.", {
    read: reader({ next: "draft", kind: "semester", facts: [{ label: "Subjects", value: "DSA and OS", quote: "DSA and OS" }, { label: "Exam", value: "in a month", quote: "exam in a month" }] }),
    write: writer(SEMESTER),
  });
  assert.equal(draft.status, "awaiting_approval");
  assert.deepEqual(draft.feasibility?.errors, []);
  const built = await builder.approveDraft(me.id, draft.id, { version: draft.version });
  assert.ok(built.ok && built.draft.status === "ready", built.ok ? "" : built.message);
  const workspaceId = built.ok ? built.draft.workspace!.id : "";

  // Rows: each topic once, under its parent, in its place among its siblings.
  const rows = await prisma.novaTopicMastery.findMany({ where: { subject: { profileId: me.profileId } }, select: { id: true, name: true, parentId: true, position: true, subject: { select: { name: true } } } });
  const planned = draft.plan!.subjects.flatMap(s => topicRows(s).map(r => ({ subject: s.name, name: r.topic.name, parent: r.topic.parent ?? null })));
  assert.equal(rows.length, planned.length);
  for (const p of planned) {
    const row = rows.filter(r => r.name === p.name && r.subject.name === p.subject);
    assert.equal(row.length, 1, `${p.name} once`);
    const parent = row[0]!.parentId ? rows.find(r => r.id === row[0]!.parentId)!.name : null;
    assert.equal(parent, p.parent, `${p.name} under ${p.parent}`);
  }
  for (const s of draft.plan!.subjects) {
    for (const parent of [null, ...s.topics.map(t => t.name)]) {
      const want = s.topics.filter(t => (t.parent ?? null) === parent).map(t => t.name);
      const got = rows.filter(r => r.subject.name === s.name && (r.parentId ? rows.find(x => x.id === r.parentId)!.name : null) === parent).sort((a, b) => a.position! - b.position!).map(r => r.name);
      assert.deepEqual(got, want, `order under ${parent ?? s.name}`);
    }
  }

  // The map, for this workspace by default: the same tree, the same order, nothing twice, nothing missing.
  const map = await loadNovaKnowledgeMap(me.id);
  assert.ok(map.status === "ready");
  if (map.status !== "ready") return;
  assert.equal(map.workspaceId, workspaceId);
  const topics = map.nodes.filter((x): x is Extract<MapNode, { type: "topic" }> => x.type === "topic");
  assert.equal(topics.length, planned.length);
  const nodes: MapNode[] = map.nodes;
  const label = (id: string): string => nodes.find(x => x.id === id)!.label;
  for (const p of planned) {
    const node = topics.filter(t => t.label === p.name && t.subjectName === p.subject);
    assert.equal(node.length, 1, `${p.name} drawn once`);
    const incoming: MapEdge[] = map.edges.filter(e => e.to === node[0]!.id && (e.kind === "subtopic" || e.kind === "has_topic"));
    assert.equal(incoming.length, 1);
    const edge: MapEdge = incoming[0]!;
    assert.equal(edge.kind === "subtopic" ? label(edge.from) : null, p.parent);
  }
  const unit2 = topics.find(t => t.label === "Unit 2: Trees")!;
  assert.deepEqual(topics.filter(t => t.parentId === unit2.id.slice(6)).sort((a, b) => a.order! - b.order!).map(t => t.label), ["Binary search trees", "Heaps"]);
  // Tasks are cards: steps under their task, the wait an edge.
  assert.equal(map.nodes.filter(x => x.type === "task").length, 6);
  assert.ok(map.edges.some(e => e.kind === "depends_on" && label(e.from) === "Implement a heap" && label(e.to) === "Implement a BST"));
  assert.ok(map.edges.some(e => e.kind === "step" && label(e.from) === "Implement a BST" && label(e.to) === "Write insert"));

  // Only leaves are studied: a unit, a topic with subtopics, never queued.
  const queue = (await getAllTopicMasteries(me.profileId)).map(t => t.topicName).sort();
  assert.deepEqual(queue, ["Big-O notation", "Binary search trees", "Deadlocks", "Heap sort", "Heapify", "Master theorem", "Paging", "Recursion", "Scheduling", "Segmentation"]);
  // Reopened, the live view is the same tree, by id.
  const detail = (await workspaceDetail(me.id, me.profileId, workspaceId))!;
  const dsa = detail.subjects.find(s => s.name === "DSA")!;
  assert.deepEqual(dsa.topics.slice(0, 3).map(t => [t.name, t.parentId ? dsa.topics.find(x => x.id === t.parentId)!.name : null]), [["Unit 1: Foundations", null], ["Asymptotic analysis", "Unit 1: Foundations"], ["Big-O notation", "Asymptotic analysis"]]);
  assert.deepEqual(detail.tasks.find(t => t.title === "Implement a heap")!.after, [detail.tasks.find(t => t.title === "Implement a BST")!.id]);
});

test("progress survives a topic gaining and losing topics inside it; it leaves the queue and comes back with what it had", async () => {
  const me = await learner();
  const subject = await prisma.novaSubject.create({ data: { profileId: me.profileId, name: "Algorithms" } });
  const graphs = await prisma.novaTopicMastery.create({ data: { subjectId: subject.id, name: "Graphs", masteryProbability: 0.62, reviewCount: 4, lastStudiedAt: new Date(), nextReviewAt: new Date(Date.now() + 86_400_000) } });
  assert.deepEqual((await getAllTopicMasteries(me.profileId)).map(t => t.topicName), ["Graphs"]);

  let s = await loadStudyStructure(me.profileId);
  let r = await applyStudyEdits(me.profileId, { version: s.version, edits: [{ op: "add_topics", subjectId: subject.id, names: ["BFS", "DFS"], parentId: graphs.id }] });
  assert.ok(r.ok, r.ok ? "" : r.message);
  assert.deepEqual((await getAllTopicMasteries(me.profileId)).map(t => t.topicName).sort(), ["BFS", "DFS"]);
  const kept = await prisma.novaTopicMastery.findUniqueOrThrow({ where: { id: graphs.id } });
  assert.equal(kept.masteryProbability, 0.62);
  assert.equal(kept.reviewCount, 4);

  s = await loadStudyStructure(me.profileId);
  const inside = s.subjects.find(x => x.id === subject.id)!.topics.filter(t => t.parentId === graphs.id);
  assert.deepEqual(inside.map(t => t.name), ["BFS", "DFS"]);
  // A topic with topics inside it can't be removed until they go; then they can.
  const blocked = await applyStudyEdits(me.profileId, { version: s.version, edits: [{ op: "remove_topic", topicId: graphs.id }] });
  assert.ok(!blocked.ok);
  r = await applyStudyEdits(me.profileId, { version: s.version, edits: inside.map(t => ({ op: "remove_topic", topicId: t.id })) });
  assert.ok(r.ok, r.ok ? "" : r.message);
  const back = await getAllTopicMasteries(me.profileId);
  assert.deepEqual(back.map(t => [t.topicName, t.masteryProbability, t.reviewCount]), [["Graphs", 0.62, 4]]);
  // A move inside a topic of the same subject, and a loop, are checked.
  s = await loadStudyStructure(me.profileId);
  const add = await applyStudyEdits(me.profileId, { version: s.version, edits: [{ op: "add_topics", subjectId: subject.id, names: ["Shortest paths"] }] });
  assert.ok(add.ok);
  s = await loadStudyStructure(me.profileId);
  const sp = s.subjects[0]!.topics.find(t => t.name === "Shortest paths")!;
  const moved = await applyStudyEdits(me.profileId, { version: s.version, edits: [{ op: "move_topic", topicId: sp.id, parentId: graphs.id }] });
  assert.ok(moved.ok);
  s = await loadStudyStructure(me.profileId);
  const loop = await applyStudyEdits(me.profileId, { version: s.version, edits: [{ op: "move_topic", topicId: graphs.id, parentId: sp.id }] });
  assert.ok(!loop.ok);
  // Another learner's topic is never a parent.
  const other = await learner();
  const theirs = await prisma.novaSubject.create({ data: { profileId: other.profileId, name: "Theirs", topics: { create: [{ name: "Secret" }] } }, include: { topics: true } });
  s = await loadStudyStructure(me.profileId);
  const stolen = await applyStudyEdits(me.profileId, { version: s.version, edits: [{ op: "add_topics", subjectId: subject.id, names: ["X"], parentId: theirs.topics[0]!.id }] });
  assert.ok(!stolen.ok);
});

test("waits are rows: drawn as edges, changed by an approved change, gone with their task; a plan that contradicts itself isn't built", async () => {
  const me = await learner();
  const bad = await begin(me.id, "Plan the DSA exam.", {
    read: reader({ next: "draft", kind: "exam", facts: [{ label: "Exam", value: "DSA", quote: "DSA exam" }, { label: "Goal", value: "plan", quote: "Plan" }] }),
    write: writer({ ...SEMESTER, tasks: [...SEMESTER.tasks, { key: "late", title: "Revise trees after the exam", subject: "DSA", dueDay: inDays(40) }] }),
  });
  assert.deepEqual(bad.feasibility?.errors.map(e => e.code), ["after_deadline"]);
  const refused = await builder.approveDraft(me.id, bad.id, { version: bad.version });
  assert.ok(!refused.ok && refused.error === "invalid" && refused.message.includes("Revise trees after the exam"));
  assert.equal(await prisma.novaWorkspace.count({ where: { profileId: me.profileId } }), 0);

  // Fixed by the learner on the page, it builds.
  const fixed = { ...bad.plan!, tasks: bad.plan!.tasks.filter(t => t.key !== "late") };
  const edited = await builder.editDraftPlan(me.id, bad.id, { plan: fixed, baseVersion: bad.version });
  assert.ok(edited.ok);
  const built = await builder.approveDraft(me.id, bad.id, { version: edited.ok ? edited.draft.version : 0 });
  assert.ok(built.ok && built.draft.status === "ready", built.ok ? "" : built.message);
  const tasks = await prisma.novaTask.findMany({ where: { profileId: me.profileId }, select: { id: true, title: true } });
  const id = (title: string) => tasks.find(t => t.title === title)!.id;
  assert.deepEqual(await prisma.novaTaskDependency.findMany({ where: { taskId: id("Implement a heap") }, select: { dependsOnId: true } }), [{ dependsOnId: id("Implement a BST") }]);

  // A change to the workspace: the scheduling task now waits on Big-O; the heap waits on nothing.
  const change = await say(me.id, bad.id, "The scheduling work should wait for the Big-O problems, and the heap shouldn't wait on anything.", {
    read: reader({ next: "revise", change: "Scheduling waits on Big-O; heap waits on nothing", touches: ["tasks"] }), write: noWrite,
    writeChanges: async req => ({ ok: true, summary: null, ops: [
      { op: "update_task", taskId: req.current.tasks.find(t => t.title === "Simulate round-robin scheduling")!.id, after: [req.current.tasks.find(t => t.title === "Solve 10 Big-O problems")!.id] },
      { op: "update_task", taskId: req.current.tasks.find(t => t.title === "Implement a heap")!.id, after: [] },
    ] }),
  });
  assert.equal(change.changes?.ops.length, 2, JSON.stringify(change.changes));
  const applied = await builder.approveDraft(me.id, bad.id, { version: change.version });
  assert.ok(applied.ok, applied.ok ? "" : applied.message);
  const waits = await prisma.novaTaskDependency.findMany({ where: { task: { profileId: me.profileId } }, select: { taskId: true, dependsOnId: true } });
  assert.deepEqual(waits, [{ taskId: id("Simulate round-robin scheduling"), dependsOnId: id("Solve 10 Big-O problems") }]);
  const map = await loadNovaKnowledgeMap(me.id);
  assert.ok(map.status === "ready" && map.edges.filter(e => e.kind === "depends_on").length === 1);

  // A task deleted takes its waits with it.
  await prisma.novaTask.delete({ where: { id: id("Solve 10 Big-O problems") } });
  assert.equal(await prisma.novaTaskDependency.count({ where: { task: { profileId: me.profileId } } }), 0);
});

test("a proposal is revised by operations: a nesting-only change is a new version, and nothing else moves", async () => {
  const me = await learner();
  const first = await begin(me.id, "Plan my semester 5", {
    read: reader({ next: "draft", kind: "semester", facts: [{ label: "Semester", value: "5", quote: "semester 5" }, { label: "Goal", value: "plan", quote: "Plan" }] }), write: writer(SEMESTER),
  });
  const v = first.version;
  const second = await say(me.id, first.id, "Make writing delete a step of writing insert.", {
    read: reader({ next: "revise", change: "Write delete under Write insert", touches: ["tasks"] }), write: noWrite,
    writeChanges: async () => ({ ok: true, summary: null, ops: [{ op: "update_task", taskId: "bst-del", parentId: "bst-ins" }] }),
  });
  assert.equal(second.version, v + 1);
  assert.equal(second.plan!.tasks.find(t => t.key === "bst-del")!.parent, "bst-ins");
  assert.deepEqual(second.plan!.subjects, first.plan!.subjects);
  assert.deepEqual(second.plan!.tasks.filter(t => t.key !== "bst-del"), first.plan!.tasks.filter(t => t.key !== "bst-del"));
});

test("an older learner's rows still read: no positions, no parents, an older plan; the map scopes and switches workspaces", async () => {
  const me = await learner();
  // As written before 26 Oct: topics created in order, no position, no parent.
  const at = Date.now() - 86_400_000;
  await prisma.novaAcademicProfile.update({ where: { id: me.profileId }, data: { onboardingComplete: true } });
  const subject = await prisma.novaSubject.create({ data: { profileId: me.profileId, name: "Chemistry" } });
  for (const [i, name] of ["Atoms", "Bonding", "Acids"].entries()) await prisma.novaTopicMastery.create({ data: { subjectId: subject.id, name, createdAt: new Date(at + i) } });
  const oldPlan = { version: 1, kind: "custom", title: "Chemistry", subjects: [{ name: "Chemistry", topics: [{ name: "Atoms", unit: "Unit 1", subtopics: ["Isotopes"], explanation: null, sources: [] }] }], phases: [], tasks: [], dates: [], notes: [], resources: [], sources: [], assumptions: [], prerequisites: [] };
  const ws = await prisma.novaWorkspace.create({ data: { profileId: me.profileId, kind: "custom", title: "Chemistry", plan: oldPlan, subjectIds: [subject.id], clientKey: `old-${STAMP}` } });
  const detail = (await workspaceDetail(me.id, me.profileId, ws.id))!;
  assert.deepEqual(detail.subjects[0]!.topics.map(t => [t.name, t.parentId ?? null]), [["Atoms", null], ["Bonding", null], ["Acids", null]]);

  // Adding a topic after them puts it last, and gives the older rows their order.
  const s = await loadStudyStructure(me.profileId);
  assert.ok((await applyStudyEdits(me.profileId, { version: s.version, edits: [{ op: "add_topics", subjectId: subject.id, names: ["Organic chemistry"] }] })).ok);
  const ordered = await prisma.novaTopicMastery.findMany({ where: { subjectId: subject.id }, orderBy: { position: "asc" }, select: { name: true, position: true } });
  assert.deepEqual(ordered.map(t => t.name), ["Atoms", "Bonding", "Acids", "Organic chemistry"]);

  // A second workspace, worked on later, is the map's default; "all" draws both; an unfiled task is drawn too.
  const other = await prisma.novaSubject.create({ data: { profileId: me.profileId, name: "Physics", topics: { create: [{ name: "Optics" }] } } });
  const later = await prisma.novaWorkspace.create({ data: { profileId: me.profileId, kind: "custom", title: "Physics", plan: oldPlan, subjectIds: [other.id], clientKey: `later-${STAMP}` } });
  await prisma.novaTask.create({ data: { profileId: me.profileId, title: "Buy a lab coat", clientKey: `ws:later-${STAMP}:coat` } });
  const byDefault = await loadNovaKnowledgeMap(me.id);
  assert.ok(byDefault.status === "ready" && byDefault.workspaceId === later.id);
  assert.ok(byDefault.status === "ready" && byDefault.nodes.every(x => x.type !== "subject" || x.label === "Physics"));
  assert.ok(byDefault.status === "ready" && byDefault.nodes.some(x => x.type === "task" && x.label === "Buy a lab coat"));
  assert.ok(byDefault.status === "ready" && byDefault.workspaces!.map(w => w.title).join(",") === "Physics,Chemistry");
  const chem = await loadNovaKnowledgeMap(me.id, { workspace: ws.id });
  assert.ok(chem.status === "ready" && chem.nodes.filter(x => x.type === "topic").map(x => x.label).join(",") === "Atoms,Bonding,Acids,Organic chemistry");
  const all = await loadNovaKnowledgeMap(me.id, { workspace: "all" });
  assert.ok(all.status === "ready" && all.workspaceId === null && all.nodes.filter(x => x.type === "subject").length === 2);
  // Another learner's workspace id draws nothing of theirs: it falls back to everything that is mine.
  const stranger = await learner();
  const foreign = await loadNovaKnowledgeMap(stranger.id, { workspace: ws.id });
  assert.ok(foreign.status === "ready" ? foreign.nodes.length === 0 : true);
});

after(async () => {
  await prisma.messengerUser.deleteMany({ where: { platformChatId: { in: ids } } });
  await prisma.$disconnect();
});
