// K-01, K-10, K-28A: what a learner approves is said by name and place, a
// note rename waits for approval, and each workspace has its own link.
import { approvalItem, approvalNeeded, ChangeSchema, describe as describeChange } from "../changes";
import { workspaceUrl } from "../tools";
import type { StudyStructure } from "../../nova/product/setup-edit.types";

const st: StudyStructure = {
  version: "v1",
  subjects: [
    { id: "s1", name: "Computer Science", parentId: null, dates: 0, topics: [] },
    { id: "s2", name: "Operating Systems", parentId: "s1", dates: 0, topics: [
      { id: "t1", name: "Processes", parentId: null, hasHistory: false },
      { id: "t2", name: "Scheduling", parentId: "t1", hasHistory: false },
    ] },
    { id: "s3", name: "Networks", parentId: null, dates: 0, topics: [{ id: "t3", name: "TCP", parentId: null, hasHistory: false }] },
  ],
};
const notes = [{ id: "cmwhpaiyf00012bkix1ij5nd6", updatedAt: "2026-11-17T10:00:00.000Z", title: "Round robin notes", subjectName: "Operating Systems", topicName: "Scheduling" }];
const NOTE = notes[0]!.id;

describe("approval items (K-01)", () => {
  test("a delete names the note and where it is filed, never its id", () => {
    const it = approvalItem({ op: "delete_note", noteId: NOTE }, st, notes);
    expect(it).toMatchObject({ action: "delete", kind: "note", name: "Round robin notes", where: "Operating Systems › Scheduling", destructive: true });
    expect(it.text).not.toContain(NOTE);
    expect(it.text).toContain("Round robin notes");
  });
  test("a move shows where the note is and where it goes", () => {
    const it = approvalItem({ op: "file_note", noteId: NOTE, subjectId: "s3", topicName: "TCP" }, st, notes);
    expect(it).toMatchObject({ action: "file", where: "Operating Systems › Scheduling", to: "Networks › TCP" });
  });
  test("renames show the old and the new name", () => {
    expect(approvalItem({ op: "rename_note", noteId: NOTE, title: "Scheduling summary" }, st, notes)).toMatchObject({ name: "Round robin notes", to: "Scheduling summary" });
    expect(approvalItem({ op: "rename_topic", topicId: "t2", name: "CPU scheduling" }, st)).toMatchObject({ name: "Scheduling", where: "Computer Science › Operating Systems › Processes", to: "CPU scheduling" });
    expect(approvalItem({ op: "rename_subject", subjectId: "s2", name: "OS" }, st)).toMatchObject({ name: "Operating Systems", where: "Computer Science", to: "OS" });
  });
  test("subject and topic moves name both places", () => {
    expect(approvalItem({ op: "move_subject", subjectId: "s3", parentSubjectId: "s1" }, st)).toMatchObject({ name: "Networks", where: "the top level", to: "Computer Science" });
    expect(approvalItem({ op: "move_topic", topicId: "t3", toSubjectId: "s2", parentTopicId: "t1" }, st)).toMatchObject({ where: "Networks", to: "Computer Science › Operating Systems › Processes" });
  });
  test("deleting a subject says how much is inside it", () => {
    expect(approvalItem({ op: "remove_subject", subjectId: "s2" }, st).text).toBe("Delete subject “Operating Systems” from Computer Science (2 topics in it)");
  });
  test("missing records are said plainly, not as ids", () => {
    expect(describeChange({ op: "delete_note", noteId: "gone123" }, st, notes)).toBe("Delete note “a note that no longer exists”");
    expect(describeChange({ op: "remove_topic", topicId: "nope" }, st)).toContain("a topic that no longer exists");
  });
  test("a bulk addition lists every item", () => {
    expect(approvalItem({ op: "add_topics", subjectId: "s3", names: ["UDP", "IP"] }, st).text).toBe("Add 2 topics to Networks: UDP, IP");
  });
});

describe("note renames need approval (K-10)", () => {
  test("rename_note is a change the learner approves; appending alone is not", () => {
    expect(ChangeSchema.safeParse({ op: "rename_note", noteId: NOTE, title: "New" }).success).toBe(true);
    expect(approvalNeeded([{ op: "rename_note", noteId: NOTE, title: "New" }]).needed).toBe(true);
    expect(approvalNeeded([{ op: "append_to_note", noteId: NOTE, text: "more" }]).needed).toBe(false);
  });
});

describe("workspace links (K-28A)", () => {
  test("each workspace and subject opens on its own map", () => {
    const o = "https://www.thekivo.in";
    const a = workspaceUrl(o, { id: "workspace:w1", kind: "workspace", subjectIds: ["s1"] });
    const b = workspaceUrl(o, { id: "workspace:w2", kind: "workspace", subjectIds: ["s2"] });
    expect(a).toBe(`${o}/map?workspace=w1`);
    expect(b).not.toBe(a);
    expect(workspaceUrl(o, { id: "subject:s3", kind: "subject", subjectIds: ["s3"] })).toBe(`${o}/map?explore=subject%3As3`);
  });
});
