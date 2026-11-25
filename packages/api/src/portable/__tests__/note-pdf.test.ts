import { readBlocks, readInline, renderNotePdf } from "../note-pdf";
import { png, webp } from "./fixtures";

const latin1 = (b: Uint8Array) => Buffer.from(b).toString("latin1");
const base = { subjectName: "Algorithms", topicName: "DP", exportedBy: "Asha", exportedAt: new Date("2026-11-25T00:00:00Z"), updatedAt: null };

describe("a note as a PDF", () => {
  it("reads the note's marks into blocks", () => {
    const b = readBlocks("# Title\nPara line one\nline two\n\n- a\n  - b\n1. c\n- [x] done\n\n> [!idea] Big idea\n> body\n\n```\ncode\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n![cap](kivo-image:img1)\n[f.pdf](kivo-file:file1)\n---\n$$\nx^2\n$$");
    expect(b.map(x => x.kind)).toEqual(["heading", "para", "list", "quote", "code", "table", "image", "file", "rule", "math"]);
    expect(b[1]).toEqual({ kind: "para", text: "Para line one line two" });
    expect((b[2] as { items: unknown[] }).items).toEqual([
      { depth: 0, marker: "•", check: null, text: "a" }, { depth: 1, marker: "•", check: null, text: "b" },
      { depth: 0, marker: "1.", check: null, text: "c" }, { depth: 0, marker: "•", check: true, text: "done" },
    ]);
    expect(b[3]).toEqual({ kind: "quote", label: "Idea: Big idea", lines: ["body"] });
    expect(b[5]).toEqual({ kind: "table", head: ["A", "B"], rows: [["1", "2"]] });
  });

  it("only web addresses become links; everything else stays text", () => {
    expect(readInline("see [docs](https://example.com/a) and [bad](javascript:alert(1)) and [[Other note|that]] at https://x.org/y.")).toEqual([
      { kind: "text", text: "see " }, { kind: "link", text: "docs", href: "https://example.com/a" },
      { kind: "text", text: " and [bad](javascript:alert(1)) and that at " }, { kind: "link", text: "https://x.org/y", href: "https://x.org/y" }, { kind: "text", text: "." },
    ]);
    expect(readInline("**b** *i* `c` ==h== $x$").filter(r => r.kind !== "text").map(r => r.kind)).toEqual(["bold", "italic", "code", "highlight", "math"]);
  });

  it("makes a real PDF: clickable links, drawn images, page numbers, attachments listed, nothing fetched", async () => {
    const body = ["# Notes", "Read [the paper](https://example.com/paper) first.", "![Figure 1](kivo-image:img1)", "![A webp](kivo-image:w1)", "![Remote](https://evil.example/x.png)", "[Slides.pdf](kivo-file:f1)",
      ...Array.from({ length: 160 }, (_, i) => `Line ${i} of a long note that needs more than one page to print.`)].join("\n\n");
    const out = await renderNotePdf({ ...base, title: "Long note", body,
      images: [{ id: "img1", mimeType: "image/png", bytes: png(200, 120) }, { id: "w1", mimeType: "image/webp", bytes: webp() }],
      files: [{ id: "f1", fileName: "Slides.pdf", bytes: 1_234_567 }, { id: "f2", fileName: "Extra.pdf", bytes: 2_000 }] });
    const raw = latin1(out.bytes);
    expect(raw.startsWith("%PDF-")).toBe(true);
    expect(raw.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(out.pages).toBeGreaterThan(1);
    expect((raw.match(/\/Type \/Page\b/g) ?? []).length).toBe(out.pages);
    expect(raw).toContain("/URI (https://example.com/paper)");
    // An image from another site is never fetched or drawn: as in Kivo's own view, its words are a link.
    expect(raw).toContain("/URI (https://evil.example/x.png)");
    expect(out.imagesDrawn).toBe(1);
    expect(out.imagesNamed).toBe(1);                              // the WebP: named, kept in the .kivo
    expect(out.filesListed).toBe(2);                              // the named file and the one only kept with the note
    expect((raw.match(/\/Subtype \/Image/g) ?? []).length).toBe(1);
  });

  it("draws characters its font lacks as stand-ins and says so", async () => {
    const out = await renderNotePdf({ ...base, title: "Hinglish", body: "Fees ₹500 ✓ नमस्ते", images: [], files: [] });
    expect(out.substituted).toBeGreaterThan(0);
  });
});
