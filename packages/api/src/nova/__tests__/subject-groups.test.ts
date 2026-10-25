// Subjects inside subjects: "put all five under Semester Five" (seen 26 Oct,
// Semester Exams Preparation). Version 2 removed all five subjects and added
// them back as topics of a new one; version 3 added the group with the
// subjects' names as its topics; version 4 added an empty group beside them.
// Each is held here, pure: the change check, only-what-was-asked, Subject
// Studio's edits, plans, history and the map. Against Postgres:
// nova-builder-edit.itest.ts.

import { checkChanges, kindOf, withinAsk } from "../product/builder-changes";
import { planChanges, describeChanges, changedNothing, readTurn } from "../product/builder-state";
import { changesToReach, snapshotOf, snapshotOfPlan } from "../product/builder-history";
import { checkStudyEdits, parseStudyEdits, structureVersion } from "../product/setup-edit";
import { checkWorkspacePlan, planWrites } from "../product/workspace-plan";
import { changesPrompt } from "../product/workspace-generation";
import { buildKnowledgeMap } from "../product/knowledge-map";
import { SUBJECT_DEPTH_MAX, type StudyStructure } from "../product/setup-edit.types";
import type { WorkspaceDetail } from "../product/builder.types";

jest.mock("../../services/openai.service", () => ({ generateOpenAIText: jest.fn() }));

const TODAY = "2026-10-26";
const NAMES = ["Automata", "Competitive Programming", "NLP", "SPM", "Prompt Engineering"];
const id = (name: string) => `s-${name.split(" ")[0]!.toLowerCase()}`;

const semester = (): WorkspaceDetail => ({
  workspace: null, title: "Semester Exams Preparation",
  subjects: NAMES.map(n => ({ id: id(n), name: n, parentId: null, topics: [{ id: `t-${id(n)}-1`, name: `${n} part 1` }, { id: `t-${id(n)}-2`, name: `${n} part 2` }] })),
  tasks: [{ id: "k1", title: "Complete tutorials 8 to 11", status: "todo", priority: null, dueDay: "2026-11-05", subjectId: "s-automata", topicName: null, estimatedMinutes: null, parentId: null }],
  notes: [{ id: "n1", title: "How it goes: Semester Exams Preparation", subjectId: "s-automata", updatedAt: "2026-10-26T00:00:00.000Z" }],
  dates: [{ id: "d1", title: "Semester exams", day: "2026-12-01", kind: "exam", subjectId: "s-automata" }],
});
const check = (ops: unknown[], d = semester()) => checkChanges(ops, d, { today: TODAY, studied: new Set() });
const group = (parentKey = "sem5") => [
  { op: "add_subject", key: parentKey, name: "Semester Five", topics: [] },
  ...NAMES.map(n => ({ op: "move_subject", subjectId: id(n), parentKey })),
];

