// Nova as an editor of a note (note-edit.ts): what may be asked, what the
// model is given, and what code keeps of its reply. No database and no
// model: both are stubs. Applying what the learner approves is
// note-outline.test.ts.

import { editPrompt, parseEditRequest, proposeEdit, readEditReply } from "../product/note-edit";
import { markedNote } from "../product/note-tutor";
import { applyEdits, noteBlocks } from "../product/note-outline";
import type { NoteSources } from "../product/notes";

jest.mock("../../services/openai.service", () => ({ generateOpenAIText: jest.fn() }));

const BODY = [
  "# Graphs",
  "",
  "## Dijkstra's Algorithm",
  "pick the unvisited node with smallest distance then relax edges",
  "",
  "## Bellman-Ford",
  "Relaxes every edge V-1 times.",
  "",
  "Relaxes every edge V-1 times.",
].join("\n");
const note = (body = BODY): NoteSources => ({
  note: { id: "n1", title: "Graphs", body, subjectId: null, subjectName: null, topicName: null, updatedAt: "2026-10-26T10:00:00.000Z", bodyLength: body.length },
  related: [],
} as unknown as NoteSources);
const load = async () => note();
const ids = (body = BODY) => Object.fromEntries(noteBlocks(body).map(b => [b.text.slice(0, 12), b.id]));

describe("what may be asked", () => {
  it("refuses an unknown kind, an empty custom request, and too much at once", () => {
    expect(parseEditRequest({ kind: "delete_everything" }).ok).toBe(false);
    expect(parseEditRequest({ kind: "custom" }).ok).toBe(false);
    expect(parseEditRequest({ kind: "integrate" }).ok).toBe(false);
    expect(parseEditRequest({ kind: "rewrite", instruction: "x".repeat(1001) }).ok).toBe(false);
    expect(parseEditRequest({ kind: "rewrite", selection: "some words" }).ok).toBe(true);
  });
});

describe("what the model is given", () => {
  it("the note as marked blocks, the passage with its blocks, and the material as text to work on", () => {
    const parsed = parseEditRequest({ kind: "integrate", material: "Why greedy works…" });
    if (!parsed.ok) throw new Error("refused");
    const m = markedNote(BODY, null);
    const prompt = editPrompt(parsed.request, { title: "Graphs", text: m.text, partial: false }, { text: "pick the unvisited node", heading: "Dijkstra's Algorithm", blocks: ["b3"] });
    expect(prompt).toContain("[b3] pick the unvisited node");
    expect(prompt).toContain('PASSAGE the learner chose (under "Dijkstra\'s Algorithm"), in blocks b3');
    expect(prompt).toContain("MATERIAL to work in");
  });
});

