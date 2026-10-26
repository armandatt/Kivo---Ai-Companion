/**
 * Today's flow and the focus sessions it starts — real Postgres.
 *
 * Proves: opening Today writes nothing and shows Nova's draft apart; a draft
 * is taken only as it was shown, and never over a saved flow; changes are
 * saved and read back in order; a change to an older version is refused
 * with the flow as it stands; Undo restores; removing an item leaves its
 * task; one learner cannot name another's task. Focus: a session for this
 * occurrence only (the task's estimate is unchanged), no time limit (stored
 * 0, not swept as forgotten), a task with no topic as a label that records
 * no topic, a running session's length changed, ending one shown on its
 * item with nothing marked done. The copilot (model stood in) writes
 * nothing: "plan my day" alone is a question; a change is a proposal shown
 * from the real rules; rejecting it leaves the flow; approving it applies
 * exactly it as Nova; a proposal the learner's own change has overtaken, or
 * one code did not make, writes nothing; task changes stay proposals.
 *
 *   NOVA_TEST_DATABASE_URL=postgresql://... npx tsx --test src/nova/__integration__/nova-day-flow.itest.ts
 */

import "./test-database.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";

process.env.TELEGRAM_BOT_TOKEN = "";
process.env.GEMINI_API_KEY = "";
process.env.OPENAI_API_KEY = "";

const { prisma } = await import("@repo/db/client");
const { ensureSetupProfile, saveSetup } = await import("../product/setup.js");
const { createTask, listTasks } = await import("../product/tasks.js");
const { acceptDraft, changeDayFlow, loadDayFlow, startFocus, undoDayFlow } = await import("../product/day-flow.js");
const { runNovaSessionCommand } = await import("../product/session.js");
const { approvePending, askCopilot, PLAN_QUESTION } = await import("../product/day-copilot.js");
const { abandonIfStale } = await import("../persistence/nova-persistence.js");

const STAMP = Date.now();
const ids: string[] = [];
let n = 0;

async function learner() {
  const id = `web:dayflow_${STAMP}_${n++}`;
  ids.push(id);
  await prisma.messengerUser.create({ data: { platform: "web", platformChatId: id, persona: "nova", displayName: "Asha" } });
  const profileId = (await ensureSetupProfile(id))!.profileId;
  await saveSetup(id, { subjects: [{ name: "Backend", topics: ["FastAPI authentication", "SQL joins"] }], exams: [], dailyMinutes: 120, studyTime: null }, new Date(), "merge");
  await prisma.novaAcademicProfile.update({ where: { id: profileId }, data: { onboardingComplete: true, timezone: "UTC" } });
  const today = new Date().toISOString().slice(0, 10);
  const task = await createTask(profileId, { title: "Assignment 3", dueDay: today, estimatedMinutes: 60 });
  const plain = await createTask(profileId, { title: "Startup deck" });
  assert.ok(task.ok && plain.ok);
  return { id, profileId, taskId: task.task.id, plainId: plain.task.id };
}

after(async () => {
  await prisma.messengerUser.deleteMany({ where: { platformChatId: { in: ids } } });
  await prisma.$disconnect();
});

test("opening Today writes nothing; Nova's draft is shown apart and taken only as it was shown, never over a saved flow", async () => {
  const L = await learner();
  const first = await loadDayFlow(L.profileId, L.id);
  assert.equal(await prisma.novaDayFlow.count({ where: { profileId: L.profileId } }), 0, "reading made no row");
  assert.equal(first.saved, false);
  assert.ok(first.draft && first.draft.items.length > 0);
  assert.equal(first.draft.items[0]!.title, "Assignment 3", "the task due today comes first");
  assert.ok(first.draft.reasons.length > 0);
  assert.equal((await loadDayFlow(L.profileId, L.id)).draft?.id, first.draft.id, "the same draft on every read");

  assert.equal((await acceptDraft({ profileId: L.profileId, platformChatId: L.id, version: 0, draftId: "not-it" })).ok, false);
  const taken = await acceptDraft({ profileId: L.profileId, platformChatId: L.id, version: 0, draftId: first.draft.id });
  assert.ok(taken.ok && taken.flow.saved);
  assert.deepEqual(taken.flow.items.map(i => i.title), first.draft.items.map(i => i.title));
  assert.equal(taken.flow.draft, null);
  const again = await acceptDraft({ profileId: L.profileId, platformChatId: L.id, version: taken.flow.version, draftId: first.draft.id });
  assert.ok(!again.ok, "a draft never replaces a saved flow");
});

