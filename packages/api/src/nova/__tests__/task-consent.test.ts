// Build with Nova: only the tasks the learner asked for (task-consent.ts),
// and things put inside the parent they named (builder-changes.ts
// placeUnder). Applied by code to whatever the model wrote; no database and
// no model (the plan writer's model is a stub).

import { filterPlanTasks, filterTaskOps } from "../product/task-consent";
import { checkChanges, placeUnder, withinAsk } from "../product/builder-changes";
import { applyToPlan, planDetail } from "../product/builder-plan";
import { builderPlanPrompt, changesPrompt, writeBuilderPlan, type BuilderPlanRequest } from "../product/workspace-generation";
import { checkWorkspacePlan, type WorkspacePlan } from "../product/workspace-plan";
import type { WorkspaceDetail } from "../product/builder.types";

jest.mock("../../services/openai.service", () => ({ generateOpenAIText: jest.fn() }));

const TODAY = "2026-10-26";

// Finance with four phases, each with a topic, and tasks in two of them.
function financePlan(over: Record<string, unknown> = {}): WorkspacePlan {
  const r = checkWorkspacePlan({
    title: "Finance", summary: "Learn finance in four phases",
    subjects: [{ name: "Finance", topics: [
      { name: "Phase 1", kind: "milestone", topics: [{ name: "Budgeting" }] },
      { name: "Phase 2", kind: "milestone", topics: [{ name: "Saving" }] },
      { name: "Phase 3", kind: "milestone", topics: [{ name: "Investing" }] },
      { name: "Phase 4", kind: "milestone", topics: [{ name: "Retirement" }] },
    ] }],
    tasks: [
      { key: "b", title: "Write a monthly budget", subject: "Finance", topic: "Budgeting" },
      { key: "b1", title: "List fixed costs", parent: "b" },
      { key: "p1", title: "Track spending for a week", subject: "Finance", topic: "Phase 1" },
      { key: "s", title: "Open a savings account", subject: "Finance", topic: "Saving", after: ["b"] },
    ],
    ...over,
  }, { today: TODAY });
  if (!r.ok) throw new Error(r.message);
  return r.plan;
}

describe("a proposal's tasks are only those asked for", () => {
  it("none asked for: no tasks at all, said as left out; the hierarchy is untouched (Scenario C)", () => {
    const plan = financePlan();
    const out = filterPlanTasks(plan, { mode: "none", scope: [] });
    expect(out.plan.tasks).toEqual([]);
    expect(out.plan.subjects).toEqual(plan.subjects);
    expect(out.dropped).toEqual(["4 tasks (you haven't asked for tasks)"]);
  });
  it("asked for all: every task stays", () => {
    const plan = financePlan();
    expect(filterPlanTasks(plan, { mode: "all", scope: [] })).toEqual({ plan, dropped: [] });
  });
  it("asked for Phase 1 only: its tasks, those of topics inside it, and their steps; a wait on a task left out goes (Scenario E)", () => {
    const out = filterPlanTasks(financePlan(), { mode: "scoped", scope: ["phase 1"] });
    expect(out.plan.tasks.map(t => t.key)).toEqual(["b", "b1", "p1"]);
    expect(out.dropped).toEqual(["1 task (you asked for tasks only in phase 1)"]);
    const scopedToSaving = filterPlanTasks(financePlan(), { mode: "scoped", scope: ["Phase 2"] });
    expect(scopedToSaving.plan.tasks.map(t => t.key)).toEqual(["s"]);
    expect(scopedToSaving.plan.tasks[0]!.after).toEqual([]);
  });
  it("a whole subject in scope covers the subjects inside it", () => {
    const plan = financePlan({
      subjects: [{ name: "Money", topics: [] }, { name: "Finance", parent: "Money", topics: [{ name: "Budgeting" }] }, { name: "Cooking", topics: [{ name: "Knife skills" }] }],
      tasks: [{ key: "b", title: "Write a monthly budget", subject: "Finance", topic: "Budgeting" }, { key: "k", title: "Practise a julienne", subject: "Cooking", topic: "Knife skills" }],
    });
    expect(filterPlanTasks(plan, { mode: "scoped", scope: ["Money"] }).plan.tasks.map(t => t.key)).toEqual(["b"]);
  });
});

