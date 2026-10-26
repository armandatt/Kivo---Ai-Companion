/**
 * Tasks as a tree — real Postgres.
 *
 * What it proves: a step is stored under its task (the Planner's own create
 * and edit, a built plan, and a change Build with Nova applies), at any depth
 * the rules allow; a move that would loop is refused; removing a task removes
 * its steps; a plan Nova writes stores no priority of its own; and one
 * learner can't hang a step under another's task.
 *
 *   NOVA_TEST_DATABASE_URL=postgresql://... npx tsx --test src/nova/__integration__/nova-task-tree.itest.ts
 */

import "./test-database.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";

process.env.TELEGRAM_BOT_TOKEN = "";
process.env.GEMINI_API_KEY = "";
process.env.OPENAI_API_KEY = "";

const { prisma } = await import("@repo/db/client");
const tasks = await import("../product/tasks.js");
const builder = await import("../product/builder.js");
const { readTurn } = await import("../product/builder-state.js");
const { checkWorkspacePlan } = await import("../product/workspace-plan.js");
const { ensureSetupProfile } = await import("../product/setup.js");
const { TASK_DEPTH_MAX } = await import("../product/task-tree.js");

import type { BuilderDeps } from "../product/builder.js";

const STAMP = Date.now();
const ids: string[] = [];
let n = 0;
async function learner() {
  const id = `web:tree_${STAMP}_${n++}`;
  ids.push(id);
  await prisma.messengerUser.create({ data: { platform: "web", platformChatId: id, persona: "nova", displayName: "Mira" } });
  const profileId = (await ensureSetupProfile(id))!.profileId;
  await prisma.novaAcademicProfile.update({ where: { id: profileId }, data: { onboardingComplete: true } });
  return { id, profileId };
}
const made = async (profileId: string, raw: Record<string, unknown>) => {
  const r = await tasks.createTask(profileId, raw);
  assert.ok(r.ok, r.ok ? "" : r.message);
  return r.ok ? r.task : null!;
};

after(async () => {
  await prisma.messengerUser.deleteMany({ where: { platformChatId: { in: ids } } });
  await prisma.$disconnect();
});

test("the Planner keeps steps under their task, at any depth allowed, and never in a loop", async () => {
  const me = await learner();
  const api = await made(me.profileId, { title: "Build the tasks API", topicName: "Backend" });
  const auth = await made(me.profileId, { title: "Add authentication", parentId: api.id });
  const jwt = await made(me.profileId, { title: "Issue JWTs", parentId: auth.id });
  assert.equal(auth.parentId, api.id);
  // Filed where its task is.
  assert.equal(jwt.topicName, "Backend");
  const listed = (await tasks.listTasks(me.profileId)).tasks;
  assert.equal(listed.find(t => t.id === jwt.id)!.parentId, auth.id);

  // A loop is refused; out to its own is fine.
  const loop = await tasks.updateTask(me.profileId, api.id, { parentId: jwt.id });
  assert.equal(!loop.ok && loop.error, "bad_parent");
  const out = await tasks.updateTask(me.profileId, jwt.id, { parentId: null });
  assert.ok(out.ok && out.task.parentId === null);

  // Depth: a chain to the cap, then one more is refused.
  let parent = api.id;
  for (let i = 2; i <= TASK_DEPTH_MAX; i++) parent = (await made(me.profileId, { title: `Level ${i}`, parentId: parent })).id;
  const tooDeep = await tasks.createTask(me.profileId, { title: "One too many", parentId: parent });
  assert.equal(!tooDeep.ok && tooDeep.error, "bad_parent");

  // Removing a task removes its steps.
  assert.ok(await tasks.deleteTask(me.profileId, api.id));
  assert.equal(await prisma.novaTask.count({ where: { profileId: me.profileId } }), 1);
});

test("a step can't hang under another learner's task", async () => {
  const a = await learner(), b = await learner();
  const theirs = await made(a.profileId, { title: "Their task" });
  const r = await tasks.createTask(b.profileId, { title: "Mine", parentId: theirs.id });
  assert.equal(!r.ok && r.error, "bad_parent");
  const mine = await made(b.profileId, { title: "Mine" });
  const moved = await tasks.updateTask(b.profileId, mine.id, { parentId: theirs.id });
  assert.equal(!moved.ok && moved.error, "bad_parent");
});

// "latest" in a quote stands for the learner's latest words, quoted as a
// model quotes a request to build or for tasks.
const reader = (raw: Record<string, unknown>): NonNullable<BuilderDeps["read"]> => async input => {
  const said = input.messages.filter(m => m.role === "user");
  const latest = said.at(-1)?.text ?? "";
  const quote = (v: unknown) => (v && typeof v === "object" && (v as { quote?: unknown }).quote === "latest" ? { ...v, quote: latest } : v);
  return readTurn({ reply: "OK.", facts: [], assumptions: [], suggestions: [], question: null, ...raw, build: quote(raw.build), tasks: quote(raw.tasks) }, said.map(m => m.text).join("\n"), [], latest);
};
// The learner asked for the plan, and for tasks: these tests are about
// other rules (task-consent and consent have their own, nova-builder-consent).
const ASKED = { build: { quote: "latest" }, tasks: { want: "all", quote: "latest" } };

