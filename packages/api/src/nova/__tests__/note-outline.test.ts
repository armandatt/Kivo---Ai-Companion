// A note's structure (note-outline.ts): blocks and references that survive
// edits or say they don't, where an addition goes (Examples A to E of the
// Notes spec), and edits applied only where their words still are.

import {
  alreadyIn, applyEdits, fingerprint, insertAt, noteBlocks, noteSections, placementFor, refOf, resolvePlacement, resolveRef, type EditChange,
} from "../product/note-outline";

const DIJKSTRA = [
  "# Graphs",
  "",
  "Notes on shortest paths.",
  "",
  "## BFS",
  "",
  "Breadth-first search visits nodes level by level.",
  "",
  "## Dijkstra's Algorithm",
  "",
  "Pick the unvisited node with the smallest tentative distance, then relax its edges.",
  "",
  "- Works with non-negative weights",
  "- Uses a priority queue",
  "",
  "```python",
  "heapq.heappush(q, (0, src))",
  "",
  "```",
  "",
  "## Bellman-Ford",
  "",
  "Relaxes every edge V-1 times.",
].join("\n");

const FASTAPI = [
  "# FastAPI",
  "",
  "## Routing",
  "Path operations map URLs to functions.",
  "",
  "## Dependency Injection",
  "Depends() declares what a path operation needs.",
  "",
  "### Example",
  "A database session per request.",
  "",
  "## Middleware",
  "Code that runs around every request.",
].join("\n");

describe("blocks", () => {
  it("reads headings, paragraphs, lists and code as blocks with their exact ranges and heading", () => {
    const blocks = noteBlocks(DIJKSTRA);
    expect(blocks.map(b => b.kind)).toEqual(["heading", "para", "heading", "para", "heading", "para", "list", "code", "heading", "para"]);
    for (const b of blocks) expect(DIJKSTRA.slice(b.start, b.end)).toBe(b.text);
    const code = blocks.find(b => b.kind === "code")!;
    // A blank line inside code stays inside it.
    expect(code.text).toContain("heapq");
    expect(code.text.endsWith("```")).toBe(true);
    expect(blocks.find(b => b.text.startsWith("Pick"))!.heading).toBe("Dijkstra's Algorithm");
  });
  it("sections know their own text and everything under them", () => {
    const s = noteSections(FASTAPI);
    const di = s.find(x => x.title === "Dependency Injection")!;
    expect(FASTAPI.slice(di.start, di.ownEnd)).toBe("## Dependency Injection\nDepends() declares what a path operation needs.");
    expect(FASTAPI.slice(di.start, di.end).endsWith("A database session per request.")).toBe(true);
    expect(s.find(x => x.title === "Example")!.parent).toBe(di.id);
  });
});

describe("references", () => {
  const pick = noteBlocks(DIJKSTRA).find(b => b.text.startsWith("Pick"))!;
  const ref = refOf(pick);
  it("say where the passage is and what it is under", () => {
    expect(ref.heading).toBe("Dijkstra's Algorithm");
    expect(ref.excerpt.startsWith("pick the unvisited node")).toBe(true);
    expect(resolveRef(DIJKSTRA, ref)).toMatchObject({ status: "exact", start: pick.start, end: pick.end });
  });
  it("follow the same words when text above them changes", () => {
    const edited = DIJKSTRA.replace("Notes on shortest paths.", "Notes on shortest paths, with a lot more written here first.");
    const found = resolveRef(edited, ref);
    expect(found.status).toBe("moved");
    expect(found.status !== "stale" && edited.slice(found.start, found.end)).toBe(pick.text);
  });
  it("are stale when the passage itself changed or was deleted, and never point at other text", () => {
    expect(resolveRef(DIJKSTRA.replace("smallest tentative", "largest"), ref).status).toBe("stale");
    expect(resolveRef(DIJKSTRA.replace(pick.text, ""), ref).status).toBe("stale");
    // The same words twice: which one is meant can't be known.
    expect(resolveRef(`${DIJKSTRA}\n\n${pick.text}\n\n${pick.text}`.replace(pick.text, "x"), ref).status).toBe("stale");
  });
});

