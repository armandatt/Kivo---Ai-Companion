import {
  alreadyIn, applyEdits, draftMarkdown, draftTitle, joinsDraft, linkTarget, mergeIntoBody, parseCapture, parseEdits, readItems, sourceGroups,
  DRAFT_ITEMS_MAX, SESSION_GAP_MS, type CaptureItem,
} from "../product/capture-draft-rules";

const item = (over: Partial<CaptureItem>): CaptureItem => ({
  id: over.id ?? Math.random().toString(36).slice(2), key: null, url: "https://arxiv.org/abs/1706.03762", title: "Attention Is All You Need",
  site: "arxiv.org", text: "Attention is all you need.", context: null, note: "", capturedAt: "2026-11-13T10:00:00.000Z", ...over,
});

describe("parseCapture", () => {
  it("keeps a passage with its page, the address normalised", () => {
    const r = parseCapture({ url: "https://www.example.com/a?utm_source=x#frag", title: "  A   page ", text: "Line one\r\nLine two  ", key: "k".repeat(16) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input.url).toBe("https://www.example.com/a?utm_source=x");
    expect(r.input.site).toBe("example.com");
    expect(r.input.title).toBe("A page");
    expect(r.input.text).toBe("Line one\nLine two");
    expect(r.input.fresh).toBe(false);
  });
  it("asks for nothing to file: no subject, topic or note is read", () => {
    const r = parseCapture({ url: "https://example.com", text: "x", subjectId: "s1", topicName: "t" });
    expect(r.ok && Object.keys(r.input).sort()).toEqual(["context", "fresh", "key", "note", "site", "text", "title", "url"]);
  });
  it("refuses an address that is not an ordinary web page, and an empty capture", () => {
    expect(parseCapture({ url: "javascript:alert(1)", text: "x" }).ok).toBe(false);
    const empty = parseCapture({ text: "   " });
    expect(!empty.ok && empty.refusal.error).toBe("empty");
  });
  it("refuses a passage longer than a draft keeps", () => {
    const r = parseCapture({ url: "https://example.com", text: "x".repeat(9000) });
    expect(!r.ok && r.refusal.error).toBe("too_long");
  });
});

describe("which draft", () => {
  const now = new Date("2026-11-13T12:00:00Z");
  it("joins the same reading session", () => {
    expect(joinsDraft({ lastCaptureAt: new Date(now.getTime() - SESSION_GAP_MS + 1000), passages: 3 }, now)).toBe(true);
  });
  it("starts a new one once the session has moved on, or the draft is full", () => {
    expect(joinsDraft({ lastCaptureAt: new Date(now.getTime() - SESSION_GAP_MS - 1000), passages: 3 }, now)).toBe(false);
    expect(joinsDraft({ lastCaptureAt: now, passages: DRAFT_ITEMS_MAX }, now)).toBe(false);
  });
  it("knows a retry and the same passage again", () => {
    const items = [item({ id: "a", key: "key-aaaaaaaa" })];
    expect(alreadyIn(items, { url: null, text: "other", key: "key-aaaaaaaa" })?.id).toBe("a");
    expect(alreadyIn(items, { url: items[0]!.url, text: items[0]!.text, key: null })?.id).toBe("a");
    expect(alreadyIn(items, { url: "https://other.org/", text: items[0]!.text, key: null })).toBeNull();
  });
});

describe("sources", () => {
  it("groups passages by page, in the order pages first appear, each passage keeping its own source", () => {
    const items = [
      item({ id: "1" }),
      item({ id: "2", url: "https://example.com/b", title: "B", site: "example.com", text: "b1" }),
      item({ id: "3", text: "second from arxiv" }),
    ];
    const groups = sourceGroups(items);
    expect(groups.map(g => g.items.map(i => i.id))).toEqual([["1", "3"], ["2"]]);
    expect(draftTitle(null, items)).toBe("Attention Is All You Need and 1 more");
    expect(draftTitle("Mine", items)).toBe("Mine");
  });

  it("names each source once, as a compact link, never the raw address after each passage", () => {
    const text = draftMarkdown([item({ id: "1", text: "first" }), item({ id: "2", text: "second", note: "My thought." })]);
    expect(text).toBe([
      "## Attention Is All You Need",
      "[View source](https://arxiv.org/abs/1706.03762) · arxiv.org",
      "",
      "> first",
      "",
      "> second",
      "",
      "My thought.",
    ].join("\n"));
    expect(text.split("https://arxiv.org").length - 1).toBe(1);
  });

  it("encodes brackets in an address so the link stays whole", () => {
    expect(linkTarget("https://en.wikipedia.org/wiki/Mercury_(planet)")).toBe("https://en.wikipedia.org/wiki/Mercury_%28planet%29");
  });
});

describe("mergeIntoBody", () => {
  it("adds at the end under a divider, never changing what is there", () => {
    const plan = mergeIntoBody("# My note\n\nMine.", [item({ text: "new" })], "2026-11-13")!;
    expect(plan.body.startsWith("# My note\n\nMine.\n\n---\n\n*Added 2026-11-13*\n\n### Attention Is All You Need")).toBe(true);
    expect(plan.joined).toEqual([]);
  });

  it("joins passages to a section that already cites the page, with no second heading", () => {
    const existing = [
      "### Attention Is All You Need",
      "[View source](https://arxiv.org/abs/1706.03762) · arxiv.org",
      "",
      "> old passage",
      "",
      "## Later section",
      "Other text.",
    ].join("\n");
    const plan = mergeIntoBody(existing, [item({ text: "new passage" })], "2026-11-13")!;
    expect(plan.body).toBe([
      "### Attention Is All You Need",
      "[View source](https://arxiv.org/abs/1706.03762) · arxiv.org",
      "",
      "> old passage",
      "",
      "> new passage",
      "",
      "## Later section",
      "Other text.",
    ].join("\n"));
    expect(plan.joined).toEqual(["Attention Is All You Need"]);
    expect(plan.added).toBe("");
  });

  it("refuses what a note cannot hold", () => {
    expect(mergeIntoBody("x".repeat(999_990), [item({ text: "a long enough passage" })], "2026-11-13")).toBeNull();
  });
});

describe("edits", () => {
  const items = [item({ id: "a", text: "A" }), item({ id: "b", text: "B" }), item({ id: "c", text: "C" })];
  it("edits, annotates, reorders and removes, in order", () => {
    const edits = parseEdits([
      { op: "edit", id: "a", text: "A2", note: "why" },
      { op: "move", id: "c", to: 0 },
      { op: "remove", id: "b" },
      { op: "rename", title: "  Reading on attention " },
    ])!;
    const next = applyEdits({ title: null, items }, edits);
    expect(next.items.map(i => [i.id, i.text, i.note])).toEqual([["c", "C", ""], ["a", "A2", "why"]]);
    expect(next.title).toBe("Reading on attention");
  });
  it("skips a passage removed elsewhere, and refuses what is not an edit", () => {
    expect(applyEdits({ title: null, items }, [{ op: "remove", id: "zz" }]).items).toHaveLength(3);
    expect(parseEdits([{ op: "explode", id: "a" }])).toBeNull();
    expect(parseEdits([])).toBeNull();
  });
  it("reads stored items defensively", () => {
    expect(readItems([{ id: "x", capturedAt: "t", text: 5 }, "junk", null])).toEqual([
      { id: "x", key: null, url: null, title: "", site: null, text: "", context: null, note: "", capturedAt: "t" },
    ]);
  });
});
