// Build with Nova on what the learner already has: finding it by the name
// they use, checking proposed changes against its records, and the quality
// rules for academic plans. Pure, no database (nova-builder-edit.itest.ts
// covers the same against Postgres).

import { changeCounts, checkChanges, decideResource, matchResources, readChangeSet, type ResourceCandidates } from "../product/builder-changes";
import { checkWorkspacePlan, isPlaceholderTopic, planWrites } from "../product/workspace-plan";
import { NO_SYLLABUS, changesPrompt, writeBuilderPlan, type BuilderPlanRequest } from "../product/workspace-generation";
import { readBuilderTurn, turnPrompt, type TurnInput } from "../product/builder-conversation";
import type { WorkspaceDetail } from "../product/builder.types";

jest.mock("../../services/openai.service", () => ({ generateOpenAIText: jest.fn() }));

const TODAY = "2026-10-22";

const candidates = (extra: Partial<ResourceCandidates> = {}): ResourceCandidates => ({
  workspaces: [{ id: "w1", title: "TrackerX", subjectIds: ["s-tx"] }],
  subjects: [
    { id: "s-dsa", name: "Data Structures and Algorithms", code: "CS201" },
    { id: "s-os", name: "Operating Systems", code: null },
    { id: "s-tx", name: "TrackerX", code: null },
  ],
  ...extra,
});

describe("finding what they mean, among their own records", () => {
  it("knows a subject by its name, its course code or its acronym, with the words around it ignored", () => {
    expect(matchResources("DSA", candidates()).map(m => m.id)).toEqual(["s-dsa"]);
    expect(matchResources("my existing DSA plan", candidates()).map(m => m.id)).toEqual(["s-dsa"]);
    expect(matchResources("cs201", candidates()).map(m => m.id)).toEqual(["s-dsa"]);
    expect(matchResources("operating systems", candidates()).map(m => m.id)).toEqual(["s-os"]);
    expect(matchResources("Quantum physics", candidates())).toEqual([]);
    expect(matchResources("", candidates())).toEqual([]);
  });

  it("a subject that belongs to a matched workspace is that workspace, not a second match", () => {
    expect(matchResources("TrackerX", candidates())).toEqual([{ kind: "workspace", id: "w1", name: "TrackerX", subjectIds: ["s-tx"] }]);
  });

  it("one match is opened (a subject as itself, never the workspace around it); several ask which; none says so", () => {
    const found = decideResource({ name: "DSA", intent: "change" }, candidates());
    expect(found).toEqual({ type: "found", intent: "change", ref: { kind: "subjects", workspaceId: null, subjectIds: ["s-dsa"], title: "Data Structures and Algorithms" } });
    // Seen 22 Oct: "open my dsa workspace" opened the whole semester that holds DSA.
    const semester = candidates({ workspaces: [{ id: "w2", title: "B.Tech CSE Semester 5 Exam Preparation", subjectIds: ["s-dsa", "s-os"] }] });
    expect(decideResource({ name: "dsa workspace", intent: "open" }, semester)).toEqual({ type: "found", intent: "open", ref: { kind: "subjects", workspaceId: null, subjectIds: ["s-dsa"], title: "Data Structures and Algorithms" } });
    // The workspace itself, when that is what they named.
    expect(decideResource({ name: "semester 5 exam preparation", intent: "open" }, semester)).toEqual({ type: "found", intent: "open", ref: { kind: "workspace", workspaceId: "w2", subjectIds: ["s-dsa", "s-os"], title: "B.Tech CSE Semester 5 Exam Preparation" } });
    const two = decideResource({ name: "DSA", intent: "change" }, { workspaces: [], subjects: [{ id: "a", name: "DSA Lab", code: null }, { id: "b", name: "DSA Theory", code: null }] });
    expect(two.type === "choose" && two.names).toEqual(["DSA Lab", "DSA Theory"]);
    expect(decideResource({ name: "Physics", intent: "change" }, candidates()).type).toBe("missing");
  });

  it("asking for a new one, or naming nothing, opens nothing", () => {
    expect(decideResource({ name: "DSA", intent: "new" }, candidates())).toEqual({ type: "none" });
    expect(decideResource(null, candidates())).toEqual({ type: "none" });
  });
});

