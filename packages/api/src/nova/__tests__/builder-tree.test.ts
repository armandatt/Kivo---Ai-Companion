// Build with Nova: tasks inside tasks, priorities that are the learner's,
// versions to return to, confirmed deletion and the greeting. Pure rules
// only; the database side is nova-builder-tree.itest.ts.
//
// The cases come from real use (25 Oct, a four-day Kivo v1 sprint): every
// milestone said "0 tasks", the milestones were listed twice, "≈ 1 week ·
// 30 h a week" sat on a four-day plan, Nova said it had set no priorities
// while the proposal showed them, "one main topic called Kivo" became one
// topic holding everything, "make version 6 back" and "delete this" failed.

import { TASK_DEPTH_MAX, ancestorsOf, checkTree, depthOf, descendantsOf, parentsFirst, treeOrder, wouldLoop } from "../product/task-tree";
import { checkWorkspacePlan, planFromTemplate, planWrites, type WorkspacePlan } from "../product/workspace-plan";
import { keepLearnerPriorities } from "../product/workspace-generation";
import { changesToReach, planFromState, stateFromPlan } from "../product/builder-history";
import { checkChanges } from "../product/builder-changes";
import { builderGreeting, openingFor } from "../product/builder-greeting";
import { deletionText, proposalSummary } from "../product/builder";
import { STUDY_TEMPLATES } from "../product/templates";
import { readTurn } from "../product/builder-state";
import type { DeletionScope, WorkspaceDetail } from "../product/builder.types";

jest.mock("../../services/openai.service", () => ({ generateOpenAIText: jest.fn() }));

const TODAY = "2026-10-25";
const plan = (raw: Record<string, unknown>, extra: Partial<Parameters<typeof checkWorkspacePlan>[1]> = {}) => {
  const checked = checkWorkspacePlan({ title: "Kivo v1", ...raw }, { today: TODAY, ...extra });
  if (!checked.ok) throw new Error(checked.message);
  return checked;
};

describe("the tree's rules (task-tree.ts)", () => {
  const items = [
    { key: "a", parent: null }, { key: "b", parent: "a" }, { key: "c", parent: "b" }, { key: "d", parent: null },
  ];
  it("knows ancestors, depth, steps and loops", () => {
    expect(ancestorsOf(items, "c")).toEqual(["b", "a"]);
    expect(depthOf(items, "c")).toBe(3);
    expect(descendantsOf(items, "a")).toEqual(["b", "c"]);
    expect(wouldLoop(items, "a", "c")).toBe(true);
    expect(wouldLoop(items, "d", "c")).toBe(false);
    expect(wouldLoop(items, "a", "a")).toBe(true);
  });

  it("reads in tree order and creates parents first", () => {
    const shuffled = [{ key: "c", parent: "b" }, { key: "b", parent: "a" }, { key: "a", parent: null }];
    expect(treeOrder(shuffled).map(x => `${x.item.key}:${x.depth}`)).toEqual(["a:0", "b:1", "c:2"]);
    expect(parentsFirst(shuffled).map(x => x.key)).toEqual(["a", "b", "c"]);
  });

  it("repairs, never drops: a missing parent, a task inside itself, a loop, too deep", () => {
    const name = (i: { key: string }) => i.key;
    const missing = checkTree([{ key: "a", parent: "nobody" }], name);
    expect(missing.items[0]!.parent).toBeNull();
    expect(checkTree([{ key: "a", parent: "a" }], name).items[0]!.parent).toBeNull();
    const loop = checkTree([{ key: "a", parent: "b" }, { key: "b", parent: "a" }], name);
    expect(loop.items.filter(i => i.parent === null)).toHaveLength(1);
    expect(loop.fixes[0]).toContain("inside its own steps");
    const chain = Array.from({ length: TASK_DEPTH_MAX + 3 }, (_, i) => ({ key: `k${i}`, parent: i ? `k${i - 1}` : null }));
    const cut = checkTree(chain, name);
    expect(cut.items).toHaveLength(chain.length);
    expect(Math.max(...cut.items.map(i => depthOf(cut.items, i.key)))).toBe(TASK_DEPTH_MAX);
  });
});

