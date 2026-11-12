// Screenshots in notes, the tutor and the editor (12 Nov). The images are
// stored on the note and named by id; these tests check what reaches the
// model (real image content in the provider's format), that a follow-up and
// a missing image are handled, and that no edit removes an image from a note.
// The database and the model are stubs; the real store is nova-note-images.itest.ts.

import { buildClaudeRequest } from "../../services/llmProviders";
import { imageRefsIn, readImageIds, NOTE_IMAGE_BYTES_MAX } from "../product/note-images";
import { proposeEdit } from "../product/note-edit";
import { imageLine } from "../product/note-image-prompt";
import type { NoteSources } from "../product/notes";
import { readFileSync } from "node:fs";
import { join } from "node:path";

jest.mock("@repo/db/client", () => ({ prisma: {} }));
jest.mock("../../services/openai.service", () => ({ generateOpenAIText: jest.fn() }));
const { tutorOnNote } = require("../product/note-tutor") as typeof import("../product/note-tutor");

const A = "cimgaaaaaaaa01", B = "cimgbbbbbbbb02", C = "cimgcccccccc03", OTHER = "cimgzzzzzzzz99";
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex").toString("base64");
const BODY = ["# Graphs", "", "Dijkstra picks the closest node.", "", `![Slide 4](kivo-image:${A})`, "", "Bellman-Ford relaxes every edge."].join("\n");
const note = (body = BODY): NoteSources => ({ note: { id: "n1", title: "Graphs", body, subjectId: null, subjectName: null, topicName: null, updatedAt: "v1", bodyLength: body.length }, related: [] } as unknown as NoteSources);
// The store, as noteImagesForModel answers: only ids it has, for this learner and note.
const store = (have: string[]) => jest.fn(async (_p: string, _n: string, ids: string[]) => ({
  images: ids.filter(id => have.includes(id)).map((id, i) => ({ id, name: `image I${i + 1}`, mimeType: "image/png", data: PNG })),
  missing: ids.filter(id => !have.includes(id)),
}));
type Req = { prompt: string; attachments?: Array<{ name: string; mimeType: string; data: string }> };

describe("image references", () => {
  it("are read from a note's text, each once, and from a request only as valid ids", () => {
    expect(imageRefsIn(`${BODY}\n![again](kivo-image:${A})\n![b](kivo-image:${B})`)).toEqual([A, B]);
    expect(readImageIds([A, A, "../etc/passwd", 42, B, C, OTHER, "cimgddddddd04"])).toEqual([A, B, C, OTHER]);
  });
  it("the browser's size limit is the server's", () => {
    const web = readFileSync(join(__dirname, "../../../../../apps/web/components/nova/notes/note-image-upload.ts"), "utf8");
    expect(web).toContain(`export const NOTE_IMAGE_BYTES_MAX = ${NOTE_IMAGE_BYTES_MAX.toLocaleString("en-US").split(",").join("_")}`);
  });
});

describe("the tutor sees the screenshots", () => {
  it("text and several images in one request reach the model as image attachments, and Claude gets image blocks", async () => {
    let seen: Req | null = null;
    const generate = jest.fn(async (r: Req) => { seen = r; return JSON.stringify({ sections: [{ basis: "nova", heading: null, text: "The slide shows a graph." }] }); });
    const out = await tutorOnNote("p1", "n1", { mode: "explain", message: "what do these show?", images: [B, C] }, generate as never, jest.fn().mockResolvedValue(note()), jest.fn().mockResolvedValue([]), { loadImages: store([B, C]) });
    expect(out.ok).toBe(true);
    expect(seen!.attachments!.map(a => [a.name, a.mimeType])).toEqual([["image I1", "image/png"], ["image I2", "image/png"]]);
    expect(seen!.prompt).toContain("I1, I2 came with this message");
    const claude = buildClaudeRequest(seen! as never, "claude-haiku-5-5", "low") as unknown as { messages: Array<{ content: Array<{ type: string; source?: { type: string; media_type: string; data: string } }> }> };
    const blocks = claude.messages[0]!.content;
    expect(blocks.filter(b => b.type === "image").map(b => [b.source!.type, b.source!.media_type, b.source!.data])).toEqual([["base64", "image/png", PNG], ["base64", "image/png", PNG]]);
  });

  it("a follow-up sends the earlier images again, labelled as earlier", async () => {
    let seen: Req | null = null;
    await tutorOnNote("p1", "n1", { mode: "explain", message: "and the second one?", earlierImages: [B, C] }, (async (r: Req) => { seen = r; return JSON.stringify({ sections: [] }); }) as never, jest.fn().mockResolvedValue(note()), jest.fn().mockResolvedValue([]), { loadImages: store([B, C]) });
    expect(seen!.attachments).toHaveLength(2);
    expect(seen!.prompt).toContain("I1, I2 were attached earlier in this conversation");
  });

  it("an image that is gone (removed, or not this learner's) is left out and said, never an error", async () => {
    let seen: Req | null = null;
    const loader = store([B]);
    const out = await tutorOnNote("p1", "n1", { mode: "explain", message: "explain", images: [OTHER, B] }, (async (r: Req) => { seen = r; return JSON.stringify({ sections: [{ basis: "nova", heading: null, text: "x" }] }); }) as never, jest.fn().mockResolvedValue(note()), jest.fn().mockResolvedValue([]), { loadImages: loader });
    expect(out.ok).toBe(true);
    expect(loader).toHaveBeenCalledWith("p1", "n1", [OTHER, B]);
    expect(seen!.attachments).toHaveLength(1);
    expect(seen!.prompt).toContain("One image attached in this conversation is no longer available");
  });

  it("at most four images, the new ones first", () => {
    expect(imageLine(4, 1)).toContain("I1 came with this message; I2, I3, I4 were attached earlier");
  });
});

