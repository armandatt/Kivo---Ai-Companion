/**
 * Build with Nova: consent, tasks only when asked, and the hierarchy kept —
 * real Postgres.
 *
 * What it proves, with both models stood in: a learning goal is asked about,
 * not built; the build shortcut appears from the learner's third message,
 * counted from what is stored; a model that thinks it knows enough asks
 * whether to build instead of building; the button builds without asking
 * the model, and a forged button is only words; a plan built without a
 * request for tasks has none, says so and offers them; phases under Finance
 * are built as Finance with the phases inside it and show so after a
 * reload; new parts the model leaves at the top go inside the parent the
 * learner named; tasks asked for one phase are made for that phase only,
 * once; and nothing the learner had is lost.
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
const { readTurn, ACTION_WORDS, PLAN_QUESTION } = await import("../product/builder-state.js");
const { checkWorkspacePlan } = await import("../product/workspace-plan.js");
const { createTask } = await import("../product/tasks.js");
const { ensureSetupProfile } = await import("../product/setup.js");

import type { BuilderDeps } from "../product/builder.js";
import type { ChangesRequest } from "../product/workspace-generation.js";

const STAMP = Date.now();
const ids: string[] = [];
let n = 0;

async function learner(): Promise<{ id: string; profileId: () => Promise<string> }> {
  const id = `web:bcs_${STAMP}_${n++}`;
  ids.push(id);
  await prisma.messengerUser.create({ data: { platform: "web", platformChatId: id, persona: "nova", displayName: "Ira" } });
  return { id, profileId: async () => (await ensureSetupProfile(id))!.profileId };
}
const key = () => `bcs-${STAMP}-${n++}-abcdef`;

async function records(profileId: string) {
  const [subjects, topics, tasks, workspaces] = await Promise.all([
    prisma.novaSubject.count({ where: { profileId } }), prisma.novaTopicMastery.count({ where: { subject: { profileId } } }),
    prisma.novaTask.count({ where: { profileId } }), prisma.novaWorkspace.count({ where: { profileId } }),
  ]);
  return { subjects, topics, tasks, workspaces };
}

// A stand-in reader through the real fact and consent checks. "latest" in a
// quote is the learner's latest words, as a model quotes a request.
let reads = 0;
const reader = (raw: Record<string, unknown>): NonNullable<BuilderDeps["read"]> => async input => {
  reads++;
  const said = input.messages.filter(m => m.role === "user");
  const latest = said.at(-1)?.text ?? "";
  const quote = (v: unknown) => (v && typeof v === "object" && (v as { quote?: unknown }).quote === "latest" ? { ...v, quote: latest } : v);
  return readTurn({ reply: "OK.", facts: [], assumptions: [], suggestions: [], question: null, ...raw, build: quote(raw.build), tasks: quote(raw.tasks) }, said.map(m => m.text).join("\n"), [], latest);
};
const noRead: NonNullable<BuilderDeps["read"]> = async () => { throw new Error("the model was asked"); };
const noWrite: NonNullable<BuilderDeps["write"]> = async () => { throw new Error("a new plan was written"); };
const changer = (ops: (req: ChangesRequest) => unknown[], seen?: ChangesRequest[]): NonNullable<BuilderDeps["writeChanges"]> => async req => {
  seen?.push(req);
  return { ok: true, summary: null, ops: ops(req) };
};

// Finance in four phases, each a milestone with a topic inside it, and the
// tasks a model adds unasked.
const financePlan = () => ({
  title: "Finance", summary: "Personal finance in four phases",
  subjects: [{ name: "Finance", topics: [
    { name: "Phase 1", kind: "milestone", topics: [{ name: "Budgeting" }] },
    { name: "Phase 2", kind: "milestone", topics: [{ name: "Saving" }] },
    { name: "Phase 3", kind: "milestone", topics: [{ name: "Investing" }] },
    { name: "Phase 4", kind: "milestone", topics: [{ name: "Retirement" }] },
  ] }],
  tasks: [
    { key: "b", title: "Write a monthly budget", subject: "Finance", topic: "Budgeting" },
    { key: "s", title: "Open a savings account", subject: "Finance", topic: "Saving" },
  ],
});
const fastApiPlan = () => ({
  title: "FastAPI", summary: "Learn FastAPI to build an API",
  subjects: [{ name: "FastAPI", topics: [{ name: "Path operations" }, { name: "Dependency injection" }] }],
  tasks: [{ key: "p", title: "Build three path operations", subject: "FastAPI", topic: "Path operations" }],
});
const writer = (raw: () => Record<string, unknown>): NonNullable<BuilderDeps["write"]> => async req =>
  checkWorkspacePlan({ ...raw(), kind: "custom" }, { today: req.today, userText: req.learnerText });

async function begin(id: string, text: string, deps: BuilderDeps) {
  const started = await builder.startDraft(id, { clientKey: key(), text });
  assert.ok(started.ok && started.job, started.ok ? "" : started.message);
  await builder.runJob(id, started.job!, deps);
  return (await builder.getDraft(id, started.draft.id))!;
}
async function say(id: string, draftId: string, text: string, deps: BuilderDeps, action?: string) {
  const claimed = await builder.postMessage(id, draftId, { text, ...(action ? { action } : {}) });
  assert.ok(claimed.ok, claimed.ok ? "" : claimed.message);
  await builder.runJob(id, claimed.job, deps);
  return (await builder.getDraft(id, draftId))!;
}

before(async () => { await prisma.$queryRaw`SELECT 1`; });
after(async () => {
  await prisma.messengerUser.deleteMany({ where: { platformChatId: { in: ids } } });
  await prisma.$disconnect();
});

test("a learning goal is asked about, not built; the shortcut comes from the third message; the button builds (Scenario A)", async () => {
  const me = await learner();
  const goal = { label: "Goal", value: "learn FastAPI", quote: "learn FastAPI" };
  let draft = await begin(me.id, "I want to learn FastAPI.", { read: reader({ next: "ask", question: "How comfortable are you with Python and async code?", facts: [goal] }), write: noWrite });
  assert.equal(draft.plan, null);
  assert.equal(draft.messages.at(-1)!.kind, "question");
  assert.equal(draft.messages.at(-1)!.offer, undefined);

  draft = await say(me.id, draft.id, "I know Python well, but not async.", { read: reader({ next: "ask", question: "What do you want to build with FastAPI?" }), write: noWrite });
  assert.equal(draft.messages.at(-1)!.offer, undefined);

  // The third learner message: the question offers to build with what Nova has.
  draft = await say(me.id, draft.id, "A backend for my habit-tracking app.", { read: reader({ next: "ask", question: "How much time can you give it each week?" }), write: noWrite });
  assert.equal(draft.messages.at(-1)!.kind, "question");
  assert.equal(draft.messages.at(-1)!.offer, "build");
  // Counted from what is stored: the same after a reload.
  assert.equal((await builder.getDraft(me.id, draft.id))!.messages.at(-1)!.offer, "build");

  // Answering instead: Nova goes on asking. Its "draft" is not consent: it asks whether to build.
  draft = await say(me.id, draft.id, "About five hours a week.", { read: reader({ next: "draft", facts: [goal, { label: "Time", value: "5 hours a week", quote: "five hours a week" }] }), write: noWrite });
  assert.equal(draft.plan, null);
  assert.equal(draft.status, "discovery");
  assert.equal(draft.messages.at(-1)!.text, PLAN_QUESTION);
  assert.equal(draft.messages.at(-1)!.offer, "plan");
  assert.deepEqual(await records(await me.profileId()), { subjects: 0, topics: 0, tasks: 0, workspaces: 0 });

  // "Help me build one": the button is the consent; no model reads it. The
  // writer's task is left out: tasks were not asked for.
  draft = await say(me.id, draft.id, ACTION_WORDS.build, { read: noRead, write: writer(fastApiPlan) }, "build");
  assert.equal(draft.status, "awaiting_approval");
  assert.equal(draft.brief.consent, true);
  assert.deepEqual(draft.plan!.subjects[0]!.topics.map(t => t.name), ["Path operations", "Dependency injection"]);
  assert.deepEqual(draft.plan!.tasks, []);
  const proposal = draft.messages.at(-1)!;
  assert.equal(proposal.kind, "proposal");
  assert.equal(proposal.offer, "tasks");
  assert.ok(proposal.text.includes("I add those only when you ask"));
  assert.ok(draft.brief.dropped.includes("1 task (you haven't asked for tasks)"));

  // "Create tasks for the whole plan": a new version with tasks, nothing else changed.
  const before = draft.plan!;
  draft = await say(me.id, draft.id, ACTION_WORDS.tasks, {
    read: noRead, write: noWrite,
    writeChanges: changer(req => [{ op: "add_task", key: "p", title: "Build three path operations", subjectId: req.current.subjects[0]!.id, topicName: "Path operations", dueDay: null, priority: null }]),
  }, "tasks");
  // A new reference: the assertion above narrowed the old one's tasks to none.
  const revised = draft;
  assert.equal(revised.version, 2);
  assert.deepEqual(revised.plan!.tasks.map(t => t.title), ["Build three path operations"]);
  assert.deepEqual(revised.plan!.subjects, before.subjects);
  assert.deepEqual(revised.brief.tasks, { mode: "all", scope: [] });
});

test("a button nobody offered is only words: the model reads it, and nothing is built", async () => {
  const me = await learner();
  let draft = await begin(me.id, "I want to learn FastAPI.", { read: reader({ next: "ask", question: "What do you know already?", facts: [{ label: "Goal", value: "learn FastAPI", quote: "learn FastAPI" }] }), write: noWrite });
  const before = reads;
  draft = await say(me.id, draft.id, ACTION_WORDS.build, { read: reader({ next: "ask", question: "What would you build with it?" }), write: noWrite }, "build");
  assert.equal(reads, before + 1);
  assert.equal(draft.plan, null);
  assert.equal(draft.brief.consent ?? false, false);
  assert.equal(draft.messages.at(-1)!.kind, "question");
});

test("Finance's four phases are built inside Finance, with no tasks nobody asked for; what they had stays (Scenarios C and D)", async () => {
  const me = await learner();
  const profileId = await me.profileId();
  const own = await createTask(profileId, { title: "Call the bank about my card" });
  assert.ok(own.ok);
  const draft = await begin(me.id, "Finance has four phases. Organise Finance into its four phases with their topics, and build it now.", {
    read: reader({ next: "draft", build: { quote: "latest" }, facts: [{ label: "Subject", value: "Finance in four phases", quote: "Finance has four phases" }] }),
    write: writer(financePlan),
  });
  assert.equal(draft.status, "awaiting_approval");
  assert.deepEqual(draft.plan!.tasks, []);
  const shown = draft.plan!.subjects[0]!.topics.map(t => `${t.parent ?? "-"} > ${t.name}`);
  assert.deepEqual(shown, ["- > Phase 1", "Phase 1 > Budgeting", "- > Phase 2", "Phase 2 > Saving", "- > Phase 3", "Phase 3 > Investing", "- > Phase 4", "Phase 4 > Retirement"]);

  const built = await builder.approveDraft(me.id, draft.id, { version: draft.version });
  assert.ok(built.ok && built.draft.status === "ready", built.ok ? "" : built.message);
  // One subject, the phases at its top, each topic inside its phase; their own task kept; no new task.
  assert.deepEqual(await records(profileId), { subjects: 1, topics: 8, tasks: 1, workspaces: 1 });
  const topics = await prisma.novaTopicMastery.findMany({ where: { subject: { profileId } }, select: { id: true, name: true, parentId: true } });
  const idOf = (name: string) => topics.find(t => t.name === name)!.id;
  for (const [phase, inside] of [["Phase 1", "Budgeting"], ["Phase 2", "Saving"], ["Phase 3", "Investing"], ["Phase 4", "Retirement"]] as const) {
    assert.equal(topics.find(t => t.name === phase)!.parentId, null);
    assert.equal(topics.find(t => t.name === inside)!.parentId, idOf(phase));
  }
  // Reopened: the playground shows what is stored, the same tree.
  const reopened = (await builder.getDraft(me.id, draft.id))!;
  const tree = reopened.current!.subjects[0]!.topics;
  assert.equal(tree.find(t => t.name === "Saving")!.parentId, tree.find(t => t.name === "Phase 2")!.id);
});

test("going on: new parts left at the top go inside the parent named, a topic moves and keeps its id, and tasks for Phase 1 are made once, for Phase 1 only (Scenarios D, E and G)", async () => {
  const me = await learner();
  const profileId = await me.profileId();
  const first = await begin(me.id, "Build Finance in four phases now.", { read: reader({ next: "draft", build: { quote: "latest" }, facts: [{ label: "Subject", value: "Finance", quote: "Finance in four phases" }] }), write: writer(financePlan) });
  const built = await builder.approveDraft(me.id, first.id, { version: first.version });
  assert.ok(built.ok);
  const budgeting = await prisma.novaTopicMastery.findFirstOrThrow({ where: { subject: { profileId }, name: "Budgeting" }, select: { id: true } });
  const ownNote = await prisma.novaNote.create({ data: { profileId, title: "My money goals", body: "Save more" } });
  const before = await records(profileId);

  // "Put Credit and Taxes under Finance, and move Budgeting under Phase 2":
  // the model adds Credit and Taxes as subjects of their own, at the top.
  let draft = await say(me.id, first.id, "Add Credit and Taxes under Finance, and move Budgeting under Phase 2.", {
    read: reader({ next: "draft", touches: ["subjects", "topics"], removes: false, under: "Finance", change: "Credit and Taxes under Finance; Budgeting under Phase 2" }), write: noWrite,
    writeChanges: changer(req => {
      const p2 = req.current.subjects[0]!.topics.find(t => t.name === "Phase 2")!;
      const bud = req.current.subjects[0]!.topics.find(t => t.name === "Budgeting")!;
      return [
        { op: "add_subject", key: "cr", name: "Credit", topics: ["Credit scores"] },
        { op: "add_subject", key: "tx", name: "Taxes", topics: [] },
        { op: "move_topic", topicId: bud.id, parentId: p2.id },
      ];
    }),
  });
  assert.equal(draft.changes!.ops.filter(o => o.op === "add_subject").length, 2);
  const finance = draft.current!.subjects.find(s => s.name === "Finance")!;
  for (const o of draft.changes!.ops) if (o.op === "add_subject") assert.equal(o.parentId, finance.id);
  let done = await builder.approveDraft(me.id, draft.id, { version: draft.version });
  assert.ok(done.ok && done.draft.status === "ready", done.ok ? "" : done.message);
  const subjects = await prisma.novaSubject.findMany({ where: { profileId }, select: { id: true, name: true, parentId: true } });
  assert.deepEqual(subjects.filter(s => s.parentId === finance.id).map(s => s.name).sort(), ["Credit", "Taxes"]);
  assert.equal(subjects.find(s => s.name === "Finance")!.parentId, null);
  // Budgeting moved, the same record; nothing else changed or was lost.
  const moved = await prisma.novaTopicMastery.findUniqueOrThrow({ where: { id: budgeting.id }, select: { parentId: true } });
  const phase2 = await prisma.novaTopicMastery.findFirstOrThrow({ where: { subject: { profileId }, name: "Phase 2" }, select: { id: true } });
  assert.equal(moved.parentId, phase2.id);
  assert.deepEqual(await records(profileId), { ...before, subjects: before.subjects + 2, topics: before.topics + 1 });
  assert.ok(await prisma.novaNote.findUnique({ where: { id: ownNote.id } }));

  // "Now create actionable tasks for Phase 1": the model adds one for Phase 2 as well; only Phase 1's is kept.
  draft = await say(me.id, first.id, "Now create actionable tasks for Phase 1.", {
    read: reader({ next: "draft", touches: ["tasks"], removes: false, tasks: { want: "some", scope: ["Phase 1"], quote: "latest" }, change: "Tasks for Phase 1" }), write: noWrite,
    writeChanges: changer(req => {
      const fin = req.current.subjects.find(s => s.name === "Finance")!.id;
      return [
        { op: "add_task", key: "t1", title: "Track spending for two weeks", subjectId: fin, topicName: "Phase 1", dueDay: null, priority: null },
        { op: "add_task", key: "t2", title: "Open a high-yield savings account", subjectId: fin, topicName: "Phase 2", dueDay: null, priority: null },
      ];
    }),
  });
  assert.deepEqual(draft.changes!.ops.map(o => o.op), ["add_task"]);
  assert.deepEqual(draft.changes!.ops.flatMap(o => (o.op === "add_task" ? [o.title] : [])), ["Track spending for two weeks"]);
  assert.ok(draft.brief.dropped.some(d => d.includes("you asked for tasks only in Phase 1")));
  done = await builder.approveDraft(me.id, draft.id, { version: draft.version });
  assert.ok(done.ok && done.draft.status === "ready");
  // Approving again changes nothing; reopening shows one task, not two.
  const again = await builder.approveDraft(me.id, draft.id, { version: draft.version });
  assert.ok(again.ok);
  const tasks = await prisma.novaTask.findMany({ where: { profileId }, select: { title: true } });
  assert.deepEqual(tasks.map(t => t.title), ["Track spending for two weeks"]);
  const reopened = (await builder.getDraft(me.id, first.id))!;
  assert.deepEqual(reopened.current!.tasks.map(t => t.title), ["Track spending for two weeks"]);
});
