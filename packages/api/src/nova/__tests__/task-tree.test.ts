// Tasks as a tree, and priorities as the learner's: the pure rules
// (task-tree.ts), a plan's steps and Nova's suggestions (workspace-plan.ts),
// and changes Build with Nova proposes to steps (builder-changes.ts).
// nova-task-tree.itest.ts covers the same against Postgres.

import { TASK_DEPTH_MAX, canPlace, heightOf, levelOf, parentsOf, subtreeOf, treeOrder, untangle } from "../product/task-tree";
import { checkWorkspacePlan, planWrites } from "../product/workspace-plan";
import { checkChanges, withinAsk, withoutPriorities } from "../product/builder-changes";
import type { WorkspaceDetail } from "../product/builder.types";

const TODAY = "2026-10-26";
const nodes = [
  { id: "a", parent: null }, { id: "a1", parent: "a" }, { id: "a1x", parent: "a1" }, { id: "a2", parent: "a" }, { id: "b", parent: null },
];

describe("the tree rules", () => {
  it("knows levels, subtrees and heights", () => {
    const p = parentsOf(nodes);
    expect([levelOf(p, "a"), levelOf(p, "a1"), levelOf(p, "a1x")]).toEqual([1, 2, 3]);
    expect(subtreeOf(nodes, "a")).toEqual(["a", "a1", "a1x", "a2"]);
    expect([heightOf(nodes, "a"), heightOf(nodes, "a1"), heightOf(nodes, "b")]).toEqual([3, 2, 1]);
  });

  it("refuses a task under itself, under its own steps, under nothing, or too deep", () => {
    expect(canPlace(nodes, "a", "a")).toEqual({ ok: false, reason: "self" });
    expect(canPlace(nodes, "a", "a1x")).toEqual({ ok: false, reason: "loop" });
    expect(canPlace(nodes, "a", "ghost")).toEqual({ ok: false, reason: "missing" });
    expect(canPlace(nodes, "b", "a1x")).toEqual({ ok: true });
    expect(canPlace(nodes, "a1", null)).toEqual({ ok: true });
    const chain = Array.from({ length: TASK_DEPTH_MAX }, (_, i) => ({ id: `c${i}`, parent: i ? `c${i - 1}` : null }));
    expect(canPlace([...chain, { id: "x", parent: null }], "x", `c${TASK_DEPTH_MAX - 1}`)).toEqual({ ok: false, reason: "too_deep" });
    // A subtree moves whole: its height counts.
    expect(canPlace([...chain.slice(0, TASK_DEPTH_MAX - 2), ...nodes], "a", `c${TASK_DEPTH_MAX - 3}`)).toEqual({ ok: false, reason: "too_deep" });
  });

  it("reads any list as a tree: loops, missing parents and too much depth are undone, the input untouched", () => {
    const raw = [{ id: "x", parent: "y" }, { id: "y", parent: "x" }, { id: "z", parent: "gone" }, { id: "w", parent: "w" }];
    const fixed = untangle(raw);
    expect(fixed.find(n => n.id === "z")!.parent).toBeNull();
    expect(fixed.find(n => n.id === "w")!.parent).toBeNull();
    expect(fixed.filter(n => n.id === "x" || n.id === "y").some(n => n.parent === null)).toBe(true);
    expect(raw[0]!.parent).toBe("y");
    const deep = Array.from({ length: TASK_DEPTH_MAX + 3 }, (_, i) => ({ id: `d${i}`, parent: i ? `d${i - 1}` : null }));
    expect(Math.max(...untangle(deep).map(n => levelOf(parentsOf(untangle(deep)), n.id)))).toBe(TASK_DEPTH_MAX);
  });

  it("orders a tree parents first, steps right under their task, siblings as given", () => {
    const shuffled = [nodes[3]!, nodes[2]!, nodes[4]!, nodes[1]!, nodes[0]!];
    expect(treeOrder(shuffled).map(x => `${"-".repeat(x.depth)}${x.item.id}`)).toEqual(["b", "a", "-a2", "-a1", "--a1x"]);
  });
});

