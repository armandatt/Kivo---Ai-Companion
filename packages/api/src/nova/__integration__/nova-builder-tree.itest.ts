/**
 * Build with Nova: trees of tasks, the learner's priorities, versions and
 * confirmed deletion — real Postgres.
 *
 * What it proves, with both models stood in:
 *   - a plan nested three deep is built as that tree (NovaTask.parentId),
 *     shown back as it is stored and drawn on the Knowledge Map, step under
 *     task under milestone;
 *   - Nova's priorities are suggestions: nothing it wrote becomes a priority,
 *     and the learner's own survive Nova's next version and are what is built;
 *   - the tree's rules hold in the database: no loops, no parent of another
 *     learner's, steps moved up (not lost) when their task goes;
 *   - change sets add steps, move tasks, remove a task with its open steps
 *     (finished ones stay) and remove a date;
 *   - every version is kept; restoring a proposal makes a new version and
 *     keeps the rest; restoring something built proposes the changes that
 *     bring it back, applied only on approval;
 *   - deleting happens only on confirmation with the fingerprint shown, keeps
 *     what is the learner's (studied topics, finished tasks, notes they
 *     edited), can be brought back from the history, and a chat message
 *     never confirms it;
 *   - another learner reaches none of it.
 *
 *   NOVA_TEST_DATABASE_URL=postgresql://... npm run test:integration
 */

import "./test-database.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

process.env.TELEGRAM_BOT_TOKEN = "";
process.env.GEMINI_API_KEY = "";
process.env.OPENAI_API_KEY = "";

const { prisma } = await import("@repo/db/client");
const builder = await import("../product/builder.js");
const { readTurn } = await import("../product/builder-state.js");
const { checkWorkspacePlan } = await import("../product/workspace-plan.js");
const { keepLearnerPriorities } = await import("../product/workspace-generation.js");
const { createTask, updateTask, deleteTask, listTasks } = await import("../product/tasks.js");
const { ensureSetupProfile } = await import("../product/setup.js");
const { loadNovaKnowledgeMap } = await import("../product/knowledge-map.js");

import type { BuilderDeps } from "../product/builder.js";
import type { ChangesRequest } from "../product/workspace-generation.js";

const STAMP = Date.now();
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const ids: string[] = [];
let n = 0;

async function learner(): Promise<{ id: string; profileId: () => Promise<string> }> {
  const id = `web:btr_${STAMP}_${n++}`;
  ids.push(id);
  await prisma.messengerUser.create({ data: { platform: "web", platformChatId: id, persona: "nova", displayName: "Avi" } });
  return { id, profileId: async () => (await ensureSetupProfile(id))!.profileId };
}
const key = () => `btr-${STAMP}-${n++}-abcdef`;

const FACTS = [{ label: "Project", value: "Kivo v1", quote: "Kivo v1" }, { label: "Deadline", value: "four days", quote: "four days" }];
const reader = (raw: Record<string, unknown>): NonNullable<BuilderDeps["read"]> => async input =>
  readTurn({ reply: "OK.", facts: FACTS, assumptions: [], suggestions: [], question: null, kind: "project", ...raw }, input.messages.filter(m => m.role === "user").map(m => m.text).join("\n"), []);
// The real writer's handling around the model: checked as Nova's, the learner's priorities kept.
const writer = (raw: () => Record<string, unknown>): NonNullable<BuilderDeps["write"]> => async req =>
  keepLearnerPriorities(checkWorkspacePlan({ ...raw(), kind: "custom" }, { today: req.today, userText: req.learnerText, author: "nova", kind: req.kind }), req.current);
const changer = (ops: (req: ChangesRequest) => unknown[]): NonNullable<BuilderDeps["writeChanges"]> => async req => ({ ok: true, summary: null, ops: ops(req) });

