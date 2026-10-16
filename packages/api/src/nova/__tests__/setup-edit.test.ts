// Editing subjects and topics: what a batch may do, checked before anything
// is written (product/setup-edit.ts). The writes are in nova-setup-edit.itest.ts.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkStudyEdits, parseStudyEdits, structureVersion } from "../product/setup-edit";
import type { StudyStructure } from "../product/setup-edit.types";

const structure = (): StudyStructure => {
  const subjects = [
    { id: "os", name: "Operating Systems", dates: 1, topics: [
      { id: "t1", name: "Deadlocks", hasHistory: true },
      { id: "t2", name: "Paging", hasHistory: false },
    ] },
    { id: "ml", name: "Machine learning", dates: 0, topics: [{ id: "t3", name: "Regression", hasHistory: false }] },
    { id: "empty", name: "Old stuff", dates: 0, topics: [] },
  ];
  return { version: structureVersion(subjects), subjects };
};
const check = (edits: Parameters<typeof checkStudyEdits>[1]) => checkStudyEdits(structure(), edits);

describe("reading a request", () => {
  it("takes only known operations with the right fields, and a version", () => {
    expect(parseStudyEdits({ version: "v", edits: [{ op: "rename_topic", topicId: "t1", name: "x", profileId: "evil" }] }))
      .toEqual({ ok: true, version: "v", edits: [{ op: "rename_topic", topicId: "t1", name: "x" }] });
    for (const bad of [null, {}, { version: "v", edits: [] }, { version: "v", edits: [{ op: "drop_table" }] }, { edits: [{ op: "remove_topic", topicId: "t1" }] }, { version: "v", edits: [{ op: "rename_topic", topicId: 3, name: "x" }] }]) {
      expect(parseStudyEdits(bad).ok).toBe(false);
    }
  });
});

describe("what a batch may do", () => {
  it("renames and moves topics, renames and adds subjects, and says each in a sentence", () => {
    const r = check([
      { op: "rename_topic", topicId: "t1", name: "Deadlock handling" },
      { op: "move_topic", topicId: "t2", toSubjectId: "ml" },
      { op: "rename_subject", subjectId: "ml", name: "AI engineering" },
      { op: "add_subject", name: "  DSA  ", topics: ["Arrays", "Graphs", "arrays"] },
      { op: "add_topics", subjectId: "os", names: ["Scheduling", "Deadlock handling"] },
    ]);
    expect(r.issues).toEqual([]);
    expect(r.sentences).toEqual([
      "Rename Deadlocks to Deadlock handling (its notes, tasks, saved pages and history go with it).",
      "Move Paging from Operating Systems to Machine learning (with its notes, tasks, saved pages and history).",
      "Rename the subject Machine learning to AI engineering.",
      "Add the subject DSA with 2 topics.",
      "Add to Operating Systems: Scheduling.",
    ]);
  });

  it("a topic with recorded study is never removed; one without is", () => {
    expect(check([{ op: "remove_topic", topicId: "t1" }]).issues[0]!.message).toContain("would delete that record");
    expect(check([{ op: "remove_topic", topicId: "t2" }]).issues).toEqual([]);
  });

  it("a subject is removed only once it has no topics and no dates, in the order given", () => {
    expect(check([{ op: "remove_subject", subjectId: "empty" }]).issues).toEqual([]);
    expect(check([{ op: "remove_subject", subjectId: "ml" }]).issues[0]!.message).toContain("still has topics");
    expect(check([{ op: "remove_topic", topicId: "t3" }, { op: "remove_subject", subjectId: "ml" }]).issues).toEqual([]);
    expect(check([{ op: "move_topic", topicId: "t2", toSubjectId: "ml" }, { op: "remove_topic", topicId: "t1" }]).issues).toHaveLength(1);
    expect(check([{ op: "remove_topic", topicId: "t2" }, { op: "remove_subject", subjectId: "os" }]).issues[0]!.message).toContain("still has topics");
  });

  it("names cannot collide, any case, where they land", () => {
    expect(check([{ op: "rename_topic", topicId: "t2", name: "deadlocks" }]).issues).toHaveLength(1);
    expect(check([{ op: "rename_subject", subjectId: "ml", name: "operating systems" }]).issues).toHaveLength(1);
    expect(check([{ op: "add_subject", name: "MACHINE LEARNING", topics: [] }]).issues).toHaveLength(1);
    expect(check([{ op: "add_topics", subjectId: "ml", names: ["Paging"] }, { op: "move_topic", topicId: "t2", toSubjectId: "ml" }]).issues).toHaveLength(1);
    expect(check([{ op: "rename_topic", topicId: "t2", name: "   " }]).issues).toHaveLength(1);
  });

  it("ids that are not the learner's stop the whole batch", () => {
    const r = check([{ op: "rename_topic", topicId: "t2", name: "Paging 2" }, { op: "rename_topic", topicId: "someone-elses", name: "x" }]);
    expect(r.issues).toEqual([{ index: 1, message: "That topic isn't one of yours." }]);
  });

  it("the version names the structure: any rename or move changes it, order does not", () => {
    const s = structure();
    expect(structureVersion([...s.subjects].reverse())).toBe(s.version);
    expect(structureVersion(s.subjects.map(x => x.id === "os" ? { ...x, name: "OS" } : x))).not.toBe(s.version);
    expect(structureVersion(s.subjects.map(x => x.id === "os" ? { ...x, topics: x.topics.slice(1) } : x))).not.toBe(s.version);
  });
});