test("a built plan writes its steps under their tasks and no priority Nova gave; a change adds and moves steps", async () => {
  const me = await learner();
  const started = await builder.startDraft(me.id, { clientKey: `tree-${STAMP}-abcdef`, text: "Plan TrackerX: the API and its auth, launching in a month." });
  assert.ok(started.ok && started.job);
  await builder.runJob(me.id, started.job!, {
    read: reader({ ...ASKED, next: "draft", kind: "project", facts: [{ label: "Project", value: "TrackerX", quote: "TrackerX" }, { label: "Deadline", value: "in a month", quote: "in a month" }] }),
    write: async req => checkWorkspacePlan({ kind: "custom", title: "TrackerX", summary: "Ship TrackerX",
      subjects: [{ name: "TrackerX", topics: ["Backend"] }], phases: [{ name: "Backend", subject: "TrackerX" }],
      tasks: [
        { key: "api", title: "Build the tasks API", topic: "Backend", priority: "high", priorityReason: "The launch waits on it" },
        { key: "auth", title: "Add authentication", parent: "api" },
        { key: "jwt", title: "Issue and verify JWTs", parent: "auth" },
        { key: "tests", title: "Write API tests", parent: "api" },
      ] }, { today: req.today, userText: req.learnerText, nova: true }),
  });
  const draft = (await builder.getDraft(me.id, started.draft.id))!;
  assert.equal(draft.plan!.tasks.find(t => t.key === "api")!.suggestedPriority, "high");
  const built = await builder.approveDraft(me.id, draft.id, { version: draft.version });
  assert.ok(built.ok, built.ok ? "" : built.message);
  const rows = await prisma.novaTask.findMany({ where: { profileId: me.profileId }, select: { id: true, title: true, parentId: true, priority: true } });
  const id = (title: string) => rows.find(r => r.title === title)!.id;
  assert.equal(rows.find(r => r.title === "Issue and verify JWTs")!.parentId, id("Add authentication"));
  assert.equal(rows.find(r => r.title === "Add authentication")!.parentId, id("Build the tasks API"));
  assert.equal(rows.find(r => r.title === "Write API tests")!.parentId, id("Build the tasks API"));
  // Nova's suggestion is not their priority.
  assert.ok(rows.every(r => r.priority === null));
  // The live view reads the tree back.
  const live = (await builder.getDraft(me.id, draft.id))!;
  assert.equal(live.current!.tasks.find(t => t.title === "Issue and verify JWTs")!.parentId, id("Add authentication"));

  // A change: a step under a step it adds, and a move out.
  const claimed = await builder.postMessage(me.id, draft.id, { text: "Break the JWT work down, and make the tests a task of their own" });
  assert.ok(claimed.ok);
  await builder.runJob(me.id, claimed.job, {
    read: reader({ ...ASKED, next: "draft", change: "Break JWT down; tests on their own", touches: ["tasks"] }),
    write: async () => { throw new Error("a new plan was written"); },
    writeChanges: async req => {
      const jwtTask = req.current.tasks.find(t => t.title === "Issue and verify JWTs")!;
      const testsTask = req.current.tasks.find(t => t.title === "Write API tests")!;
      return { ok: true, summary: null, ops: [
        { op: "add_task", key: "sign", title: "Sign tokens with rotating keys", parentId: jwtTask.id, priority: "high" },
        { op: "add_task", key: "rot", title: "Schedule key rotation", parentKey: "sign" },
        { op: "update_task", taskId: testsTask.id, parentId: null },
      ] };
    },
  });
  const changing = (await builder.getDraft(me.id, draft.id))!;
  assert.deepEqual(changing.changes!.ops.map(o => o.says), [
    'Add step "Sign tokens with rotating keys" under "Issue and verify JWTs"',
    'Add step "Schedule key rotation" under "Sign tokens with rotating keys"',
    'Change task "Write API tests": make it a task of its own',
  ]);
  const applied = await builder.approveDraft(me.id, draft.id, { version: changing.version });
  assert.ok(applied.ok, applied.ok ? "" : applied.message);
  const after_ = await prisma.novaTask.findMany({ where: { profileId: me.profileId }, select: { title: true, parentId: true, id: true, priority: true } });
  const idOf = (title: string) => after_.find(r => r.title === title)!.id;
  assert.equal(after_.find(r => r.title === "Schedule key rotation")!.parentId, idOf("Sign tokens with rotating keys"));
  assert.equal(after_.find(r => r.title === "Sign tokens with rotating keys")!.parentId, idOf("Issue and verify JWTs"));
  assert.equal(after_.find(r => r.title === "Write API tests")!.parentId, null);
  // The request was not about priorities: none was set.
  assert.equal(after_.find(r => r.title === "Sign tokens with rotating keys")!.priority, null);

  // Approving again adds nothing twice.
  assert.ok((await builder.approveDraft(me.id, draft.id, { version: changing.version })).ok);
  assert.equal(await prisma.novaTask.count({ where: { profileId: me.profileId } }), after_.length);
});
