// Research papers in notes: what a pasted link names (paper-source.ts), how
// a paper sits in a note (its card, the paper's own text, "My notes"), and
// that additions and Nova's edits never land in the paper's text. Pure.

import { identifyPaper, paperCardMarkdown, paperKey, paperNoteBody, paperPlacement, paperRegion, readArxivId, readDoi, readPaperCard, type PaperCard } from "../product/paper-source";
import { noteBlocks, placementFor, resolvePlacement } from "../product/note-outline";
import { readEditReply, paperScope, parseEditRequest } from "../product/note-edit";

jest.mock("../../services/openai.service", () => ({ generateOpenAIText: jest.fn() }));

const id = (s: string) => { const r = identifyPaper(s); if (!r.ok) throw new Error(r.message); return r.paper; };

describe("what a link names", () => {
  it("arXiv: abstract, PDF (with a version and .pdf), HTML, export, old-style ids, a bare id", () => {
    for (const u of ["https://arxiv.org/abs/1706.03762", "https://arxiv.org/pdf/1706.03762v7", "https://arxiv.org/pdf/1706.03762.pdf", "http://export.arxiv.org/abs/1706.03762", "https://arxiv.org/html/1706.03762v7/", "arXiv:1706.03762", "1706.03762"]) {
      expect(id(u)).toEqual({ kind: "arxiv", id: "1706.03762", url: "https://arxiv.org/abs/1706.03762" });
    }
    expect(id("https://arxiv.org/abs/hep-th/9901001").id).toBe("hep-th/9901001");
    expect(readArxivId("2301.012345")).toBeNull();
  });

  it("DOIs: doi.org, doi:, a publisher page with the DOI in its path, and an arXiv DOI read as arXiv", () => {
    expect(id("https://doi.org/10.1038/s41586-021-03819-2")).toMatchObject({ kind: "doi", id: "10.1038/s41586-021-03819-2" });
    expect(id("doi:10.1145/3292500.3330701")).toMatchObject({ kind: "doi", id: "10.1145/3292500.3330701" });
    expect(id("https://dl.acm.org/doi/pdf/10.1145/3292500.3330701")).toMatchObject({ kind: "doi", id: "10.1145/3292500.3330701" });
    expect(id("https://onlinelibrary.wiley.com/doi/full/10.1002/anie.201915678")).toMatchObject({ kind: "doi", id: "10.1002/anie.201915678" });
    expect(id("https://www.nature.com/articles/nature14539")).toMatchObject({ kind: "doi", id: "10.1038/nature14539" });
    expect(id("https://doi.org/10.48550/arXiv.1706.03762")).toMatchObject({ kind: "arxiv", id: "1706.03762" });
    expect(readDoi("10.1000/xyz.")).toBe("10.1000/xyz");
    expect(readDoi("11.1000/xyz")).toBeNull();
  });

  it("Semantic Scholar, OpenReview, PubMed, PubMed Central and Europe PMC", () => {
    expect(id("https://www.semanticscholar.org/paper/Attention-is-All-you-Need-Vaswani-Shazeer/204e3073870fae3d05bcbc2f6a8e263d9b72e776")).toMatchObject({ kind: "semantic_scholar", id: "204e3073870fae3d05bcbc2f6a8e263d9b72e776" });
    expect(id("https://openreview.net/forum?id=YicbFdNTTy")).toMatchObject({ kind: "openreview", id: "YicbFdNTTy" });
    expect(id("https://openreview.net/pdf?id=YicbFdNTTy")).toMatchObject({ kind: "openreview", id: "YicbFdNTTy" });
    expect(id("https://pubmed.ncbi.nlm.nih.gov/33116299/")).toMatchObject({ kind: "pubmed", id: "33116299" });
    expect(id("https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7613000/")).toMatchObject({ kind: "pmc", id: "PMC7613000" });
    expect(id("https://pmc.ncbi.nlm.nih.gov/articles/PMC7613000/")).toMatchObject({ kind: "pmc", id: "PMC7613000" });
    expect(id("https://europepmc.org/article/MED/33116299")).toMatchObject({ kind: "pubmed", id: "33116299" });
  });

  it("a direct PDF and another page, over https only; private and malformed addresses refused", () => {
    expect(id("https://example.org/papers/attention.pdf")).toMatchObject({ kind: "pdf" });
    expect(id("https://proceedings.mlr.press/v139/radford21a.html")).toMatchObject({ kind: "page" });
    for (const [u, reason] of [["", "empty"], ["not a link", "not_a_link"], ["ftp://x.org/a.pdf", "not_https"], ["http://example.org/a.pdf", "not_https"],
      ["https://localhost/a.pdf", "private"], ["https://127.0.0.1/a.pdf", "private"], ["https://intranet/a.pdf", "private"], ["https://user:pw@example.org/a.pdf", "not_a_link"]] as const) {
      const r = identifyPaper(u);
      expect(r.ok ? null : r.reason).toBe(reason);
    }
  });

  it("one paper, one key, however it was reached", () => {
    expect(paperKey({ arxivId: "1706.03762", doi: "10.48550/x", url: "u" })).toBe("arxiv:1706.03762");
    expect(paperKey({ doi: "10.1038/ABC", url: "u" })).toBe("doi:10.1038/abc");
    expect(paperKey({ pmid: "1", pmcid: "pmc7", url: "u" })).toBe("pmc:PMC7");
    expect(paperKey({ url: "https://x.org/a.pdf" })).toBe("url:https://x.org/a.pdf");
  });
});

