// Versions to look back at and return to (builder-history.ts): what a
// version holds, and the changes that bring records back to one, checked by
// the same rules as any change. nova-builder-edit.itest.ts covers restoring
// against Postgres.

import { changesToReach, readProposal, readSnapshot, snapshotOf, snapshotOfPlan } from "../product/builder-history";
import { checkChanges } from "../product/builder-changes";
import { checkWorkspacePlan } from "../product/workspace-plan";
import type { WorkspaceDetail } from "../product/builder.types";

const TODAY = "2026-10-26";
const live = (): WorkspaceDetail => ({
  workspace: null, title: "TrackerX",
  subjects: [{ id: "s1", name: "TrackerX", topics: [{ id: "t1", name: "Backend" }, { id: "t2", name: "Polish" }] }],
  tasks: [
    { id: "api", title: "Build the API", status: "todo", priority: "low", dueDay: "2026-11-05", subjectId: "s1", topicName: "Backend", estimatedMinutes: null, parentId: null },
    { id: "auth", title: "Add auth", status: "todo", priority: null, dueDay: null, subjectId: "s1", topicName: "Backend", estimatedMinutes: null, parentId: "api" },
    { id: "extra", title: "Write a blog post", status: "todo", priority: null, dueDay: null, subjectId: "s1", topicName: "Polish", estimatedMinutes: null, parentId: null },
    { id: "done", title: "Sketch the schema", status: "done", priority: null, dueDay: null, subjectId: "s1", topicName: "Backend", estimatedMinutes: null, parentId: null },
  ],
  notes: [{ id: "n1", title: "How it goes: TrackerX", subjectId: "s1", updatedAt: "2026-10-20T00:00:00.000Z" }],
  dates: [{ id: "d1", title: "Launch", day: "2026-11-20", kind: "project", subjectId: "s1" }],
});

describe("a version, read back", () => {
  it("knows a plan from a change set from a snapshot", () => {
    const plan = checkWorkspacePlan({ kind: "custom", title: "X", subjects: [{ name: "X", topics: ["Y"] }] }, { today: TODAY });
    expect(plan.ok && readProposal(plan.plan)).toEqual(plan.ok ? { plan: plan.plan } : false);
    expect(readProposal({ changes: { ops: [], dropped: [] }, title: "X" })).toEqual({ changes: { ops: [], dropped: [] }, title: "X" });
    expect(readProposal({ nope: 1 })).toBeNull();
    expect(readSnapshot(snapshotOf(live()))!.tasks.find(t => t.title === "Add auth")!.parent).toBe("api");
  });
});

describe("bringing records back to a version", () => {
  it("adds what is gone, removes what was added since, puts back dates, priorities and steps; never a finished task", () => {
    const then = snapshotOf(live());
    // Since then: a topic and a task removed, a step moved out, a priority and a date changed, a task added.
    const now_: WorkspaceDetail = {
      ...live(),
      subjects: [{ id: "s1", name: "TrackerX", topics: [{ id: "t1", name: "Backend" }, { id: "t3", name: "Marketing" }] }],
      tasks: [
        { ...live().tasks[0]!, priority: "high", dueDay: "2026-11-09" },
        { ...live().tasks[1]!, parentId: null },
        { id: "new", title: "Run ads", status: "todo", priority: null, dueDay: null, subjectId: "s1", topicName: "Marketing", estimatedMinutes: null, parentId: null },
        live().tasks[3]!,
      ],
      dates: [{ id: "d1", title: "Launch", day: "2026-12-01", kind: "project", subjectId: "s1" }],
    };
    const reach = changesToReach(now_, then, TODAY);
    const set = checkChanges(reach.ops, now_, { today: TODAY, studied: new Set() });
    expect(set.ops.map(o => o.says).sort()).toEqual([
      'Add task "Write a blog post"',
      'Add to TrackerX: Polish',
      'Change date "Launch": move to 2026-11-20 (was 2026-12-01)',
      'Change task "Add auth": move under "Build the API"',
      'Change task "Build the API": due 2026-11-05 (was 2026-11-09), low priority',
      'Remove task "Run ads"',
      'Remove topic "Marketing" from TrackerX',
    ].sort());
  });

  it("matches a task by the titles above it, so two 'Write tests' stay two", () => {
    const d = live();
    d.tasks.push({ id: "t-a", title: "Write tests", status: "todo", priority: null, dueDay: null, subjectId: "s1", topicName: null, estimatedMinutes: null, parentId: "api" });
    d.tasks.push({ id: "t-b", title: "Write tests", status: "todo", priority: null, dueDay: null, subjectId: "s1", topicName: null, estimatedMinutes: null, parentId: "extra" });
    expect(changesToReach(d, snapshotOf(d), TODAY).ops).toEqual([]);
  });

  it("a day that has passed, a finished task and a note whose text isn't known are said, not forced", () => {
    const then = snapshotOf(live());
    then.dates = [{ title: "Kickoff", day: "2026-10-01", kind: "other", subject: "TrackerX" }, ...then.dates];
    then.tasks.push({ key: "old", title: "Old finished thing", status: "done", priority: null, dueDay: null, subject: "TrackerX", topic: null, parent: null });
    then.notes.push({ title: "Gone note", subject: "TrackerX", body: null });
    const reach = changesToReach(live(), then, TODAY);
    expect(reach.notes).toEqual(['"Old finished thing" was finished then; it isn\'t made again', 'the date "Kickoff" has passed', 'the note "Gone note" can\'t be brought back (its text isn\'t kept)']);
  });

  it("a plan's own version reads as what building it makes", () => {
    const r = checkWorkspacePlan({ kind: "custom", title: "X", subjects: [{ name: "X", topics: ["A"] }], tasks: [{ key: "a", title: "Do A", topic: "A" }, { key: "b", title: "Step", parent: "a" }] }, { today: TODAY });
    const s = r.ok ? snapshotOfPlan(r.plan) : null;
    expect(s!.tasks.map(t => [t.title, t.parent])).toEqual([["Do A", null], ["Step", "a"]]);
  });
});
