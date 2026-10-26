/**
 * Subjects inside subjects — real Postgres.
 *
 * Replays the owner's 26 Oct conversation ("instead of all the subjects
 * scattered on the knowledge map i want them to come under one main thing
 * which is semester five"; "no dont remove it, keep everything same") with
 * both models stood in by what they actually proposed, and proves: a request
 * that removes nothing keeps no removal; the group is added and each subject
 * put inside it on approval, with every topic, task and date where it was;
 * the map draws it; History takes it back; deleting the workspace removes
 * the group Nova made; a plan can make a group; and a learner can't put a
 * subject inside another learner's.
 *
 *   NOVA_TEST_DATABASE_URL=postgresql://... npx tsx --test src/nova/__integration__/nova-subject-groups.itest.ts
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
const { checkWorkspacePlan } = await import("../product/workspace-plan.js");
const { ensureSetupProfile } = await import("../product/setup.js");
const { applyStudyEdits, loadStudyStructure } = await import("../product/setup-edit.js");
const { loadNovaKnowledgeMap } = await import("../product/knowledge-map.js");

import type { BuilderDeps } from "../product/builder.js";
import type { ChangesRequest } from "../product/workspace-generation.js";

const STAMP = Date.now();
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const NAMES = ["Competitive Programming", "Automata", "NLP", "SPM", "Prompt Engineering"];
const ids: string[] = [];
let n = 0;

async function learner() {
  const id = `web:grp_${STAMP}_${n++}`;
  ids.push(id);
  await prisma.messengerUser.create({ data: { platform: "web", platformChatId: id, persona: "nova", displayName: "Kartik" } });
  return { id, profileId: (await ensureSetupProfile(id))!.profileId };
}
const key = () => `grp-${STAMP}-${n++}-abcdef`;
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
const changer = (ops: (req: ChangesRequest) => unknown[]): NonNullable<BuilderDeps["writeChanges"]> => async req => ({ ok: true, summary: null, ops: ops(req) });
const noWrite: NonNullable<BuilderDeps["write"]> = async () => { throw new Error("a new plan was written"); };
const noModel: NonNullable<BuilderDeps["writeChanges"]> = async () => { throw new Error("the model wrote it"); };

async function say(id: string, draftId: string, text: string, deps: BuilderDeps) {
  const claimed = await builder.postMessage(id, draftId, { text });
  assert.ok(claimed.ok, claimed.ok ? "" : claimed.message);
  await builder.runJob(id, claimed.job, deps);
  return (await builder.getDraft(id, draftId))!;
}
const placement = async (profileId: string) => {
  const rows = await prisma.novaSubject.findMany({ where: { profileId }, select: { id: true, name: true, parentId: true } });
  return Object.fromEntries(rows.map(r => [r.name, r.parentId ? rows.find(x => x.id === r.parentId)?.name ?? "?" : null]));
};
const counts = async (profileId: string) => ({
  topics: await prisma.novaTopicMastery.count({ where: { subject: { profileId } } }),
  tasks: await prisma.novaTask.findMany({ where: { profileId }, select: { title: true, subjectId: true }, orderBy: { title: "asc" } }),
  exams: await prisma.novaExam.findMany({ where: { profileId }, select: { title: true, subjectId: true } }),
});

after(async () => {
  await prisma.messengerUser.deleteMany({ where: { platformChatId: { in: ids } } });
  await prisma.$disconnect();
});

test("Semester Five: regrouping removes nothing, puts each subject inside the group, and can be taken back and deleted", async () => {
  const me = await learner();
  await prisma.novaAcademicProfile.update({ where: { id: me.profileId }, data: { onboardingComplete: true } });
  const started = await builder.startDraft(me.id, { clientKey: key(), text: "i have my semester exam for the five subjects in december first week" });
  assert.ok(started.ok && started.job);
  await builder.runJob(me.id, started.job!, {
    read: reader({ ...ASKED, next: "draft", kind: "semester", facts: [{ label: "Exams", value: "December first week", quote: "december first week" }, { label: "Subjects", value: "five", quote: "five subjects" }] }),
    write: async req => checkWorkspacePlan({
      kind: "custom", title: "Semester Exams Preparation", summary: "Five semester exams",
      subjects: NAMES.map(name => ({ name, topics: [`${name} basics`, `${name} problems`] })),
      tasks: [{ key: "aut", title: "Complete tutorials 8 to 11", subject: "Automata", dueDay: inDays(10) }],
      dates: [{ title: "Automata exam", subject: "Automata", kind: "exam", day: inDays(36) }],
    }, { today: req.today, userText: req.learnerText, nova: true }),
  });
  let draft = (await builder.getDraft(me.id, started.draft.id))!;
  const built = await builder.approveDraft(me.id, draft.id, { version: draft.version });
  assert.ok(built.ok && built.draft.status === "ready", built.ok ? "" : built.message);
  const before = await counts(me.profileId);

  // v2, as the model wrote it: every subject removed, the group added with their names as its topics.
  // The learner asked to remove nothing, so no removal is kept.
  draft = await say(me.id, draft.id, "no dont remove it i mean keep everything same just make sure they all come under one main topic that is sem five", {
    read: reader({ ...ASKED, next: "revise", change: "Put all five subjects under Semester Five", touches: ["subjects"], removes: false }), write: noWrite,
    writeChanges: changer(req => [
      { op: "add_subject", name: "Semester Five", topics: NAMES },
      ...req.current.subjects.map(s => ({ op: "remove_subject", subjectId: s.id })),
    ]),
  });
  assert.equal(draft.status, "awaiting_approval");
  assert.deepEqual(draft.changes!.ops.map(o => o.says), ['Add subject "Semester Five"', ...NAMES.map(name => `Put "${name}" inside "Semester Five"`)]);
  assert.ok(draft.changes!.ops.every(o => o.effect !== "remove"));
  // Nothing changes before approval.
  assert.ok(Object.values(await placement(me.profileId)).every(p => p === null));

  const applied = await builder.approveDraft(me.id, draft.id, { version: draft.version });
  assert.ok(applied.ok, applied.ok ? "" : applied.message);
  const grouped = await placement(me.profileId);
  assert.equal(grouped["Semester Five"], null);
  for (const name of NAMES) assert.equal(grouped[name], "Semester Five", name);
  // Every topic, task and date is where it was.
  assert.deepEqual(await counts(me.profileId), before);
  // The workspace holds the group, and the live view knows where each subject sits.
  const live = (await builder.getDraft(me.id, draft.id))!;
  const group = live.current!.subjects.find(s => s.name === "Semester Five")!;
  assert.ok(group);
  assert.ok(live.current!.subjects.filter(s => s.parentId === group.id).length === 5);

  // The map draws the group with its five subjects; Subject Studio shows the same.
  const map = await loadNovaKnowledgeMap(me.id);
  assert.equal(map.status, "ready");
  if (map.status === "ready") assert.equal(map.edges.filter(e => e.kind === "contains" && e.from === `subject:${group.id}`).length, 5);
  const structure = await loadStudyStructure(me.profileId);
  assert.equal(structure.subjects.filter(s => s.parentId === group.id).length, 5);

  // "Revert the changes": History brings the subjects back out and the group goes.
  draft = await say(me.id, draft.id, "no, revert the changes", { read: reader({ ...ASKED, next: "revise", undo: true }), write: noWrite, writeChanges: noModel });
  assert.deepEqual(draft.changes!.ops.map(o => o.says).sort(), [
    ...NAMES.map(name => `Take "${name}" out of "Semester Five", on its own`),
    'Remove subject "Semester Five" (its notes and tasks stay, unfiled)',
  ].sort());
  const undone = await builder.approveDraft(me.id, draft.id, { version: draft.version });
  assert.ok(undone.ok, undone.ok ? "" : undone.message);
  const back = await placement(me.profileId);
  assert.equal(back["Semester Five"], undefined);
  assert.ok(NAMES.every(name => back[name] === null));
  assert.deepEqual(await counts(me.profileId), before);

  // Grouped again, the clean way (the group added with a key, each subject moved in).
  draft = await say(me.id, draft.id, "put them all under Semester Five", {
    read: reader({ ...ASKED, next: "revise", change: "Group under Semester Five", touches: ["subjects"], removes: false }), write: noWrite,
    writeChanges: changer(req => [
      { op: "add_subject", key: "sem5", name: "Semester Five", topics: [] },
      ...req.current.subjects.map(s => ({ op: "move_subject", subjectId: s.id, parentKey: "sem5" })),
    ]),
  });
  assert.ok((await builder.approveDraft(me.id, draft.id, { version: draft.version })).ok);

  // Deleting it from everywhere: the group Nova made goes with the rest of what Nova made.
  draft = await say(me.id, draft.id, "delete this from everywhere", { read: reader({ ...ASKED, next: "revise", deleteAll: true }), write: noWrite, writeChanges: noModel });
  const scope = draft.brief.deletion!;
  assert.ok(scope.removes.subjects.some(s => s.name === "Semester Five"));
  assert.ok((await builder.confirmDeletion(me.id, draft.id, { fingerprint: scope.fingerprint })).ok);
  assert.equal(await prisma.novaSubject.count({ where: { profileId: me.profileId, name: "Semester Five" } }), 0);
});

test("a plan can make a group; building it never moves a subject they already had", async () => {
  const me = await learner();
  const mine = await applyStudyEdits(me.profileId, { version: (await loadStudyStructure(me.profileId)).version, edits: [{ op: "add_subject", name: "NLP", topics: ["Tokenisation"] }] });
  assert.ok(mine.ok);
  const started = await builder.startDraft(me.id, { clientKey: key(), text: "Semester five: Automata and NLP, all under Semester Five, exams in December" });
  assert.ok(started.ok && started.job);
  await builder.runJob(me.id, started.job!, {
    read: reader({ ...ASKED, next: "draft", kind: "semester", facts: [{ label: "Semester", value: "five", quote: "Semester five" }, { label: "Exams", value: "December", quote: "exams in December" }] }),
    write: async req => checkWorkspacePlan({ kind: "custom", title: "Semester Five", summary: "Exams",
      subjects: [{ name: "Semester Five", topics: [] }, { name: "Automata", topics: ["Regular languages"], parent: "Semester Five" }, { name: "NLP", topics: ["Parsing"], parent: "Semester Five" }],
    }, { today: req.today, userText: req.learnerText, nova: true }),
  });
  const draft = (await builder.getDraft(me.id, started.draft.id))!;
  assert.equal(draft.plan!.subjects.find(s => s.name === "Automata")!.parent, "Semester Five");
  const built = await builder.approveDraft(me.id, draft.id, { version: draft.version });
  assert.ok(built.ok, built.ok ? "" : built.message);
  const placed = await placement(me.profileId);
  assert.equal(placed["Automata"], "Semester Five");
  // NLP was theirs already: building adds to it and leaves it where it was.
  assert.equal(placed["NLP"], null);
});

test("Subject Studio puts a subject inside another of theirs, never inside another learner's or in a loop", async () => {
  const a = await learner(), b = await learner();
  const add = async (profileId: string, names: string[]) => {
    const r = await applyStudyEdits(profileId, { version: (await loadStudyStructure(profileId)).version, edits: names.map(name => ({ op: "add_subject", name, topics: [] })) });
    assert.ok(r.ok);
    return r.ok ? r.structure.subjects : [];
  };
  const [theirs] = await add(a.profileId, ["Their group"]);
  const subjects = await add(b.profileId, ["Semester Five", "Automata"]);
  const group = subjects.find(s => s.name === "Semester Five")!, automata = subjects.find(s => s.name === "Automata")!;
  const structureVersionBefore = (await loadStudyStructure(b.profileId)).version;

  const stolen = await applyStudyEdits(b.profileId, { version: (await loadStudyStructure(b.profileId)).version, edits: [{ op: "move_subject", subjectId: automata.id, parentId: theirs!.id }] });
  assert.equal(!stolen.ok && stolen.error, "invalid");
  const moved = await applyStudyEdits(b.profileId, { version: (await loadStudyStructure(b.profileId)).version, edits: [{ op: "move_subject", subjectId: automata.id, parentId: group.id }] });
  assert.ok(moved.ok && moved.applied[0] === "Put Automata inside Semester Five.");
  const loop = await applyStudyEdits(b.profileId, { version: (await loadStudyStructure(b.profileId)).version, edits: [{ op: "move_subject", subjectId: group.id, parentId: automata.id }] });
  assert.equal(!loop.ok && loop.error, "invalid");
  // A page made before the move is stale: the version knows where subjects sit.
  const old = await applyStudyEdits(b.profileId, { version: subjects.length ? structureVersionBefore : "", edits: [{ op: "move_subject", subjectId: automata.id, parentId: null }] });
  assert.equal(!old.ok && old.error, "stale");
  // Removing the group leaves Automata on its own.
  const removed = await applyStudyEdits(b.profileId, { version: (await loadStudyStructure(b.profileId)).version, edits: [{ op: "remove_subject", subjectId: group.id }] });
  assert.ok(removed.ok);
  assert.equal((await prisma.novaSubject.findUnique({ where: { id: automata.id } }))!.parentId, null);
});