describe("a plan with steps (workspace-plan.ts)", () => {
  it("keeps tasks nested to any depth, from steps or from parent keys, and builds them parents first", () => {
    const checked = plan({
      subjects: [{ name: "Kivo", topics: [] }],
      phases: [{ name: "Product readiness", subject: "Kivo" }],
      tasks: [
        { key: "builder", title: "Finalize Nova Builder", subject: "Kivo", topic: "Product readiness", steps: [
          { key: "tree", title: "Implement recursive task hierarchy", steps: [{ title: "Add parentId to tasks" }, { title: "Check loops" }] },
          { key: "persist", title: "Validate parent-child persistence" },
        ] },
        { key: "edit", title: "Add nested editing controls", parent: "builder" },
      ],
    });
    const t = checked.plan.tasks;
    expect(t.map(x => x.title)).toEqual(["Finalize Nova Builder", "Implement recursive task hierarchy", "Add parentId to tasks", "Check loops", "Validate parent-child persistence", "Add nested editing controls"]);
    const tree = t.map(x => ({ key: x.key, parent: x.parent ?? null }));
    expect(depthOf(tree, t.find(x => x.title === "Check loops")!.key)).toBe(3);
    // A step is filed where its task is: same subject and milestone.
    expect(new Set(t.map(x => x.topic))).toEqual(new Set(["Product readiness"]));
    // Built parents first, each step naming its parent's key.
    const writes = planWrites(checked.plan).tasks;
    for (const w of writes) if (w.parent) expect(writes.findIndex(x => x.key === w.parent)).toBeLessThan(writes.indexOf(w));
  });

  it("the same title under two parents is two tasks; twice under one parent is one", () => {
    const t = plan({ tasks: [
      { key: "a", title: "Ship web" }, { key: "b", title: "Ship app" },
      { title: "Write tests", parent: "a" }, { title: "Write tests", parent: "b" }, { title: "Write tests", parent: "b" },
    ] }).plan.tasks;
    expect(t.filter(x => x.title === "Write tests")).toHaveLength(2);
  });

  it("repairs a broken tree and says so in fixed, not dropped", () => {
    const checked = plan({ tasks: [{ key: "a", title: "A", parent: "b" }, { key: "b", title: "B", parent: "a" }, { key: "c", title: "C", parent: "ghost" }] });
    expect(checked.plan.tasks).toHaveLength(3);
    expect(checked.fixed.length).toBeGreaterThanOrEqual(2);
    expect(checked.dropped).toEqual([]);
  });
});

describe("priorities are the learner's (found 25 Oct)", () => {
  const tasks = [
    { key: "a", title: "Build the home page", priority: "high", priorityReason: "due first; others wait on it" },
    { key: "b", title: "Write tests", suggestedPriority: "medium" },
  ];
  it("from Nova: a priority it writes is a suggestion with its basis, never set", () => {
    const t = plan({ tasks }, { author: "nova" }).plan.tasks;
    expect(t.map(x => x.priority)).toEqual([null, null]);
    expect(t.map(x => x.suggestedPriority)).toEqual(["high", "medium"]);
    expect(t[0]!.priorityReason).toBe("due first; others wait on it");
  });

  it("from a template: suggested by the template; from the learner's page: kept as theirs", () => {
    const template = STUDY_TEMPLATES.find(x => x.tasks.some(k => k.priority))!;
    const applied = planFromTemplate(template, { name: "Thing", subjectList: "One", topics: "", date: "" }, { today: TODAY });
    if (!applied.ok) throw new Error(applied.message);
    expect(applied.plan.tasks.every(x => x.priority === null)).toBe(true);
    expect(applied.plan.tasks.some(x => x.suggestedPriority && x.priorityReason === "The template suggests it.")).toBe(true);
    expect(plan({ tasks }).plan.tasks[0]!.priority).toBe("high");
  });

  it("a new version keeps every priority the learner set, by key or title, and only those", () => {
    const before = { tasks: [{ key: "a", title: "Build the home page", priority: "low" }, { key: "x", title: "Gone", priority: "high" }] };
    const next = keepLearnerPriorities(checkWorkspacePlan({ title: "K", tasks: [{ key: "renamed", title: "Build the home page", priority: "high" }, { key: "b", title: "Write tests", priority: "high" }] }, { today: TODAY, author: "nova" }), before);
    if (!next.ok) throw new Error("not ok");
    expect(next.plan.tasks.map(t => [t.title, t.priority, t.suggestedPriority])).toEqual([["Build the home page", "low", "high"], ["Write tests", null, "high"]]);
  });

  it("Nova reading the conversation sees each priority for what it is, so 'on what basis?' is answered honestly", () => {
    const p = plan({ phases: [{ name: "Home Page Sprint" }], tasks: [
      { key: "a", title: "Build home page workflow architecture", topic: "Home Page Sprint", suggestedPriority: "high", priorityReason: "due first", steps: [{ title: "Sketch the flow" }] },
      { key: "b", title: "Polish", priority: "medium" },
    ] }, { author: "learner" }).plan;
    const lines = proposalSummary(p).tasks;
    expect(lines[0]).toBe("- Build home page workflow architecture [Home Page Sprint]; suggested high by Nova: due first, not accepted yet");
    expect(lines[1]).toBe("  - Sketch the flow; no priority");
    expect(lines[2]).toBe("- Polish; priority medium (set by the learner)");
  });
});

