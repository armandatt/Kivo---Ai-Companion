// Nova as an editor of a note (note-edit.ts): what may be asked, what the
// model is given, and what code keeps of its reply. No database and no
// model: both are stubs. Applying what the learner approves is
// note-outline.test.ts.

import { EDIT_NOTE_WINDOW, editPrompt, parseEditRequest, proposeEdit, readEditReply } from "../product/note-edit";
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
      { kind: "summary", instruction: null, selection: null, material: null, noteVersion: null, history: [], answering: null }, BODY, m.blocks, null);
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

// ── Many iterations, failures and recovery (12 Nov) ──────────────────────────
// Reported: the editor degraded after five or six edits and answered "Can't
// help you with this. Can you say it another way?" to API failures. Each test
// plays the page's part: the saved note is the source of truth, a proposal is
// applied with applyEdits and saved, and the next request reads the note again.

type Req = { prompt: string; deadlineMs?: number; json?: boolean };
const timeout = () => Object.assign(new Error("Request timed out."), { name: "APIConnectionTimeoutError" });
const rateLimited = () => Object.assign(new Error("429 rate limited"), { status: 429 });
const truncated = () => new Error("Claude: the reply was cut off at its length limit (model: m)");

// A saved note that changes as edits are applied, with a new version each save.
function store(initial: string) {
  let body = initial, saves = 0;
  return {
    get body() { return body; },
    load: async () => note(body) && ({ ...note(body), note: { ...note(body).note, updatedAt: `v${saves}` } } as unknown as NoteSources),
    save(next: string) { body = next; saves++; },
  };
}
const lastBlock = (body: string) => noteBlocks(body).at(-1)!.id;
// BODY repeats its last line on purpose (dedupe); an insert anchored there is ambiguous.
const PLAIN = BODY.slice(0, BODY.lastIndexOf("\n\nRelaxes every edge"));

describe("fifteen edits in a row", () => {
  it("each request reads the latest saved note and the conversation so far, and every applied change is in the final note", async () => {
    const s = store(PLAIN);
    const history: Array<{ asked: string; outcome: "applied"; said: string }> = [];
    for (let i = 1; i <= 15; i++) {
      let seen = "";
      const generate = async (r: Req) => {
        seen = r.prompt;
        return JSON.stringify({ summary: `Added point ${i}.`, question: null, need: null, changes: [{ op: "insert", after: lastBlock(s.body), text: `- Point ${i}: detail ${i}.`, why: "asked" }] });
      };
      const out = await proposeEdit("p", "n1", { kind: "custom", instruction: `add point ${i} at the end`, history }, generate as never, s.load);
      if (!out.ok) throw new Error(`iteration ${i}: ${out.message}`);
      // The latest saved text, not an older copy: the previous point is in what the model read.
      if (i > 1) expect(seen).toContain(`Point ${i - 1}: detail ${i - 1}.`);
      // Earlier requests travel with it (the last ten), each marked as applied.
      if (i > 1) expect(seen).toContain(`The learner asked: add point ${i - 1} at the end`);
      if (i > 1) expect(seen).toContain("applied (already in the note)");
      const applied = applyEdits(s.body, out.changes);
      if (!applied.ok) throw new Error(`iteration ${i} did not apply`);
      s.save(applied.body);
      history.push({ asked: `add point ${i} at the end`, outcome: "applied", said: `Added point ${i}.` });
    }
    for (let i = 1; i <= 15; i++) expect(s.body).toContain(`- Point ${i}: detail ${i}.`);
    // In order, each once.
    const at = Array.from({ length: 15 }, (_, k) => s.body.indexOf(`Point ${k + 1}:`));
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    for (let i = 1; i <= 15; i++) expect(s.body.split(`- Point ${i}: `).length).toBe(2);
  });

  it("a request that refers to an earlier one is sent with it, and the same section can be changed again", async () => {
    const s = store(BODY);
    const block = () => noteBlocks(s.body).find(b => b.text.startsWith("pick the") || b.text.startsWith("Pick"))!.id;
    const texts = ["Pick the unvisited node with the smallest distance, then relax its edges.", "Pick the closest unvisited node; relax its edges.", "Pick the closest unvisited node (a priority queue does this); relax its edges."];
    const history: Array<{ asked: string; outcome: "applied"; said: string }> = [];
    for (const [k, text] of texts.entries()) {
      let seen = "";
      const out = await proposeEdit("p", "n1", { kind: "custom", instruction: k === 0 ? "rewrite the Dijkstra line clearly" : "make it shorter, like before", history }, (async (r: Req) => { seen = r.prompt; return JSON.stringify({ summary: "Reworded.", changes: [{ op: "replace", blocks: [block()], text, why: "" }] }); }) as never, s.load);
      if (!out.ok) throw new Error(out.message);
      if (k > 0) expect(seen).toContain("rewrite the Dijkstra line clearly");
      const applied = applyEdits(s.body, out.changes);
      if (!applied.ok) throw new Error("did not apply");
      s.save(applied.body);
      history.push({ asked: k === 0 ? "rewrite the Dijkstra line clearly" : "make it shorter, like before", outcome: "applied", said: "Reworded." });
    }
    expect(s.body).toContain(texts[2]);
    expect(s.body).not.toContain(texts[0]);
  });

  it("an answer to Nova's question goes back with the question", async () => {
    let seen = "";
    await proposeEdit("p", "n1", { kind: "custom", instruction: "under Bellman-Ford", answering: "Under which heading should the new section go?", history: [{ asked: "add a section on A*", outcome: "question", said: "Under which heading should the new section go?" }] }, (async (r: Req) => { seen = r.prompt; return "{}"; }) as never, load);
    expect(seen).toContain("You asked the learner: Under which heading should the new section go?\nThis message is their answer.");
    expect(seen).toContain("→ you asked: Under which heading");
  });
});

