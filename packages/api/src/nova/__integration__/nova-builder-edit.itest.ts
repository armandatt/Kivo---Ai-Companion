/**
 * Build with Nova on what the learner already has — real Postgres.
 *
 * What it proves, with both models stood in: a new conversation that names
 * something of theirs ("my DSA plan") finds it among their own records and
 * proposes changes to it, never a duplicate; "open" shows it and changes
 * nothing; a name that could be several asks which, and one that is none
 * says so; changes apply only on approval, through the records' own writers,
 * and leave everything else as it was (task progress included); an old
 * conversation goes on and changes what it built; approving twice applies
 * once; a change set that no longer fits what is there is refused whole;
 * deleting a conversation keeps everything it built; and one learner can
 * neither find nor change another's records.
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
const { listTasks, createTask } = await import("../product/tasks.js");
const { applyStudyEdits, loadStudyStructure } = await import("../product/setup-edit.js");
const { ensureSetupProfile } = await import("../product/setup.js");
const { loadNovaKnowledgeMap } = await import("../product/knowledge-map.js");

import type { BuilderDeps } from "../product/builder.js";
import type { ChangesRequest } from "../product/workspace-generation.js";

const STAMP = Date.now();
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const ids: string[] = [];
let n = 0;

async function learner(): Promise<{ id: string; profileId: () => Promise<string> }> {
  const id = `web:bed_${STAMP}_${n++}`;
  ids.push(id);
  await prisma.messengerUser.create({ data: { platform: "web", platformChatId: id, persona: "nova", displayName: "Mira" } });
  return { id, profileId: async () => (await ensureSetupProfile(id))!.profileId };
}
const key = () => `bed-${STAMP}-${n++}-abcdef`;

async function records(profileId: string) {
  const [subjects, topics, tasks, notes, exams, workspaces] = await Promise.all([
    prisma.novaSubject.count({ where: { profileId } }), prisma.novaTopicMastery.count({ where: { subject: { profileId } } }),
    prisma.novaTask.count({ where: { profileId } }), prisma.novaNote.count({ where: { profileId } }),
    prisma.novaExam.count({ where: { profileId } }), prisma.novaWorkspace.count({ where: { profileId } }),
  ]);
  return { subjects, topics, tasks, notes, exams, workspaces };
}

const reader = (raw: Record<string, unknown>): NonNullable<BuilderDeps["read"]> => async input =>
  readTurn({ reply: "OK.", facts: [], assumptions: [], suggestions: [], question: null, ...raw }, input.messages.filter(m => m.role === "user").map(m => m.text).join("\n"), []);
const changer = (ops: (req: ChangesRequest) => unknown[], seen?: ChangesRequest[]): NonNullable<BuilderDeps["writeChanges"]> => async req => {
  seen?.push(req);
  return { ok: true, summary: null, ops: ops(req) };
};
const noWrite: NonNullable<BuilderDeps["write"]> = async () => { throw new Error("a new plan was written"); };

async function begin(id: string, text: string, deps: BuilderDeps) {
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

// A DSA subject of their own, set up in Subject Studio (no workspace), with a task in progress.
async function withDsa(me: { profileId: () => Promise<string> }) {
  const profileId = await me.profileId();
  // Set up already (Subject Studio and the Map are for learners who are).
  await prisma.novaAcademicProfile.update({ where: { id: profileId }, data: { onboardingComplete: true } });
  const s = await loadStudyStructure(profileId);
  const r = await applyStudyEdits(profileId, { version: s.version, edits: [{ op: "add_subject", name: "Data Structures and Algorithms", topics: ["Arrays and strings", "Linked lists", "Trees"] }] });
  assert.ok(r.ok);
  const dsa = (await loadStudyStructure(profileId)).subjects.find(x => x.name === "Data Structures and Algorithms")!;
  const task = await createTask(profileId, { title: "Solve 10 tree problems", subjectId: dsa.id });
  assert.ok(task.ok);
  await prisma.novaTask.update({ where: { id: task.ok ? task.task.id : "" }, data: { status: "in_progress" } });
  return { profileId, dsa, taskId: task.ok ? task.task.id : "" };
}

before(async () => { await prisma.$queryRaw`SELECT 1`; });
after(async () => {
  await prisma.messengerUser.deleteMany({ where: { platformChatId: { in: ids } } });
  await prisma.$disconnect();
});

test("a new chat naming their DSA plan opens that subject and proposes changes to it, never a duplicate", async () => {
  const me = await learner();
  const { profileId, dsa, taskId } = await withDsa(me);
  const before = await records(profileId);
  const seen: ChangesRequest[] = [];
  const draft = await begin(me.id, "Open my existing DSA plan and add dynamic programming topics", {
    read: reader({ next: "draft", change: "Add dynamic programming topics", resource: { name: "DSA plan", intent: "change" } }),
    write: noWrite,
    writeChanges: changer(req => [
      { op: "add_topics", subjectId: req.current.subjects[0]!.id, names: ["Memoization and tabulation", "Knapsack problems", "Introduction", "Trees"], why: "DP builds on recursion" },
      { op: "rename_topic", topicId: "not-a-topic-of-theirs", name: "x" },
    ], seen),
  });
  // Found among their own records and shown as it is now.
  assert.equal(draft.resource?.kind, "subjects");
  assert.deepEqual(draft.resource?.subjectIds, [dsa.id]);
  assert.deepEqual(draft.current!.subjects[0]!.topics.map(t => t.name), ["Arrays and strings", "Linked lists", "Trees"]);
  assert.ok(seen[0]!.current.subjects[0]!.topics.some(t => t.id === dsa.topics[0]!.id));
  // One change, with only the specific new topics: a placeholder, a repeat and a foreign id left out, said why.
  assert.equal(draft.changes!.ops.length, 1);
  assert.deepEqual(draft.changes!.ops[0]!.op === "add_topics" && draft.changes!.ops[0]!.names, ["Memoization and tabulation", "Knapsack problems"]);
  assert.ok(draft.changes!.dropped.some(d => d.includes("Introduction")) && draft.changes!.dropped.some(d => d.includes("already has it")));
  assert.equal(draft.status, "awaiting_approval");
  assert.ok(draft.messages.some(m => m.text.includes("I found Data Structures and Algorithms")));
  // Nothing written before approval.
  assert.deepEqual(await records(profileId), before);

  const done = await builder.approveDraft(me.id, draft.id, { version: draft.version });
  assert.ok(done.ok && done.draft.status === "ready", done.ok ? "" : done.message);
  const after_ = await records(profileId);
  assert.deepEqual(after_, { ...before, topics: before.topics + 2 });
  const structure = await loadStudyStructure(profileId);
  assert.deepEqual(structure.subjects.map(s => s.name), ["Data Structures and Algorithms"]);
  assert.deepEqual(structure.subjects[0]!.topics.map(t => t.name), ["Arrays and strings", "Linked lists", "Trees", "Memoization and tabulation", "Knapsack problems"]);
  // Unrelated content as it was: the task, its progress, the topic ids.
  const task = (await listTasks(profileId)).tasks.find(t => t.id === taskId)!;
  assert.equal(task.status, "in_progress");
  assert.equal(structure.subjects[0]!.topics[0]!.id, dsa.topics[0]!.id);
  // The Knowledge Map shows the same records.
  const map = await loadNovaKnowledgeMap(me.id);
  assert.ok(map.status === "ready" && map.nodes.some(nd => nd.id === `topic:${structure.subjects[0]!.topics[4]!.id}`));
  // The view names what the page opens on the map.
  assert.deepEqual(done.ok && done.draft.current!.subjects.map(s => s.id), [dsa.id]);

  // Approving again applies nothing twice.
  const again = await builder.approveDraft(me.id, draft.id, { version: draft.version });
  assert.ok(again.ok);
  assert.deepEqual(await records(profileId), after_);
});

test("'open my DSA plan' shows it as it is and changes nothing", async () => {
  const me = await learner();
  const { profileId } = await withDsa(me);
  const before = await records(profileId);
  const draft = await begin(me.id, "Show me my DSA plan", {
    read: reader({ next: "chat", resource: { name: "DSA", intent: "open" } }), write: noWrite,
    writeChanges: async () => { throw new Error("changes were written for an open"); },
  });
  assert.equal(draft.resource?.title, "Data Structures and Algorithms");
  assert.equal(draft.changes, null);
  assert.equal(draft.status, "discovery");
  assert.ok(draft.messages.at(-1)!.text.startsWith("Here's Data Structures and Algorithms as it is in Kivo now"));
  assert.deepEqual(await records(profileId), before);
});

test("a name that could be several asks which; the answer opens that one; a name that is none says so", async () => {
  const me = await learner();
  const profileId = await me.profileId();
  const s = await loadStudyStructure(profileId);
  assert.ok((await applyStudyEdits(profileId, { version: s.version, edits: [{ op: "add_subject", name: "DSA Lab", topics: ["Sorting lab"] }, { op: "add_subject", name: "DSA Theory", topics: ["Recurrences"] }] })).ok);
  const before = await records(profileId);

  let draft = await begin(me.id, "Add graphs to my DSA plan", { read: reader({ next: "draft", resource: { name: "DSA", intent: "change" } }), write: noWrite });
  assert.equal(draft.resource, null);
  assert.equal(draft.changes, null);
  assert.deepEqual(draft.brief.choices, ["DSA Lab", "DSA Theory"]);
  assert.ok(draft.messages.at(-1)!.text.includes("Which one do you mean?"));
  assert.deepEqual(await records(profileId), before);

  draft = await say(me.id, draft.id, "DSA Theory", {
    read: reader({ next: "draft", change: "Add graphs", resource: { name: "DSA Theory", intent: "change" } }), write: noWrite,
    writeChanges: changer(req => [{ op: "add_topics", subjectId: req.current.subjects[0]!.id, names: ["Graph traversal (BFS and DFS)"] }]),
  });
  assert.equal(draft.resource?.title, "DSA Theory");
  assert.equal(draft.changes!.ops.length, 1);

  const other = await begin(me.id, "Add a chapter to my Quantum Physics plan", { read: reader({ next: "draft", resource: { name: "Quantum Physics", intent: "change" } }), write: noWrite });
  assert.equal(other.resource, null);
  assert.ok(other.messages.at(-1)!.text.includes(`I couldn't find "Quantum Physics"`));
  assert.deepEqual(await records(profileId), before);
});

test("an old conversation goes on: it changes what it built, in place, and keeps progress", async () => {
  const me = await learner();
  const plan = () => ({
    title: "TrackerX", summary: "Ship TrackerX",
    subjects: [{ name: "TrackerX", topics: ["Tasks API", "Notifications"] }],
    phases: [{ name: "Tasks API", subject: "TrackerX" }, { name: "Notifications", subject: "TrackerX" }],
    tasks: [{ key: "api", title: "Build the tasks API", topic: "Tasks API", dueDay: inDays(10) }, { key: "notify", title: "Send reminders", topic: "Notifications", dueDay: inDays(20) }],
    dates: [{ title: "TrackerX launch", subject: "TrackerX", kind: "project", day: inDays(30) }],
  });
  const first = await begin(me.id, "Plan TrackerX, launching in a month.", {
    read: reader({ next: "draft", facts: [{ label: "Project", value: "TrackerX", quote: "TrackerX" }, { label: "Deadline", value: "in a month", quote: "in a month" }] }),
    write: async req => checkWorkspacePlan({ ...plan(), kind: "custom" }, { today: req.today, userText: req.learnerText }),
  });
  const built = await builder.approveDraft(me.id, first.id, { version: first.version });
  assert.ok(built.ok && built.draft.status === "ready");
  const profileId = await me.profileId();
  // Reopened, it shows the plan's own shape on the live records: its milestones, in order, with their tasks.
  const reopened = (await builder.getDraft(me.id, first.id))!;
  assert.deepEqual(reopened.current!.phases!.map(p => p.name), ["Tasks API", "Notifications"]);
  assert.equal(reopened.current!.tasks.find(t => t.title === "Build the tasks API")!.topicName, "Tasks API");
  const api = (await listTasks(profileId)).tasks.find(t => t.title === "Build the tasks API")!;
  await prisma.novaTask.update({ where: { id: api.id }, data: { status: "in_progress" } });
  const before = await records(profileId);

  // The same conversation, reopened later: its workspace is what it changes.
  const draft = await say(me.id, first.id, "The launch moved two weeks later. Update the plan, and put notifications before the API work.", {
    read: reader({ next: "draft", change: "Move the launch two weeks later; notifications first" }), write: noWrite,
    writeChanges: changer(req => {
      const launch = req.current.dates.find(d => d.title === "TrackerX launch")!;
      const notify = req.current.tasks.find(t => t.title === "Send reminders")!;
      const apiTask = req.current.tasks.find(t => t.title === "Build the tasks API")!;
      return [
        { op: "update_date", dateId: launch.id, day: inDays(44) },
        { op: "update_task", taskId: notify.id, dueDay: inDays(34) },
        { op: "order_tasks", taskIds: [notify.id, apiTask.id] },
        { op: "add_task", key: "beta", title: "Run a beta week", dueDay: inDays(40) },
      ];
    }),
  });
  assert.equal(draft.resource?.workspaceId, built.ok ? built.draft.workspace!.id : "");
  assert.equal(draft.changes!.ops.length, 4);
  assert.deepEqual(await records(profileId), before);

  const done = await builder.approveDraft(me.id, draft.id, { version: draft.version });
  assert.ok(done.ok && done.draft.status === "ready", done.ok ? "" : done.message);
  const tasks = (await listTasks(profileId)).tasks;
  assert.equal(tasks.find(t => t.id === api.id)!.status, "in_progress");
  assert.equal(tasks.find(t => t.title === "Send reminders")!.dueDay, inDays(34));
  // Notifications first: the board's own order (topics have none to change).
  const placed = await prisma.novaTask.findMany({ where: { profileId, title: { in: ["Send reminders", "Build the tasks API"] } }, select: { title: true, position: true } });
  assert.equal(placed.find(t => t.title === "Send reminders")!.position, 0);
  assert.equal(placed.find(t => t.title === "Build the tasks API")!.position, 1);
  assert.equal(done.ok && done.draft.current!.dates.find(d => d.title === "TrackerX launch")!.day, inDays(44));
  assert.deepEqual(await records(profileId), { ...before, tasks: before.tasks + 1 });

  // Approving again (a double click, a retry) adds nothing twice.
  assert.ok((await builder.approveDraft(me.id, draft.id, { version: draft.version })).ok);
  assert.deepEqual(await records(profileId), { ...before, tasks: before.tasks + 1 });
});

test("a change set that no longer fits what is there is refused whole, and proposed again on Try again", async () => {
  const me = await learner();
  const { profileId, taskId } = await withDsa(me);
  await prisma.novaTask.update({ where: { id: taskId }, data: { status: "todo" } });
  const draft = await begin(me.id, "Drop the tree problems task from my DSA plan and add a heap task", {
    read: reader({ next: "draft", resource: { name: "DSA", intent: "change" } }), write: noWrite,
    writeChanges: changer(req => [
      { op: "remove_task", taskId: req.current.tasks[0]!.id },
      { op: "add_task", key: "heap", title: "Implement a binary heap" },
    ]),
  });
  assert.equal(draft.changes!.ops.length, 2);
  const before = await records(profileId);
  // The learner finished the task meanwhile, on the board.
  await prisma.novaTask.update({ where: { id: taskId }, data: { status: "done" } });
  const refused = await builder.approveDraft(me.id, draft.id, { version: draft.version });
  assert.ok(!refused.ok && refused.error === "stale");
  assert.deepEqual(await records(profileId), before);
  assert.ok(!(await listTasks(profileId)).tasks.some(t => t.title === "Implement a binary heap"));
  assert.equal(!refused.ok && refused.draft!.failure!.stage, "drafting");
});

test("deleting a conversation removes only the conversation: what it built stays everywhere", async () => {
  const me = await learner();
  const { profileId } = await withDsa(me);
  const draft = await begin(me.id, "Add heaps to my DSA plan", {
    read: reader({ next: "draft", resource: { name: "DSA", intent: "change" } }), write: noWrite,
    writeChanges: changer(req => [{ op: "add_topics", subjectId: req.current.subjects[0]!.id, names: ["Binary heaps"] }]),
  });
  assert.ok((await builder.approveDraft(me.id, draft.id, { version: draft.version })).ok);
  const before = await records(profileId);

  // Another learner cannot delete it.
  const stranger = await learner();
  assert.deepEqual(await builder.deleteDraft(stranger.id, draft.id), { ok: false, error: "not_found", message: "That conversation isn't one of yours." });
  assert.ok(await builder.getDraft(me.id, draft.id));

  assert.deepEqual(await builder.deleteDraft(me.id, draft.id), { ok: true });
  assert.equal(await builder.getDraft(me.id, draft.id), null);
  assert.equal((await builder.listDrafts(me.id)).drafts.some(d => d.id === draft.id), false);
  assert.deepEqual(await records(profileId), before);
  const map = await loadNovaKnowledgeMap(me.id);
  assert.ok(map.status === "ready" && map.nodes.some(nd => nd.label === "Binary heaps"));
});

test("one learner can neither find nor change another's records", async () => {
  const owner = await learner();
  const { profileId: ownerProfile, dsa } = await withDsa(owner);
  const before = await records(ownerProfile);
  const other = await learner();
  // Their DSA is not this learner's: the name finds nothing of theirs.
  const draft = await begin(other.id, "Add DP to my DSA plan", { read: reader({ next: "draft", resource: { name: "DSA", intent: "change" } }), write: noWrite });
  assert.equal(draft.resource, null);
  assert.ok(draft.messages.at(-1)!.text.includes("I couldn't find"));

  // And ids of another learner's records, proposed for one's own, are left out.
  const mine = await withDsa(other);
  const proposed = await begin(other.id, "Add DP to my DSA plan", {
    read: reader({ next: "draft", resource: { name: "DSA", intent: "change" } }), write: noWrite,
    writeChanges: changer(() => [{ op: "add_topics", subjectId: dsa.id, names: ["Dynamic programming"] }, { op: "remove_topic", topicId: dsa.topics[0]!.id }]),
  });
  assert.equal(proposed.changes, null);
  assert.ok(proposed.messages.at(-1)!.text.startsWith("I couldn't turn that into a change"));
  assert.deepEqual(await records(ownerProfile), before);
  assert.notEqual(mine.dsa.id, dsa.id);
});

test("a subject inside a bigger workspace opens as that subject alone, and changes reach only it (seen 22 Oct)", async () => {
  const me = await learner();
  const profileId = await me.profileId();
  const first = await begin(me.id, "Plan my semester 5 exams: DSA and OS, exams in early December.", {
    read: reader({ next: "draft", facts: [{ label: "Subjects", value: "DSA and OS", quote: "DSA and OS" }, { label: "Exams", value: "early December", quote: "early December" }] }),
    write: async req => checkWorkspacePlan({ kind: "custom", title: "B.Tech CSE Semester 5 Exam Preparation",
      subjects: [{ name: "DSA", topics: [{ name: "Hashing", unit: "Unit 1", subtopics: ["Open addressing", "Chaining"] }, "Trees"] }, { name: "OS", topics: ["Scheduling", "Deadlocks"] }],
      tasks: [{ key: "os", title: "OS past paper", subject: "OS" }, { key: "dsa", title: "DSA tree problems", subject: "DSA" }] }, { today: req.today, userText: req.learnerText }),
  });
  assert.equal(first.status, "awaiting_approval", JSON.stringify(first.messages.map(m => m.text)));
  assert.ok((await builder.approveDraft(me.id, first.id, { version: first.version })).ok);
  const before = await records(profileId);

  const draft = await begin(me.id, "open my dsa workspace here", { read: reader({ next: "chat", resource: { name: "dsa workspace", intent: "open" } }), write: noWrite });
  assert.equal(draft.resource?.kind, "subjects");
  assert.equal(draft.resource?.title, "DSA");
  assert.deepEqual(draft.current!.subjects.map(s => s.name), ["DSA"]);
  assert.deepEqual(draft.current!.tasks.map(t => t.title), ["DSA tree problems"]);
  assert.equal(draft.current!.title, "DSA");
  // The subject keeps the outline its plan gave it.
  assert.deepEqual(draft.current!.subjects[0]!.topics[0], { ...draft.current!.subjects[0]!.topics[0]!, unit: "Unit 1", subtopics: ["Open addressing", "Chaining"] });

  const changed = await say(me.id, draft.id, "Add graphs to it", {
    read: reader({ next: "draft", change: "Add graphs" }), write: noWrite,
    writeChanges: changer(req => {
      assert.deepEqual(req.current.subjects.map(s => s.name), ["DSA"]);
      return [{ op: "add_topics", subjectId: req.current.subjects[0]!.id, names: ["Graph traversal (BFS and DFS)"] }];
    }),
  });
  assert.equal(changed.status, "awaiting_approval", JSON.stringify(changed.messages.map(m => m.text)));
  const done = await builder.approveDraft(me.id, changed.id, { version: changed.version });
  assert.ok(done.ok && done.draft.status === "ready", done.ok ? "" : done.message);
  assert.deepEqual(await records(profileId), { ...before, topics: before.topics + 1 });
  const s = await loadStudyStructure(profileId);
  assert.deepEqual(s.subjects.find(x => x.name === "OS")!.topics.map(t => t.name), ["Scheduling", "Deadlocks"]);
  // Still part of the semester workspace, which shows the new topic too.
  assert.equal((await builder.getDraft(me.id, first.id))!.current!.subjects.find(x => x.name === "DSA")!.topics.length, 3);
});

test("a subject that belongs elsewhere is removed from the workspace with its topics; its tasks stay, unfiled (seen 22 Oct)", async () => {
  const me = await learner();
  const profileId = await me.profileId();
  const first = await begin(me.id, "Plan my semester 5 exams: DSA and Prompt Engineering, exams in early December.", {
    read: reader({ next: "draft", facts: [{ label: "Subjects", value: "DSA and Prompt Engineering", quote: "DSA and Prompt Engineering" }, { label: "Exams", value: "early December", quote: "early December" }] }),
    write: async req => checkWorkspacePlan({ kind: "custom", title: "Semester 5",
      subjects: [{ name: "DSA", topics: ["Hashing"] }, { name: "Prompt Engineering", topics: ["Few-shot prompting", "Guardrails"] }],
      tasks: [{ key: "pe", title: "Write 10 prompts", subject: "Prompt Engineering" }] }, { today: req.today, userText: req.learnerText }),
  });
  const built = await builder.approveDraft(me.id, first.id, { version: first.version });
  assert.ok(built.ok);

  // As in the report: first the topics, then "remove prompt engineering from subject too".
  let draft = await say(me.id, first.id, "delete prompt engineering topics, it is in sem 6", {
    read: reader({ next: "draft", change: "Remove Prompt Engineering topics" }), write: noWrite,
    writeChanges: changer(req => req.current.subjects.find(x => x.name === "Prompt Engineering")!.topics.map(t => ({ op: "remove_topic", topicId: t.id }))),
  });
  assert.ok((await builder.approveDraft(me.id, draft.id, { version: draft.version })).ok);
  draft = await say(me.id, first.id, "remove prompt engineering from subject too", {
    read: reader({ next: "draft", change: "Remove the Prompt Engineering subject" }), write: noWrite,
    writeChanges: changer(req => [{ op: "remove_subject", subjectId: req.current.subjects.find(x => x.name === "Prompt Engineering")!.id }]),
  });
  assert.deepEqual(draft.changes!.ops.map(o => o.op), ["remove_subject"]);
  const done = await builder.approveDraft(me.id, draft.id, { version: draft.version });
  assert.ok(done.ok && done.draft.status === "ready", done.ok ? "" : done.message);
  assert.deepEqual(done.ok && done.draft.current!.subjects.map(x => x.name), ["DSA"]);
  assert.deepEqual((await loadStudyStructure(profileId)).subjects.map(x => x.name), ["DSA"]);
  // Its task is still theirs, filed under nothing now.
  const task = (await listTasks(profileId)).tasks.find(t => t.title === "Write 10 prompts")!;
  assert.equal(task.subjectId, null);

  // In one step: a subject asked away goes with its topics.
  const again = await begin(me.id, "Add a subject Compilers to my DSA plan", { read: reader({ next: "draft", resource: { name: "DSA", intent: "change" } }), write: noWrite,
    writeChanges: changer(() => [{ op: "add_subject", name: "Compilers", topics: ["Lexing"] }]) });
  assert.ok((await builder.approveDraft(me.id, again.id, { version: again.version })).ok);
});

test("Build with Nova keeps to its job: an unrelated request changes nothing, and a change brings nothing not asked for", async () => {
  const me = await learner();
  const { profileId, dsa } = await withDsa(me);
  const before = await records(profileId);
  // Unrelated: answered by code; nothing opened, proposed or counted.
  const off = await begin(me.id, "Write my English essay on climate change", {
    read: reader({ next: "decline", reply: "Here is an essay…", resource: { name: "DSA", intent: "change" } }), write: noWrite,
    writeChanges: async () => { throw new Error("changes were written for an unrelated request"); },
  });
  assert.equal(off.messages.at(-1)!.text, "That's outside what I do here. In Build with Nova I shape and change your workspaces: their subjects, topics, tasks, dates and notes, and I can talk through files you share for them. For anything else, ask Nova from Today.");
  assert.equal(off.resource, null);
  assert.equal(off.brief.questionsAsked, 0);
  // Nothing to come back to: it is not listed among their conversations.
  assert.equal((await builder.listDrafts(me.id)).drafts.some(d => d.id === off.id), false);
  assert.deepEqual(await records(profileId), before);

  // Asked for topics; the writer also slips in a task, a note and a date.
  const draft = await begin(me.id, "Add two topics to my DSA plan: heaps and tries", {
    read: reader({ next: "draft", touches: ["topics"], resource: { name: "DSA", intent: "change" } }), write: noWrite,
    writeChanges: changer(req => [
      { op: "add_topics", subjectId: req.current.subjects[0]!.id, names: ["Heaps", "Tries"] },
      { op: "add_task", key: "x", title: "Practise heaps daily" },
      { op: "add_note", title: "Tries explained", body: "# Tries" },
      { op: "add_date", title: "Heap quiz", day: inDays(5) },
    ]),
  });
  assert.deepEqual(draft.changes!.ops.map(o => o.op), ["add_topics"]);
  assert.equal(draft.changes!.dropped.filter(d => d.endsWith("(not asked for)")).length, 3);
  const done = await builder.approveDraft(me.id, draft.id, { version: draft.version });
  assert.ok(done.ok);
  assert.deepEqual(await records(profileId), { ...before, topics: before.topics + 2 });
  assert.ok((await loadStudyStructure(profileId)).subjects.find(x => x.id === dsa.id)!.topics.some(t => t.name === "Tries"));
});