describe("milestones and estimates, repaired by code (found 25 Oct)", () => {
  it("files each task under the milestone its topic means, and lists a milestone once", () => {
    const checked = plan({
      subjects: [{ name: "Kivo Version 1 Development", topics: [{ name: "Home Page Development", subtopics: ["Workflow architecture", "UI design"] }, { name: "Knowledge Map and Planner" }] }],
      phases: [{ name: "Home Page Sprint", subject: "Kivo Version 1 Development" }, { name: "Knowledge Map & Planner Sprint", subject: "Kivo Version 1 Development" }],
      tasks: [{ key: "a", title: "Build home page workflow architecture", topic: "Home Page Development" }, { key: "b", title: "Develop knowledge map interface", topic: "Knowledge Map and Planner" }],
    }, { kind: "project", author: "nova" });
    expect(checked.plan.tasks.map(t => t.topic)).toEqual(["Home Page Sprint", "Knowledge Map & Planner Sprint"]);
    expect(checked.plan.subjects[0]!.topics).toEqual([]);
    expect(checked.plan.phases[0]!.goals).toEqual(["Workflow architecture", "UI design"]);
    expect(checked.fixed.some(f => f.includes("listed once"))).toBe(true);
    // The topics the workspace gets are the milestones, once each.
    expect(planWrites(checked.plan).subjects[0]!.topics).toEqual(["Home Page Sprint", "Knowledge Map & Planner Sprint"]);
  });

  it("leaves a study plan's topics alone: a phase and a topic may share words there", () => {
    const checked = plan({ subjects: [{ name: "DSA", topics: [{ name: "Arrays and strings" }] }], phases: [{ name: "Arrays and strings practice" }], tasks: [{ title: "Solve 10", topic: "Arrays and strings" }] }, { kind: "exam" });
    expect(checked.plan.subjects[0]!.topics.map(t => t.name)).toEqual(["Arrays and strings"]);
    expect(checked.plan.tasks[0]!.topic).toBe("Arrays and strings");
  });

  it("takes a weekly estimate off a milestone whose tasks are all due within a week", () => {
    const checked = plan({ phases: [{ name: "Sprint", weeks: 1, hoursPerWeek: 30 }, { name: "Later", weeks: 3 }], tasks: [
      { title: "A", topic: "Sprint", dueDay: "2026-10-26" }, { title: "B", topic: "Sprint", dueDay: "2026-10-28" }, { title: "C", topic: "Later" },
    ] });
    expect(checked.plan.phases.map(p => [p.weeks, p.hoursPerWeek])).toEqual([[null, null], [3, null]]);
    expect(checked.fixed.join(" ")).toContain("Took a weekly estimate off");
  });
});

// ── Versions: the changes that bring a workspace back ─────────────────────────

const detail = (over: Partial<WorkspaceDetail> = {}): WorkspaceDetail => ({
  workspace: null, title: "Kivo v1",
  subjects: [{ id: "s1", name: "Kivo", topics: [{ id: "t1", name: "Home Page Sprint" }, { id: "t2", name: "Extra" }] }],
  tasks: [
    { id: "k1", title: "Build home page", status: "todo", priority: null, dueDay: "2026-10-26", subjectId: "s1", topicName: "Home Page Sprint", estimatedMinutes: null, parentId: null, description: null },
    { id: "k2", title: "Sketch the flow", status: "todo", priority: null, dueDay: null, subjectId: "s1", topicName: "Home Page Sprint", estimatedMinutes: null, parentId: "k1", description: null },
    { id: "k3", title: "Not in v6", status: "todo", priority: null, dueDay: null, subjectId: "s1", topicName: null, estimatedMinutes: null, parentId: null, description: null },
    { id: "k4", title: "Finished one", status: "done", priority: null, dueDay: null, subjectId: "s1", topicName: null, estimatedMinutes: null, parentId: null, description: null },
  ],
  notes: [], dates: [{ id: "d1", title: "Launch", day: "2026-10-29", kind: "project", subjectId: "s1" }],
  ...over,
});