describe("a long note", () => {
  const section = (n: number) => `## Section ${n}\n${`Text of section ${n}. `.repeat(120)}`;
  const LONG = ["# Big note", ...Array.from({ length: 40 }, (_, i) => section(i + 1))].join("\n\n");

  it("is given in part with an outline of every heading; the model can ask for the section it needs, once", async () => {
    expect(LONG.length).toBeGreaterThan(EDIT_NOTE_WINDOW);
    const target = noteBlocks(LONG).find(b => b.text === "## Section 39")!;
    const prompts: string[] = [];
    const generate = async (r: Req) => {
      prompts.push(r.prompt);
      if (prompts.length === 1) return JSON.stringify({ summary: "", question: null, need: target.id, changes: [] });
      const body = noteBlocks(LONG).find(b => b.start > target.start)!;
      return JSON.stringify({ summary: "Added an example.", changes: [{ op: "insert", after: body.id, text: "Example: section 39 in practice.", why: "" }] });
    };
    const out = await proposeEdit("p", "n1", { kind: "custom", instruction: "add an example to section 39" }, generate as never, async () => note(LONG));
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain("OUTLINE of the whole note");
    expect(prompts[0]).toContain(`[${target.id}] ## Section 39 (not given)`);
    expect(prompts[0]).not.toContain("Text of section 39.");
    expect(prompts[1]).toContain("Text of section 39.");
    expect(out.ok && out.changes[0]!.after).toBe("Example: section 39 in practice.");
    // What the model reads stays bounded, whatever the note's length.
    for (const p of prompts) expect(p.length).toBeLessThan(EDIT_NOTE_WINDOW + 6_000);
  });
});