// Kivo v1: one project, two milestones, tasks with steps three deep, a date.
const kivo = (over: Record<string, unknown> = {}) => ({
  title: "Kivo v1", summary: "Four days to finish Kivo v1.",
  subjects: [{ name: "Kivo", topics: [] }],
  phases: [{ name: "Product readiness", subject: "Kivo" }, { name: "Release readiness", subject: "Kivo" }],
  tasks: [
    { key: "builder", title: "Finalize Nova Builder", topic: "Product readiness", subject: "Kivo", priority: "high", priorityReason: "the release waits on it", steps: [
      { key: "tree", title: "Implement recursive task hierarchy", steps: [{ key: "col", title: "Add the parent column" }, { key: "loops", title: "Refuse loops" }] },
      { key: "persist", title: "Validate parent-child persistence" },
    ] },
    { key: "map", title: "Test Knowledge Map integration", topic: "Product readiness", subject: "Kivo" },
    { key: "reg", title: "Run regression tests", topic: "Release readiness", subject: "Kivo", dueDay: inDays(3) },
  ],
  dates: [{ title: "Launch", subject: "Kivo", kind: "project", day: inDays(4) }],
  notes: [{ key: "scope", title: "Kivo v1 scope", subject: "Kivo", body: "# Scope\n- Builder\n- Map", origin: "nova" }],
  ...over,
});

async function begin(id: string, deps: BuilderDeps, text = "Plan Kivo v1 in four days") {
  const started = await builder.startDraft(id, { clientKey: key(), text });
  assert.ok(started.ok && started.job, started.ok ? "" : started.message);
  await builder.runJob(id, started.job!, deps);
  return (await builder.getDraft(id, started.draft.id))!;
}
async function say(id: string, draftId: string, text: string, deps: BuilderDeps) {
  const claimed = await builder.postMessage(id, draftId, { text });
  assert.ok(claimed.ok, claimed.ok ? "" : claimed.message);
  await builder.runJob(id, claimed.job, deps);
  return (await builder.getDraft(id, draftId))!;
}
async function built(me: { id: string }) {
  const draft = await begin(me.id, { read: reader({ next: "draft" }), write: writer(kivo) });
  const done = await builder.approveDraft(me.id, draft.id, { version: draft.version });
  assert.ok(done.ok && done.draft.status === "ready", done.ok ? "" : done.message);
  return done.draft;
}
const tasksOf = (profileId: string) => prisma.novaTask.findMany({ where: { profileId }, select: { id: true, title: true, parentId: true, priority: true, status: true, topicName: true } });

before(async () => { await prisma.$queryRaw`SELECT 1`; });
after(async () => {
  await prisma.messengerUser.deleteMany({ where: { platformChatId: { in: ids } } });
  await prisma.$disconnect();
});

test("a plan nested three deep is built as that tree, shown back as stored, and drawn on the map", async () => {
  const me = await learner();
  const draft = await begin(me.id, { read: reader({ next: "draft" }), write: writer(kivo) });
  const plan = draft.plan!;
  // Nova's "high" is a suggestion with its basis; nothing is set.
  const b = plan.tasks.find(t => t.title === "Finalize Nova Builder")!;
  assert.deepEqual([b.priority, b.suggestedPriority, b.priorityReason], [null, "high", "the release waits on it"]);
  assert.equal(plan.tasks.find(t => t.title === "Refuse loops")!.parent, plan.tasks.find(t => t.title === "Implement recursive task hierarchy")!.key);

  const done = await builder.approveDraft(me.id, draft.id, { version: draft.version });
  assert.ok(done.ok && done.draft.status === "ready");
  const profileId = await me.profileId();
  const rows = await tasksOf(profileId);
  const by = (title: string) => rows.find(r => r.title === title)!;
  assert.equal(by("Implement recursive task hierarchy").parentId, by("Finalize Nova Builder").id);
  assert.equal(by("Refuse loops").parentId, by("Implement recursive task hierarchy").id);
  assert.equal(by("Finalize Nova Builder").parentId, null);
  // A step is filed under its task's milestone; no priority was written.
  assert.equal(by("Refuse loops").topicName, "Product readiness");
  assert.ok(rows.every(r => r.priority === null));
  // Shown back as stored.
  const live = done.draft.current!;
  assert.equal(live.tasks.find(t => t.title === "Add the parent column")!.parentId, by("Implement recursive task hierarchy").id);
  // The map: milestone → task → step → step.
  await prisma.novaAcademicProfile.update({ where: { id: profileId }, data: { onboardingComplete: true } });
  const map = await loadNovaKnowledgeMap(me.id);
  assert.equal(map.status, "ready");
  if (map.status !== "ready") return;
  const topic = map.nodes.find(x => x.type === "topic" && x.label === "Product readiness")!;
  assert.ok(map.edges.some(e => e.kind === "task_of" && e.from === topic.id && e.to === `task:${by("Finalize Nova Builder").id}`));
  assert.ok(map.edges.some(e => e.kind === "has_step" && e.from === `task:${by("Implement recursive task hierarchy").id}` && e.to === `task:${by("Refuse loops").id}`));
  const root = map.nodes.find(x => x.id === `task:${by("Finalize Nova Builder").id}`)!;
  assert.ok(root.type === "task" && root.steps === 4);
  // The history: Nova's first version and what it built.
  const history = await builder.draftVersions(me.id, draft.id);
  assert.ok(history.ok);
  if (history.ok) assert.deepEqual(history.versions.map(v => `${v.kind}:${v.version}`).sort(), ["applied:1", "proposal:1"]);
});

