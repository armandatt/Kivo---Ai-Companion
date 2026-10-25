// The planning engine (26 Oct): plans revised by operations, never written
// again; topics as an ordered tree with only leaves studied; waits as data;
// feasibility checked by code; structured output from the provider. No
// database and no model: the model is a stub. Against a real database:
// nova-planning-engine.itest.ts.

import { applyToPlan, planDetail } from "../product/builder-plan";
import { checkChanges, withinAsk } from "../product/builder-changes";
import { changedNothing, planChanges } from "../product/builder-state";
import { checkFeasibility } from "../product/plan-feasibility";
import { checkWorkspacePlan, planWrites, readStoredPlan, topicRows, type WorkspacePlan } from "../product/workspace-plan";
import { compareTopics, studyTopicIds, topicOutline } from "../product/topic-tree";
import { TOO_LONG, writeBuilderChanges, writeBuilderPlan } from "../product/workspace-generation";
import { TRUNCATED, buildGeminiRequest, isTruncated, parseGeminiResponse } from "../../services/llmProviders";

jest.mock("../../services/openai.service", () => ({ generateOpenAIText: jest.fn() }));

const TODAY = "2026-10-26";
const ctx = { today: TODAY, studied: new Set<string>() };

function plan(raw: Record<string, unknown>): WorkspacePlan {
  const r = checkWorkspacePlan({ kind: "custom", ...raw }, { today: TODAY });
  if (!r.ok) throw new Error(r.message);
  return r.plan;
}

const semester = () => plan({
  title: "Semester 5",
  subjects: [
    { name: "Semester Five", topics: [] },
    { name: "DSA", parent: "Semester Five", topics: [
      { name: "Unit 1: Foundations", topics: [{ name: "Asymptotic analysis", topics: ["Big-O", "Master theorem"] }, "Recursion"] },
      { name: "Unit 2: Trees", topics: ["Binary search trees", "Heaps"] },
    ] },
    { name: "OS", parent: "Semester Five", topics: [{ name: "Unit 1: Processes", topics: ["Scheduling", "Deadlocks"] }] },
  ],
  tasks: [
    { key: "bigo", title: "Solve 10 Big-O problems", subject: "DSA", topic: "Big-O", priority: "high" },
    { key: "bst", title: "Implement a BST", subject: "DSA", topic: "Binary search trees" },
    { key: "bst-ins", title: "Write insert", parent: "bst" },
    { key: "bst-del", title: "Write delete", parent: "bst" },
    { key: "heap", title: "Implement a heap", subject: "DSA", topic: "Heaps", after: ["bst"] },
    { key: "sched", title: "Simulate round robin", subject: "OS", topic: "Scheduling" },
  ],
  dates: [{ title: "DSA exam", subject: "DSA", kind: "exam", day: "2026-12-10" }],
});