describe("the editor works with images and never loses one", () => {
  const blocks = (body: string) => require("../product/note-outline").noteBlocks(body) as Array<{ id: string; text: string }>;
  const idOf = (body: string, start: string) => blocks(body).find(b => b.text.startsWith(start))!.id;

  it("an attached screenshot reaches the model, and its line may be put into the note", async () => {
    let seen: Req | null = null;
    const out = await proposeEdit("p1", "n1", { kind: "custom", instruction: "add what this slide says under Bellman-Ford", images: [B] }, (async (r: Req) => {
      seen = r;
      return JSON.stringify({ summary: "Added the slide.", changes: [{ op: "insert", after: idOf(BODY, "Bellman-Ford"), text: `The slide compares both algorithms.\n\n![Slide 7](kivo-image:${B})`, why: "" }] });
    }) as never, async () => note(), { loadImages: store([B]) });
    expect(seen!.attachments).toHaveLength(1);
    expect(seen!.prompt).toContain(`I1 = ![caption](kivo-image:${B})`);
    expect(out.ok && out.changes[0]!.after).toContain(`kivo-image:${B}`);
  });

  it("a change that would drop an image line is refused, with the reason", async () => {
    const out = await proposeEdit("p1", "n1", { kind: "custom", instruction: "tidy this section" }, async () => JSON.stringify({ summary: "x", changes: [
      { op: "replace", blocks: [idOf(BODY, "Dijkstra"), idOf(BODY, "![Slide")], text: "Dijkstra greedily picks the nearest unvisited node.", why: "" },
    ] }), async () => note());
    expect(out).toMatchObject({ ok: false, error: "nothing_usable" });
    if (!out.ok) expect(out.message).toContain("would remove an image");
  });

  it("a deletion of an image line is refused too; a rewrite that keeps the line goes through", async () => {
    const del = await proposeEdit("p1", "n1", { kind: "dedupe" }, async () => JSON.stringify({ summary: "x", changes: [{ op: "delete", blocks: [idOf(BODY, "![Slide")], why: "" }] }), async () => note());
    expect(del.ok).toBe(false);
    const keep = await proposeEdit("p1", "n1", { kind: "structure" }, async () => JSON.stringify({ summary: "x", changes: [
      { op: "replace", blocks: [idOf(BODY, "Dijkstra"), idOf(BODY, "![Slide")], text: `## Dijkstra\nDijkstra picks the closest node.\n\n![Slide 4](kivo-image:${A})`, why: "" },
    ] }), async () => note());
    expect(keep.ok && keep.changes).toHaveLength(1);
  });

  it("an image id that is neither in the note nor attached is refused", async () => {
    const out = await proposeEdit("p1", "n1", { kind: "custom", instruction: "add a diagram" }, async () => JSON.stringify({ summary: "x", changes: [
      { op: "insert", after: idOf(BODY, "Bellman-Ford"), text: `![Made up](kivo-image:${OTHER})`, why: "" },
    ] }), async () => note());
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.message).toContain("an image that isn't in your note");
  });

  it("ten edits in a row leave every image in the note", async () => {
    const { applyEdits } = require("../product/note-outline") as typeof import("../product/note-outline");
    let body = BODY;
    for (let i = 1; i <= 10; i++) {
      const out = await proposeEdit("p1", "n1", { kind: "custom", instruction: `edit ${i}` }, async () => JSON.stringify({ summary: "x", changes: [
        // The model tries, every other time, to rewrite across the image.
        i % 2 ? { op: "replace", blocks: [idOf(body, "Dijkstra"), idOf(body, "![Slide")], text: `Dijkstra, version ${i}.`, why: "" }
              : { op: "insert", after: idOf(body, "Bellman-Ford"), text: `Point ${i} about Bellman-Ford and negative edges.`, why: "" },
      ] }), async () => note(body));
      if (out.ok) { const r = applyEdits(body, out.changes); if (r.ok) body = r.body; }
    }
    expect(imageRefsIn(body)).toEqual([A]);
    expect(body).toContain(`![Slide 4](kivo-image:${A})`);
    for (const i of [2, 4, 6, 8, 10]) expect(body).toContain(`Point ${i} about Bellman-Ford`);
  });

  it("an image inside the passage chosen goes to the model too", async () => {
    let seen: Req | null = null;
    await proposeEdit("p1", "n1", { kind: "custom", instruction: "explain this diagram in the note", selection: `![Slide 4](kivo-image:${A})` }, (async (r: Req) => { seen = r; return "{}"; }) as never, async () => note(), { loadImages: store([A]) });
    expect(seen!.attachments).toHaveLength(1);
  });
});
