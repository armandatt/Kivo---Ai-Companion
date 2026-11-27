// Bug batch 28 Nov, item 6: exact find/replace for Kivo Connect's update_note.
jest.mock("@repo/db/client", () => ({ prisma: {} }));
import { applyExactEdits } from "../product/note-versions";

describe("REGRESSION item 6: applyExactEdits", () => {
  it("replaces a passage found exactly once", () => {
    expect(applyExactEdits("a b c", [{ find: "b", replace: "B" }])).toEqual({ ok: true, body: "a B c" });
  });
  it("refuses a missing passage and a repeated one, naming the edit", () => {
    expect(applyExactEdits("a b c", [{ find: "z", replace: "" }])).toEqual({ ok: false, index: 0, reason: "missing", count: 0 });
    expect(applyExactEdits("a b b", [{ find: "a", replace: "A" }, { find: "b", replace: "B" }])).toEqual({ ok: false, index: 1, reason: "ambiguous", count: 2 });
  });
  it("applies edits in order, each on the text as it then stands", () => {
    expect(applyExactEdits("one two", [{ find: "one", replace: "three" }, { find: "three two", replace: "done" }])).toEqual({ ok: true, body: "done" });
  });
  it("is exact: case and spacing matter", () => {
    expect(applyExactEdits("Phase One", [{ find: "phase one", replace: "x" }]).ok).toBe(false);
  });
});