describe("a revision is operations on the proposal, applied by code", () => {
  const revise = (before: WorkspacePlan, ops: unknown[], touches: Parameters<typeof withinAsk>[1] = [], removes: boolean | null = null) => {
    const { detail } = planDetail(before);
    const set = withinAsk(checkChanges(ops, detail, ctx), touches, detail, { removes });
    const after = checkWorkspacePlan(applyToPlan(before, set), { today: TODAY });
    if (!after.ok) throw new Error(after.message);
    return { set, after: after.plan };
  };

  it("gives every item an id, the tree included", () => {
    const { detail } = planDetail(semester());
    const dsa = detail.subjects.find(s => s.name === "DSA")!;
    expect(dsa.parentId).toBe(detail.subjects.find(s => s.name === "Semester Five")!.id);
    const big = dsa.topics.find(t => t.name === "Big-O")!;
    expect(dsa.topics.find(t => t.id === big.parentId)!.name).toBe("Asymptotic analysis");
    expect(detail.tasks.find(t => t.id === "bst-ins")!.parentId).toBe("bst");
    expect(detail.tasks.find(t => t.id === "heap")!.after).toEqual(["bst"]);
  });

  it("an added task changes nothing else: keys, priorities, waits, the tree and dates stay byte for byte", () => {
    const before = semester();
    const { after } = revise(before, [{ op: "add_task", key: "mock", title: "Take a mock DSA paper", subjectId: "s2", topicName: null, dueDay: "2026-12-01", priority: null }], ["tasks"]);
    expect(after.tasks.slice(0, before.tasks.length)).toEqual(before.tasks);
    expect(after.subjects).toEqual(before.subjects);
    expect(after.dates).toEqual(before.dates);
    expect(after.tasks.at(-1)).toMatchObject({ key: "mock", title: "Take a mock DSA paper", subject: "DSA" });
  });

  it("nests and orders topics: a new unit, topics moved into it at a place, siblings reordered", () => {
    const before = semester();
    const { detail } = planDetail(before);
    const dsa = detail.subjects.find(s => s.name === "DSA")!;
    const id = (name: string) => dsa.topics.find(t => t.name === name)!.id;
    const { set, after } = revise(before, [
      { op: "add_topics", subjectId: dsa.id, names: ["Unit 3: Graphs"], keys: ["u3"] },
      { op: "add_topics", subjectId: dsa.id, names: ["BFS", "DFS"], parentKey: "u3" },
      { op: "move_topic", topicId: id("Heaps"), parentKey: "u3", index: 0 },
      { op: "order_topics", topicIds: [id("Recursion"), id("Asymptotic analysis")] },
    ], ["topics"]);
    expect(set.dropped).toEqual([]);
    const rows = topicRows(after.subjects.find(s => s.name === "DSA")!).map(r => `${"  ".repeat(r.depth)}${r.topic.name}`);
    expect(rows).toEqual([
      "Unit 1: Foundations", "  Recursion", "  Asymptotic analysis", "    Big-O", "    Master theorem",
      "Unit 2: Trees", "  Binary search trees",
      "Unit 3: Graphs", "  Heaps", "  BFS", "  DFS",
    ]);
    // The heap task is still filed under Heaps, wherever Heaps now sits.
    expect(after.tasks.find(t => t.key === "heap")!.topic).toBe("Heaps");
  });

  it("a move that loops or goes too deep is left out and said", () => {
    const before = semester();
    const { detail } = planDetail(before);
    const dsa = detail.subjects.find(s => s.name === "DSA")!;
    const id = (name: string) => dsa.topics.find(t => t.name === name)!.id;
    const { set } = revise(before, [{ op: "move_topic", topicId: id("Unit 1: Foundations"), parentId: id("Big-O") }], ["topics"]);
    expect(set.ops).toEqual([]);
    expect(set.dropped[0]).toContain("not inside itself or a topic inside it");
  });

  it("renaming a topic follows it into its tasks and the topics inside it", () => {
    const before = semester();
    const { detail } = planDetail(before);
    const dsa = detail.subjects.find(s => s.name === "DSA")!;
    const { after } = revise(before, [{ op: "rename_topic", topicId: dsa.topics.find(t => t.name === "Asymptotic analysis")!.id, name: "Complexity analysis" }], ["topics"]);
    const s = after.subjects.find(x => x.name === "DSA")!;
    expect(s.topics.find(t => t.name === "Big-O")!.parent).toBe("Complexity analysis");
  });

  it("removing a topic takes what is inside it, each said, and its tasks lose only the filing", () => {
    const before = semester();
    const { detail } = planDetail(before);
    const dsa = detail.subjects.find(s => s.name === "DSA")!;
    const { set, after } = revise(before, [{ op: "remove_topic", topicId: dsa.topics.find(t => t.name === "Asymptotic analysis")!.id }], ["topics"], true);
    expect(set.ops.map(o => o.says)).toEqual(['Remove "Big-O" (inside "Asymptotic analysis")', 'Remove "Master theorem" (inside "Asymptotic analysis")', 'Remove topic "Asymptotic analysis" from DSA']);
    expect(after.subjects.find(s => s.name === "DSA")!.topics.map(t => t.name)).not.toContain("Big-O");
    expect(after.tasks.find(t => t.key === "bigo")).toMatchObject({ topic: null, priority: "high" });
  });

  it("a request that removes nothing keeps no removal, whatever the model proposed", () => {
    const before = semester();
    const { set } = revise(before, [{ op: "remove_task", taskId: "sched" }, { op: "update_task", taskId: "bst", parentId: "bigo" }], ["tasks"], false);
    expect(set.ops.map(o => o.op)).toEqual(["update_task"]);
    expect(set.dropped[0]).toContain("you didn't ask to remove anything");
  });

  it("waits are set and checked: a circle is left out and said", () => {
    const before = semester();
    const { set, after } = revise(before, [{ op: "update_task", taskId: "bst", after: ["heap"] }, { op: "update_task", taskId: "sched", after: ["bigo"] }], ["tasks"]);
    expect(set.dropped.some(d => d.includes("round in a circle"))).toBe(true);
    expect(after.tasks.find(t => t.key === "sched")!.after).toEqual(["bigo"]);
    expect(after.tasks.find(t => t.key === "bst")!.after).toEqual([]);
  });

  it("a nesting-only revision is a real change, not 'nothing changed'", () => {
    const before = semester();
    const { after } = revise(before, [{ op: "update_task", taskId: "sched", parentId: "bst" }], ["tasks"]);
    expect(after.tasks.find(t => t.key === "sched")!.parent).toBe("bst");
    expect(changedNothing(planChanges(before, after))).toBe(false);
  });

  it("a plan larger than 30 KB is revised whole: the model is shown ids, never a cut-off copy", async () => {
    const big = plan({
      title: "Huge semester",
      subjects: Array.from({ length: 6 }, (_, s) => ({ name: `Subject ${s + 1}`, topics: Array.from({ length: 6 }, (_, u) => ({
        name: `Unit ${s + 1}.${u + 1}`, explanation: "x".repeat(300), topics: Array.from({ length: 4 }, (_, t) => ({ name: `Topic ${s + 1}.${u + 1}.${t + 1}`, explanation: "y".repeat(200) })),
      })) })),
      tasks: Array.from({ length: 60 }, (_, i) => ({ key: `t${i}`, title: `Practise set ${i}`, subject: `Subject ${(i % 6) + 1}`, topic: `Topic ${(i % 6) + 1}.1.1` })),
    });
    expect(JSON.stringify(big).length).toBeGreaterThan(30_000);
    let prompt = "";
    const written = await writeBuilderChanges({
      today: TODAY, kind: "semester", facts: [], proposal: true, current: planDetail(big).detail, proposed: null, change: "Add a mock test", conversation: [],
    }, (async (req: { prompt: string; json?: boolean }) => { prompt = req.prompt; expect(req.json).toBe(true); return JSON.stringify({ ops: [{ op: "add_task", key: "mock", title: "Take a full mock test", subjectId: "s1", topicName: null, dueDay: null, priority: null }] }); }) as never);
    assert(written.ok);
    // Every topic is named in the prompt with its id; nothing is cut.
    expect(prompt).toContain('topic t180 "Topic 6.6.4"');
    const { detail } = planDetail(big);
    const set = checkChanges(written.ops, detail, ctx);
    const after = checkWorkspacePlan(applyToPlan(big, set), { today: TODAY });
    assert(after.ok);
    expect(after.plan.subjects).toEqual(big.subjects);
    expect(after.plan.tasks.slice(0, 60)).toEqual(big.tasks);
    expect(after.plan.tasks).toHaveLength(61);
  });
});
function assert(v: unknown): asserts v { expect(v).toBeTruthy(); }