test("the learner's changes are saved in order and read back; an older version is refused; Undo restores; removing an item keeps its task", async () => {
  const L = await learner();
  const topic = await prisma.novaTopicMastery.findFirst({ where: { name: "SQL joins", subject: { profileId: L.profileId } }, select: { id: true } });
  const base = { profileId: L.profileId, platformChatId: L.id };
  const made = await changeDayFlow({ ...base, version: 0, by: "learner", ops: [
    { op: "add", item: { kind: "task", taskId: L.taskId } },
    { op: "add", item: { kind: "topic", topicId: topic!.id }, at: 0 },
    { op: "add", item: { kind: "focus", title: "20 minutes of revision", minutes: 20 } },
    { op: "set_intention", text: "Finish the assignment" },
  ] });
  assert.ok(made.ok);
  assert.deepEqual(made.flow.items.map(i => i.title), ["SQL joins", "Assignment 3", "20 minutes of revision"]);
  assert.equal(made.flow.items[1]!.minutes, 60, "a task's estimate is today's time to start with");
  assert.equal((await prisma.novaTask.count({ where: { profileId: L.profileId } })), 2, "a topic and a focus item made no task");

  const reread = await loadDayFlow(L.profileId, L.id);
  assert.deepEqual(reread.items.map(i => i.title), ["SQL joins", "Assignment 3", "20 minutes of revision"]);
  assert.equal(reread.intention, "Finish the assignment");

  const stale = await changeDayFlow({ ...base, version: made.flow.version - 1, by: "learner", ops: [{ op: "remove", id: reread.items[0]!.id }] });
  assert.ok(!stale.ok && stale.error === "stale" && stale.flow?.items.length === 3, "an older version changes nothing");

  const assignment = reread.items.find(i => i.taskId === L.taskId)!;
  const removed = await changeDayFlow({ ...base, version: reread.version, by: "learner", ops: [{ op: "remove", id: assignment.id }, { op: "set_minutes", id: reread.items[0]!.id, minutes: 45 }] });
  assert.ok(removed.ok && removed.flow.items.length === 2);
  const task = (await listTasks(L.profileId)).tasks.find(t => t.id === L.taskId)!;
  assert.deepEqual([task.status, task.estimatedMinutes, task.dueDay], ["todo", 60, new Date().toISOString().slice(0, 10)], "the task is as it was");

  const undone = await undoDayFlow({ ...base, version: removed.flow.version });
  assert.ok(undone.ok);
  assert.deepEqual(undone.flow.items.map(i => [i.title, i.minutes]), made.flow.items.map(i => [i.title, i.minutes]));

  // Another learner's task is not something this learner can put in their day.
  const other = await learner();
  const foreign = await changeDayFlow({ ...base, version: undone.flow.version, by: "learner", ops: [{ op: "add", item: { kind: "task", taskId: other.taskId } }] });
  assert.ok(!foreign.ok && foreign.error === "invalid");
  assert.equal((await loadDayFlow(other.profileId, other.id)).saved, false, "and nothing of theirs changed");
});

