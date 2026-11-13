// The words of a reply as it is written: display only, and never trusted.
import { liveStrings, liveText, TUTOR_LIVE_KEYS, COPILOT_LIVE_KEYS } from "../product/reply-stream";
import { hasSelection, selectionSection, appendToBody } from "../product/note-capture";
import { notePath, NOTE_BODY_MAX } from "../product/notes.types";

describe("reading an unfinished reply", () => {
  it("takes the readable fields, in order, wherever they are", () => {
    const raw = '{"sections":[{"basis":"notes","heading":"H","text":"First part."},{"basis":"nova","text":"Second."}],"exercise":{"question":"Why?","answer":"secret"}}';
    expect(liveStrings(raw, TUTOR_LIVE_KEYS)).toEqual(["First part.", "Second.", "Why?"]);
  });
  it("shows a string still being written, at every point it could stop, and never a key or another field", () => {
    const whole = '{"intent":"ask","reply":"Say \\"hi\\"\\nnow é","question":null,"choices":["a"]}';
    for (let at = 0; at <= whole.length; at++) {
      const text = liveText(whole.slice(0, at), COPILOT_LIVE_KEYS);
      expect('Say "hi"\nnow é'.startsWith(text)).toBe(true);
    }
    expect(liveText(whole, COPILOT_LIVE_KEYS)).toBe('Say "hi"\nnow é');
  });
  it("gives nothing for a reply that hasn't reached the words, or isn't JSON", () => {
    expect(liveText('{"intent":"pro', COPILOT_LIVE_KEYS)).toBe("");
    expect(liveText("Sorry, I can't", COPILOT_LIVE_KEYS)).toBe("");
    expect(liveText("", COPILOT_LIVE_KEYS)).toBe("");
  });
  it("leaves out citations, and waits for one cut in half", () => {
    expect(liveText('{"text":"It holds [S1] here [S2', TUTOR_LIVE_KEYS)).toBe("It holds here ");
    expect(liveText('{"text":"An array [Size] stays', TUTOR_LIVE_KEYS)).toBe("An array [Size] stays");
  });
});

describe("a passage as a section of a note", () => {
  const section = selectionSection({ title: "Attention explained", url: "https://ex.com/a", text: "Self-attention relates positions.\n\nSecond line.", day: "2026-11-01", via: "extension" });
  it("says what it is, quotes the passage and keeps where it came from", () => {
    expect(section).toContain("### Attention explained\n[View source](https://ex.com/a) · ex.com");
    expect(section).toContain("> Self-attention relates positions.\n>\n> Second line.");
    // The address once, behind words: never the raw address as text.
    expect(section.split("https://ex.com/a").length - 1).toBe(1);
    expect(section).toContain("*Captured 2026-11-01 with the Nova extension.*");
  });
  it("does not become the note's own source", () => {
    for (const line of section.split("\n")) expect(line.toLowerCase().startsWith("source:")).toBe(false);
    for (const line of section.split("\n")) expect(line.startsWith("**Source:**")).toBe(false);
  });
  it("is recognised in the note, so the same passage isn't added twice", () => {
    const next = appendToBody("# Mine\n\nOriginal.", section, "2026-11-01")!;
    expect(next.startsWith("# Mine\n\nOriginal.")).toBe(true);
    expect(hasSelection(next, "Self-attention relates positions.\n\nSecond line.")).toBe(true);
    expect(hasSelection(next, "Another passage.")).toBe(false);
  });
  it("copes with a page with no title or address", () => {
    const bare = selectionSection({ title: "", url: null, text: "Text.", day: "2026-11-01", via: "paste" });
    expect(bare).toContain("### Excerpt\n");
    expect(bare).not.toContain("View source");
  });
  it("names a note's place by its subjects and topic", () => {
    const subjects = [{ id: "a", name: "ML", parentId: null }, { id: "b", name: "Deep", parentId: "a" }];
    expect(notePath("b", "Attention", subjects)).toBe("ML › Deep › Attention");
    expect(notePath(null, null, subjects)).toBe("");
    expect(notePath("x", "T", [{ id: "x", name: "Loop", parentId: "x" }])).toBe("Loop › T");
  });
  it("a note can hold a long book", () => { expect(NOTE_BODY_MAX).toBeGreaterThanOrEqual(1_000_000); });
});