describe("topics as an ordered tree; only leaves are studied", () => {
  it("siblings keep their saved order, never alphabetical; an older row with none comes after, by when it was added", () => {
    const rows = [
      { id: "c", name: "C", position: null, createdAt: "2026-01-02" }, { id: "z", name: "Zeta", position: 0, createdAt: "2026-01-05" },
      { id: "a", name: "Alpha", position: 1, createdAt: "2026-01-04" }, { id: "b", name: "B", position: null, createdAt: "2026-01-01" },
    ];
    expect([...rows].sort(compareTopics).map(r => r.id)).toEqual(["z", "a", "b", "c"]);
  });

  it("a parent organises and is not studied; a milestone is never studied; an archived child leaves its parent a leaf again", () => {
    const topics = [
      { id: "u1", parentId: null }, { id: "t1", parentId: "u1" }, { id: "t2", parentId: "u1", archived: true },
      { id: "u2", parentId: null }, { id: "t3", parentId: "u2", archived: true },
      { id: "m1", parentId: null, kind: "milestone" }, { id: "solo", parentId: null },
    ];
    expect([...studyTopicIds(topics)].sort()).toEqual(["solo", "t1", "u2"]);
    expect(topicOutline(topics.filter(t => !t.archived)).map(r => [r.item.id, r.depth])).toEqual([["u1", 0], ["t1", 1], ["u2", 0], ["m1", 0], ["solo", 0]]);
  });

  it("an older stored plan (units, subtopics, phases, one wait) reads into the tree without losing anything", () => {
    const old = {
      version: 1, kind: "custom", templateId: null, templateVersion: null, category: null, title: "Old", summary: "", prerequisites: ["Algebra"],
      subjects: [{ name: "Maths", topics: [{ name: "Limits", unit: "Unit 1", subtopics: ["Epsilon-delta"], explanation: "Approaching", sources: [] }] }],
      phases: [{ name: "Week 1", subject: "Maths", weeks: 1, hoursPerWeek: 4, goals: ["Limits"], exercises: [], project: null, completion: "Can compute limits", resources: [] }],
      tasks: [{ key: "a", title: "Do problems", priority: "high", subject: "Maths", topic: "Week 1", dueDay: "2025-01-01", estimatedMinutes: 30 }, { key: "b", title: "Review", priority: null, subject: "Maths", topic: null, dueDay: null, estimatedMinutes: null, after: "a" }],
      dates: [{ title: "Old exam", subject: "Maths", kind: "exam", day: "2025-02-01" }], notes: [], resources: [], sources: [], assumptions: [],
    };
    const p = readStoredPlan(old)!;
    expect(topicRows(p.subjects[0]!).map(r => `${"  ".repeat(r.depth)}${r.topic.name}${r.topic.kind ? ` (${r.topic.kind})` : ""}`)).toEqual(["Week 1 (milestone)", "Unit 1", "  Limits", "    Epsilon-delta"]);
    // Its own past days, its priority and its wait are kept.
    expect(p.tasks.map(t => [t.key, t.priority, t.dueDay, t.after])).toEqual([["a", "high", "2025-01-01", []], ["b", null, null, ["a"]]]);
    expect(p.dates).toHaveLength(1);
    expect(p.prerequisites).toEqual(["Algebra"]);
  });

  it("planWrites gives each topic its place, kind and details in outline order", () => {
    const w = planWrites(semester());
    const dsa = w.subjects.find(s => s.name === "DSA")!;
    expect(dsa.topics.slice(0, 4).map(t => [t.name, t.parent])).toEqual([["Unit 1: Foundations", null], ["Asymptotic analysis", "Unit 1: Foundations"], ["Big-O", "Asymptotic analysis"], ["Master theorem", "Asymptotic analysis"]]);
    expect(w.subjects.find(s => s.name === "DSA")!.parent).toBe("Semester Five");
  });
});

