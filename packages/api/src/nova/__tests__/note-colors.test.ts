// Colour in a note (note-colors.ts) and Nova's editor keeping it (12 Nov).
import { colorSpanAt, formattingMarks, NOTE_COLORS } from "../product/note-colors";
import { proposeEdit } from "../product/note-edit";
import { applyEdits, noteBlocks } from "../product/note-outline";
import type { NoteSources } from "../product/notes";

jest.mock("@repo/db/client", () => ({ prisma: {} }));
jest.mock("../../services/openai.service", () => ({ generateOpenAIText: jest.fn() }));

const BODY = ["# Caching", "", "A [cache hit]{.teal} avoids the ==slow disk== read.", "", "Eviction: [LRU]{.hl-amber} is the default.", "", "Plain closing line about TTLs."].join("\n");
const note = (body: string): NoteSources => ({ note: { id: "n1", title: "Caching", body, subjectId: null, subjectName: null, topicName: null, updatedAt: "v1", bodyLength: body.length }, related: [] } as unknown as NoteSources);
const id = (body: string, start: string) => noteBlocks(body).find(b => b.text.startsWith(start))!.id;

describe("the marks", () => {
  it("a span names one of the palette's colours, as text or highlight", () => {
    expect(colorSpanAt("[cache hit]{.teal}", 0)).toEqual({ words: "cache hit", color: "teal", highlight: false, end: 18 });
    expect(colorSpanAt("[LRU]{.hl-amber}", 0)).toMatchObject({ color: "amber", highlight: true });
    expect(colorSpanAt("[x]{.purple}", 0)).toBeNull();
    expect(colorSpanAt("[[Link]]{.teal}", 0)).toBeNull();
    expect(colorSpanAt("[]{.teal}", 0)).toBeNull();
    expect(NOTE_COLORS).toHaveLength(7);
  });
  it("are counted", () => {
    expect(formattingMarks(BODY)).toBe(3);
    expect(formattingMarks("no marks, a == b, and [brackets] here")).toBe(0);
  });
});

describe("Nova's editor keeps the learner's colours", () => {
  it("is told the syntax and the palette", async () => {
    let prompt = "";
    await proposeEdit("p", "n1", { kind: "grammar" }, (async (r: { systemInstruction: string }) => { prompt = r.systemInstruction; return "{}"; }) as never, async () => note(BODY));
    expect(prompt).toContain("[words]{.blue}");
    expect(prompt).toContain("accent, blue, teal, amber, green, red, muted");
  });

  it("a rewrite that drops all the colouring is refused, with the reason", async () => {
    const out = await proposeEdit("p", "n1", { kind: "rewrite" }, async () => JSON.stringify({ summary: "x", changes: [{ op: "replace", blocks: [id(BODY, "A [cache")], text: "A cache hit avoids the slow disk read entirely.", why: "" }] }), async () => note(BODY));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.message).toContain("would remove your colours or highlights");
  });

  it("a rewrite that keeps the colours goes through; one that adds colour where none was is allowed", async () => {
    const out = await proposeEdit("p", "n1", { kind: "rewrite" }, async () => JSON.stringify({ summary: "x", changes: [
      { op: "replace", blocks: [id(BODY, "A [cache")], text: "A [cache hit]{.teal} skips the ==slow disk== read entirely.", why: "" },
      { op: "replace", blocks: [id(BODY, "Plain closing")], text: "Plain closing line about [TTLs]{.blue}.", why: "" },
    ] }), async () => note(BODY));
    expect(out.ok && out.changes).toHaveLength(2);
  });

  it("ten edits in a row, saved and read back each time, leave every colour where it was", async () => {
    let body = BODY;
    for (let i = 1; i <= 10; i++) {
      const out = await proposeEdit("p", "n1", { kind: "custom", instruction: `edit ${i}` }, async () => JSON.stringify({ summary: "x", changes: [
        // Every other time the model "forgets" the marks.
        i % 2 ? { op: "replace", blocks: [id(body, "A ")], text: `A cache hit avoids a disk read (${i}).`, why: "" }
              : { op: "insert", after: id(body, "Plain closing"), text: `Point ${i}: [expiry]{.amber} matters for TTLs.`, why: "" },
      ] }), async () => note(body));
      if (out.ok) { const r = applyEdits(body, out.changes); if (r.ok) body = r.body; }
    }
    expect(body).toContain("[cache hit]{.teal}");
    expect(body).toContain("==slow disk==");
    expect(body).toContain("[LRU]{.hl-amber}");
    expect(formattingMarks(body)).toBe(3 + 5);
  });
});