test("the learner's priority survives Nova's next version, and only theirs is built", async () => {
  const me = await learner();
  let draft = await begin(me.id, { read: reader({ next: "draft" }), write: writer(kivo) });
  const plan = draft.plan!;
  const mine = { ...plan, tasks: plan.tasks.map(t => (t.title === "Run regression tests" ? { ...t, priority: "low" as const } : t)) };
  const edited = await builder.editDraftPlan(me.id, draft.id, { plan: mine, baseVersion: draft.version });
  assert.ok(edited.ok);
  // Nova revises and says "high" for that task: a suggestion; the learner's "low" stays.
  draft = await say(me.id, draft.id, "add a smoke test", { read: reader({ next: "revise", change: "add a smoke test" }), write: writer(() => kivo({ tasks: [...(kivo().tasks as object[]).map(t => ((t as { key: string }).key === "reg" ? { ...t, priority: "high" } : t)), { key: "smoke", title: "Run a smoke test", topic: "Release readiness", priority: "high" }] })) });
  const reg = draft.plan!.tasks.find(t => t.title === "Run regression tests")!;
  assert.deepEqual([reg.priority, reg.suggestedPriority], ["low", "high"]);
  assert.equal(draft.plan!.tasks.find(t => t.title === "Run a smoke test")!.priority, null);
  const done = await builder.approveDraft(me.id, draft.id, { version: draft.version });
  assert.ok(done.ok);
  const rows = await tasksOf(await me.profileId());
  assert.deepEqual(rows.filter(r => r.priority).map(r => [r.title, r.priority]), [["Run regression tests", "low"]]);
});

test("the tree's rules hold in the database: no loops, no parent of another learner's, steps move up", async () => {
  const me = await learner(), other = await learner();
  const profileId = await me.profileId(), otherProfile = await other.profileId();
  const a = await createTask(profileId, { title: "Ship" });
  assert.ok(a.ok);
  const b = await createTask(profileId, { title: "Build", parentId: a.ok ? a.task.id : "" });
  const c = await createTask(profileId, { title: "Test", parentId: b.ok ? b.task.id : "" });
  assert.ok(b.ok && c.ok);
  const [aid, bid, cid] = [a.ok ? a.task.id : "", b.ok ? b.task.id : "", c.ok ? c.task.id : ""];
  // Inside its own steps: refused, and nothing changes.
  const loop = await updateTask(profileId, aid, { parentId: cid });
  assert.equal(loop.ok, false);
  assert.equal((await prisma.novaTask.findUnique({ where: { id: aid } }))!.parentId, null);
  // Another learner's task is no parent.
  const theirs = await createTask(otherProfile, { title: "Theirs" });
  const foreign = await createTask(profileId, { title: "Mine", parentId: theirs.ok ? theirs.task.id : "" });
  assert.equal(foreign.ok, false);
  // The board lists parents; removing a task moves its steps up.
  assert.equal((await listTasks(profileId)).tasks.find(t => t.id === cid)!.parentId, bid);
  assert.ok(await deleteTask(profileId, bid));
  assert.equal((await prisma.novaTask.findUnique({ where: { id: cid } }))!.parentId, aid);
});