const current = (): WorkspaceDetail => ({
  workspace: null, title: "Data Structures and Algorithms",
  subjects: [{ id: "s1", name: "Data Structures and Algorithms", topics: [{ id: "t1", name: "Arrays" }, { id: "t2", name: "Trees" }, { id: "t3", name: "Graphs" }] }],
  tasks: [
    { id: "k1", title: "Solve 10 tree problems", status: "in_progress", priority: null, dueDay: "2026-11-01", subjectId: "s1", topicName: "Trees", estimatedMinutes: null },
    { id: "k2", title: "Read about heaps", status: "done", priority: null, dueDay: null, subjectId: "s1", topicName: null, estimatedMinutes: null },
    { id: "k3", title: "Graph quiz", status: "todo", priority: "low", dueDay: null, subjectId: "s1", topicName: "Graphs", estimatedMinutes: null },
  ],
  notes: [{ id: "n1", title: "DSA cheatsheet", subjectId: "s1", updatedAt: "2026-10-01T00:00:00.000Z" }],
  dates: [{ id: "d1", title: "DSA mid-term", day: "2026-11-20", kind: "exam", subjectId: "s1" }],
});
const ctx = { today: TODAY, studied: new Set(["t2"]) };

describe("proposed changes, checked against the records by id", () => {
  it("keeps what names this resource's records and changes something, and says it in words", () => {
    const set = checkChanges({ ops: [
      { op: "add_topics", subjectId: "s1", names: ["Dynamic programming: memoization", "Knapsack"], why: "after graphs" },
      { op: "update_task", taskId: "k1", dueDay: "2026-11-08", priority: "high" },
      { op: "update_date", dateId: "d1", day: "2026-11-27" },
      { op: "order_tasks", taskIds: ["k3", "k1"] },
      { op: "add_task", key: "dp", title: "Solve 5 DP problems", dueDay: "2026-11-10" },
      { op: "add_note", title: "DP patterns", body: "# Patterns\n- Knapsack" },
      { op: "remove_topic", topicId: "t3" },
    ] }, current(), ctx);
    expect(set.ops.map(o => o.op)).toEqual(["add_topics", "update_task", "update_date", "order_tasks", "add_task", "add_note", "remove_topic"]);
    expect(set.ops.map(o => o.id)).toEqual(["c1", "c2", "c3", "c4", "c5", "c6", "c7"]);
    expect(set.ops.map(o => o.effect)).toEqual(["add", "change", "change", "change", "add", "add", "remove"]);
    expect(set.ops[1]!.says).toBe('Change task "Solve 10 tree problems": due 2026-11-08 (was 2026-11-01), high priority');
    expect(set.ops[2]!.says).toBe('Change date "DSA mid-term": move to 2026-11-27 (was 2026-11-20)');
    expect(set.ops[0]!.why).toBe("after graphs");
    // A task and a note added to a resource with one subject are filed under it.
    expect(set.ops[4]!.op === "add_task" && set.ops[4]!.subjectId).toBe("s1");
    expect(changeCounts(set)).toBe("3 additions, 3 changes and 1 removal");
    expect(set.dropped).toEqual([]);
  });

  it("leaves out ids that aren't this resource's, repeats, placeholders, studied topics, finished tasks and the past, saying why", () => {
    const set = checkChanges([
      { op: "add_topics", subjectId: "someone-elses", names: ["Hashing"] },
      { op: "add_topics", subjectId: "s1", names: ["Trees", "Introduction", "Advanced concepts", "Heaps"] },
      { op: "remove_topic", topicId: "t2" },
      { op: "remove_task", taskId: "k2" },
      { op: "update_task", taskId: "k9", title: "x" },
      { op: "update_task", taskId: "k3", priority: "low" },
      { op: "add_task", title: "Graph quiz" },
      { op: "add_date", title: "Final", day: "2026-01-01" },
      { op: "add_note", title: "dsa cheatsheet", body: "again" },
      { op: "add_subject", name: "data structures and algorithms", topics: [] },
      { op: "order_tasks", taskIds: ["k2", "k3"] },
      { op: "delete_everything" },
    ], current(), ctx);
    expect(set.ops.map(o => o.says)).toEqual(["Add to Data Structures and Algorithms: Heaps"]);
    for (const why of ["isn't part of this", "already has it", "too general", "you've studied it", "finished tasks are kept", "already there", "not a day from today on", "a note with that title", "it's already here", "aren't open here"]) {
      expect(set.dropped.join(" | ")).toContain(why);
    }
  });

  it("a stored change set reads back; nothing stored is nothing proposed", () => {
    const set = checkChanges([{ op: "add_topics", subjectId: "s1", names: ["Heaps"] }], current(), ctx);
    expect(readChangeSet(JSON.parse(JSON.stringify(set)))).toEqual(set);
    expect(readChangeSet({})).toBeNull();
    expect(readChangeSet(null)).toBeNull();
  });

  it("the change writer is shown each record with its id, and the change asked", () => {
    const p = changesPrompt({
      today: TODAY, kind: "exam", facts: [], change: "Add dynamic programming", proposed: null, conversation: [],
      current: { title: "DSA", subjects: current().subjects, tasks: current().tasks.map(t => ({ id: t.id, title: t.title, status: t.status, dueDay: t.dueDay, priority: t.priority, topicName: t.topicName })), dates: [{ id: "d1", title: "DSA mid-term", day: "2026-11-20" }], notes: ["DSA cheatsheet"] },
    });
    expect(p).toContain('- subject s1 "Data Structures and Algorithms": t1 "Arrays", t2 "Trees", t3 "Graphs"');
    expect(p).toContain('- task k1 "Solve 10 tree problems" (in_progress, due 2026-11-01, under Trees)');
    expect(p).toContain('- date d1 "DSA mid-term" on 2026-11-20');
    expect(p).toContain("CHANGE ASKED: Add dynamic programming");
  });
});

