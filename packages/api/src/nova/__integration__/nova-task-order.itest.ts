/**
 * A task's length and the learner's own order — real Postgres integration test.
 *
 * What it proves: a length is only what the learner gave, and can be cleared;
 * a reorder places exactly the named tasks of one open column, in one
 * transaction, and is refused whole (nothing written) when any of them moved
 * column or is not the learner's; finished tasks are not ordered.
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
const { createTask, updateTask, listTasks, reorderTasks } = await import("../product/tasks.js");

const STAMP = Date.now();
const chats: string[] = [];
const now = new Date();

async function profile() {
  const chat = `web:torder_${STAMP}_${chats.length}`;
  chats.push(chat);
  const u = await prisma.messengerUser.create({ data: { platform: "web", platformChatId: chat, persona: "nova", novaAcademicProfile: { create: {} } }, select: { novaAcademicProfile: { select: { id: true } } } });
  return u.novaAcademicProfile!.id;
}
const make = async (p: string, title: string, extra: Record<string, unknown> = {}) => {
  const r = await createTask(p, { title, ...extra }, { now });
  assert.ok(r.ok);
  return r.ok ? r.task : null!;
};
const order = async (p: string) => (await listTasks(p, { now })).tasks.filter(t => t.status === "todo").map(t => t.title);

before(async () => { await prisma.$queryRaw`SELECT 1`; });
after(async () => {
  await prisma.messengerUser.deleteMany({ where: { platformChatId: { in: chats } } });
  await prisma.$disconnect();
});

test("a length is the learner's: set, shown, cleared, never guessed", async () => {
  const p = await profile();
  const t = await make(p, "Lab", { estimatedMinutes: 45 });
  assert.equal(t.estimatedMinutes, 45);
  assert.equal((await make(p, "Read")).estimatedMinutes, null, "not given, not guessed");
  const cleared = await updateTask(p, t.id, { estimatedMinutes: null }, { now });
  assert.ok(cleared.ok && cleared.task.estimatedMinutes === null);
  const bad = await updateTask(p, t.id, { estimatedMinutes: 9000 }, { now });
  assert.ok(!bad.ok && bad.error === "bad_minutes");
});

test("the learner's order holds, unplaced tasks follow, and a repeat is the same", async () => {
  const p = await profile();
  const a = await make(p, "A", { dueDay: "2026-10-20" });
  const b = await make(p, "B");
  const c = await make(p, "C", { dueDay: "2026-10-18" });
  assert.deepEqual(await order(p), ["C", "A", "B"], "the usual order: soonest due first");
  for (let i = 0; i < 2; i++) {
    const r = await reorderTasks(p, { status: "todo", ids: [b.id, a.id] }, { now });
    assert.ok(r.ok);
    assert.deepEqual(await order(p), ["B", "A", "C"]);
  }
  // A new order that leaves one out takes its place away.
  assert.ok((await reorderTasks(p, { status: "todo", ids: [a.id] }, { now })).ok);
  assert.deepEqual(await order(p), ["A", "C", "B"]);
  assert.equal((await prisma.novaTask.findUniqueOrThrow({ where: { id: b.id } })).position, null);
});

test("a task that moved column, another learner's task, or the done column: refused whole, nothing written", async () => {
  const p = await profile();
  const a = await make(p, "A"), b = await make(p, "B");
  assert.ok((await reorderTasks(p, { status: "todo", ids: [a.id, b.id] }, { now })).ok);
  await updateTask(p, b.id, { status: "in_progress" }, { now });
  const stale = await reorderTasks(p, { status: "todo", ids: [b.id, a.id] }, { now });
  assert.ok(!stale.ok && stale.error === "changed");
  assert.equal((await prisma.novaTask.findUniqueOrThrow({ where: { id: a.id } })).position, 0, "nothing written");

  const other = await profile();
  const theirs = await reorderTasks(other, { status: "todo", ids: [a.id] }, { now });
  assert.ok(!theirs.ok && theirs.error === "changed");
  assert.equal((await prisma.novaTask.findUniqueOrThrow({ where: { id: a.id } })).position, 0);

  for (const body of [{ status: "done", ids: [a.id] }, { status: "todo", ids: [] }, { status: "todo", ids: [a.id, a.id] }, null]) {
    const r = await reorderTasks(p, body, { now });
    assert.ok(!r.ok && r.error === "invalid", JSON.stringify(body));
  }
});

test("two reorders of one column at the same moment: both answer, and the column ends in one of the two orders, never a mix", async () => {
  const p = await profile();
  const ts = [];
  for (const t of ["A", "B", "C", "D"]) ts.push(await make(p, t));
  const one = ts.map(t => t.id), two = [...one].reverse();
  for (let round = 0; round < 5; round++) {
    const results = await Promise.all([reorderTasks(p, { status: "todo", ids: one }, { now }), reorderTasks(p, { status: "todo", ids: two }, { now })]);
    assert.ok(results.every(r => r.ok), JSON.stringify(results.map(r => r.ok ? "ok" : r.error)));
    const now_ = await order(p);
    assert.ok(JSON.stringify(now_) === JSON.stringify(["A", "B", "C", "D"]) || JSON.stringify(now_) === JSON.stringify(["D", "C", "B", "A"]), JSON.stringify(now_));
  }
});

test("a reorder and a move to another column at the same moment: the reorder is refused or the moved task keeps no place", async () => {
  const p = await profile();
  const a = await make(p, "A"), b = await make(p, "B");
  const [reordered] = await Promise.all([
    reorderTasks(p, { status: "todo", ids: [b.id, a.id] }, { now }),
    updateTask(p, b.id, { status: "in_progress" }, { now }),
  ]);
  const row = await prisma.novaTask.findUniqueOrThrow({ where: { id: b.id } });
  assert.equal(row.status, "in_progress");
  if (!reordered.ok) assert.equal(reordered.error, "changed");
  // Either way, A keeps a consistent place and nothing is half-written.
  assert.ok((await prisma.novaTask.count({ where: { profileId: p, status: "todo", position: { not: null } } })) <= 1);
});