test("a change set adds steps, moves a task, removes a task with its open steps and removes a date", async () => {
  const me = await learner();
  const draft = await built(me);
  const profileId = await me.profileId();
  const before = await tasksOf(profileId);
  const by = (title: string) => before.find(r => r.title === title)!;
  // A finished step stays when its task is removed.
  await prisma.novaTask.update({ where: { id: by("Validate parent-child persistence").id }, data: { status: "done", completedAt: new Date() } });
  const next = await say(me.id, draft.id, "break the map test down, move regression under it, drop the builder task and the launch date", {
    read: reader({ next: "revise", change: "restructure", touches: ["tasks", "dates"] }),
    writeChanges: changer(req => [
      { op: "add_task", key: "ui", title: "Check the map draws steps", parentId: by("Test Knowledge Map integration").id },
      { op: "add_task", key: "ui2", title: "Check the indentation", parentKey: "ui" },
      { op: "update_task", taskId: by("Run regression tests").id, parentId: by("Test Knowledge Map integration").id },
      { op: "remove_task", taskId: by("Finalize Nova Builder").id },
      { op: "remove_date", dateId: req.current.dates[0]!.id },
    ]),
  });
  assert.equal(next.status, "awaiting_approval");
  const says = next.changes!.ops.map(o => o.says);
  assert.ok(says.some(s => s.startsWith('Remove task "Finalize Nova Builder" and its 4 open steps') || s.startsWith('Remove task "Finalize Nova Builder" and its 3 open steps')), says.join(" | "));
  const done = await builder.approveDraft(me.id, draft.id, { version: next.version });
  assert.ok(done.ok, done.ok ? "" : done.message);
  const rows = await tasksOf(profileId);
  const now = (title: string) => rows.find(r => r.title === title);
  assert.equal(now("Check the map draws steps")!.parentId, by("Test Knowledge Map integration").id);
  assert.equal(now("Check the indentation")!.parentId, now("Check the map draws steps")!.id);
  assert.equal(now("Run regression tests")!.parentId, by("Test Knowledge Map integration").id);
  assert.equal(now("Finalize Nova Builder"), undefined);
  assert.equal(now("Refuse loops"), undefined);
  // The finished step stayed, and now stands on its own.
  assert.equal(now("Validate parent-child persistence")!.status, "done");
  assert.equal(now("Validate parent-child persistence")!.parentId, null);
  assert.equal(await prisma.novaExam.count({ where: { profileId } }), 0);
});

test("versions: restoring a proposal makes a new one and keeps the rest; restoring what was built proposes the way back", async () => {
  const me = await learner();
  // Two proposals, then back to the first.
  let draft = await begin(me.id, { read: reader({ next: "draft" }), write: writer(kivo) });
  draft = await say(me.id, draft.id, "drop the map test", { read: reader({ next: "revise", change: "drop the map test" }), write: writer(() => kivo({ tasks: (kivo().tasks as Array<{ key: string }>).filter(t => t.key !== "map") })) });
  assert.equal(draft.version, 2);
  let history = await builder.draftVersions(me.id, draft.id);
  assert.ok(history.ok);
  const v1 = history.ok ? history.versions.find(v => v.version === 1 && v.kind === "proposal")! : null;
  assert.ok(v1?.restores?.startsWith("Makes this the proposal again"));
  const stale = await builder.restoreVersion(me.id, draft.id, { versionId: v1!.id, baseVersion: 1 });
  assert.equal(stale.ok, false);
  const restored = await builder.restoreVersion(me.id, draft.id, { versionId: v1!.id, baseVersion: draft.version });
  assert.ok(restored.ok, restored.ok ? "" : restored.message);
  assert.equal(restored.draft.version, 3);
  assert.ok(restored.draft.plan!.tasks.some(t => t.title === "Test Knowledge Map integration"));
  history = await builder.draftVersions(me.id, draft.id);
  assert.ok(history.ok && history.versions.filter(v => v.kind === "proposal").length === 3);

  // Built, then changed: version 3's records come back through a change set.
  const done = await builder.approveDraft(me.id, draft.id, { version: 3 });
  assert.ok(done.ok);
  const profileId = await me.profileId();
  const mapTask = (await tasksOf(profileId)).find(t => t.title === "Test Knowledge Map integration")!;
  let next = await say(me.id, draft.id, "remove the map test", { read: reader({ next: "revise", change: "remove", touches: ["tasks"] }), writeChanges: changer(() => [{ op: "remove_task", taskId: mapTask.id }]) });
  assert.ok((await builder.approveDraft(me.id, draft.id, { version: next.version })).ok);
  assert.equal((await tasksOf(profileId)).some(t => t.title === "Test Knowledge Map integration"), false);
  history = await builder.draftVersions(me.id, draft.id);
  assert.ok(history.ok);
  const built3 = history.ok ? history.versions.find(v => v.kind === "applied" && v.version === 3)! : null;
  next = (await builder.getDraft(me.id, draft.id))!;
  const back = await builder.restoreVersion(me.id, draft.id, { versionId: built3!.id, baseVersion: next.version });
  assert.ok(back.ok, back.ok ? "" : back.message);
  // Proposed, not applied.
  assert.equal(back.draft.status, "awaiting_approval");
  assert.ok(back.draft.changes!.ops.some(o => o.op === "add_task" && o.title === "Test Knowledge Map integration"));
  assert.equal((await tasksOf(profileId)).some(t => t.title === "Test Knowledge Map integration"), false);
  assert.ok((await builder.approveDraft(me.id, draft.id, { version: back.draft.version })).ok);
  assert.equal((await tasksOf(profileId)).some(t => t.title === "Test Knowledge Map integration"), true);
});