describe("academic plans: specific topics, in learning order", () => {
  it("a placeholder topic says nothing about what to study and is left out", () => {
    for (const name of ["Introduction", "Advanced concepts", "Practice questions", "Revision", "Basics of DSA", "DSA fundamentals", "DSA"]) expect(isPlaceholderTopic(name, "DSA")).toBe(true);
    for (const name of ["Asymptotic analysis", "Introduction to graph traversal", "Dynamic programming on trees", "Binary heaps"]) expect(isPlaceholderTopic(name, "DSA")).toBe(false);
  });

  it("units and specific subtopics are kept in the order given; placeholders and repeats are dropped and said", () => {
    const checked = checkWorkspacePlan({
      kind: "custom", title: "DSA semester",
      subjects: [{ name: "Data Structures and Algorithms", topics: [
        { name: "Introduction", subtopics: ["What is an algorithm"] },
        { name: "Asymptotic analysis", unit: "Unit 1: Foundations", subtopics: ["Big-O, Omega and Theta", "Recurrence relations", "Master theorem", "Basics", "Master theorem"] },
        { name: "Arrays and strings", unit: "Unit 1: Foundations", subtopics: ["Two pointers", "Sliding window", "Prefix sums"] },
        { name: "Trees", unit: "Unit 2: Non-linear structures", subtopics: ["Binary search trees", "Tree traversals"] },
        { name: "Advanced concepts", unit: "Unit 3" },
      ] }],
    }, { today: TODAY });
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    const topics = checked.plan.subjects[0]!.topics;
    expect(topics.map(t => t.name)).toEqual(["Asymptotic analysis", "Arrays and strings", "Trees"]);
    expect(topics[0]!.subtopics).toEqual(["Big-O, Omega and Theta", "Recurrence relations", "Master theorem"]);
    expect(topics[2]!.unit).toBe("Unit 2: Non-linear structures");
    expect(checked.dropped.filter(d => d.includes("too general"))).toHaveLength(2);
    // The topic guide note keeps the units and what each topic covers.
    const guide = planWrites(checked.plan).notes.find(n => n.title.startsWith("Data Structures and Algorithms: topic guide"))!;
    expect(guide.body).toContain("# Unit 1: Foundations\n## Asymptotic analysis\n- Big-O, Omega and Theta");
    expect(guide.body.indexOf("# Unit 2: Non-linear structures")).toBeGreaterThan(guide.body.indexOf("## Arrays and strings"));
    expect(guide.body.split("# Unit 1: Foundations").length).toBe(2);
  });

  const request = (over: Partial<BuilderPlanRequest> = {}): BuilderPlanRequest => ({
    today: TODAY, kind: "exam", facts: [{ label: "Exam", value: "DSA end-semester" }], known: [], assumptions: [], suggestions: [],
    conversation: [], learnerText: "", current: null, change: null, existing: null, ...over,
  });
  const plan = JSON.stringify({ title: "DSA", subjects: [{ name: "DSA", topics: [{ name: "Asymptotic analysis", subtopics: ["Big-O"] }] }] });

  it("without a syllabus, a study plan says by code that it follows the common course, not an official one", async () => {
    let system = "";
    const written = await writeBuilderPlan(request(), (async (req: { systemInstruction: string }) => { system = req.systemInstruction; return plan; }) as never);
    expect(written.ok && written.plan.assumptions[0]).toBe(NO_SYLLABUS);
    expect(system).toContain("each subject in units (unit), each unit's topics in the order they are learnt, prerequisites and foundations first");
    expect(system).toContain("never claim the plan matches an official syllabus");
    expect(system).toContain("Data Structures and Algorithms runs from asymptotic analysis");
    // A shared syllabus, or one the learner described, and a project: not said.
    const withFile = await writeBuilderPlan(request({ files: [{ name: "syllabus.pdf", mimeType: "application/pdf", data: "JVBERi0=" }] }), (async () => plan) as never);
    expect(withFile.ok && withFile.plan.assumptions.includes(NO_SYLLABUS)).toBe(false);
    const told = await writeBuilderPlan(request({ facts: [{ label: "Syllabus", value: "Units 1-5 as listed" }] }), (async () => plan) as never);
    expect(told.ok && told.plan.assumptions.includes(NO_SYLLABUS)).toBe(false);
    const project = await writeBuilderPlan(request({ kind: "project" }), (async () => plan) as never);
    expect(project.ok && project.plan.assumptions.includes(NO_SYLLABUS)).toBe(false);
  });
});

