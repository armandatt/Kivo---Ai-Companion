import { compare, closest, searchScore, snippet, words } from "../similarity";

const RAFT = { title: "Raft consensus", body: "Raft elects a leader with randomized election timeouts. The leader replicates log entries to followers and commits once a majority acknowledges." };

describe("Kivo Connect similarity (keyword, not semantic)", () => {
  test("text already in a note is an exact duplicate", () => {
    expect(compare({ title: "Leader election", body: "Raft elects a leader with randomized election timeouts." }, RAFT).overlap).toBe("exact_duplicate");
  });
  test("the same title, or most of its words, is the same concept", () => {
    expect(compare({ title: "Raft Consensus", body: "Terms are logical clocks." }, RAFT).overlap).toBe("same_concept");
    expect(compare({ title: "The Raft consensus algorithm", body: "Terms." }, RAFT).overlap).toBe("same_concept");
  });
  test("shared wording without the same title is related; nothing shared is new", () => {
    expect(compare({ title: "Paxos", body: "A leader replicates log entries; a majority of acceptors must acknowledge each entry before it commits." }, RAFT).overlap).toBe("related");
    expect(compare({ title: "Gradient descent", body: "Step against the gradient of the loss." }, RAFT).overlap).toBe("new");
  });
  test("closest puts the strongest overlap first and drops unrelated notes", () => {
    const res = closest({ title: "Raft consensus", body: "x" }, [{ title: "Cooking", body: "pasta" }, RAFT]);
    expect(res.map(r => r.note.title)).toEqual(["Raft consensus"]);
  });
  test("words fold case, accents, plurals and stop words", () => {
    expect(words("The Nodes elect Leaders")).toEqual(["node", "elect", "leader"]);
  });
  test("search scores a title match above a text match", () => {
    expect(searchScore("raft", { title: "Raft", text: "" })).toBeGreaterThan(searchScore("raft", { title: "Notes", text: "raft" }));
  });
  test("snippet shows the text around the first match", () => {
    expect(snippet("a ".repeat(200) + "consensus here", ["consensus"])).toContain("consensus here");
  });
});