describe("a plan's steps", () => {
  const plan = (tasks: unknown[], nova = true) => {
    const r = checkWorkspacePlan({
      kind: "custom", title: "TrackerX", subjects: [{ name: "TrackerX", topics: ["Backend"] }], phases: [{ name: "Backend", subject: "TrackerX" }], tasks,
    }, { today: TODAY, nova });
    if (!r.ok) throw new Error(r.message);
    return r.plan;
  };

  it("keeps a step under its task, filed where its task is, at any depth", () => {
    const p = plan([
      { key: "api", title: "Build the tasks API", topic: "Backend" },
      { key: "auth", title: "Add authentication", parent: "api" },
      { key: "jwt", title: "Issue and verify JWTs", parent: "auth" },
      { key: "tests", title: "Write tests", parent: "api" },
      { key: "ui", title: "Build the settings page" },
      { key: "uitests", title: "Write tests", parent: "ui" },
    ]);
    expect(p.tasks.map(t => [t.key, t.parent ?? null])).toEqual([["api", null], ["auth", "api"], ["jwt", "auth"], ["tests", "api"], ["ui", null], ["uitests", "ui"]]);
    expect(p.tasks.find(t => t.key === "jwt")!.topic).toBe("Backend");
    // Written as they are: the parent goes with each step.
    expect(planWrites(p).tasks.find(t => t.key === "jwt")!.parent).toBe("auth");
  });

  it("steps of one task wait on nothing among themselves: their order says it", () => {
    const p = plan([{ key: "a", title: "A" }, { key: "s1", title: "One", parent: "a" }, { key: "s2", title: "Two", parent: "a", after: "s1" }, { key: "b", title: "B", after: "a" }]);
    expect(p.tasks.map(t => t.after ?? null)).toEqual([null, null, null, "a"]);
  });

  it("a step of nothing, or in a loop, becomes a task of its own", () => {
    const p = plan([{ key: "a", title: "A", parent: "b" }, { key: "b", title: "B", parent: "a" }, { key: "c", title: "C", parent: "ghost" }]);
    expect(p.tasks.find(t => t.key === "c")!.parent).toBeNull();
    expect(p.tasks.some(t => t.parent === null && (t.key === "a" || t.key === "b"))).toBe(true);
  });
});

describe("priorities are the learner's", () => {
  it("Nova's priority is only a suggestion, and only with a reason", () => {
    const r = checkWorkspacePlan({ kind: "custom", title: "X", subjects: [{ name: "X", topics: ["Y"] }], tasks: [
      { key: "a", title: "Ship the API", priority: "high", priorityReason: "The launch on 2026-11-20 waits on it" },
      { key: "b", title: "Polish icons", priority: "low" },
      { key: "c", title: "Write docs", suggestedPriority: "medium", priorityReason: "Reviewers asked for it" },
    ] }, { today: TODAY, nova: true });
    if (!r.ok) throw new Error(r.message);
    expect(r.plan.tasks.map(t => [t.priority, t.suggestedPriority ?? null, t.priorityReason ?? null])).toEqual([
      [null, "high", "The launch on 2026-11-20 waits on it"],
      [null, null, null],
      [null, "medium", "Reviewers asked for it"],
    ]);
  });

  it("the learner's own priority is kept as theirs", () => {
    const r = checkWorkspacePlan({ kind: "custom", title: "X", subjects: [{ name: "X", topics: ["Y"] }], tasks: [{ key: "a", title: "A", priority: "high" }] }, { today: TODAY });
    expect(r.ok && r.plan.tasks[0]!.priority).toBe("high");
  });

  it("a change Nova proposes carries no priority unless the request is about priorities", () => {
    const ops = withoutPriorities([{ op: "update_task", taskId: "k1", priority: "high", dueDay: "2026-11-01" }, { op: "add_task", key: "n", title: "New", priority: "low" }, { op: "add_topics", subjectId: "s1", names: ["X"] }]);
    expect(ops).toEqual([{ op: "update_task", taskId: "k1", dueDay: "2026-11-01" }, { op: "add_task", key: "n", title: "New" }, { op: "add_topics", subjectId: "s1", names: ["X"] }]);
  });
});

const detail = (): WorkspaceDetail => ({
  workspace: null, title: "TrackerX",
  subjects: [{ id: "s1", name: "TrackerX", topics: [{ id: "t1", name: "Backend" }] }],
  tasks: [
    { id: "api", title: "Build the tasks API", status: "todo", priority: null, dueDay: null, subjectId: "s1", topicName: "Backend", estimatedMinutes: null, parentId: null },
    { id: "auth", title: "Add authentication", status: "in_progress", priority: null, dueDay: null, subjectId: "s1", topicName: "Backend", estimatedMinutes: null, parentId: "api" },
    { id: "done", title: "Sketch the schema", status: "done", priority: null, dueDay: null, subjectId: "s1", topicName: "Backend", estimatedMinutes: null, parentId: "auth" },
    { id: "ui", title: "Build the settings page", status: "todo", priority: null, dueDay: null, subjectId: "s1", topicName: null, estimatedMinutes: null, parentId: null },
  ],
  notes: [], dates: [],
});
const ctx = { today: TODAY, studied: new Set<string>() };