// The live records: Finance with its phases as topics, and a task the learner has.
const detail: WorkspaceDetail = {
  workspace: null, title: "Finance",
  subjects: [
    { id: "s-fin", name: "Finance", parentId: null, topics: [
      { id: "t-p1", name: "Phase 1", parentId: null, kind: "milestone" },
      { id: "t-bud", name: "Budgeting", parentId: "t-p1" },
      { id: "t-p2", name: "Phase 2", parentId: null, kind: "milestone" },
    ] },
  ],
  tasks: [{ id: "k-own", title: "Read my bank statement", status: "todo", priority: null, dueDay: null, subjectId: "s-fin", topicName: "Budgeting", estimatedMinutes: null, parentId: null }],
  notes: [], dates: [],
};
const check = (ops: unknown[]) => checkChanges(ops, detail, { today: TODAY, studied: new Set() });

describe("a change's new tasks are only those asked for", () => {
  const ops = [
    { op: "add_topics", subjectId: "s-fin", names: ["Credit"], parentId: "t-p2" },
    { op: "add_task", key: "a", title: "Set a budget for October", subjectId: "s-fin", topicName: "Budgeting", dueDay: null, priority: null },
    { op: "add_task", key: "a1", title: "Pick categories", parentKey: "a", subjectId: null, topicName: null, dueDay: null, priority: null },
    { op: "add_task", key: "own1", title: "Highlight recurring costs", parentId: "k-own", subjectId: null, topicName: null, dueDay: null, priority: null },
    { op: "add_task", key: "c", title: "Compare credit cards", subjectId: "s-fin", topicName: "Phase 2", dueDay: null, priority: null, after: ["a"] },
  ];
  it("none asked for: every add_task goes, whatever kinds the model said the request was about; the rest stays", () => {
    // touches [] lets every kind through withinAsk: tasks are still held back here.
    const set = filterTaskOps(withinAsk(check(ops), [], detail), { mode: "none", scope: [] }, detail);
    expect(set.ops.map(o => o.op)).toEqual(["add_topics"]);
    expect(set.dropped.filter(d => d.endsWith("(you haven't asked for tasks)"))).toHaveLength(4);
  });
  it("Phase 1 only: tasks filed in it or a topic inside it, steps of those (new or the learner's), nothing in Phase 2", () => {
    const set = filterTaskOps(check(ops), { mode: "scoped", scope: ["Phase 1"] }, detail);
    expect(set.ops.flatMap(o => (o.op === "add_task" ? [o.key] : []))).toEqual(["a", "a1", "own1"]);
    expect(set.ops.map(o => o.id)).toEqual(["c1", "c2", "c3", "c4"]);
  });
  it("all asked for: unchanged", () => {
    const set = check(ops);
    expect(filterTaskOps(set, { mode: "all", scope: [] }, detail)).toBe(set);
  });
  it("never removes a task that is there", () => {
    const set = check([{ op: "remove_task", taskId: "k-own" }]);
    expect(filterTaskOps(set, { mode: "none", scope: [] }, detail).ops.map(o => o.op)).toEqual(["remove_task"]);
  });
});