describe("the conversation knows their records by name, and what it works on", () => {
  const input = (over: Partial<TurnInput> = {}): TurnInput => ({
    today: TODAY, messages: [{ id: "m1", role: "user", text: "add DP to my DSA plan", at: "" }], brief: { kind: null, title: null, facts: [], known: [], assumptions: [], suggestions: [], question: null, questionsAsked: 0, dropped: [] },
    known: [], proposal: null, existing: null, ...over,
  });

  it("is given their workspaces and subjects, and reads back the one named", async () => {
    let system = "";
    const reading = await readBuilderTurn(input({ resources: ["Data Structures and Algorithms [CS201] (subject)"] }), (async (req: { systemInstruction: string }) => {
      system = req.systemInstruction;
      return JSON.stringify({ reply: "On it.", next: "draft", resource: { name: "DSA", intent: "change" } });
    }) as never);
    expect(reading?.resource).toEqual({ name: "DSA", intent: "change" });
    expect(system).toContain("Kivo finds it; never claim you have opened or found it.");
    expect(turnPrompt(input({ resources: ["Data Structures and Algorithms [CS201] (subject)"] }))).toContain("THEIR WORKSPACES AND SUBJECTS: Data Structures and Algorithms [CS201] (subject)");
  });

  it("working on something of theirs, the changes proposed so far are shown, and an unreadable resource is none", async () => {
    const p = turnPrompt(input({ existing: { title: "DSA", subjects: ["DSA"], tasks: [] }, changes: ['Add to DSA: Heaps'] }));
    expect(p).toContain("WORKING ON: DSA (it exists in Kivo).");
    expect(p).toContain("CHANGES PROPOSED SO FAR (not applied):\n- Add to DSA: Heaps");
    const reading = await readBuilderTurn(input(), (async () => JSON.stringify({ reply: "Hi.", next: "chat", resource: { name: "", intent: "edit" } })) as never);
    expect(reading?.resource).toBeNull();
  });
});