describe("a subject inside another, as a change", () => {
  it("adds the group and puts each subject inside it, every topic, task, note and date staying where it is", () => {
    const set = check(group());
    expect(set.ops.map(o => o.says)).toEqual([
      'Add subject "Semester Five"',
      ...NAMES.map(n => `Put "${n}" inside "Semester Five"`),
    ]);
    expect(set.ops.filter(o => o.effect === "remove")).toEqual([]);
    expect(set.dropped).toEqual([]);
    expect(set.ops.every(o => kindOf(o.op) === "subjects")).toBe(true);
  });

  it("a group's subjects named as its topics are moved into it, never made topics beside them (v3)", () => {
    const set = check([{ op: "add_subject", name: "Semester Five", topics: NAMES }]);
    expect(set.ops.map(o => o.says)).toEqual(['Add subject "Semester Five"', ...NAMES.map(n => `Put "${n}" inside "Semester Five"`)]);
  });

  it("moves go after the subjects the set adds, whatever order the model gave", () => {
    const [add, ...moves] = group();
    expect(check([...moves, add]).ops.map(o => o.op)).toEqual(["add_subject", ...NAMES.map(() => "move_subject")]);
  });

  it("into one already there by id, out on its own, and nothing for a move that changes nothing", () => {
    const d = semester();
    d.subjects[2]!.parentId = "s-automata";
    const set = check([
      { op: "move_subject", subjectId: "s-spm", parentId: "s-automata" },
      { op: "move_subject", subjectId: "s-nlp", parentId: null },
      { op: "move_subject", subjectId: "s-prompt", parentId: null },
    ], d);
    expect(set.ops.map(o => o.says)).toEqual(['Put "SPM" inside "Automata"', 'Take "NLP" out of "Automata", on its own']);
  });

  it("never inside itself or a subject inside it, never past the depth cap, never inside one that isn't part of this", () => {
    const d = semester();
    d.subjects[1]!.parentId = "s-automata";
    const set = check([
      { op: "move_subject", subjectId: "s-automata", parentId: "s-competitive" },
      { op: "move_subject", subjectId: "s-nlp", parentId: "s-nlp" },
      { op: "move_subject", subjectId: "s-spm", parentId: "someone-elses" },
      { op: "move_subject", subjectId: "nope", parentId: null },
    ], d);
    expect(set.ops).toEqual([]);
    expect(set.dropped).toEqual([
      'putting "Automata" inside "Competitive Programming" (not inside itself or a subject inside it)',
      'putting "NLP" inside "NLP" (not inside itself or a subject inside it)',
      'putting "SPM" inside a subject that isn\'t part of this',
      "moving a subject that isn't part of this",
    ]);
    // A chain as deep as allowed, then one more level is refused.
    const chain = [{ op: "add_subject", key: "g0", name: "G0", topics: [] }, ...Array.from({ length: SUBJECT_DEPTH_MAX }, (_, i) => ({ op: "add_subject", key: `g${i + 1}`, name: `G${i + 1}`, topics: [], parentKey: `g${i}` }))];
    const deep = check(chain);
    expect(deep.ops).toHaveLength(SUBJECT_DEPTH_MAX);
    expect(deep.dropped).toEqual([`subject "G${SUBJECT_DEPTH_MAX}" (subjects go at most ${SUBJECT_DEPTH_MAX} levels deep)`]);
  });

  it("removing a group leaves the subjects inside it on their own, and says so", () => {
    const d = semester();
    d.subjects.push({ id: "s-sem5", name: "Semester Five", parentId: null, topics: [] });
    for (const s of d.subjects) if (s.id !== "s-sem5" && s.id !== "s-nlp") s.parentId = "s-sem5";
    expect(check([{ op: "remove_subject", subjectId: "s-sem5" }], d).ops.map(o => o.says))
      .toEqual(['Remove subject "Semester Five" (its notes and tasks stay, unfiled; Automata, Competitive Programming, SPM, Prompt Engineering stay, on their own)']);
  });

  it("renames a subject, never onto another's name", () => {
    expect(check([{ op: "rename_subject", subjectId: "s-spm", name: "Software Project Management" }, { op: "rename_subject", subjectId: "s-nlp", name: "automata" }]).ops.map(o => o.says))
      .toEqual(['Rename subject "SPM" to "Software Project Management"']);
  });
});

describe("only what was asked: regrouping removes nothing (v2)", () => {
  // What the model proposed for "keep everything same, just make sure they all come under sem five".
  const v2 = [
    { op: "add_subject", name: "Semester Five", topics: NAMES },
    ...NAMES.map(n => ({ op: "remove_subject", subjectId: id(n) })),
  ];

  it("a request that asks to remove nothing keeps no removal, and says what it left out", () => {
    const set = withinAsk(check(v2), ["subjects"], semester(), { removes: false });
    expect(set.ops.map(o => o.says)).toEqual(['Add subject "Semester Five"', ...NAMES.map(n => `Put "${n}" inside "Semester Five"`)]);
    expect(set.ops.map(o => o.id)).toEqual(set.ops.map((_, i) => `c${i + 1}`));
    expect(set.dropped.some(d => d.endsWith("(you didn't ask to remove anything)"))).toBe(true);
  });

  it("asked to remove, removals stay; not said, nothing changes from before", () => {
    const removing = check(v2);
    expect(withinAsk(removing, ["subjects"], semester(), { removes: true }).ops.some(o => o.effect === "remove")).toBe(true);
    expect(withinAsk(removing, ["subjects"], semester()).ops.some(o => o.effect === "remove")).toBe(true);
  });

  it("the reading carries whether they asked to remove anything; absent is not said", () => {
    const base = { reply: "OK.", next: "revise", facts: [], assumptions: [], suggestions: [], question: null };
    expect(readTurn({ ...base, removes: false }, "x")!.removes).toBe(false);
    expect(readTurn({ ...base, removes: true }, "x")!.removes).toBe(true);
    expect(readTurn(base, "x")!.removes).toBeNull();
  });

  it("the change writer sees subjects inside others indented under them", () => {
    const d = semester();
    d.subjects[1]!.parentId = "s-automata";
    const prompt = changesPrompt({ today: TODAY, kind: "semester", facts: [], current: { ...d, tasks: [], dates: [], notes: [] }, proposed: null, change: "x", conversation: [] });
    expect(prompt).toContain('- subject s-automata "Automata"');
    expect(prompt).toContain('\n  - subject s-competitive "Competitive Programming"');
  });
});