describe("changes to steps", () => {
  it("adds steps under a task that is there and under one added in the same change, in any order given", () => {
    const set = checkChanges([
      { op: "add_task", key: "jwt2", title: "Rotate keys", parentKey: "jwt" },
      { op: "add_task", key: "jwt", title: "Issue JWTs", parentId: "auth" },
      { op: "add_task", key: "ws", title: "Wire the websocket" },
    ], detail(), ctx);
    expect(set.ops.map(o => o.says)).toEqual([
      'Add step "Issue JWTs" under "Add authentication"',
      'Add step "Rotate keys" under "Issue JWTs"',
      'Add task "Wire the websocket"',
    ]);
    // Filed where its task is.
    expect(set.ops[0]!.op === "add_task" && set.ops[0]!.topicName).toBe("Backend");
  });

  it("the same title under another task is another task", () => {
    const set = checkChanges([{ op: "add_task", key: "a", title: "Write tests", parentId: "api" }, { op: "add_task", key: "b", title: "Write tests", parentId: "ui" }, { op: "add_task", key: "c", title: "Write tests", parentId: "ui" }], detail(), ctx);
    expect(set.ops.length).toBe(2);
    expect(set.dropped).toEqual(['task "Write tests" (already there)']);
  });

  it("moves a task under another, or out to be its own; never under itself or its own steps", () => {
    const set = checkChanges([{ op: "update_task", taskId: "ui", parentId: "api" }, { op: "update_task", taskId: "auth", parentId: null }, { op: "update_task", taskId: "api", parentId: "auth" }], detail(), ctx);
    expect(set.ops.map(o => o.says)).toEqual(['Change task "Build the settings page": move under "Build the tasks API"', 'Change task "Add authentication": make it a task of its own']);
    expect(set.dropped).toEqual(['moving "Build the tasks API" (not under itself or its own steps)']);
  });

  it("a task goes with its open steps, never with a finished one", () => {
    expect(checkChanges([{ op: "remove_task", taskId: "api" }], detail(), ctx).dropped).toEqual(['removing "Build the tasks API" (it has finished steps; finished tasks are kept)']);
    const d = detail();
    d.tasks = d.tasks.filter(t => t.id !== "done");
    expect(checkChanges([{ op: "remove_task", taskId: "api" }], d, ctx).ops[0]!.says).toBe('Remove task "Build the tasks API" and its 1 step');
  });

  it("a priority-only change is about priorities, not tasks", () => {
    const set = checkChanges([{ op: "update_task", taskId: "api", priority: "high" }, { op: "update_task", taskId: "ui", dueDay: "2026-11-02" }], detail(), ctx);
    expect(withinAsk(set, ["priorities"], detail()).ops.map(o => o.op === "update_task" && o.taskId)).toEqual(["api"]);
    expect(withinAsk(set, ["tasks"], detail()).ops.map(o => o.op === "update_task" && o.taskId)).toEqual(["ui"]);
  });
});

import { buildKnowledgeMap } from "../product/knowledge-map";

describe("the Knowledge Map shows a topic's tasks with their steps", () => {
  it("a tree goes to the topic its top task is filed under, steps included; tasks are never points on the map", () => {
    const map = buildKnowledgeMap({
      subjects: [{ id: "s1", name: "TrackerX" }],
      topics: [{ id: "t1", subjectId: "s1", name: "Backend", masteryProbability: 0, reviewCount: 0 }],
      notes: [], resources: [], totals: { notes: 0, resources: 0 },
      tasks: [
        { id: "a", title: "Build the API", status: "todo", parentId: null, subjectId: "s1", topicName: "Backend" },
        // A step filed elsewhere still goes with its task.
        { id: "a1", title: "Add auth", status: "done", parentId: "a", subjectId: "s1", topicName: null },
        { id: "b", title: "Write the README", status: "todo", parentId: null, subjectId: "s1", topicName: null },
        { id: "c", title: "Unfiled", status: "todo", parentId: null, subjectId: null, topicName: null },
      ],
    });
    const topic = map.nodes.find(n => n.id === "topic:t1");
    const subject = map.nodes.find(n => n.id === "subject:s1");
    expect(topic?.type === "topic" && topic.tasks?.map(t => [t.id, t.parentId])).toEqual([["a", null], ["a1", "a"]]);
    expect(subject?.type === "subject" && subject.tasks?.map(t => t.id)).toEqual(["b"]);
    expect(map.nodes.length).toBe(2);
  });
});