test("deleting happens only on confirmation, keeps what is theirs, and can be brought back", async () => {
  const me = await learner(), other = await learner();
  const draft = await built(me);
  const profileId = await me.profileId();
  const topics = await prisma.novaTopicMastery.findMany({ where: { subject: { profileId } }, select: { id: true, name: true } });
  // Studied, finished and edited: these are the learner's.
  await prisma.novaTopicMastery.update({ where: { id: topics.find(t => t.name === "Release readiness")!.id }, data: { reviewCount: 1 } });
  const reg = (await tasksOf(profileId)).find(t => t.title === "Run regression tests")!;
  await prisma.novaTask.update({ where: { id: reg.id }, data: { status: "done", completedAt: new Date() } });
  const scopeNote = await prisma.novaNote.findFirst({ where: { profileId, title: "Kivo v1 scope" } });
  await prisma.novaNote.update({ where: { id: scopeNote!.id }, data: { createdAt: new Date(Date.now() - 60_000) } });
  await prisma.novaNote.update({ where: { id: scopeNote!.id }, data: { body: "# Scope\n- Builder\n- Map\n- My own line" } });
  const counts = async () => ({
    workspaces: await prisma.novaWorkspace.count({ where: { profileId } }), tasks: await prisma.novaTask.count({ where: { profileId } }),
    exams: await prisma.novaExam.count({ where: { profileId } }), notes: await prisma.novaNote.count({ where: { profileId } }),
  });
  const before = await counts();

  // Asked: the scope is shown and nothing goes.
  let d = await say(me.id, draft.id, "delete the kivo as the project from everywhere", { read: reader({ next: "delete", resource: { name: "Kivo v1", intent: "delete" } }) });
  assert.ok(d.deletion);
  assert.deepEqual(await counts(), before);
  assert.ok(d.deletion!.keeps.topics.includes("Release readiness"));
  assert.equal(d.deletion!.keeps.finishedTasks, 1);
  assert.ok(d.deletion!.keeps.notes.includes("Kivo v1 scope"));
  assert.ok(d.messages.at(-1)!.text.includes("Nothing is deleted until you confirm"));
  // A "yes" in chat is talk, not a confirmation.
  d = await say(me.id, draft.id, "yes delete it", { read: reader({ next: "chat" }) });
  assert.ok(d.deletion);
  assert.deepEqual(await counts(), before);
  // Another learner can't; a different fingerprint can't.
  assert.equal((await builder.confirmDeletion(other.id, draft.id, { fingerprint: d.deletion!.fingerprint })).ok, false);
  assert.equal((await builder.confirmDeletion(me.id, draft.id, { fingerprint: "nope" })).ok, false);
  assert.deepEqual(await counts(), before);

  const gone = await builder.confirmDeletion(me.id, draft.id, { fingerprint: d.deletion!.fingerprint });
  assert.ok(gone.ok, gone.ok ? "" : gone.message);
  assert.equal(gone.draft.deletion, null);
  const after_ = await counts();
  assert.equal(after_.workspaces, 0);
  assert.equal(after_.exams, 0);
  // Left: the finished task and the edited note; the studied topic and its subject.
  assert.deepEqual((await prisma.novaTask.findMany({ where: { profileId }, select: { title: true } })).map(t => t.title), ["Run regression tests"]);
  assert.deepEqual((await prisma.novaNote.findMany({ where: { profileId }, select: { title: true } })).map(n => n.title), ["Kivo v1 scope"]);
  assert.deepEqual((await prisma.novaTopicMastery.findMany({ where: { subject: { profileId } }, select: { name: true } })).map(t => t.name), ["Release readiness"]);
  // Again: nothing waits, nothing more goes.
  assert.equal((await builder.confirmDeletion(me.id, draft.id, { fingerprint: d.deletion!.fingerprint })).ok, false);

  // Brought back from the history, as a proposal to approve.
  const history = await builder.draftVersions(me.id, draft.id);
  assert.ok(history.ok);
  const was = history.ok ? history.versions.find(v => v.kind === "deleted")! : null;
  assert.ok(was?.restores?.includes("building it again"), was?.restores ?? "");
  assert.equal((await builder.draftVersions(other.id, draft.id)).ok, false);
  const fresh = (await builder.getDraft(me.id, draft.id))!;
  const back = await builder.restoreVersion(me.id, draft.id, { versionId: was!.id, baseVersion: fresh.version });
  assert.ok(back.ok, back.ok ? "" : back.message);
  assert.equal(back.draft.status, "awaiting_approval");
  assert.ok(back.draft.plan!.tasks.some(t => t.title === "Implement recursive task hierarchy"));
  assert.equal(await prisma.novaWorkspace.count({ where: { profileId } }), 0);
});