describe("Subject Studio: the same, by hand", () => {
  const structure = (): StudyStructure => {
    const subjects = NAMES.map(n => ({ id: id(n), name: n, parentId: null, dates: 0, topics: [] }));
    return { version: structureVersion(subjects), subjects };
  };

  it("adds a group and moves subjects into it by name, in one batch, each said", () => {
    const r = checkStudyEdits(structure(), [
      { op: "add_subject", name: "Semester Five", topics: [] },
      { op: "move_subject", subjectId: "s-automata", parentId: null, parentName: "semester five" },
      { op: "add_subject", name: "Labs", topics: ["Lab 1"], parentName: "Semester Five" },
    ]);
    expect(r.issues).toEqual([]);
    expect(r.sentences).toEqual(["Add the subject Semester Five.", "Put Automata inside Semester Five.", "Add the subject Labs inside Semester Five with 1 topic."]);
  });

  it("refuses a loop, a move that changes nothing, and a parent that isn't theirs", () => {
    const s = structure();
    s.subjects[1]!.parentId = "s-automata";
    const r = checkStudyEdits(s, [
      { op: "move_subject", subjectId: "s-automata", parentId: "s-competitive" },
      { op: "move_subject", subjectId: "s-competitive", parentId: "s-automata" },
      { op: "move_subject", subjectId: "s-nlp", parentId: "theirs" },
      { op: "move_subject", subjectId: "s-competitive", parentId: null },
    ]);
    expect(r.issues.map(i => i.message)).toEqual([
      "Automata can't go inside itself or a subject inside it.",
      "Competitive Programming is already inside Automata.",
      "The subject to put it inside isn't one of yours.",
    ]);
    expect(r.sentences).toEqual(["Take Competitive Programming out of Automata, as a subject of its own."]);
  });

  it("removing a group leaves what is inside on its own", () => {
    const s = structure();
    s.subjects.push({ id: "g", name: "Semester Five", parentId: null, dates: 0, topics: [] });
    s.subjects[0]!.parentId = "g";
    expect(checkStudyEdits(s, [{ op: "remove_subject", subjectId: "g" }, { op: "move_subject", subjectId: "s-automata", parentId: null }]).issues)
      .toEqual([{ index: 1, message: "Automata is already a subject of its own." }]);
  });

  it("reads parentName and parentId from a request; the version changes when a subject moves", () => {
    expect(parseStudyEdits({ version: "v", edits: [{ op: "move_subject", subjectId: "a", parentName: "G", evil: 1 }] }))
      .toEqual({ ok: true, version: "v", edits: [{ op: "move_subject", subjectId: "a", parentId: null, parentName: "G" }] });
    expect(parseStudyEdits({ version: "v", edits: [{ op: "move_subject", subjectId: "a", parentId: 3 }] }).ok).toBe(false);
    const before = structure().subjects;
    const after = before.map(x => (x.id === "s-nlp" ? { ...x, parentId: "s-automata" } : x));
    expect(structureVersion(after)).not.toBe(structureVersion(before));
    // A subject on its own reads as it did before subjects could nest.
    expect(structureVersion(before)).toBe(structureVersion(before.map(({ parentId: _p, ...x }) => x)));
  });
});