describe("failures say what they are, and change nothing", () => {
  const req = { kind: "grammar" };
  const never = (m: string) => expect(m).not.toMatch(/another way|rephrase|say it differently/i);

  it("a timeout", async () => {
    const out = await proposeEdit("p", "n1", req, async () => { throw timeout(); }, load);
    expect(out).toMatchObject({ ok: false, error: "unavailable", retryable: true });
    if (!out.ok) { expect(out.message).toContain("took too long"); never(out.message); }
  });

  it("a rate limit", async () => {
    const out = await proposeEdit("p", "n1", req, async () => { throw rateLimited(); }, load);
    expect(out).toMatchObject({ ok: false, error: "unavailable", retryable: true });
    if (!out.ok) { expect(out.message).toContain("busy"); never(out.message); }
  });

  it("a missing key is not retryable", async () => {
    const out = await proposeEdit("p", "n1", req, async () => { throw new Error("ANTHROPIC_API_KEY is not set"); }, load);
    expect(out).toMatchObject({ ok: false, error: "unavailable", retryable: false });
  });

  it("a malformed reply is tried once more, and the second answer is used", async () => {
    const b = ids();
    let calls = 0;
    const out = await proposeEdit("p", "n1", req, (async () => (++calls === 1 ? "Sure! {\"summary\": \"x\", \"chan" : JSON.stringify({ summary: "Fixed.", changes: [{ op: "replace", blocks: [b["pick the unv"]], text: "Pick the unvisited node with the smallest distance, then relax its edges.", why: "" }] }))) as never, load);
    expect(calls).toBe(2);
    expect(out.ok && out.changes).toHaveLength(1);
  });

  it("a reply cut off twice is an incomplete answer, not an unclear request", async () => {
    let calls = 0;
    const out = await proposeEdit("p", "n1", req, async () => { calls++; throw truncated(); }, load);
    expect(calls).toBe(2);
    expect(out).toMatchObject({ ok: false, error: "unavailable", retryable: true });
    if (!out.ok) { expect(out.message).toContain("incomplete"); never(out.message); }
  });

  it("every change dropped says why, and nothing is proposed", async () => {
    const out = await proposeEdit("p", "n1", { kind: "custom", instruction: "fix it" }, async () => JSON.stringify({ summary: "x", changes: [{ op: "replace", blocks: ["b99"], text: "y", why: "" }] }), load);
    expect(out).toMatchObject({ ok: false, error: "nothing_usable" });
    if (!out.ok) { expect(out.message).toContain("a change to text that isn't one passage of the note"); never(out.message); }
  });

  it("after a failure the next request works, and the note was never touched", async () => {
    const s = store(BODY);
    await proposeEdit("p", "n1", req, async () => { throw timeout(); }, s.load);
    expect(s.body).toBe(BODY);
    const out = await proposeEdit("p", "n1", { kind: "custom", instruction: "add a line", history: [{ asked: "fix grammar", outcome: "failed" }] }, async () => JSON.stringify({ summary: "Added.", changes: [{ op: "insert", after: lastBlock(BODY), text: "A new line.", why: "" }] }), s.load);
    expect(out.ok).toBe(true);
  });
});

describe("duplicate and concurrent requests", () => {
  it("two identical requests give the same proposal, and applying it twice adds it once", async () => {
    const s = store(PLAIN);
    const reply = async () => JSON.stringify({ summary: "Added.", changes: [{ op: "insert", after: lastBlock(PLAIN), text: "This paragraph is added only once, however often it is applied.", why: "" }] });
    const [a, b] = await Promise.all([proposeEdit("p", "n1", { kind: "custom", instruction: "add" }, reply, s.load), proposeEdit("p", "n1", { kind: "custom", instruction: "add" }, reply, s.load)]);
    if (!a.ok || !b.ok) throw new Error("refused");
    expect(a.changes).toEqual(b.changes);
    const first = applyEdits(s.body, a.changes);
    if (!first.ok) throw new Error("did not apply");
    s.save(first.body);
    const second = applyEdits(s.body, b.changes);
    expect(second.ok && second.already).toEqual([b.changes[0]!.id]);
    expect(s.body.split("This paragraph is added only once").length).toBe(2);
  });

  it("a proposal made on an older version that no longer fits is refused whole by the apply check", async () => {
    const s = store(BODY);
    const b = ids();
    const out = await proposeEdit("p", "n1", { kind: "grammar" }, async () => JSON.stringify({ summary: "x", changes: [{ op: "replace", blocks: [b["pick the unv"]], text: "Pick the unvisited node.", why: "" }] }), s.load);
    if (!out.ok) throw new Error("refused");
    // Someone else rewrote that line meanwhile.
    s.save(BODY.replace("pick the unvisited node with smallest distance then relax edges", "Completely different words now."));
    expect(applyEdits(s.body, out.changes).ok).toBe(false);
  });
});

describe("the learner's language", () => {
  it("a Hinglish learner's editor talks in Hinglish, and text for the note keeps the note's language", async () => {
    let seen = "";
    await proposeEdit("p", "n1", { kind: "grammar" }, (async (r: Req) => { seen = r.prompt; return "{}"; }) as never, load, { language: "hinglish" });
    expect(seen).toContain("LANGUAGE: Hinglish, the learner's chosen language.");
    expect(seen).toContain("keeps the note's own language");
  });
});
