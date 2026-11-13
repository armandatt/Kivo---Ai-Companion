import { planCapture, planMapBuild, provenanceLine } from "../curation";
import { approvalNeeded, ChangeSchema } from "../changes";
import type { StudyStructure } from "../../nova/product/setup-edit.types";

const ST: StudyStructure = {
  version: "v1",
  subjects: [{ id: "s1", name: "Distributed Systems", parentId: null, dates: 0, topics: [
    { id: "t1", name: "Consensus", hasHistory: true, parentId: null },
    { id: "t2", name: "Raft", hasHistory: false, parentId: "t1" },
  ] }],
};
const note = (id: string, title: string, body: string) => ({ id, title, body, subjectId: "s1", subjectName: "Distributed Systems", topicName: null, updatedAt: new Date("2026-11-01T00:00:00Z") });
const P = { client: "Claude", capturedAt: "2026-11-13T10:00:00.000Z" };

describe("capture_knowledge planning", () => {
  test("exact duplicate skipped, same concept enriched, related linked, new created", () => {
    const raft = note("n1", "Raft", "Raft elects a leader with randomized election timeouts and replicates the log.");
    const paxos = note("n2", "Paxos", "Paxos reaches agreement among acceptors with prepare and accept phases over a majority quorum.");
    const plan = planCapture({
      provenance: P, structure: ST, subjectName: "Distributed Systems",
      items: [
        { title: "Leader election", kind: "concept", body: "Raft elects a leader with randomized election timeouts and replicates the log." },
        { title: "Raft", kind: "explanation", body: "Terms act as logical clocks; a stale leader steps down on seeing a higher term." },
        { title: "Multi-Paxos", kind: "concept", body: "Multi-Paxos keeps a stable leader so acceptors skip the prepare phase; a majority quorum still accepts each value." },
        { title: "Vector clocks", kind: "concept", body: "Each process keeps a counter per process to order events causally." },
      ],
      found: [[raft], [raft], [paxos], []],
    });
    expect(plan.decisions.map(d => d.action)).toEqual(["skip", "enrich", "create", "create"]);
    expect(plan.decisions[2]!.links).toContain("Paxos");
    const ops = plan.changes.map(c => c.op);
    expect(ops).toEqual(["append_to_note", "create_note", "create_note"]);
    const enrich = plan.changes[0] as { op: "append_to_note"; noteId: string; text: string; baseUpdatedAt: string };
    expect(enrich.noteId).toBe("n1");
    expect(enrich.baseUpdatedAt).toBe("2026-11-01T00:00:00.000Z");
    const multi = plan.changes[1] as { body: string; subjectId?: string };
    expect(multi.body).toContain("[[Paxos]]");
    expect(multi.subjectId).toBe("s1");
  });
  test("a concept named as a topic files the note there; no topic is invented", () => {
    const plan = planCapture({ provenance: P, structure: ST, subjectId: "s1", items: [{ title: "Raft log matching", kind: "concept", body: "x y z", concepts: ["Raft"] }, { title: "CRDTs", kind: "concept", body: "a b c" }], found: [[], []] });
    expect((plan.changes[0] as { topicName?: string }).topicName).toBe("Raft");
    expect((plan.changes[1] as { topicName?: string }).topicName).toBeUndefined();
  });
  test("provenance carries only what was given", () => {
    expect(provenanceLine(P)).toBe("*Captured from a conversation with Claude · 2026-11-13*");
    const full = provenanceLine({ ...P, conversationTitle: "Distributed systems", sourceUrl: "https://example.com/a" });
    expect(full).toContain('"Distributed systems"');
    expect(full).toContain("[source](https://example.com/a)");
  });
  test("two items with one title in a capture make one note", () => {
    const plan = planCapture({ provenance: P, structure: ST, items: [{ title: "Gossip", kind: "concept", body: "one" }, { title: "gossip", kind: "example", body: "two" }], found: [[], []] });
    expect(plan.decisions.map(d => d.action)).toEqual(["create", "skip"]);
  });
  test("an unknown subject is not created unless asked", () => {
    const no = planCapture({ provenance: P, structure: ST, subjectName: "Biology", items: [{ title: "Cells", kind: "concept", body: "x" }], found: [[]] });
    expect(no.target.subjectName).toBeNull();
    const yes = planCapture({ provenance: P, structure: ST, subjectName: "Biology", createSubject: true, items: [{ title: "Cells", kind: "concept", body: "x" }], found: [[]] });
    expect(yes.changes[0]).toEqual({ op: "add_subject", name: "Biology", topics: [] });
  });
});