describe("put inside the parent they named, never beside it (Scenario D)", () => {
  it("new phases written as subjects of their own go inside Finance, a subject: one map, not four", () => {
    const raw = [1, 2, 3, 4].map(n => ({ op: "add_subject", key: `p${n}`, name: `Stage ${n}`, topics: [] }));
    const placed = placeUnder(raw, "finance", detail);
    expect(placed.touches).toEqual(["subjects"]);
    const set = check(placed.ops);
    expect(set.ops.map(o => (o.op === "add_subject" ? o.parentId : null))).toEqual(["s-fin", "s-fin", "s-fin", "s-fin"]);
  });
  it("inside a topic, a new subject becomes a topic there, with what it holds inside it", () => {
    const placed = placeUnder([{ op: "add_subject", key: "cr", name: "Credit scores", topics: ["Reports", "Utilisation"] }], "Phase 2", detail);
    expect(placed.touches).toEqual(["topics"]);
    const set = check(placed.ops);
    expect(set.ops.map(o => o.op)).toEqual(["add_topics", "add_topics"]);
    // Applied to the outline: Credit scores inside Phase 2, its two topics inside it.
    const first = set.ops[0]!;
    expect(first.op === "add_topics" && first.parentId).toBe("t-p2");
    expect(set.ops[1]!.op === "add_topics" && (set.ops[1] as { parentKey?: string }).parentKey).toBe("cr");
  });
  it("new topics at the top of that topic's subject go inside it; anything already placed is left as written", () => {
    const placed = placeUnder([
      { op: "add_topics", subjectId: "s-fin", names: ["Emergency fund"] },
      { op: "add_topics", subjectId: "s-fin", names: ["Taxes"], parentId: "t-p1" },
      { op: "move_topic", topicId: "t-bud", parentId: null },
    ], "Phase 2", detail);
    expect(placed.ops).toEqual([
      { op: "add_topics", subjectId: "s-fin", names: ["Emergency fund"], parentId: "t-p2" },
      { op: "add_topics", subjectId: "s-fin", names: ["Taxes"], parentId: "t-p1" },
      { op: "move_topic", topicId: "t-bud", parentId: null },
    ]);
  });
  it("a parent not there, or none named, changes nothing", () => {
    const raw = [{ op: "add_subject", key: "x", name: "Stage 1", topics: [] }];
    expect(placeUnder(raw, "Accounting", detail)).toEqual({ ops: raw, touches: [] });
    expect(placeUnder(raw, null, detail)).toEqual({ ops: raw, touches: [] });
  });
  it("on a proposal not built yet: four phases moved under Finance stay one subject with the phases inside, nothing else changes", () => {
    const r = checkWorkspacePlan({
      title: "Money", summary: "Money matters",
      subjects: [{ name: "Finance", topics: [{ name: "Phase 1" }, { name: "Phase 2" }, { name: "Phase 3" }, { name: "Phase 4" }, { name: "Money basics" }] }],
      tasks: [{ key: "keep", title: "Read the basics chapter", subject: "Finance", topic: "Money basics" }],
    }, { today: TODAY });
    if (!r.ok) throw new Error(r.message);
    const { detail: d } = planDetail(r.plan);
    const fin = d.subjects[0]!;
    const ov = fin.topics.find(t => t.name === "Money basics")!;
    // "Put all four phases under Money basics": each phase is moved, nothing is re-added.
    const ops = fin.topics.filter(t => t.name.startsWith("Phase")).map(t => ({ op: "move_topic", topicId: t.id, parentId: ov.id }));
    const set = checkChanges(ops, d, { today: TODAY, studied: new Set() });
    const after = applyToPlan(r.plan, set);
    expect(after.subjects).toHaveLength(1);
    expect(after.subjects[0]!.topics.filter(t => t.parent === "Money basics").map(t => t.name)).toEqual(["Phase 1", "Phase 2", "Phase 3", "Phase 4"]);
    expect(after.tasks).toEqual(r.plan.tasks);
  });
});

describe("what the writers are told", () => {
  const req: BuilderPlanRequest = { today: TODAY, kind: "skill", facts: [], known: [], assumptions: [], suggestions: [], conversation: [], learnerText: "", existing: null };
  it("a plan is told whether tasks were asked for, and for which parts", () => {
    expect(builderPlanPrompt(req)).toContain("TASKS: none asked for");
    expect(builderPlanPrompt({ ...req, tasks: { mode: "scoped", scope: ["Phase 1"] } })).toContain("asked for only in Phase 1");
    expect(changesPrompt({ today: TODAY, kind: null, facts: [], current: { title: "F", subjects: [], tasks: [], dates: [], notes: [] }, proposed: null, change: "x", conversation: [] })).toContain("TASKS ALLOWED: none asked for");
  });
  it("a reply with tasks nobody asked for is proposed without them (whatever the model wrote)", async () => {
    const reply = JSON.stringify({
      title: "Finance", summary: "Four phases",
      subjects: [{ name: "Finance", topics: [{ name: "Phase 1", kind: "milestone", topics: [{ name: "Budgeting" }] }] }],
      tasks: [{ key: "b", title: "Write a monthly budget", subject: "Finance", topic: "Budgeting" }],
    });
    const out = await writeBuilderPlan(req, async () => reply);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.plan.tasks).toEqual([]);
    expect(out.plan.subjects[0]!.topics.map(t => t.name)).toEqual(["Phase 1", "Budgeting"]);
    expect(out.dropped).toContain("1 task (you haven't asked for tasks)");
    const asked = await writeBuilderPlan({ ...req, tasks: { mode: "all", scope: [] } }, async () => reply);
    expect(asked.ok && asked.plan.tasks.map(t => t.key)).toEqual(["b"]);
  });
});
