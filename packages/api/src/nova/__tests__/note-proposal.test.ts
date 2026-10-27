// Nova's editor starting a note, PDF highlights and images in notes: the pure
// rules. Nothing here reaches a database or a model.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { destinationChoices, parseProposalRequest, proposeNewNote, proposalPrompt, readProposalReply } from "../product/note-proposal";
import { documentKey, parseHighlight } from "../product/pdf-highlights";
import { imageInfo } from "../product/note-images";
import type { NoteSubjectOption } from "../product/notes.types";

jest.mock("../../services/openai.service", () => ({ generateOpenAIText: jest.fn() }));

const SUBJECTS: NoteSubjectOption[] = [
  { id: "sem5", name: "Semester Five", topics: [], parentId: null, topicParents: {} },
  { id: "ml", name: "Machine Learning", topics: ["Neural networks", "Backpropagation", "Regularisation"], parentId: "sem5", topicParents: { Backpropagation: "Neural networks", "Neural networks": null, Regularisation: null } },
  { id: "os", name: "Operating Systems", topics: ["Deadlocks"], parentId: "sem5", topicParents: { Deadlocks: null } },
];
const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000280000001e00806000000", "hex");
const pdf = (text = "%PDF-1.4\n1 0 obj << /Type /Page >> endobj\n%%EOF") => ({ name: "lecture6.pdf", data: Buffer.from(text).toString("base64") });

function ask(raw: unknown) {
  const p = parseProposalRequest(raw);
  if (!p.ok) throw new Error(p.refusal.message);
  return p.request;
}

describe("Nova's editor starting a note", () => {
  it("needs something to start from, and checks files by their bytes", () => {
    expect(parseProposalRequest({}).ok).toBe(false);
    expect(parseProposalRequest({ title: "Backprop" }).ok).toBe(true);
    const fake = parseProposalRequest({ files: [{ name: "x.pdf", data: Buffer.from("not a pdf").toString("base64") }] });
    expect(fake.ok === false && fake.refusal.error).toBe("unsupported");
    expect(ask({ files: [pdf()] }).files[0]!.mimeType).toBe("application/pdf");
  });

  it("shows the model the learner's own subjects and topics by reference, the closest first, with their paths", () => {
    const choices = destinationChoices(SUBJECTS, "backpropagation lecture");
    expect(choices[0]!.d.path).toEqual(["Semester Five", "Machine Learning", "Neural networks", "Backpropagation"]);
    const prompt = proposalPrompt(ask({ title: "Lecture 6" }), choices);
    expect(prompt).toContain("d1 (topic): Semester Five > Machine Learning > Neural networks > Backpropagation");
    expect(prompt).not.toContain("No subject");
  });

  const reply = (o: object) => JSON.stringify({ title: "Backpropagation, lecture 6", outline: "## The chain rule\n*What it says*\n\n## Worked example", destination: null, files: [], ...o });

  it("files it only under a reference it was given; anything else is dropped, never made", () => {
    const request = ask({ title: "Lecture 6" });
    const choices = destinationChoices(SUBJECTS, "backpropagation");
    const ref = choices.find(c => c.d.topicName === "Backpropagation")!.ref;
    const ok = readProposalReply(reply({ destination: ref, destinationReason: "It is the lecture's topic." }), request, choices, SUBJECTS)!;
    expect(ok.destination).toEqual({ subjectId: "ml", topicName: "Backpropagation", path: ["Semester Five", "Machine Learning", "Neural networks", "Backpropagation"], reason: "It is the lecture's topic." });
    expect(readProposalReply(reply({ destination: "d999" }), request, choices, SUBJECTS)!.destination).toBeNull();
    expect(readProposalReply(reply({ destination: "Machine Learning" }), request, choices, SUBJECTS)!.destination).toBeNull();
  });

  it("a new topic is only a suggestion under one of their subjects; a name they already have is that topic", () => {
    const request = ask({ title: "Dropout" });
    const choices = destinationChoices(SUBJECTS, "dropout");
    const ml = choices.find(c => c.d.kind === "subject" && c.d.subjectId === "ml")!.ref;
    const p = readProposalReply(reply({ newTopic: { under: ml, name: "Dropout", reason: "Not in your map yet." } }), request, choices, SUBJECTS)!;
    expect(p.newTopic).toEqual({ subjectId: "ml", path: ["Semester Five", "Machine Learning"], name: "Dropout", reason: "Not in your map yet." });
    expect(p.destination).toBeNull();
    const known = readProposalReply(reply({ newTopic: { under: ml, name: "regularisation", reason: "x" } }), request, choices, SUBJECTS)!;
    expect(known.newTopic).toBeNull();
    expect(known.destination?.topicName).toBe("Regularisation");
    const topicRef = choices.find(c => c.d.kind === "topic")!.ref;
    expect(readProposalReply(reply({ newTopic: { under: topicRef, name: "X", reason: "" } }), request, choices, SUBJECTS)!.newTopic).toBeNull();
  });

  it("says a file was read only when the model said so, and names every file given", () => {
    const request = ask({ files: [pdf()] });
    const silent = readProposalReply(reply({ files: [] }), request, [], SUBJECTS)!;
    expect(silent.files).toEqual([{ name: "lecture6.pdf", read: false, note: "Nova didn't say it read this file." }]);
    const read = readProposalReply(reply({ files: [{ name: "lecture6.pdf", read: true, note: "Used the slide headings." }] }), request, [], SUBJECTS)!;
    expect(read.files[0]).toEqual({ name: "lecture6.pdf", read: true, note: "Used the slide headings." });
  });

  it("keeps an outline only with headings, never lets it set the note's Source, and needs JSON", () => {
    const request = ask({ title: "Lecture 6" });
    expect(readProposalReply(reply({ outline: "Just some prose." }), request, [], SUBJECTS)).toBeNull();
    expect(readProposalReply("Here is your outline: ## A", request, [], SUBJECTS)).toBeNull();
    const p = readProposalReply(reply({ outline: "## Paper\nSource: https://evil.example\n\n![x](kivo-image:abcdefgh12)" }), request, [], SUBJECTS)!;
    expect(p.outline).not.toMatch(/^source:/im);
    expect(p.outline).toContain("From: https://evil.example");
    expect(p.outline).not.toContain("kivo-image:");
  });

  it("asks once, with the files as attachments, and stores nothing", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const generate = async (req: Record<string, unknown>) => { calls.push(req); return reply({}); };
    const r = await proposeNewNote("p1", { intent: "for the midterm", files: [pdf()] }, { generate: generate as never, subjects: SUBJECTS });
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect((calls[0]!.attachments as unknown[]).length).toBe(1);
    expect(calls[0]!.json).toBe(true);
    const failing = await proposeNewNote("p1", { title: "x" }, { generate: (async () => { throw new Error("down"); }) as never, subjects: SUBJECTS });
    expect(failing.ok === false && failing.error).toBe("unavailable");
    const src = readFileSync(join(__dirname, "../product/note-proposal.ts"), "utf8");
    expect(src).not.toMatch(/prisma|createNote|updateNote/);
  });
});