const CARD: PaperCard = {
  title: "Attention Is All You Need", authors: ["Ashish Vaswani", "Noam Shazeer"], published: "2017-06-12", venue: "NeurIPS 2017",
  arxivId: "1706.03762", doi: null, pmid: null, pmcid: null, openreviewId: null, sourceUrl: "https://arxiv.org/abs/1706.03762",
  pdfUrl: "https://arxiv.org/pdf/1706.03762", status: "full", from: "arXiv's HTML version", importedOn: "2026-10-27", key: "arxiv:1706.03762",
};
const PAPER = paperNoteBody(CARD, "The dominant sequence transduction models…", "## 1 Introduction\n\nRecurrent networks…\n\n## 3 Model Architecture\n\nThe Transformer…\n\n$$\nQK^T\n$$ (1)");

describe("a paper in a note", () => {
  it("the card says what the paper is, where it came from and how much was imported, and reads back the same", () => {
    expect(paperCardMarkdown(CARD)).toContain("> **Imported:** full text · from arXiv's HTML version · 2026-10-27");
    expect(readPaperCard(PAPER)?.card).toEqual(CARD);
    expect(readPaperCard("# Just a note\n\ntext")).toBeNull();
  });

  it("the paper's text runs from the card to \"My notes\"; without that heading, to the end", () => {
    const r = paperRegion(PAPER)!;
    expect(PAPER.slice(r.start, r.end)).toContain("The Transformer");
    expect(PAPER.slice(r.notesAt!)).toBe("## My notes\n");
    const noHeading = PAPER.replace("## My notes", "");
    expect(paperRegion(noHeading)).toMatchObject({ end: noHeading.length, notesAt: null });
  });

  it("an addition that would go under one of the paper's sections goes to the same place in My notes, and the paper's places are not offered", () => {
    const placed = paperPlacement(PAPER, placementFor(PAPER, { kind: "explanation", heading: "3 Model Architecture" }));
    expect(placed.best).toMatchObject({ how: "newSection", heading: "### 3 Model Architecture", label: "New subsection in My notes: 3 Model Architecture" });
    expect(resolvePlacement(PAPER, placed.best)).toBe(PAPER.trimEnd().length);
    const region = paperRegion(PAPER)!;
    for (const o of placed.options) expect(resolvePlacement(PAPER, o)! >= region.end).toBe(true);
    // A subsection that is there already is used, not made twice.
    const withSub = `${PAPER}\n### 3 Model Architecture\n\nMy take.\n`;
    expect(paperPlacement(withSub, placementFor(withSub, { kind: "explanation", heading: "3 Model Architecture" })).best).toMatchObject({ how: "section", label: "Add under: My notes › 3 Model Architecture" });
  });

  it("Nova's editor drops any change to the paper's own text and keeps additions under My notes", () => {
    const blocks = noteBlocks(PAPER);
    const scope = paperScope(PAPER, blocks)!;
    const intro = blocks.find(b => b.text.startsWith("Recurrent"))!;
    const mine = blocks.find(b => b.text === "## My notes")!;
    expect(scope.sourceBlocks).toContain(intro.id);
    expect(scope.notesBlock).toBe(mine.id);
    const parsed = parseEditRequest({ kind: "custom", instruction: "clean it up and add notes" });
    if (!parsed.ok) throw new Error("refused");
    const reply = JSON.stringify({ summary: "s", changes: [
      { op: "replace", blocks: [intro.id], text: "RNNs are slow.", why: "shorter" },
      { op: "insert", after: intro.id, text: "An aside inside the paper", why: "x" },
      { op: "insert", after: mine.id, text: "### 1 Introduction\n\n- RNNs process tokens one at a time.", why: "notes" },
    ] });
    const read = readEditReply(reply, parsed.request, PAPER, blocks, null, new Set(scope.sourceBlocks))!;
    expect(read.changes.map(c => c.op)).toEqual(["insert"]);
    expect(read.changes[0]!.after).toContain("RNNs process tokens");
    expect(read.dropped).toEqual(["a change to the imported paper's own text (Nova doesn't rewrite the source)", "an addition inside the imported paper's text (your notes go under My notes)"]);
  });
});