describe("build_knowledge_map planning", () => {
  test("reuses topics the subject has, adds only what is missing, under its parent", () => {
    const plan = planMapBuild(ST, { subjectId: "s1", outline: [
      { name: "Consensus", children: [{ name: "raft" }, { name: "Paxos", explanation: "Agreement via quorums." }] },
      { name: "Replication", children: [{ name: "Chain replication" }] },
    ] });
    expect(plan.reused.map(r => r.name)).toEqual(["Consensus", "Raft"]);
    expect(plan.added).toEqual([{ name: "Paxos", under: "Consensus" }, { name: "Replication", under: null }, { name: "Chain replication", under: "Replication" }]);
    expect(plan.changes).toEqual([
      { op: "add_topics", subjectId: "s1", names: ["Paxos"], parentTopicName: "Consensus" },
      { op: "add_topics", subjectId: "s1", names: ["Replication"] },
      { op: "add_topics", subjectId: "s1", names: ["Chain replication"], parentTopicName: "Replication" },
    ]);
  });
  test("a new subject carries its top topics; deeper ones follow by name", () => {
    const plan = planMapBuild(ST, { subjectName: "Operating Systems", outline: [{ name: "Processes", children: [{ name: "Scheduling" }] }, { name: "Memory" }] });
    expect(plan.subject.exists).toBe(false);
    expect(plan.changes[0]).toEqual({ op: "add_subject", name: "Operating Systems", topics: ["Processes", "Memory"] });
    expect(plan.changes[1]).toEqual({ op: "add_topics", subjectName: "Operating Systems", names: ["Scheduling"], parentTopicName: "Processes" });
  });
  test("depth and repeats are bounded and said", () => {
    const plan = planMapBuild(ST, { subjectId: "s1", outline: [{ name: "A", children: [{ name: "B", children: [{ name: "C", children: [{ name: "D", children: [{ name: "E" }] }] }] }] }, { name: "a" }] });
    expect(plan.added.map(a => a.name)).toEqual(["A", "B", "C", "D"]);
    expect(plan.refused.length).toBe(2);
  });
});

describe("what needs the learner's approval (server-side rule)", () => {
  test("deleting, moving, renaming and refiling always do", () => {
    expect(approvalNeeded([{ op: "delete_note", noteId: "n" }]).needed).toBe(true);
    expect(approvalNeeded([{ op: "rename_topic", topicId: "t", name: "x" }]).needed).toBe(true);
    expect(approvalNeeded([{ op: "file_note", noteId: "n", subjectId: null }]).needed).toBe(true);
  });
  test("a clear small addition does not; a large one does, counted in items", () => {
    expect(approvalNeeded([{ op: "create_note", title: "t", body: "b" }]).needed).toBe(false);
    expect(approvalNeeded([{ op: "add_topics", subjectId: "s", names: Array.from({ length: 12 }, (_, i) => `t${i}`) }]).needed).toBe(false);
    expect(approvalNeeded([{ op: "add_topics", subjectId: "s", names: Array.from({ length: 13 }, (_, i) => `t${i}`) }]).needed).toBe(true);
  });
  test("the change vocabulary is closed", () => {
    expect(ChangeSchema.safeParse({ op: "drop_table", name: "x" }).success).toBe(false);
    expect(ChangeSchema.safeParse({ op: "create_note", title: "t", body: "b", profileId: "someone-else" }).success).toBe(true);
    expect(ChangeSchema.parse({ op: "create_note", title: "t", body: "b", profileId: "x" })).not.toHaveProperty("profileId");
  });
});