describe("returning to a version (builder-history.ts)", () => {
  const v6 = plan({
    subjects: [{ name: "Kivo", topics: [{ name: "Home Page Sprint" }] }],
    tasks: [{ key: "a", title: "Build home page", topic: "Home Page Sprint", dueDay: "2026-10-27", steps: [{ title: "Sketch the flow" }, { title: "Pick colours" }] }],
    dates: [{ title: "Launch", day: "2026-10-30", kind: "project", subject: "Kivo" }],
  }).plan;

  it("proposes exactly the difference, steps kept under their task, and nothing finished touched", () => {
    const reach = changesToReach(detail(), stateFromPlan(v6), TODAY);
    const set = checkChanges(reach.ops, detail(), { today: TODAY, studied: new Set(), priorityAsked: true });
    const says = set.ops.map(o => o.says);
    expect(says).toContain('Change task "Build home page": due 2026-10-27 (was 2026-10-26)');
    expect(says).toContain('Add step "Pick colours" under "Build home page"');
    expect(says).toContain('Remove task "Not in v6"');
    expect(says).toContain('Remove topic "Extra" from Kivo');
    expect(says).toContain('Change date "Launch": move to 2026-10-30 (was 2026-10-29)');
    expect(says.some(s => s.includes("Finished one"))).toBe(false);
    expect(says.some(s => s.includes("Sketch the flow"))).toBe(false);
  });

  it("a studied topic is never removed on the way back; that is said", () => {
    const set = checkChanges(changesToReach(detail(), stateFromPlan(v6), TODAY).ops, detail(), { today: TODAY, studied: new Set(["t2"]), priorityAsked: true });
    expect(set.ops.some(o => o.op === "remove_topic")).toBe(false);
    expect(set.dropped.join(" ")).toContain("you've studied it");
  });

  it("a deleted workspace comes back as a plan to approve, from its own plan when it had one", () => {
    expect(planFromState(stateFromPlan(v6), TODAY).title).toBe("Kivo v1");
    const rebuilt = checkWorkspacePlan(planFromState({ ...stateFromPlan(v6), plan: null }, TODAY), { today: TODAY });
    expect(rebuilt.ok && rebuilt.plan.tasks.map(t => t.title)).toEqual(["Build home page", "Sketch the flow", "Pick colours"]);
  });
});

describe("deleting, said in full before anything goes", () => {
  const scope: DeletionScope = {
    title: "Kivo Version 1 Finalisation", workspaceId: "w1", subjectIds: ["s1"], fingerprint: "f",
    removes: { workspace: true, subjects: [{ id: "s1", name: "Kivo Version 1 Development" }], topics: [{ id: "t1", name: "Home Page Sprint" }], tasks: [{ id: "k1", title: "Build home page" }], dates: [{ id: "d1", title: "Launch", day: "2026-10-29" }], notes: [{ id: "n1", title: "Order of work" }] },
    keeps: { topics: [], finishedTasks: 2, notes: ["My own note"], subjects: [] },
  };
  it("names what goes and what stays, and that only the button confirms", () => {
    const text = deletionText(scope);
    expect(text).toContain("- the workspace Kivo Version 1 Finalisation");
    expect(text).toContain("- 1 date: Launch (2026-10-29)");
    expect(text).toContain("- 2 finished tasks");
    expect(text).toContain("your 1 note: My own note");
    expect(text).toContain("Nothing is deleted until you confirm with the Delete button");
  });
  it("reads 'delete' as a request to confirm, and a conversation's own deletion as talk", () => {
    const r = readTurn({ reply: "I'll show what it would remove.", next: "delete", resource: { name: "Kivo", intent: "delete" } }, "delete kivo from everywhere");
    expect(r?.next).toBe("delete");
    expect(r?.resource).toEqual({ name: "Kivo", intent: "delete" });
  });
});

describe("the greeting, in their language and with their name", () => {
  it("English, Hindi and Hinglish, with and without a name", () => {
    expect(builderGreeting("english", "Avi").title).toBe("What would you like to build, Avi?");
    expect(builderGreeting(null, null).opening).toBe("What are you working on, and what would you like to end up with?");
    expect(builderGreeting("hindi", "अवि").title).toBe("अवि, आज क्या बनाना है?");
    expect(builderGreeting("hinglish", null).title).toBe("Aaj kya build karna hai?");
    expect(builderGreeting("klingon", null).language).toBe("english");
    expect(openingFor(builderGreeting("hinglish", null), "DSA")).toBe("DSA mein kya change karna hai? Aapke approve karne tak kuch nahi badlega.");
  });
});