describe("whether a plan can be done, by code", () => {
  it("a valid semester plan has no errors", () => {
    const p = semester();
    const f = checkFeasibility(p, { hoursPerWeek: 10, kind: "semester" });
    expect(f.errors).toEqual([]);
  });

  it("work due after its deadline, a task due before what it waits on, and a step after its task are errors", () => {
    const p = plan({
      title: "X", subjects: [{ name: "DSA", topics: ["Trees"] }],
      dates: [{ title: "DSA exam", subject: "DSA", kind: "exam", day: "2026-11-20" }],
      tasks: [
        { key: "a", title: "Build trees", subject: "DSA", dueDay: "2026-11-10" },
        { key: "b", title: "Revise trees", subject: "DSA", dueDay: "2026-11-05", after: ["a"] },
        { key: "c", title: "Late review", subject: "DSA", dueDay: "2026-11-25" },
        { key: "a1", title: "Step", parent: "a", dueDay: "2026-11-15" },
      ],
    });
    const codes = checkFeasibility(p, { hoursPerWeek: null, kind: "exam" }).errors.map(e => e.code).sort();
    expect(codes).toEqual(["after_deadline", "step_after_parent", "wait_order"]);
  });

  it("a week planned beyond the time they have, missing estimates, near-duplicates and unpractised topics are warnings", () => {
    const p = plan({
      title: "X", subjects: [{ name: "DSA", topics: ["Trees", "Graphs", "Heaps"] }],
      dates: [{ title: "DSA exam", subject: "DSA", kind: "exam", day: "2026-11-30" }],
      tasks: [
        { key: "a", title: "Solve tree problems", subject: "DSA", topic: "Trees", dueDay: "2026-11-02", estimatedMinutes: 300 },
        { key: "b", title: "Solve tree problems!", subject: "DSA", topic: "Trees", dueDay: "2026-11-03", estimatedMinutes: 300 },
        { key: "c", title: "Graph quiz", subject: "DSA", topic: "Graphs", dueDay: "2026-11-04" },
      ],
    });
    const f = checkFeasibility(p, { hoursPerWeek: 6, kind: "exam" });
    expect(f.errors).toEqual([]);
    expect(f.warnings.map(w => w.code).sort()).toEqual(["duplicate_titles", "missing_estimates", "unpractised_topics", "week_overload"]);
    expect(f.warnings.find(w => w.code === "unpractised_topics")!.message).toContain("Heaps");
  });

  it("dates are never moved to make it fit: the check only reads", () => {
    const p = semester();
    const copy = JSON.stringify(p);
    checkFeasibility(p, { hoursPerWeek: 1, kind: "semester" });
    expect(JSON.stringify(p)).toBe(copy);
  });
});