describe("Highlights on a PDF", () => {
  const ok = { docUrl: "https://arxiv.org/pdf/1706.03762#page=3", page: 3, rects: [{ x: 0.1, y: 0.2, w: 0.5, h: 0.02 }], text: "  a   passage ", clientKey: "hl:1234abcd" };

  it("names the document by its address without the page fragment or credentials", () => {
    expect(documentKey("https://user:pw@arxiv.org/pdf/1706.03762#page=3")).toBe("https://arxiv.org/pdf/1706.03762");
    expect(documentKey("javascript:alert(1)")).toBeNull();
    expect(documentKey("file:///etc/passwd")).toBeNull();
  });

  it("keeps a place on the page as fractions inside it, and nothing outside", () => {
    const p = parseHighlight(ok);
    expect(p.ok && p.input).toEqual({ docUrl: "https://arxiv.org/pdf/1706.03762", page: 3, rects: ok.rects, text: "a passage", color: "yellow", clientKey: "hl:1234abcd" });
    expect(parseHighlight({ ...ok, rects: [{ x: 1.2, y: 0, w: 0.1, h: 0.1 }] }).ok).toBe(false);
    expect(parseHighlight({ ...ok, rects: [] }).ok).toBe(false);
    expect(parseHighlight({ ...ok, page: 0 }).ok).toBe(false);
    expect(parseHighlight({ ...ok, clientKey: "x" }).ok).toBe(false);
    expect(parseHighlight({ ...ok, color: "red" }).ok && (parseHighlight({ ...ok, color: "red" }) as { input: { color: string } }).input.color).toBe("yellow");
  });
});

describe("Images in a note", () => {
  it("reads the type and size from the bytes, never from the name", () => {
    expect(imageInfo(PNG)).toEqual({ type: "image/png", width: 640, height: 480 });
    const jpeg = Buffer.from("ffd8ffe000104a46494600010100000100010000ffc00011080064012c03012200021101031101", "hex");
    expect(imageInfo(jpeg)).toEqual({ type: "image/jpeg", width: 300, height: 100 });
    expect(imageInfo(Buffer.from("<svg onload=alert(1)></svg>"))).toBeNull();
    expect(imageInfo(Buffer.from("%PDF-1.4"))).toBeNull();
  });

  it("checks a note is the learner's through the notes module, and touches no note itself", () => {
    const src = readFileSync(join(__dirname, "../product/note-images.ts"), "utf8");
    expect(src).toMatch(/import \{ ownsNote \} from "\.\/notes"/);
    expect(src).not.toMatch(/prisma\.novaNote\./);
    expect(src).toMatch(/findFirst\(\{ where: \{ id, profileId \}/);
  });
});