describe("where an addition goes", () => {
  const place = (body: string, hint: Parameters<typeof placementFor>[1], md = "> [!note] Nova\n> Added.") => {
    const { best, clear } = placementFor(body, hint);
    const at = resolvePlacement(body, best);
    return { best, clear, at, out: at === null ? null : insertAt(body, at, md, best.heading).body };
  };
  it("A: an explanation of a section's idea goes in that section, not at the end", () => {
    const pick = noteBlocks(DIJKSTRA).find(b => b.text.startsWith("Pick"))!;
    const r = place(DIJKSTRA, { kind: "explanation", refs: [refOf(pick)] }, "Why greedy works: the smallest distance is final.")
    expect(r.best.label).toBe("Add under: Dijkstra's Algorithm");
    expect(r.out!.indexOf("Why greedy works")).toBeGreaterThan(r.out!.indexOf("heapq"));
    expect(r.out!.indexOf("Why greedy works")).toBeLessThan(r.out!.indexOf("## Bellman-Ford"));
    // Everything else as it was.
    expect(r.out!.replace("Why greedy works: the smallest distance is final.\n\n", "")).toBe(DIJKSTRA);
  });
  it("B: a subsection on Dependency Injection goes under it, after what is already there", () => {
    const r = place(FASTAPI, { kind: "subsection", heading: "dependency injection" }, "### Scopes\nPer request or per app.");
    expect(r.best.label).toBe("Add under: Dependency Injection");
    expect(r.out!.indexOf("### Scopes")).toBeGreaterThan(r.out!.indexOf("A database session"));
    expect(r.out!.indexOf("### Scopes")).toBeLessThan(r.out!.indexOf("## Middleware"));
  });
  it("C: a summary goes in the summary section, or a new one at the start of the note", () => {
    const r = place(FASTAPI, { kind: "summary" }, "- FastAPI maps paths to functions.");
    expect(r.best.how).toBe("newSection");
    expect(r.best.label).toBe("New section: Summary, at the start of FastAPI");
    expect(r.out!.startsWith("# FastAPI\n\n## Summary\n\n- FastAPI maps paths")).toBe(true);
    const withOne = `${FASTAPI}\n\n## Key takeaways\nTo fill in.`;
    expect(place(withOne, { kind: "summary" }).best.label).toBe("Add under: Key takeaways");
  });
  it("D: an example goes under the section's Example subsection when it has one", () => {
    const dep = noteBlocks(FASTAPI).find(b => b.text.startsWith("Depends"))!;
    const r = place(FASTAPI, { kind: "example", refs: [refOf(dep)] }, "Another: an auth user.");
    expect(r.best.label).toBe("Add under: Example");
    expect(r.out!.indexOf("Another: an auth user.")).toBeGreaterThan(r.out!.indexOf("A database session"));
  });
  it("E: something the note doesn't cover is offered as a new section, and Nova asks which place", () => {
    const r = place(FASTAPI, { kind: "other", title: "Kubernetes" });
    expect(r.clear).toBe(false);
    expect(r.best.label).toBe("New section: Kubernetes, at the end");
    const { options } = placementFor(FASTAPI, { kind: "other" });
    expect(options.map(o => o.label)).toContain("Add under: Middleware");
    expect(options.map(o => o.label)).toContain("At the end of the note");
  });
  it("after the passage the learner chose, in its section", () => {
    const at = FASTAPI.indexOf("Path operations");
    const r = place(FASTAPI, { kind: "explanation", passage: at }, "More on paths.");
    expect(r.best.label).toBe("Insert after the passage you chose, in Routing");
    expect(r.out!.indexOf("More on paths.")).toBe(r.out!.indexOf("Path operations map URLs to functions.") + "Path operations map URLs to functions.\n\n".length);
  });
  it("a note with no headings: the end, and only then", () => {
    expect(placementFor("Just a thought.", { kind: "explanation" }).best.how).toBe("end");
  });
  it("is found again after edits elsewhere, and refused when its section is gone", () => {
    const { best } = placementFor(FASTAPI, { kind: "subsection", heading: "Middleware" });
    const edited = `Intro line.\n\n${FASTAPI}`;
    expect(edited.slice(resolvePlacement(edited, best)!).startsWith("")).toBe(true);
    expect(resolvePlacement(edited, best)).toBe(edited.length);
    expect(resolvePlacement(FASTAPI.replace("## Middleware", "## Interceptors"), best)).toBeNull();
  });
  it("knows when the note already has it", () => {
    expect(alreadyIn(FASTAPI, "Depends() declares what a path operation needs.")).toBe(true);
    expect(alreadyIn(FASTAPI, "Something entirely new about async routes.")).toBe(false);
  });
});