test("focus: this session's length only, no time limit, a task as a label, a length changed, and an end that marks nothing done", async () => {
  const L = await learner();
  const topic = await prisma.novaTopicMastery.findFirst({ where: { name: "FastAPI authentication", subject: { profileId: L.profileId } }, select: { id: true } });
  const base = { profileId: L.profileId, platformChatId: L.id };
  const made = await changeDayFlow({ ...base, version: 0, by: "learner", ops: [{ op: "add", item: { kind: "topic", topicId: topic!.id, minutes: 30 } }, { op: "add", item: { kind: "task", taskId: L.taskId } }] });
  assert.ok(made.ok);
  const [topicItem, taskItem] = made.flow.items;

  // A 45-minute session on the topic: the item's 30 and nothing else change.
  const started = await startFocus({ ...base, version: made.flow.version, itemId: topicItem!.id, minutes: 45 });
  assert.ok(started.ok);
  const s1 = await prisma.novaStudySession.findFirst({ where: { profileId: L.profileId, status: "in_progress" } });
  assert.deepEqual([s1?.plannedDurationMinutes, s1?.topicName], [45, "FastAPI authentication"]);
  const active = started.flow.items.find(i => i.id === topicItem!.id)!;
  assert.deepEqual([active.status, active.sessionId, active.minutes], ["active", s1!.id, 30]);
  // A second start while one runs starts nothing new.
  const twice = await startFocus({ ...base, version: started.flow.version, itemId: taskItem!.id, minutes: 30 });
  assert.ok(!twice.ok, "a second Start while one runs is refused");
  assert.equal(await prisma.novaStudySession.count({ where: { profileId: L.profileId, status: { in: ["in_progress", "paused"] } } }), 1);
  assert.equal((await loadDayFlow(L.profileId, L.id)).items.find(i => i.id === topicItem!.id)?.sessionId, s1!.id, "and the running item keeps its session");

  // Longer, then no time limit; the study time is untouched.
  assert.ok((await runNovaSessionCommand(L.id, { action: "set_length", minutes: 60 })).ok);
  const untimed = await runNovaSessionCommand(L.id, { action: "set_length", minutes: 0 });
  assert.ok(untimed.ok && untimed.session?.untimed === true && untimed.session.plannedDurationMinutes === 0);
  // Not swept as forgotten at 2 hours, as a session with no length would be.
  await prisma.novaStudySession.update({ where: { id: s1!.id }, data: { sessionDate: new Date(Date.now() - 120 * 60_000) } });
  assert.equal(await abandonIfStale(s1!.id, new Date()), false);

  const ended = await runNovaSessionCommand(L.id, { action: "end", outcome: "good" });
  assert.ok(ended.ok && ended.ended);
  const after1 = await loadDayFlow(L.profileId, L.id);
  const doneItem = after1.items.find(i => i.id === topicItem!.id)!;
  assert.equal(doneItem.sessionEnded, true, "its session ended; the learner says what next");
  assert.equal(doneItem.status, "active", "nothing is marked done by itself");
  assert.ok((doneItem.spentMinutes ?? 0) >= 100);

  // A task with no topic: a session with no topic, its title as the label.
  const t = await startFocus({ ...base, version: after1.version, itemId: taskItem!.id, minutes: 0 });
  assert.ok(t.ok);
  const s2 = await prisma.novaStudySession.findFirst({ where: { profileId: L.profileId, status: "in_progress" } });
  assert.deepEqual([s2?.topicName, s2?.currentFocus, s2?.plannedDurationMinutes], [null, "Assignment 3", 0]);
  const view = await runNovaSessionCommand(L.id, { action: "end", outcome: "okay" });
  assert.ok(view.ok && view.ended?.topicRecorded === false, "no topic recorded, so no mastery moved");
  assert.equal((await listTasks(L.profileId)).tasks.find(x => x.id === L.taskId)!.status, "todo", "the task is not done because a session ended");
});

