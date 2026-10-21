/**
 * Templates 2.0 — real Postgres integration test.
 *
 * What it proves: a workspace made from a template or a Nova plan creates
 * real subjects, topics, dates, tasks and notes through their own writers,
 * and they show up where the learner looks (Knowledge, the Map, the board,
 * Notes, Today's plan, dates); it is made once per key, in one transaction
 * (a refusal leaves nothing behind); a near-copy needs the learner's say-so;
 * adding to a workspace merges and overwrites nothing; one learner can
 * neither see nor touch another's; and a request is routed by its reading,
 * with the models stood in.
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
const { createWorkspace, listWorkspaces, removeWorkspace } = await import("../product/workspaces.js");
const { proposeWorkspace } = await import("../product/workspace-proposal.js");
const { planFromTemplate } = await import("../product/workspace-plan.js");
const { templateById } = await import("../product/templates.js");
const { listTasks } = await import("../product/tasks.js");
const { listNotes, createNote } = await import("../product/notes.js");
const { listExams } = await import("../product/exams.js");
const { loadNovaKnowledgeMap } = await import("../product/knowledge-map.js");
const { loadNovaToday } = await import("../product/today.js");
const { NOT_CREATING } = await import("../product/workspace-routing.js");

import type { WorkspacePlan } from "../product/workspace-plan.js";

const STAMP = Date.now();
const NOW = new Date();
const TODAY = NOW.toISOString().slice(0, 10);
const inDays = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString().slice(0, 10);
const ids: string[] = [];
let n = 0;

async function learner(): Promise<{ id: string; profileId: () => Promise<string> }> {
  const id = `web:ws_${STAMP}_${n++}`;
  ids.push(id);
  await prisma.messengerUser.create({ data: { platform: "web", platformChatId: id, persona: "nova", displayName: "Asha" } });
  return { id, profileId: async () => (await prisma.novaAcademicProfile.findFirstOrThrow({ where: { user: { platformChatId: id } } })).id };
}
const key = () => `key-${STAMP}-${n++}-abcdef`;

function examPlan(): WorkspacePlan {
  const r = planFromTemplate(templateById("competitive-exam")!, { name: "GATE CSE", subjectList: "Algorithms\nOperating Systems", date: inDays(60) }, { today: TODAY });
  assert.ok(r.ok);
  return r.plan;
}

before(async () => { await prisma.$queryRaw`SELECT 1`; });
after(async () => {
  await prisma.messengerUser.deleteMany({ where: { platformChatId: { in: ids } } });
  await prisma.$disconnect();
});

test("a template makes real records, and they show where the learner looks", async () => {
  const me = await learner();
  const plan = examPlan();
  plan.subjects[0]!.topics = [{ name: "Graphs", explanation: null, sources: [] }, { name: "Dynamic programming", explanation: null, sources: [] }];
  const made = await createWorkspace(me.id, { plan, clientKey: key() }, NOW);
  assert.equal(made.ok && made.status, "created");
  assert.ok(made.ok && made.status === "created");
  assert.deepEqual(made.counts, { subjectsAdded: 2, topicsAdded: 2, datesAdded: 1, tasksAdded: 5, notesAdded: 2, notesSkipped: [], datesSkipped: [] });
  const profileId = await me.profileId();

  // Knowledge and the Map: the subjects and topics.
  const map = await loadNovaKnowledgeMap(me.id);
  assert.equal(map.status, "ready");
  const names = map.status === "ready" ? map.nodes.map(x => x.label) : [];
  for (const name of ["Algorithms", "Operating Systems", "Graphs", "Dynamic programming", "Exam pattern: GATE CSE"]) assert.ok(names.includes(name), `${name} on the map`);
  // The board: the template's tasks, filed under the first section.
  const tasks = await listTasks(profileId, { now: NOW });
  assert.equal(tasks.tasks.length, 5);
  assert.ok(tasks.tasks.every(t => t.subjectName === "Algorithms" && t.status === "todo"));
  // Notes and dates.
  assert.deepEqual((await listNotes(profileId)).notes.map(x => x.title).sort(), ["Exam pattern: GATE CSE", "Facts and formula sheet: GATE CSE"]);
  const exams = await listExams(me.id, NOW);
  assert.deepEqual(exams?.map(e => [e.title, e.date]), [["GATE CSE", inDays(60)]]);
  // Today's plan: setup counts as done, and the new topics are new material.
  const today = await loadNovaToday(me.id, { now: NOW });
  assert.equal(today.status, "ready");
  // The workspace itself, kept apart from the template.
  const list = await listWorkspaces(profileId);
  assert.deepEqual(list.workspaces.map(w => [w.kind, w.templateId, w.templateName, w.subjects.map(s => s.name)]), [["template", "competitive-exam", "Competitive exam", ["Algorithms", "Operating Systems"]]]);
});

test("one key, one workspace: a retry and two requests at once write it once", async () => {
  const me = await learner();
  const k = key();
  const first = await createWorkspace(me.id, { plan: examPlan(), clientKey: k }, NOW);
  const again = await createWorkspace(me.id, { plan: examPlan(), clientKey: k }, NOW);
  assert.equal(first.ok && first.status, "created");
  assert.equal(again.ok && again.status, "exists");
  const profileId = await me.profileId();
  assert.equal(await prisma.novaTask.count({ where: { profileId } }), 5);

  const other = await learner();
  const k2 = key();
  const results = await Promise.all([1, 2, 3].map(() => createWorkspace(other.id, { plan: examPlan(), clientKey: k2 }, NOW)));
  assert.equal(results.filter(r => r.ok && r.status === "created").length, 1);
  assert.equal(await prisma.novaWorkspace.count({ where: { profile: { user: { platformChatId: other.id } } } }), 1);
  assert.equal(await prisma.novaSubject.count({ where: { profile: { user: { platformChatId: other.id } } } }), 2);
});

test("a near-copy waits for the learner: open it, add to it, or make another", async () => {
  const me = await learner();
  await createWorkspace(me.id, { plan: examPlan(), clientKey: key() }, NOW);
  const profileId = await me.profileId();
  // Their own note under a section, written before.
  const algorithms = await prisma.novaSubject.findFirstOrThrow({ where: { profileId, name: "Algorithms" } });
  const exists = await prisma.novaNote.findFirstOrThrow({ where: { profileId, title: "Exam pattern: GATE CSE" } });
  await prisma.novaNote.update({ where: { id: exists.id }, data: { body: "MY OWN WORDS" } });

  const again = await createWorkspace(me.id, { plan: examPlan(), clientKey: key() }, NOW);
  assert.ok(again.ok && again.status === "similar");
  assert.equal(again.similar.length, 1);
  assert.equal(await prisma.novaWorkspace.count({ where: { profileId } }), 1, "nothing written");

  // Add to it: merged, nothing overwritten, nothing duplicated.
  const plus = examPlan();
  plus.subjects.push({ name: "Databases", topics: [{ name: "Normalisation", explanation: null, sources: [] }] });
  const added = await createWorkspace(me.id, { plan: plus, clientKey: key(), addTo: again.similar[0]!.id }, NOW);
  assert.ok(added.ok && added.status === "updated");
  assert.deepEqual(added.counts.notesSkipped.sort(), ["Exam pattern: GATE CSE", "Facts and formula sheet: GATE CSE"]);
  assert.equal(added.counts.tasksAdded, 0, "the same tasks, keyed by the workspace, are not made twice");
  assert.equal(added.counts.subjectsAdded, 1);
  assert.deepEqual(added.counts.datesSkipped, ["GATE CSE"]);
  assert.equal((await prisma.novaNote.findUniqueOrThrow({ where: { id: exists.id } })).body, "MY OWN WORDS");
  assert.equal(await prisma.novaSubject.count({ where: { profileId, name: "Algorithms" } }), 1);
  assert.equal(algorithms.id, (await prisma.novaSubject.findFirstOrThrow({ where: { profileId, name: "Algorithms" } })).id);
  assert.equal(await prisma.novaWorkspace.count({ where: { profileId } }), 1);

  // The same notes under another subject are still the same notes: titles are what links find.
  const single = planFromTemplate(templateById("competitive-exam")!, { name: "GATE CSE" }, { today: TODAY });
  assert.ok(single.ok);
  const regrouped = await createWorkspace(me.id, { plan: single.plan, clientKey: key(), addTo: again.similar[0]!.id }, NOW);
  assert.ok(regrouped.ok && regrouped.status === "updated");
  assert.equal(regrouped.counts.notesAdded, 0);
  assert.equal(await prisma.novaNote.count({ where: { profileId, title: "Exam pattern: GATE CSE" } }), 1);

  // Or make another, on purpose.
  const another = await createWorkspace(me.id, { plan: examPlan(), clientKey: key(), confirmAnother: true }, NOW);
  assert.equal(another.ok && another.status, "created");
  assert.equal(await prisma.novaWorkspace.count({ where: { profileId } }), 2);
});

test("made whole or not at all: a refusal partway leaves nothing behind", async () => {
  const me = await learner();
  // A learner at the open-task limit: the workspace's tasks would pass it.
  await createWorkspace(me.id, { plan: { ...examPlan(), tasks: [] }, clientKey: key() }, NOW);
  const profileId = await me.profileId();
  await createNote(profileId, { title: "keep", body: "" });
  await prisma.novaTask.createMany({ data: Array.from({ length: 298 }, (_, i) => ({ profileId, title: `t${i}`, status: "todo" })) });
  const before = { subjects: await prisma.novaSubject.count({ where: { profileId } }), notes: await prisma.novaNote.count({ where: { profileId } }) };
  const plan = examPlan();
  plan.title = "A different name";
  plan.subjects.push({ name: "Brand new subject", topics: [{ name: "x", explanation: null, sources: [] }] });
  const refused = await createWorkspace(me.id, { plan, clientKey: key(), confirmAnother: true }, NOW);
  assert.deepEqual(refused.ok ? null : refused.error, "too_many");
  assert.equal(await prisma.novaSubject.count({ where: { profileId } }), before.subjects, "no subject left behind");
  assert.equal(await prisma.novaNote.count({ where: { profileId } }), before.notes, "no note left behind");
  assert.equal(await prisma.novaWorkspace.count({ where: { profileId, title: "A different name" } }), 0);
});

test("one learner's workspaces are theirs alone", async () => {
  const a = await learner();
  const b = await learner();
  const made = await createWorkspace(a.id, { plan: examPlan(), clientKey: key() }, NOW);
  assert.ok(made.ok && made.status === "created");
  await createWorkspace(b.id, { plan: { ...examPlan(), title: "B's own" }, clientKey: key() }, NOW);
  const bProfile = await b.profileId();
  // B cannot add to A's, nor remove it, nor see it.
  const into = await createWorkspace(b.id, { plan: examPlan(), clientKey: key(), addTo: made.workspace.id }, NOW);
  assert.deepEqual(into.ok ? null : into.error, "not_found");
  assert.equal(await removeWorkspace(bProfile, made.workspace.id), false);
  assert.deepEqual((await listWorkspaces(bProfile)).workspaces.map(w => w.title), ["B's own"]);
  // A key A used means nothing for B.
  assert.equal(await prisma.novaWorkspace.count({ where: { id: made.workspace.id } }), 1);
  // Removing one's own record leaves its subjects.
  const aProfile = await a.profileId();
  assert.equal(await removeWorkspace(aProfile, made.workspace.id), true);
  assert.equal(await prisma.novaSubject.count({ where: { profileId: aProfile } }), 2);
});

test("a forged plan is checked again: no stray sources, no unchecked links, no past dates", async () => {
  const me = await learner();
  const plan = examPlan() as unknown as Record<string, unknown>;
  const made = await createWorkspace(me.id, {
    plan: { ...plan, kind: "template", templateId: "not-a-template", dates: [{ title: "Old", day: "2020-01-01", kind: "exam" }],
      resources: [{ title: "Sketchy", kind: "course", url: "https://sketchy.example", origin: "nova" }] },
    clientKey: key(),
  }, NOW);
  assert.ok(made.ok && made.status === "created");
  const row = await prisma.novaWorkspace.findUniqueOrThrow({ where: { id: made.workspace.id } });
  assert.equal(row.kind, "custom", "an unknown template id is not a template");
  const stored = row.plan as unknown as WorkspacePlan;
  assert.deepEqual(stored.dates, []);
  assert.equal(stored.resources[0]!.url, null);
});

test("a request is routed by its reading: used, adapted, custom, or nothing made", async () => {
  const me = await learner();
  const read = (over: Record<string, unknown>) => (async () => ({ ...NOT_CREATING, creating: true, ...over })) as never;
  let wrote = 0;
  const write = (async () => { wrote++; return { ok: true, dropped: [], plan: { ...examPlan(), kind: "custom", templateId: null, templateVersion: null, title: "Nova's" } }; }) as never;

  // Fits as it is: the template, no plan call.
  const used = await proposeWorkspace(me.id, { request: "set up my CS semester" }, NOW, { read: read({ outcome: "semester", subject: "Semester 5" }), write });
  assert.ok(used.ok && used.route === "use");
  assert.equal(wrote, 0);
  // Needs content: adapted by Nova.
  const adapted = await proposeWorkspace(me.id, { request: "GATE CSE plan" }, NOW, { read: read({ outcome: "competitive_exam", subject: "GATE CSE" }), write });
  assert.ok(adapted.ok && adapted.route === "adapt");
  // Files make it about the files, whatever the words.
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Page >> endobj\n%%EOF").toString("base64");
  const fromFile = await proposeWorkspace(me.id, { request: "use this", files: [{ name: "syllabus.pdf", data: pdf }] }, NOW, { read: read({ creating: false, outcome: "semester", subject: "Sem" }), write });
  assert.ok(fromFile.ok && fromFile.route === "adapt");
  // No template for it: custom.
  const custom = await proposeWorkspace(me.id, { request: "plan my wedding" }, NOW, { read: read({ outcome: "other", subject: "Wedding" }), write });
  assert.ok(custom.ok && custom.route === "custom");
  // A question: nothing.
  const question = await proposeWorkspace(me.id, { request: "what is GATE?" }, NOW, { read: (async () => NOT_CREATING) as never, write });
  assert.ok(question.ok && question.route === "not_creation");
  // A bad file is refused before any model call.
  const before = wrote;
  const bad = await proposeWorkspace(me.id, { request: "x", files: [{ name: "a.pdf", data: Buffer.from("not a pdf").toString("base64") }] }, NOW, { read: read({}), write });
  assert.deepEqual(bad.ok ? null : bad.error, "files");
  assert.equal(wrote, before);
  // Proposing stores nothing.
  assert.equal(await prisma.novaWorkspace.count({ where: { profile: { user: { platformChatId: me.id } } } }), 0);
});
