// Links between notes are the text the learner wrote: [[Title]] or
// [[Title|shown words]]. Nothing infers one and nothing is stored apart
// from the body.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { linkContext, linkedTitles, linkKey, linksTo, tokenizeLine } from "../product/note-links";
import { parseNoteInput } from "../product/notes";

jest.mock("@repo/db/client", () => ({ prisma: {} }));

describe("[[links]] in a note", () => {
  it("reads a link, a link with its own words, and plain text around them", () => {
    expect(tokenizeLine("See [[Deadlocks]] and [[Paging basics|the paging note]].")).toEqual([
      { kind: "text", text: "See " },
      { kind: "link", text: "Deadlocks", target: "Deadlocks" },
      { kind: "text", text: " and " },
      { kind: "link", text: "the paging note", target: "Paging basics" },
      { kind: "text", text: "." },
    ]);
  });

  it("leaves what is not a link as text: unclosed, empty, nested or too long", () => {
    for (const line of ["[[Deadlocks", "[[]]", "[[ ]]", `[[${"x".repeat(201)}]]`, "[single]"]) {
      expect(tokenizeLine(line).every(t => t.kind === "text")).toBe(true);
    }
    // An unclosed "[[" before a real link is text; the link after it is a link.
    expect(tokenizeLine("[[a [[b]]")).toEqual([{ kind: "text", text: "[[a " }, { kind: "link", text: "b", target: "b" }]);
  });

  it("lists each linked title once, in order, any case and spacing, and not inside code", () => {
    const body = "[[Deadlocks]] then [[deadlocks]] then [[  Banker's   algorithm ]]\n```\n[[Not a link]]\n```\n[[Paging]]";
    expect(linkedTitles(body)).toEqual(["Deadlocks", "Banker's algorithm", "Paging"]);
    expect(linksTo(body, "DEADLOCKS")).toBe(true);
    expect(linksTo(body, "Not a link")).toBe(false);
    expect(linkKey("  Banker's   Algorithm ")).toBe("banker's algorithm");
  });

  it("gives the line a backlink sits on", () => {
    expect(linkContext("Intro\nThe four conditions are in [[Deadlocks]].\nEnd", "deadlocks")).toBe("The four conditions are in [[Deadlocks]].");
    expect(linkContext("No link here", "Deadlocks")).toBe("");
  });

  it("is pure: no imports and no pattern matching on the learner's text", () => {
    const src = readFileSync(join(__dirname, "..", "product", "note-links.ts"), "utf8");
    expect(src).not.toMatch(/^import /m);
    expect(src).not.toMatch(/new RegExp|\.test\(|\.match\(/);
  });
});

describe("a save from a tab that opened an older version", () => {
  it("carries the version it opened, and refuses one it cannot read", () => {
    const ok = parseNoteInput({ body: "x", baseUpdatedAt: "2026-10-14T10:00:00.000Z" }, false);
    expect(ok.ok && ok.changes.baseUpdatedAt?.toISOString()).toBe("2026-10-14T10:00:00.000Z");
    expect(parseNoteInput({ body: "x", baseUpdatedAt: "yesterday" }, false).ok).toBe(false);
    const none = parseNoteInput({ body: "x" }, false);
    expect(none.ok && none.changes.baseUpdatedAt).toBeUndefined();
  });

  it("the update is conditional on that version, and a refused one returns the note as it stands", () => {
    const src = readFileSync(join(__dirname, "..", "product", "notes.ts"), "utf8");
    expect(src).toContain("where: { id: noteId, profileId, ...(changes.baseUpdatedAt ? { updatedAt: changes.baseUpdatedAt } : {}) }");
    expect(src).toContain('error: "conflict"');
  });
});
