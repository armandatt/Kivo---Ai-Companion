/**
 * Build with Nova — real Postgres integration test.
 *
 * What it proves, with both models stood in: a vague message gets a
 * question and nothing else; what Kivo already knows reaches the model; a
 * clear request becomes a proposal; a correction is a new version; nothing
 * the learner has is written before approval; only the current version can
 * be approved, and approving twice (or at once) builds once; the built
 * workspace is real (board, Knowledge, notes, dates); the learner's edits
 * are saved against their version and win over a slower Nova; an existing
 * workspace is added to without losing anything; failures are visible and
 * retried; cancelling stops a running job; a chat message opens one draft;
 * and one learner can neither see nor touch another's.
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
const { listNotes } = await import("../product/notes.js");
const { listExams } = await import("../product/exams.js");
const { loadNovaKnowledgeMap } = await import("../product/knowledge-map.js");

import type { TurnInput } from "../product/builder-conversation.js";
import type { BuilderPlanRequest } from "../product/workspace-generation.js";
import type { BuilderJob, BuilderDeps } from "../product/builder.js";

const STAMP = Date.now();
const NOW = () => new Date();
const TODAY = new Date().toISOString().slice(0, 10);
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const ids: string[] = [];
let n = 0;

async function learner(): Promise<{ id: string; profileId: () => Promise<string> }> {
  const id = `web:bld_${STAMP}_${n++}`;
  ids.push(id);
  await prisma.messengerUser.create({ data: { platform: "web", platformChatId: id, persona: "nova", displayName: "Asha" } });
  return { id, profileId: async () => (await prisma.novaAcademicProfile.findFirstOrThrow({ where: { user: { platformChatId: id } } })).id };
}
const key = () => `bld-${STAMP}-${n++}-abcdef`;

// What the learner has in Kivo, apart from drafts.
async function records(profileId: string) {
  const [subjects, tasks, notes, exams, workspaces] = await Promise.all([
    prisma.novaSubject.count({ where: { profileId } }), prisma.novaTask.count({ where: { profileId } }),
    prisma.novaNote.count({ where: { profileId } }), prisma.novaExam.count({ where: { profileId } }),
    prisma.novaWorkspace.count({ where: { profileId } }),
  ]);
  return { subjects, tasks, notes, exams, workspaces };
}
const NOTHING = { subjects: 0, tasks: 0, notes: 0, exams: 0, workspaces: 0 };

// A stand-in reader: the given reply, read through the real fact check.
const reader = (raw: Record<string, unknown>, seen?: TurnInput[]): NonNullable<BuilderDeps["read"]> => async input => {
  seen?.push(input);
  return readTurn({ reply: "OK.", facts: [], assumptions: [], suggestions: [], question: null, ...raw }, input.messages.filter(m => m.role === "user").map(m => m.text).join("\n"), (input.files ?? []).map(f => f.name));
};

function trackerPlan(extra: Record<string, unknown> = {}) {
  return {
    title: "TrackerX", summary: "Finish TrackerX for small teams",
    subjects: [{ name: "TrackerX", topics: ["Dashboard", "API integration", "End-to-end testing"] }],
    phases: [{ name: "Finish the dashboard", subject: "TrackerX", goals: ["All widgets done"] }, { name: "Integrate the APIs", subject: "TrackerX" }],
    tasks: [
      { key: "dash", title: "Finish dashboard widgets", topic: "Finish the dashboard", priority: "high" },
      { key: "api", title: "Wire the tasks API", topic: "Integrate the APIs", after: "dash" },
      { key: "e2e", title: "Test the full flow", topic: "Integrate the APIs", after: "api" },
    ],
    dates: [{ title: "TrackerX launch", subject: "TrackerX", kind: "project", day: inDays(21) }],
    notes: [{ key: "scope", title: "TrackerX scope", subject: "TrackerX", body: "# Scope\n- Small teams", origin: "nova" }],
    ...extra,
  };
}
// A stand-in plan writer: the given plan, checked as the real one is.
const writer = (raw: () => Record<string, unknown>, seen?: BuilderPlanRequest[]): NonNullable<BuilderDeps["write"]> => async req => {
  seen?.push(req);
  const checked = checkWorkspacePlan({ ...raw(), kind: "custom" }, { today: req.today, userText: req.learnerText });
  return checked;
};

async function say(id: string, draftId: string, text: string, deps: BuilderDeps) {
  const claimed = await builder.postMessage(id, draftId, { text });
  assert.ok(claimed.ok, claimed.ok ? "" : claimed.message);
  await builder.runJob(id, claimed.job, deps);
  return (await builder.getDraft(id, draftId))!;
}

async function begin(id: string, text: string, deps: BuilderDeps) {
  const started = await builder.startDraft(id, { clientKey: key(), text });
  assert.ok(started.ok && started.job);
  await builder.runJob(id, started.job!, deps);
  return (await builder.getDraft(id, started.draft.id))!;
}

before(async () => { await prisma.$queryRaw`SELECT 1`; });
after(async () => {
  await prisma.messengerUser.deleteMany({ where: { platformChatId: { in: ids } } });
  await prisma.$disconnect();
});

test("a vague idea gets a question, and nothing of the learner's is written", async () => {
  const me = await learner();
  const seen: TurnInput[] = [];
  // The model would like to build at once from "I'm building TrackerX": code asks first.
  const draft = await begin(me.id, "I'm building TrackerX.", { read: reader({ next: "draft", facts: [] }, seen), write: writer(trackerPlan) });
  assert.equal(draft.status, "discovery");
  assert.equal(draft.plan, null);
  assert.equal(draft.messages.at(-1)!.kind, "question");
  assert.ok(draft.messages.at(-1)!.text.includes("What are you working on"));
  assert.deepEqual(await records(await me.profileId()), NOTHING);
});

test("the conversation goes question by question, uses what Kivo knows, and does not ask it again", async () => {
  const me = await learner();
  // Already in Kivo: a goal and a subject.
  const profileId = await (async () => { await builder.startDraft(me.id, { clientKey: key() }); return me.profileId(); })();
  await prisma.novaAcademicProfile.update({ where: { id: profileId }, data: { goals: ["Ship my side project"] } });
  await prisma.novaSubject.create({ data: { profileId, name: "Operating Systems" } });

  const seen: TurnInput[] = [];
  let draft = await begin(me.id, "I'm building TrackerX.", {
    read: reader({ next: "ask", question: "What does TrackerX help people do, and who is it for?", facts: [{ label: "Project", value: "TrackerX", quote: "building TrackerX" }] }, seen),
  });
  assert.equal(draft.status, "discovery");
  assert.ok(draft.messages.at(-1)!.text.endsWith("What does TrackerX help people do, and who is it for?"));
  // What Kivo knew went to the model, and is shown as known, not as theirs.
  const known = seen[0]!.known.map(k => `${k.label}: ${k.value}`);
  assert.ok(known.includes("Goals: Ship my side project"));
  assert.ok(known.includes("Subjects already in Kivo: Operating Systems"));
  assert.deepEqual(draft.brief.facts, [{ label: "Project", value: "TrackerX" }]);

  draft = await say(me.id, draft.id, "It's a project tracking app for small teams.", {
    read: reader({ next: "ask", question: "Where are you with it right now?", facts: [{ label: "Audience", value: "small teams", quote: "for small teams" }] }, seen),
  });
  // The second reading saw the first answer and the understanding so far.
  assert.deepEqual(seen[1]!.brief.facts, [{ label: "Project", value: "TrackerX" }]);
  assert.ok(seen[1]!.messages.some(m => m.role === "nova" && m.text.includes("who is it for")));
  assert.deepEqual(draft.brief.facts.map(f => f.label), ["Audience", "Project"]);
  assert.equal(draft.brief.questionsAsked, 2);
  assert.deepEqual(await records(profileId), { ...NOTHING, subjects: 1 });
});

test("a clear request becomes a proposal without more questions, and still writes nothing", async () => {
  const me = await learner();
  const asked: BuilderPlanRequest[] = [];
  const draft = await begin(me.id, "Authentication is done, the dashboard is half done, API integration is next. Plan TrackerX for me.", {
    read: reader({ next: "draft", facts: [{ label: "Done so far", value: "authentication", quote: "Authentication is done" }, { label: "Next step", value: "API integration", quote: "API integration is next" }] }),
    write: writer(trackerPlan, asked),
  });
  assert.equal(draft.status, "awaiting_approval");
  assert.equal(draft.version, 1);
  assert.equal(draft.plan!.title, "TrackerX");
  assert.equal(draft.messages.at(-1)!.kind, "proposal");
  assert.ok(draft.messages.at(-1)!.text.includes("Nothing is created until you approve it"));
  assert.deepEqual(asked[0]!.facts, [{ label: "Done so far", value: "authentication" }, { label: "Next step", value: "API integration" }]);
  assert.equal(asked[0]!.current, null);
  assert.deepEqual(await records(await me.profileId()), NOTHING);
});

test("a correction is a new version; only the current version is approved; approving twice builds once", async () => {
  const me = await learner();
  let draft = await begin(me.id, "Plan TrackerX: dashboard, then APIs, then testing, launching on 30 November.", {
    read: reader({ next: "draft", facts: [{ label: "Project", value: "TrackerX", quote: "TrackerX" }, { label: "Deadline", value: "30 November", quote: "30 November" }] }), write: writer(trackerPlan),
  });
  assert.equal(draft.version, 1);

  const asked: BuilderPlanRequest[] = [];
  draft = await say(me.id, draft.id, "Add a task to write the release notes.", {
    read: reader({ next: "revise", change: "Add a task to write the release notes" }),
    write: writer(() => trackerPlan({ tasks: [...trackerPlan().tasks as object[], { key: "notes", title: "Write the release notes" }] }), asked),
  });
  assert.equal(draft.version, 2);
  assert.equal(draft.messages.at(-1)!.kind, "revision");
  assert.ok(draft.messages.at(-1)!.text.includes("Added task Write the release notes"));
  // The revision was written from the proposal as it stood, with the change.
  assert.equal((asked[0]!.current as { title: string }).title, "TrackerX");
  assert.equal(asked[0]!.change, "Add a task to write the release notes");

  const profileId = await me.profileId();
  const stale = await builder.approveDraft(me.id, draft.id, { version: 1 });
  assert.equal(!stale.ok && stale.error, "stale");
  assert.deepEqual(await records(profileId), NOTHING);

  const [a, b] = await Promise.all([builder.approveDraft(me.id, draft.id, { version: 2 }), builder.approveDraft(me.id, draft.id, { version: 2 })]);
  assert.ok(a.ok || b.ok);
  const again = await builder.approveDraft(me.id, draft.id, { version: 2 });
  assert.ok(again.ok);
  assert.equal(again.ok && again.draft.status, "ready");
  const built = await records(profileId);
  // Four tasks; notes: the first milestone's goals, the order of work, and the scope note
  // (the second milestone has nothing to write, so no note).
  assert.deepEqual(built, { subjects: 1, tasks: 4, notes: 3, exams: 1, workspaces: 1 });

  // The board, Knowledge, Notes and the dates are the real records.
  const board = await listTasks(profileId);
  for (const title of ["Finish dashboard widgets", "Wire the tasks API", "Test the full flow", "Write the release notes"]) assert.ok(board.tasks.some(t => t.title === title && t.status === "todo"), title);
  const map = await loadNovaKnowledgeMap(me.id);
  assert.ok(map.status === "ready" && map.nodes.some(x => x.label === "Finish the dashboard"));
  const notes = await listNotes(profileId);
  assert.ok(notes.notes.some(x => x.title === "Order of work: TrackerX"));
  assert.ok((await listExams(me.id))!.some(e => e.title === "TrackerX launch"));

  // The live view reads them back, and Nova's chat context names it.
  const live = await builder.liveWorkspace(me.id, again.ok ? again.draft.workspace!.id : "");
  assert.equal(live!.tasks.length, 4);
  assert.deepEqual(live!.subjects[0]!.topics.map(t => t.name).slice(0, 3), ["Dashboard", "API integration", "End-to-end testing"]);
  assert.ok((await builder.builderContextLines(profileId)).some(l => l.startsWith("Workspace they built in Kivo: TrackerX")));

  // Built: no more messages to it.
  const closed = await builder.postMessage(me.id, draft.id, { text: "one more thing" });
  assert.equal(!closed.ok && closed.error, "closed");
});

test("the learner's edits are saved against their version, and win over a slower Nova", async () => {
  const me = await learner();
  let draft = await begin(me.id, "Plan TrackerX, launching on 30 November.", { read: reader({ next: "draft", facts: [{ label: "Project", value: "TrackerX", quote: "TrackerX" }, { label: "Deadline", value: "30 November", quote: "30 November" }] }), write: writer(trackerPlan) });

  // An edit: renamed and a task removed. Saved as version 2.
  const mine = { ...draft.plan!, title: "TrackerX v1 launch", tasks: draft.plan!.tasks.filter(t => t.key !== "e2e") };
  const saved = await builder.editDraftPlan(me.id, draft.id, { plan: mine, baseVersion: 1 });
  assert.ok(saved.ok);
  assert.equal(saved.ok && saved.draft.version, 2);
  // An edit made on version 1 again is stale, and changes nothing.
  const stale = await builder.editDraftPlan(me.id, draft.id, { plan: draft.plan, baseVersion: 1 });
  assert.equal(!stale.ok && stale.error, "stale");
  // A web address the learner never wrote does not survive their own edit either.
  const sneaky = await builder.editDraftPlan(me.id, draft.id, { plan: { ...mine, resources: [{ title: "x", kind: "docs", url: "https://evil.example", origin: "user" }] }, baseVersion: 2 });
  assert.ok(sneaky.ok && sneaky.draft.plan!.resources[0]!.url === null);

  // Nova starts a revision on version 3; the learner edits meanwhile; Nova's result is not applied.
  const claimed = await builder.postMessage(me.id, draft.id, { text: "Add testing back" });
  assert.ok(claimed.ok);
  const meanwhile = await builder.editDraftPlan(me.id, draft.id, { plan: { ...mine, title: "Mine, newer" }, baseVersion: 3 });
  assert.ok(meanwhile.ok);
  await builder.runJob(me.id, claimed.job, { read: reader({ next: "revise", change: "Add testing back" }), write: writer(trackerPlan) });
  draft = (await builder.getDraft(me.id, draft.id))!;
  assert.equal(draft.plan!.title, "Mine, newer");
  assert.equal(draft.version, 4);
  assert.equal(draft.status, "awaiting_approval");
  assert.ok(draft.messages.at(-1)!.text.includes("kept your version"));
  assert.equal(draft.pending, null);
});

test("an existing workspace is improved by adding to it: nothing there is lost", async () => {
  const me = await learner();
  const first = await begin(me.id, "Plan TrackerX, launching on 30 November.", { read: reader({ next: "draft", facts: [{ label: "Project", value: "TrackerX", quote: "TrackerX" }, { label: "Deadline", value: "30 November", quote: "30 November" }] }), write: writer(trackerPlan) });
  const built = await builder.approveDraft(me.id, first.id, { version: 1 });
  assert.ok(built.ok && built.draft.workspace);
  const workspaceId = built.ok ? built.draft.workspace!.id : "";
  const profileId = await me.profileId();
  // The learner's own task, and progress on one of Nova's.
  await createTask(profileId, { title: "Call the design partner" });
  const dash = (await listTasks(profileId)).tasks.find(t => t.title === "Finish dashboard widgets")!;
  await prisma.novaTask.update({ where: { id: dash.id }, data: { status: "in_progress" } });

  const seen: TurnInput[] = [];
  const started = await builder.startDraft(me.id, { clientKey: key(), text: "Add a beta programme", targetWorkspaceId: workspaceId });
  assert.ok(started.ok && started.draft.target?.id === workspaceId);
  await builder.runJob(me.id, started.job!, {
    read: reader({ next: "draft", facts: [{ label: "Add", value: "a beta programme", quote: "beta programme" }] }, seen),
    write: writer(() => ({ title: "TrackerX", subjects: [{ name: "TrackerX", topics: ["Beta programme"] }], tasks: [{ key: "beta", title: "Recruit ten beta teams" }] })),
  });
  // The model saw the workspace as it stands.
  assert.ok(seen[0]!.existing!.tasks.includes("Finish dashboard widgets"));
  const draft = (await builder.getDraft(me.id, started.draft.id))!;
  assert.ok(draft.messages.at(-1)!.text.includes("nothing there is changed or removed"));
  const added = await builder.approveDraft(me.id, draft.id, { version: draft.version });
  assert.ok(added.ok && added.draft.status === "ready");
  assert.equal(added.ok && added.draft.workspace!.id, workspaceId);

  const tasks = (await listTasks(profileId)).tasks;
  assert.ok(tasks.some(t => t.title === "Recruit ten beta teams"));
  assert.ok(tasks.some(t => t.title === "Call the design partner"));
  assert.equal(tasks.find(t => t.id === dash.id)!.status, "in_progress");
  assert.equal((await records(profileId)).workspaces, 1);
});

test("failures are said and can be retried; a failed build leaves nothing", async () => {
  const me = await learner();
  const down: BuilderDeps = { read: reader({ next: "draft", facts: [{ label: "Project", value: "TrackerX", quote: "TrackerX" }, { label: "Deadline", value: "30 November", quote: "30 November" }] }), write: async () => ({ ok: false, unavailable: true, message: "Nova couldn't write the proposal just now. Nothing was lost; try again." }) };
  let draft = await begin(me.id, "Plan TrackerX, launching on 30 November.", down);
  assert.equal(draft.status, "failed");
  assert.equal(draft.failure!.stage, "drafting");
  assert.equal(draft.messages.at(-1)!.kind, "error");

  const retry = await builder.retryDraft(me.id, draft.id);
  assert.ok(retry.ok && retry.job.kind === "draft");
  await builder.runJob(me.id, retry.job, { write: writer(trackerPlan) });
  draft = (await builder.getDraft(me.id, draft.id))!;
  assert.equal(draft.status, "awaiting_approval");
  assert.equal(draft.failure, null);

  // A reading that fails: the message is kept and Nova says so.
  const silent = await say(me.id, draft.id, "hello?", { read: async () => null });
  assert.equal(silent.failure!.stage, "reply");
  assert.equal(silent.status, "awaiting_approval");
  assert.ok(silent.messages.some(m => m.role === "user" && m.text === "hello?"));

  // A build the task limit refuses: failed, nothing created, approve again allowed.
  const profileId = await me.profileId();
  await prisma.novaTask.createMany({ data: Array.from({ length: 300 }, (_, i) => ({ profileId, title: `filler ${i}`, clientKey: `fill-${STAMP}-${i}` })) });
  const before = await records(profileId);
  const refused = await builder.approveDraft(me.id, draft.id, { version: draft.version });
  assert.equal(refused.ok, false);
  const after = (await builder.getDraft(me.id, draft.id))!;
  assert.equal(after.status, "failed");
  assert.equal(after.failure!.stage, "building");
  assert.deepEqual(await records(profileId), before);
  await prisma.novaTask.deleteMany({ where: { profileId, clientKey: { startsWith: `fill-${STAMP}-` } } });
  const again = await builder.approveDraft(me.id, draft.id, { version: draft.version });
  assert.ok(again.ok && again.draft.status === "ready");
});

test("cancelling stops a running job: it writes nothing", async () => {
  const me = await learner();
  const started = await builder.startDraft(me.id, { clientKey: key(), text: "Plan TrackerX, launching on 30 November." });
  assert.ok(started.ok && started.job);
  const cancelled = await builder.cancelDraft(me.id, started.draft.id);
  assert.ok(cancelled.ok && cancelled.draft.status === "cancelled");
  await builder.runJob(me.id, started.job!, { read: reader({ next: "draft", facts: [{ label: "Project", value: "TrackerX", quote: "TrackerX" }, { label: "Deadline", value: "30 November", quote: "30 November" }] }), write: writer(trackerPlan) });
  const draft = (await builder.getDraft(me.id, started.draft.id))!;
  assert.equal(draft.status, "cancelled");
  assert.equal(draft.plan, null);
  assert.equal(draft.messages.length, 1);
  assert.deepEqual(await records(await me.profileId()), NOTHING);
});

test("one message at a time: a second while Nova works is refused", async () => {
  const me = await learner();
  const k = key();
  const started = await builder.startDraft(me.id, { clientKey: k, text: "Plan TrackerX, launching on 30 November." });
  assert.ok(started.ok);
  const second = await builder.postMessage(me.id, started.draft.id, { text: "and another thing" });
  assert.equal(!second.ok && second.error, "busy");
  // The same start sent again is the same draft, with no second job.
  const repeat = await builder.startDraft(me.id, { clientKey: k, text: "Plan TrackerX, launching on 30 November." });
  assert.ok(repeat.ok && repeat.draft.id === started.draft.id && repeat.job === null);
});

test("a chat message opens one draft, answered when it is opened on the web", async () => {
  const me = await learner();
  const a = await builder.openDraftFromChat(me.id, "Set up my GATE prep", NOW(), "telegram");
  const b = await builder.openDraftFromChat(me.id, "set up my GATE prep", NOW(), "telegram");
  assert.ok(a);
  assert.equal(a, b);
  let draft = (await builder.getDraft(me.id, a))!;
  assert.equal(draft.origin, "telegram");
  assert.equal(draft.needsReply, true);
  assert.equal(draft.pending, null);
  const resumed = await builder.postMessage(me.id, a, { resume: true });
  assert.ok(resumed.ok);
  await builder.runJob(me.id, resumed.job, { read: reader({ next: "ask", title: "GATE prep", question: "When is your exam?", facts: [{ label: "Exam", value: "GATE", quote: "GATE prep" }] }) });
  draft = (await builder.getDraft(me.id, a))!;
  assert.equal(draft.needsReply, false);
  assert.equal(draft.title, "GATE prep");
  assert.ok((await builder.builderContextLines(await me.profileId())).some(l => l.includes("GATE prep") && l.includes("Nothing of it exists until they approve it")));
});

test("one learner can neither see nor touch another's draft or workspace", async () => {
  const owner = await learner();
  const other = await learner();
  const draft = await begin(owner.id, "Plan TrackerX, launching on 30 November.", { read: reader({ next: "draft", facts: [{ label: "Project", value: "TrackerX", quote: "TrackerX" }, { label: "Deadline", value: "30 November", quote: "30 November" }] }), write: writer(trackerPlan) });
  await builder.startDraft(other.id, { clientKey: key() });
  assert.equal(await builder.getDraft(other.id, draft.id), null);
  const job: BuilderJob = { draftId: draft.id, jobId: "x", kind: "reply", change: null };
  for (const r of [
    await builder.postMessage(other.id, draft.id, { text: "hi" }),
    await builder.editDraftPlan(other.id, draft.id, { plan: draft.plan, baseVersion: 1 }),
    await builder.approveDraft(other.id, draft.id, { version: 1 }),
    await builder.cancelDraft(other.id, draft.id),
    await builder.retryDraft(other.id, draft.id),
  ]) assert.equal(!r.ok && r.error, "not_found");
  await builder.runJob(other.id, job, {});
  assert.equal((await builder.listDrafts(other.id)).drafts.some(d => d.id === draft.id), false);
  const built = await builder.approveDraft(owner.id, draft.id, { version: 1 });
  assert.ok(built.ok);
  assert.equal(await builder.liveWorkspace(other.id, built.ok ? built.draft.workspace!.id : ""), null);
  const targeted = await builder.startDraft(other.id, { clientKey: key(), targetWorkspaceId: built.ok ? built.draft.workspace!.id : "" });
  assert.equal(!targeted.ok && targeted.error, "not_found");
  assert.equal((await builder.getDraft(owner.id, draft.id))!.status, "ready");
});

// A small real-looking PDF and a PNG, as the page sends them (base64).
const pdf = (pages = 2, name = "syllabus.pdf") => ({ name, data: Buffer.from(`%PDF-1.4\n${Array.from({ length: pages }, (_, i) => `${i + 1} 0 obj << /Type /Page >> endobj`).join("\n")}\n%%EOF`).toString("base64") });
const png = (name = "plan.png") => ({ name, data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]).toString("base64") });

test("a PDF or photo shared in the conversation is read on every turn, used for the proposal, and deleted once built", async () => {
  const me = await learner();
  const seen: TurnInput[] = [];
  const started = await builder.startDraft(me.id, { clientKey: key(), text: "Here's my OS syllabus", files: [pdf(3)] });
  assert.ok(started.ok && started.job);
  assert.deepEqual(started.draft.files.map(f => [f.name, f.mimeType, f.pages]), [["syllabus.pdf", "application/pdf", 3]]);
  assert.deepEqual(started.draft.messages[0]!.files, [{ name: "syllabus.pdf", pages: 3 }]);
  await builder.runJob(me.id, started.job!, { read: reader({ next: "ask", question: "When is the exam?", facts: [{ label: "Units", value: "five units", file: "syllabus.pdf" }] }, seen) });
  assert.deepEqual(seen[0]!.files!.map(f => [f.name, f.mimeType]), [["syllabus.pdf", "application/pdf"]]);
  let draft = (await builder.getDraft(me.id, started.draft.id))!;
  assert.deepEqual(draft.brief.facts, [{ label: "Units", value: "five units", file: "syllabus.pdf" }]);

  // A photo later, and a question about the PDF: both files go to the model.
  const claimed = await builder.postMessage(me.id, draft.id, { text: "And this is my current plan. What does unit 3 cover?", files: [png()] });
  assert.ok(claimed.ok);
  await builder.runJob(me.id, claimed.job, { read: reader({ next: "chat", reply: "Unit 3 covers deadlocks (page 2 of syllabus.pdf)." }, seen) });
  assert.deepEqual(seen.at(-1)!.files!.map(f => f.name), ["syllabus.pdf", "plan.png"]);
  draft = (await builder.getDraft(me.id, draft.id))!;
  assert.equal(draft.messages.at(-1)!.text, "Unit 3 covers deadlocks (page 2 of syllabus.pdf).");
  assert.equal(draft.files.length, 2);

  // The proposal is written with them, and keeps page references to them only.
  const asked: BuilderPlanRequest[] = [];
  draft = await say(me.id, draft.id, "Exam is in six weeks. Make the plan.", {
    read: reader({ next: "draft", facts: [{ label: "Exam", value: "in six weeks", quote: "six weeks" }] }),
    write: async req => { asked.push(req); return checkWorkspacePlan({ kind: "custom", title: "OS exam", subjects: [{ name: "Operating Systems", topics: [{ name: "Deadlocks", sources: [{ file: "syllabus.pdf", page: 2 }, { file: "other.pdf", page: 1 }] }] }], sources: [{ file: "syllabus.pdf", read: true, pages: 3 }] }, { today: req.today, files: (req.files ?? []).map(f => f.name), userText: req.learnerText }); },
  });
  assert.deepEqual(asked[0]!.files!.map(f => f.name), ["syllabus.pdf", "plan.png"]);
  assert.deepEqual(draft.plan!.subjects[0]!.topics[0]!.sources, [{ file: "syllabus.pdf", page: 2 }]);
  // The photo was not accounted for, so it says so rather than claiming it was read.
  assert.deepEqual(draft.plan!.sources.map(s => [s.file, s.read]), [["syllabus.pdf", true], ["plan.png", false]]);

  // An edit keeps the page reference (the file is still in the conversation).
  const edited = await builder.editDraftPlan(me.id, draft.id, { plan: { ...draft.plan, title: "OS final" }, baseVersion: draft.version });
  assert.ok(edited.ok && edited.draft.plan!.subjects[0]!.topics[0]!.sources.length === 1);

  const built = await builder.approveDraft(me.id, draft.id, { version: edited.ok ? edited.draft.version : 0 });
  assert.ok(built.ok && built.draft.status === "ready");
  assert.equal(built.ok && built.draft.files.length, 0);
  assert.equal(await prisma.novaWorkspaceDraftFile.count({ where: { draftId: draft.id } }), 0);
  const notes = await listNotes(await me.profileId());
  assert.ok(notes.notes.some(n => n.title.startsWith("Operating Systems: topic guide")));
});

test("files are checked by their bytes and limited per message and per conversation; refused ones are not kept", async () => {
  const me = await learner();
  const fake = { name: "notes.pdf", data: Buffer.from("not really a pdf").toString("base64") };
  const bad = await builder.startDraft(me.id, { clientKey: key(), text: "here", files: [fake] });
  assert.equal(!bad.ok && bad.error, "invalid");
  const started = await builder.startDraft(me.id, { clientKey: key(), text: "first", files: [pdf(1, "a.pdf"), pdf(1, "b.pdf"), pdf(1, "c.pdf")] });
  assert.ok(started.ok && started.job);
  await builder.runJob(me.id, started.job!, { read: reader({ next: "ask", question: "What for?" }) });
  const four = await builder.postMessage(me.id, started.draft.id, { files: [pdf(1, "d.pdf"), pdf(1, "e.pdf"), pdf(1, "f.pdf"), pdf(1, "g.pdf")] });
  assert.equal(!four.ok && four.error, "invalid");   // more than three with one message
  const more = await builder.postMessage(me.id, started.draft.id, { files: [pdf(1, "a.pdf"), pdf(1, "d.pdf"), pdf(1, "e.pdf")] });
  assert.ok(more.ok);
  await builder.runJob(me.id, more.job, { read: reader({ next: "ask", question: "And?" }) });
  // Same name again is numbered, not merged.
  assert.deepEqual((await builder.getDraft(me.id, started.draft.id))!.files.map(f => f.name), ["a.pdf", "b.pdf", "c.pdf", "a.pdf (2)", "d.pdf", "e.pdf"]);
  const seventh = await builder.postMessage(me.id, started.draft.id, { files: [png()] });
  assert.equal(!seventh.ok && seventh.error, "invalid");
  assert.equal(await prisma.novaWorkspaceDraftFile.count({ where: { draftId: started.draft.id } }), 6);
  // A message while Nova works brings no file in.
  const working = await builder.postMessage(me.id, started.draft.id, { text: "x" });
  assert.ok(working.ok);
  const busy = await builder.postMessage(me.id, started.draft.id, { text: "y", files: [png("late.png")] });
  assert.equal(!busy.ok && busy.error, "busy");
  assert.equal(await prisma.novaWorkspaceDraftFile.count({ where: { draftId: started.draft.id, name: "late.png" } }), 0);
  // Cancelling deletes them; another learner never sees them.
  const other = await learner();
  await builder.startDraft(other.id, { clientKey: key() });
  assert.equal(await builder.getDraft(other.id, started.draft.id), null);
  const stopped = await builder.cancelDraft(me.id, started.draft.id);
  assert.ok(stopped.ok);
  assert.equal(await prisma.novaWorkspaceDraftFile.count({ where: { draftId: started.draft.id } }), 0);
});