test("the Knowledge Map after approval is exactly what the proposal showed: same parts, milestones, tasks, steps and notes", async () => {
  const { planPreview } = await import("../product/workspace-plan.js");
  const me = await learner();
  // As seen on 25 Oct: parts named apart from the milestones, tasks filed under the parts.
  const shaped = () => kivo({
    subjects: [{ name: "Kivo", topics: [{ name: "Home Page Development", subtopics: ["Workflow architecture"] }, { name: "Knowledge Map and Planner" }] }],
    phases: [{ name: "Home Page Sprint", subject: "Kivo", project: "Ship the home page" }, { name: "Knowledge Map & Planner Sprint", subject: "Kivo" }],
    tasks: [
      { key: "a", title: "Build home page workflow architecture", topic: "Home Page Development", steps: [{ key: "a1", title: "Map the flow", steps: [{ title: "List entry points" }] }] },
      { key: "b", title: "Develop knowledge map interface", topic: "Knowledge Map and Planner" },
    ],
  });
  const draft = await begin(me.id, { read: reader({ next: "draft" }), write: writer(shaped) });
  const preview = planPreview(draft.plan!);
  const done = await builder.approveDraft(me.id, draft.id, { version: draft.version });
  assert.ok(done.ok && done.draft.status === "ready");
  const profileId = await me.profileId();
  await prisma.novaAcademicProfile.update({ where: { id: profileId }, data: { onboardingComplete: true } });
  const map = await loadNovaKnowledgeMap(me.id);
  assert.equal(map.status, "ready");
  if (map.status !== "ready") return;
  const labels = (type: string) => map.nodes.filter(x => x.type === type).map(x => x.label).sort();
  // Parts and milestones: one subject, its milestones as its topics, once each.
  assert.deepEqual(labels("subject"), preview.subjects.map(s => s.name).sort());
  assert.deepEqual(labels("topic"), preview.subjects.flatMap(s => s.topics.map(t => t.name)).sort());
  assert.deepEqual(labels("topic"), ["Home Page Sprint", "Knowledge Map & Planner Sprint"]);
  // Tasks: the proposal's, plus only what the preview said Kivo adds (none here: the milestone has tasks).
  assert.deepEqual(labels("task"), [...draft.plan!.tasks.map(t => t.title), ...preview.added.map(t => t.title)].sort());
  assert.equal(preview.added.length, 0);
  // Notes: the proposal's own and the ones the preview said Kivo writes.
  assert.deepEqual(labels("note"), [...draft.plan!.notes.map(n => n.title), ...preview.written.map(n => n.title)].sort());
  // The hierarchy: milestone → task → step → step, as the Tasks view drew it.
  const node = (label: string) => map.nodes.find(x => x.label === label)!;
  const edge = (from: string, to: string, kind: string) => map.edges.some(e => e.from === node(from).id && e.to === node(to).id && e.kind === kind);
  assert.ok(edge("Kivo", "Home Page Sprint", "has_topic"));
  assert.ok(edge("Home Page Sprint", "Build home page workflow architecture", "task_of"));
  assert.ok(edge("Build home page workflow architecture", "Map the flow", "has_step"));
  assert.ok(edge("Map the flow", "List entry points", "has_step"));
  assert.ok(edge("Knowledge Map & Planner Sprint", "Develop knowledge map interface", "task_of"));
  // Nothing on the map that the preview did not show.
  assert.equal(map.nodes.length, labels("subject").length + labels("topic").length + labels("task").length + labels("note").length);
});