describe("boundaries", () => {
  const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

  it("adds go through setup's one subject writer; filing follows through the owners; no model", () => {
    const edit = src("product/setup-edit.ts");
    expect(edit).not.toMatch(/novaSubject\.create|novaNote\.|novaTask\.|novaLearningEvent\.|novaTopicMastery\.(update|create|delete)/);
    expect(edit).toContain("declareSubjectsIn(tx");
    for (const helper of ["refileNotesForTopic", "refileTasksForTopic", "refileResourcesForTopic"]) expect(edit).toContain(helper);
    expect(edit).not.toContain("openai.service");
    expect(src("product/setup.ts").match(/novaSubject\.create/g)).toHaveLength(1);
  });
});

describe("archived topics in Subject Studio (topic-archive.ts)", () => {
  const withArchived = (): StudyStructure => {
    const subjects = [{ id: "os", name: "OS", dates: 0, topics: [
      { id: "a1", name: "Paging", hasHistory: true, archived: true },
      { id: "t2", name: "Deadlocks", hasHistory: false },
    ] }];
    return { version: structureVersion(subjects), subjects };
  };

  it("adding an archived topic's name restores it, and says so", () => {
    const r = checkStudyEdits(withArchived(), [{ op: "add_topics", subjectId: "os", names: ["paging", "Scheduling"] }]);
    expect(r.issues).toEqual([]);
    expect(r.sentences).toEqual(["Add to OS: Scheduling.", "Restore in OS: Paging (archived, with its history)."]);
  });

  it("renaming onto an archived topic's name points to Restore", () => {
    const r = checkStudyEdits(withArchived(), [{ op: "rename_topic", topicId: "t2", name: "Paging" }]);
    expect(r.issues[0]!.message).toBe('OS has an archived topic called "Paging". Restore it instead, or pick another name.');
  });

  it("a subject with only archived topics left is not removed, and says how many", () => {
    const r = checkStudyEdits(withArchived(), [{ op: "remove_topic", topicId: "t2" }, { op: "remove_subject", subjectId: "os" }]);
    expect(r.issues[0]!.message).toBe("OS still has topics (1 archived). Move or remove them first.");
  });

  it("archiving or restoring changes the version, so a batch made before it is stale", () => {
    const s = withArchived();
    const restored = s.subjects.map(x => ({ ...x, topics: x.topics.map(t => ({ ...t, archived: false })) }));
    expect(structureVersion(restored)).not.toBe(s.version);
  });
});