test("the copilot proposes and the learner decides: nothing is written until they approve that proposal", async () => {
  const L = await learner();
  const base = { profileId: L.profileId, platformChatId: L.id };
  const made = await changeDayFlow({ ...base, version: 0, by: "learner", ops: [{ op: "add", item: { kind: "task", taskId: L.taskId } }, { op: "add", item: { kind: "focus", title: "Read the FastAPI docs", minutes: 30 } }] });
  assert.ok(made.ok);
  const v = made.flow.version;
  const stored = async () => (await loadDayFlow(L.profileId, L.id)).items.map(i => i.title);
  const say = (reply: unknown) => (async () => JSON.stringify(reply)) as never;

  // "Plan my day" alone is a question, even when the model drafts a day.
  const plan = await askCopilot(L.profileId, L.id, { message: "Plan my day", mode: "plan", version: v }, say({ intent: "propose", reply: "Here's your day", ops: [{ op: "add", ref: "c1" }, { op: "add", ref: "c2" }] }));
  assert.ok(plan.ok);
  assert.equal(plan.question, PLAN_QUESTION);
  assert.equal(plan.pending, null);
  assert.deepEqual(await stored(), ["Assignment 3", "Read the FastAPI docs"]);

  // A clear change is a proposal, worked out by the real rules, and not written.
  const asked = await askCopilot(L.profileId, L.id, { message: "Move the docs to the top and push the assignment to Friday", mode: "plan", version: v },
    say({ intent: "propose", reply: "Docs first? Moving the due day needs your yes.", ops: [{ op: "move", item: "i2", to: 0 }], proposals: [{ kind: "task_due", ref: "i1", dueDay: "2026-10-30" }] }));
  assert.ok(asked.ok && asked.pending);
  assert.deepEqual(asked.pending.changed, ["Moved Read the FastAPI docs to first."]);
  assert.deepEqual(asked.pending.items.map(i => [i.title, i.change]), [["Read the FastAPI docs", "moved"], ["Assignment 3", "moved"]]);
  assert.equal(asked.proposals[0]?.taskId, L.taskId);
  assert.deepEqual(await stored(), ["Assignment 3", "Read the FastAPI docs"], "a proposal writes nothing");
  assert.equal((await loadDayFlow(L.profileId, L.id)).version, v);

  // Saying no leaves it as it was.
  const no = await askCopilot(L.profileId, L.id, { message: "no, keep my plan", mode: "plan", version: v, open: asked.pending }, say({ intent: "decline", reply: "Okay, keeping it." }));
  assert.ok(no.ok && no.closed === "declined");
  assert.deepEqual(await stored(), ["Assignment 3", "Read the FastAPI docs"]);

  // A proposal code didn't make (changed after it was shown) writes nothing.
  const forged = await approvePending(L.profileId, L.id, { pendingId: asked.pending.id, version: v, ops: [{ op: "remove", id: made.flow.items[0]!.id }] });
  assert.equal(forged.ok, false);
  assert.deepEqual(await stored(), ["Assignment 3", "Read the FastAPI docs"]);

  // Approving applies exactly it, as Nova.
  const yes = await approvePending(L.profileId, L.id, { pendingId: asked.pending.id, version: asked.pending.version, ops: asked.pending.ops });
  assert.ok(yes.ok);
  assert.deepEqual(yes.flow.items.map(i => i.title), ["Read the FastAPI docs", "Assignment 3"]);
  assert.deepEqual(await stored(), ["Read the FastAPI docs", "Assignment 3"]);
  const task = (await listTasks(L.profileId)).tasks.find(t => t.id === L.taskId)!;
  assert.equal(task.dueDay, new Date().toISOString().slice(0, 10), "the due day is unchanged until the learner confirms it on its own");

  // A second approval of the same proposal is stale: the flow moved on.
  const again = await approvePending(L.profileId, L.id, { pendingId: asked.pending.id, version: asked.pending.version, ops: asked.pending.ops });
  assert.ok(!again.ok && again.error === "stale");

  // A proposal the learner's own change overtook is refused; their change stands.
  const next = await askCopilot(L.profileId, L.id, { message: "Take the docs out", mode: "plan", version: yes.flow.version }, say({ intent: "propose", reply: "Take them out of today?", ops: [{ op: "remove", item: "i1" }] }));
  assert.ok(next.ok && next.pending);
  const mine = await changeDayFlow({ ...base, version: yes.flow.version, by: "learner", ops: [{ op: "set_minutes", id: yes.flow.items[0]!.id, minutes: 40 }] });
  assert.ok(mine.ok);
  const late = await approvePending(L.profileId, L.id, { pendingId: next.pending.id, version: next.pending.version, ops: next.pending.ops });
  assert.ok(!late.ok && late.error === "stale");
  const now = await loadDayFlow(L.profileId, L.id);
  assert.deepEqual(now.items.map(i => [i.title, i.minutes]), [["Read the FastAPI docs", 40], ["Assignment 3", 60]]);

  const undone = await undoDayFlow({ ...base, version: now.version });
  assert.ok(undone.ok, "the learner's change can be undone");
});