describe("what code keeps of the reply", () => {
  const b = ids();
  const run = (reply: unknown, raw: Record<string, unknown>) => proposeEdit("p", "n1", raw, async () => JSON.stringify(reply), load);

  it("a rewrite of the chosen passage is proposed with its old words, and applies cleanly (Tutor and Editor apart: nothing is changed by proposing)", async () => {
    const out = await run({ summary: "Clearer.", changes: [{ op: "replace", blocks: [b["pick the unv"]], text: "Pick the unvisited node with the **smallest tentative distance**, then relax its edges.", why: "Clearer" }] },
      { kind: "rewrite", selection: "pick the unvisited node with smallest distance" });
    expect(out.ok).toBe(true)
    if (!out.ok) return;
    expect(out.changes).toHaveLength(1);
    expect(out.changes[0]).toMatchObject({ op: "replace", before: "pick the unvisited node with smallest distance then relax edges", section: "Dijkstra's Algorithm" });
    expect(out.large).toBe(false);
    const applied = applyEdits(BODY, out.changes);
    expect(applied.ok && applied.body).toBe(BODY.replace("pick the unvisited node with smallest distance then relax edges", "Pick the unvisited node with the **smallest tentative distance**, then relax its edges."));
  });

  it("with a passage chosen, a change anywhere else is dropped and said", async () => {
    const out = await run({ summary: "x", changes: [
      { op: "replace", blocks: [b["pick the unv"]], text: "Better words here.", why: "" },
      { op: "replace", blocks: [b["## Bellman-F"]], text: "## Bellman–Ford", why: "" },
    ] }, { kind: "rewrite", selection: "pick the unvisited node" });
    expect(out.ok && out.changes.map(c => c.before)).toEqual(["pick the unvisited node with smallest distance then relax edges"]);
    expect(out.ok && out.dropped).toContain("a change outside the passage you chose");
  });

  it("rewording never deletes; removing repetition may, and the removed words are in the proposal", async () => {
    const dupe = noteBlocks(BODY).filter(x => x.text === "Relaxes every edge V-1 times.").at(-1)!.id;
    const reworded = await run({ summary: "x", changes: [{ op: "delete", blocks: [dupe], why: "repeat" }] }, { kind: "grammar" });
    expect(reworded.ok).toBe(false);
    const deduped = await run({ summary: "x", changes: [{ op: "delete", blocks: [dupe], why: "repeat" }] }, { kind: "dedupe" });
    expect(deduped.ok && deduped.changes[0]).toMatchObject({ op: "delete", before: "Relaxes every edge V-1 times.", after: "" });
  });

  it("refuses blocks that aren't the note's, blocks out of order, and the same passage twice", async () => {
    const out = await run({ summary: "x", changes: [
      { op: "replace", blocks: ["b99"], text: "x", why: "" },
      { op: "replace", blocks: [b["## Bellman-F"], b["pick the unv"]], text: "x", why: "" },
      { op: "insert", after: "b42", text: "y", why: "" },
      { op: "insert", after: b["pick the unv"], text: "Why it is greedy: the closest node is final.", why: "" },
      { op: "insert", after: b["pick the unv"], text: "Why it is greedy: the closest node is final.", why: "" },
    ] }, { kind: "custom", instruction: "Add why it is greedy" });
    expect(out.ok && out.changes.map(c => c.op)).toEqual(["insert", "insert"]);
    expect(out.ok && out.dropped).toEqual(expect.arrayContaining(["a change to text that isn't one passage of the note", "an addition at a place that isn't in the note"]));
  });

  it("an addition the note already has is not proposed", () => {
    const m = markedNote(BODY, null);
    const r = readEditReply(JSON.stringify({ summary: "x", changes: [{ op: "insert", after: "start", text: "Relaxes every edge V-1 times.", why: "" }] }),
      { kind: "summary", instruction: null, selection: null, material: null, noteVersion: null }, BODY, m.blocks, null);
    expect(r).toBeNull();
  });

  it("a rewrite of most of the note is flagged as large", async () => {
    const all = noteBlocks(BODY).map(x => x.id);
    const out = await run({ summary: "x", changes: [{ op: "replace", blocks: all, text: "# Graphs\n\nAll new.", why: "" }] }, { kind: "structure" });
    expect(out.ok && out.large).toBe(true);
  });

  it("a question instead of changes is passed on, with nothing to apply", async () => {
    const out = await run({ summary: "", question: "Under which heading should the new section go?", changes: [] }, { kind: "custom", instruction: "add a section on A*" });
    expect(out.ok && out.question).toBe("Under which heading should the new section go?");
    expect(out.ok && out.changes).toEqual([]);
  });

  it("a model failure or an unreadable reply changes nothing and says so", async () => {
    expect((await proposeEdit("p", "n1", { kind: "grammar" }, async () => { throw new Error("down") }, load)).ok).toBe(false);
    expect((await proposeEdit("p", "n1", { kind: "grammar" }, async () => "not json", load)).ok).toBe(false);
    expect((await proposeEdit("p", "missing", { kind: "grammar" }, async () => "{}", async () => null))).toMatchObject({ ok: false, error: "not_found" });
  });
});