describe("structured output and a reply cut off at its limit", () => {
  it("Gemini is asked for JSON, and a cut-off JSON reply is an error, never half an object", () => {
    const { body } = buildGeminiRequest({ prompt: "p", json: true, maxOutputTokens: 100 }, "gemini-x", { disableThinking: false });
    expect((body.generationConfig as Record<string, unknown>).responseMimeType).toBe("application/json");
    expect(() => parseGeminiResponse({ candidates: [{ content: { parts: [{ text: '{"a":' }] }, finishReason: "MAX_TOKENS" }] }, "gemini-x", { json: true })).toThrow(TRUNCATED);
    expect(isTruncated(new Error(`OpenAI: ${TRUNCATED}`))).toBe(true);
  });

  it("a plan cut off at its limit says so, and is not asked again (it would be cut off again)", async () => {
    let calls = 0;
    const out = await writeBuilderPlan({ today: TODAY, kind: "semester", facts: [], known: [], assumptions: [], suggestions: [], conversation: [], learnerText: "", existing: null },
      (async () => { calls++; throw new Error(`Gemini: ${TRUNCATED}`); }) as never);
    expect(out.ok).toBe(false);
    expect(!out.ok && out.message).toBe(TOO_LONG);
    expect(calls).toBe(1);
  });
});