describe("edits are applied only where their words still are", () => {
  const blocks = noteBlocks(FASTAPI);
  const dep = blocks.find(b => b.text.startsWith("Depends"))!;
  const mid = blocks.find(b => b.text.startsWith("Code that"))!;
  const change = (over: Partial<EditChange>): EditChange => ({ id: "e1", op: "replace", start: dep.start, end: dep.end, before: dep.text, after: "Depends() declares, per path operation, what it needs.", anchor: null, section: "Dependency Injection", why: null, ...over });

  it("replaces one passage and leaves the rest exactly as it was", () => {
    const r = applyEdits(FASTAPI, [change({})]);
    expect(r.ok && r.body).toBe(FASTAPI.replace(dep.text, "Depends() declares, per path operation, what it needs."));
  });
  it("finds the passage again when text above it changed, and refuses when the passage itself changed", () => {
    const shifted = `A new first line.\n\n${FASTAPI}`;
    const r = applyEdits(shifted, [change({})]);
    expect(r.ok && r.body.includes("per path operation")).toBe(true);
    expect(applyEdits(FASTAPI.replace("declares what", "says what"), [change({})])).toEqual({ ok: false, conflicts: ["e1"] });
  });
  it("applies several at once, or none when one no longer fits (nothing half done)", () => {
    const ins: EditChange = { id: "e2", op: "insert", start: mid.end, end: mid.end, before: "", after: "It can also time requests.", anchor: fingerprint(mid.text), section: "Middleware", why: null };
    const both = applyEdits(FASTAPI, [change({}), ins]);
    expect(both.ok && both.body.endsWith("Code that runs around every request.\n\nIt can also time requests.\n")).toBe(true);
    const gone = FASTAPI.replace("Code that runs around every request.", "Something else.");
    expect(applyEdits(gone, [change({}), ins])).toEqual({ ok: false, conflicts: ["e2"] });
  });
  it("a deletion takes out only its passage and the gap around it", () => {
    const r = applyEdits(FASTAPI, [change({ op: "delete", after: "" })]);
    expect(r.ok && r.body).toBe(FASTAPI.replace("\nDepends() declares what a path operation needs.\n", "\n"));
  });
  it("two changes to the same words are refused", () => {
    expect(applyEdits(FASTAPI, [change({}), change({ id: "e2" })]).ok).toBe(false);
  });
});

describe("an apply sent twice changes the note once", () => {
  const blocks = noteBlocks(FASTAPI);
  const dep = blocks.find(b => b.text.startsWith("Depends"))!;
  const mid = blocks.find(b => b.text.startsWith("Code that"))!;
  const expand: EditChange = { id: "e1", op: "replace", start: dep.start, end: dep.end, before: dep.text, after: `${dep.text} It is resolved once per request and can depend on other dependencies.`, anchor: null, section: "Dependency Injection", why: null };
  const ins: EditChange = { id: "e2", op: "insert", start: mid.end, end: mid.end, before: "", after: "Middleware can also time every request it wraps.", anchor: fingerprint(mid.text), section: "Middleware", why: null };

  it("an expansion that keeps its sentence, and an addition, applied again: nothing more is changed, and both are said to be in already", () => {
    const once = applyEdits(FASTAPI, [expand, ins]);
    if (!once.ok) throw new Error("refused");
    expect(once.applied).toEqual(["e1", "e2"]);
    const twice = applyEdits(once.body, [expand, ins]);
    expect(twice).toEqual({ ok: true, body: once.body, applied: [], already: ["e1", "e2"] });
  });
  it("a deletion whose words are gone is in already; a replacement whose words the learner changed is still refused", () => {
    const gone = FASTAPI.replace(`${dep.text}\n`, "");
    expect(applyEdits(gone, [{ ...expand, op: "delete", after: "" }])).toMatchObject({ ok: true, applied: [], already: ["e1"] });
    expect(applyEdits(FASTAPI.replace("declares what", "says what"), [expand])).toEqual({ ok: false, conflicts: ["e1"] });
  });
});