describe("a plan's subjects inside one another", () => {
  it("keeps a parent that is another subject of the plan; drops one that isn't, or loops", () => {
    const r = checkWorkspacePlan({
      kind: "custom", title: "Semester", subjects: [
        { name: "Semester Five", topics: [] },
        { name: "Automata", topics: ["Regular languages"], parent: "semester five" },
        { name: "NLP", topics: ["Tokenisation"], parent: "Physics" },
        { name: "A", topics: [], parent: "B" }, { name: "B", topics: [], parent: "A" },
      ],
    }, { today: TODAY });
    expect(r.ok).toBe(true);
    const parents = r.ok ? Object.fromEntries(r.plan.subjects.map(s => [s.name, s.parent ?? null])) : {};
    expect(parents["Automata"]).toBe("Semester Five");
    expect(parents["NLP"]).toBeNull();
    expect([parents["A"], parents["B"]].filter(Boolean)).toHaveLength(1);
    expect(r.ok && planWrites(r.plan).subjects.find(s => s.name === "Automata")!.parent).toBe("Semester Five");
  });

  it("a revision that only regroups is a change, and says what moved", () => {
    const before = checkWorkspacePlan({ kind: "custom", title: "S", subjects: [{ name: "Semester Five", topics: [] }, { name: "NLP", topics: ["Tokenisation"] }] }, { today: TODAY });
    const after = checkWorkspacePlan({ kind: "custom", title: "S", subjects: [{ name: "Semester Five", topics: [] }, { name: "NLP", topics: ["Tokenisation"], parent: "Semester Five" }] }, { today: TODAY });
    const diff = planChanges(before.ok ? before.plan : null, after.ok ? after.plan : null!);
    expect(changedNothing(diff)).toBe(false);
    expect(describeChanges(diff)).toBe("Put NLP inside Semester Five.");
  });
});

describe("history brings placement back", () => {
  it("a subject moved since is moved back; one added since goes; a group gone comes back with its subjects inside", () => {
    const grouped = semester();
    grouped.subjects.push({ id: "s-sem5", name: "Semester Five", parentId: null, topics: [] });
    for (const s of grouped.subjects) if (s.id !== "s-sem5") s.parentId = "s-sem5";
    const then = snapshotOf(grouped);
    expect(then.subjects.find(s => s.name === "NLP")!.parent).toBe("Semester Five");

    // Since then the group was removed (its subjects left on their own).
    const now_ = semester();
    const reach = changesToReach(now_, then, TODAY);
    const set = check(reach.ops, now_);
    expect(set.ops.map(o => o.says)).toEqual(['Add subject "Semester Five"', ...NAMES.map(n => `Put "${n}" inside "Semester Five"`)]);

    // And the other way: back to before the group existed.
    const before = snapshotOf(semester());
    const back = check(changesToReach(grouped, before, TODAY).ops, grouped);
    expect(back.ops.map(o => o.says)).toEqual([...NAMES.map(n => `Take "${n}" out of "Semester Five", on its own`), 'Remove subject "Semester Five" (its notes and tasks stay, unfiled)']);
  });

  it("an older snapshot that says nothing about placement moves nothing", () => {
    const grouped = semester();
    grouped.subjects.push({ id: "s-sem5", name: "Semester Five", parentId: null, topics: [] });
    grouped.subjects[0]!.parentId = "s-sem5";
    const old = snapshotOf(grouped);
    old.subjects = old.subjects.map(({ parent: _p, ...s }) => s);
    expect(changesToReach(grouped, old, TODAY).ops).toEqual([]);
  });

  it("a plan's version knows its groups", () => {
    const r = checkWorkspacePlan({ kind: "custom", title: "S", subjects: [{ name: "G", topics: [] }, { name: "X", topics: ["Y"], parent: "G" }] }, { today: TODAY });
    expect(r.ok && snapshotOfPlan(r.plan).subjects).toEqual([{ name: "G", topics: [], tree: [], parent: null }, { name: "X", topics: ["Y"], tree: [{ name: "Y", parent: null }], parent: "G" }]);
  });
});

describe("the map draws a subject inside another", () => {
  it("as a stored edge from the group to each subject in it, and not to one that is gone", () => {
    const map = buildKnowledgeMap({
      subjects: [{ id: "g", name: "Semester Five" }, { id: "a", name: "Automata", parentId: "g" }, { id: "b", name: "NLP", parentId: "gone" }],
      topics: [], notes: [], resources: [], totals: { notes: 0, resources: 0 },
    });
    expect(map.edges.map(e => `${e.from} -${e.kind}-> ${e.to}`)).toEqual(["subject:g -contains-> subject:a"]);
    const a = map.nodes.find(n => n.id === "subject:a")!;
    expect(a.type === "subject" && a.parentId).toBe("g");
    expect(map.unconnected).toBe(1);
  });
});
