import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { buildPackage, MAP_FORMAT_V1, MAP_FORMAT_V2, validatePackage, type MapPackage } from "../map-package";
import { packArchive, unpackArchive } from "../kivo-archive";
import { missingDetailEdits, rewriteAssetRefs, verifyTasks } from "../import";
import { pdf, png } from "./fixtures";

const PNG = png(30, 20, 5), PDF = pdf("notes");
const attribution = { creator: "Asha", source: null, packageId: null, exportedAt: null };

function full() {
  return buildPackage({
    rootSubjectIds: ["S-alg", "S-os"], format: MAP_FORMAT_V2,
    subjects: [{ id: "S-alg", name: "Algorithms", parentId: null }, { id: "S-dp", name: "DP", parentId: "S-alg" }, { id: "S-os", name: "OS", parentId: null }],
    topics: [
      { id: "T1", subjectId: "S-dp", name: "Knapsack", parentId: null, kind: null, position: 0, archived: false, details: { explanation: "Choose items under a weight limit.", sources: [{ file: "L4.pdf", page: 3 }], junk: "<script>" } },
      { id: "T2", subjectId: "S-dp", name: "0/1 knapsack", parentId: "T1", kind: null, position: 0, archived: false },
      { id: "T3", subjectId: "S-os", name: "Old", parentId: null, kind: null, position: 1, archived: true },
      { id: "T4", subjectId: "S-os", name: "Build a shell", parentId: null, kind: "milestone", position: 0, archived: false, details: { weeks: 2, goals: ["fork/exec"], completion: "Runs ls | wc" } },
    ],
    notes: [
      { id: "N1", title: "Knapsack notes", body: "# Knapsack\n![table](kivo-image:IMG1)\n[L4.pdf](kivo-file:F1)\n", subjectId: "S-dp", topicName: "Knapsack" },
      { id: "N2", title: "Scheduling", body: "Round robin.\n![missing](kivo-image:NOPE)", subjectId: "S-os", topicName: null },
    ],
    images: [{ id: "IMG1", noteId: "N1", mimeType: "image/png", width: 30, height: 20, bytes: PNG, sourceUrl: "https://example.edu/l4.pdf", sourceTitle: "L4", page: 3 }],
    files: [{ id: "F1", noteId: "N1", fileName: "L4.pdf", mimeType: "application/pdf", bytes: PDF }, { id: "F2", noteId: "N2", fileName: "OS slides.pdf", mimeType: "application/pdf", bytes: pdf("slides") }],
    resources: [{ id: "R1", title: "Knapsack video", url: "https://youtube.com/watch?v=abcdefgh", domain: "youtube.com", subjectId: "S-dp", topicName: "Knapsack", resourceType: "video",
      canonicalUrl: "https://www.youtube.com/watch?v=abcdefgh", imageUrl: "https://i.ytimg.com/x.jpg", author: "MIT OCW", publishedAt: new Date("2024-01-02T00:00:00Z"), durationSeconds: 1800, tags: ["dp", "exam"] }],
    tasks: [
      { id: "K1", title: "Solve 5 knapsack problems", subjectId: "S-dp", topicName: "Knapsack", parentId: null, priority: "high", estimatedMinutes: 90, after: [] },
      { id: "K2", title: "Write the recurrence", subjectId: "S-dp", topicName: "Knapsack", parentId: "K1", priority: null, estimatedMinutes: null, after: [] },
      { id: "K3", title: "Revise", subjectId: "S-dp", topicName: null, parentId: null, priority: "low", estimatedMinutes: 30, after: ["K1"] },
      { id: "K9", title: "Unfiled task", subjectId: null, topicName: null, parentId: null, priority: null, estimatedMinutes: null },
    ],
    title: "Year 2", description: null, license: "cc-by-4.0", attribution, privateNotesLeftOut: 0,
    leftOut: { unfiledNotes: 3, unfiledPages: 2, passages: 1, pagesOverLimit: 0 },
  });
}

describe("full-fidelity maps (kivo.map/2)", () => {
  it("carries topic details, every note's images and files, page metadata and task definitions", () => {
    const { pkg, assetData } = full();
    expect(pkg.format).toBe(MAP_FORMAT_V2);
    const t1 = pkg.topics.find(t => t.name === "Knapsack")!;
    expect(t1.details).toEqual({ explanation: "Choose items under a weight limit.", sources: [{ file: "L4.pdf", page: 3 }] });   // sanitised: junk dropped
    expect(pkg.topics.find(t => t.name === "Build a shell")!.details).toMatchObject({ weeks: 2, goals: ["fork/exec"] });
    expect(pkg.notes[0]!.body).toBe("# Knapsack\n![table](kivo-image:a1)\n[L4.pdf](kivo-file:a2)\n");
    expect(pkg.notes[1]!.body).toContain("(kivo-image:missing)");
    expect(pkg.notes[1]!.body).toContain("[OS slides.pdf](kivo-file:a3)");     // kept with the note, not named: added
    expect(pkg.assets.map(a => [a.ref, a.noteRef, a.kind])).toEqual([["a1", "n1", "image"], ["a2", "n1", "document"], ["a3", "n2", "document"]]);
    expect(assetData.size).toBe(3);
    expect(pkg.resources[0]).toMatchObject({ canonicalUrl: "https://www.youtube.com/watch?v=abcdefgh", author: "MIT OCW", publishedAt: "2024-01-02T00:00:00.000Z", durationSeconds: 1800, tags: ["dp", "exam"] });
    expect(pkg.tasks.map(t => [t.ref, t.title, t.parentRef, t.waitsOn])).toEqual([["k1", "Solve 5 knapsack problems", null, []], ["k2", "Write the recurrence", "k1", []], ["k3", "Revise", null, ["k1"]]]);
    expect(pkg.tasks.every(t => !("status" in t) && !("dueDay" in t))).toBe(true);
    expect(pkg.excluded).toMatchObject({ archivedTopics: 1, imagesNotCarried: 1, unfiledNotes: 3, unfiledPages: 2, passages: 1, taskProgress: true, pagePersonalState: true, learningState: true });
    expect(validatePackage(pkg).ok).toBe(true);
  });

  it("round-trips through a .kivo file with every asset byte for byte and the map envelope", () => {
    const { pkg, assetData } = full();
    const { bytes, manifest } = packArchive(pkg, { assetData });
    expect(manifest).toMatchObject({ format: "kivo.archive/1", packageType: "map", contentFormat: MAP_FORMAT_V2, mapFormat: MAP_FORMAT_V2 });
    expect(manifest.counts).toMatchObject({ images: 1, files: 2, tasks: 3 });
    const names = Object.keys(unzipSync(bytes)).sort();
    expect(names).toEqual(["assets/documents/a2.pdf", "assets/documents/a3.pdf", "assets/images/a1.png", "content/notes/n1.md", "content/notes/n2.md", "graph.json", "manifest.json", "provenance.json"]);
    const out = unpackArchive(bytes);
    if (!out.ok) throw new Error(`${out.reason} ${out.detail}`);
    expect({ ...out.pkg, attribution: null }).toEqual({ ...pkg, attribution: null });
    expect(out.pkg.attribution).toMatchObject({ creator: "Asha", packageId: manifest.packageId });
    expect(Buffer.from(out.assetData.get("a1")!).equals(Buffer.from(PNG))).toBe(true);
    expect(Buffer.from(out.assetData.get("a2")!).equals(Buffer.from(PDF))).toBe(true);
  });

  it("a file made before 25 Nov (format 1, no packageType) still unpacks unchanged", () => {
    const v1 = buildPackage({ rootSubjectId: "S-alg", subjects: [{ id: "S-alg", name: "Algorithms", parentId: null }], topics: [{ id: "T1", subjectId: "S-alg", name: "Sorting", parentId: null, kind: null, position: 0, archived: false }],
      notes: [{ id: "N1", title: "Sorts", body: "Merge sort.", subjectId: "S-alg", topicName: "Sorting" }], resources: [], title: "Alg", description: null, license: "all-rights-reserved", attribution, privateNotesLeftOut: 0 }).pkg;
    expect(v1.format).toBe(MAP_FORMAT_V1);
    const files = unzipSync(packArchive(v1).bytes);
    const m = JSON.parse(strFromU8(files["manifest.json"]!));
    delete m.packageType; delete m.contentFormat;           // as a file from before 25 Nov
    const graph = JSON.parse(strFromU8(files["graph.json"]!));
    expect("assets" in graph || "tasks" in graph).toBe(false);
    const out = unpackArchive(zipSync({ ...files, "manifest.json": strToU8(JSON.stringify(m)) }));
    if (!out.ok) throw new Error(out.reason);
    expect(out.pkg.notes[0]!.body).toBe("Merge sort.");
    expect(out.pkg.assets).toEqual([]);
    expect(out.pkg.tasks).toEqual([]);
  });

  it("refuses what an import could not rebuild safely", () => {
    const bad = (f: (p: MapPackage) => void) => { const { pkg } = full(); f(pkg); return validatePackage(pkg); };
    expect(bad(p => { p.notes[0]!.body += "\n![x](kivo-image:a3)"; })).toMatchObject({ ok: false, reason: "note_references_unknown_image" });    // a3 is a document
    expect(bad(p => { p.notes[1]!.body += "\n![x](kivo-image:a1)"; })).toMatchObject({ ok: false, reason: "note_references_unknown_image" });    // another note's
    expect(bad(p => { p.assets[0]!.bytes = 50_000_000; })).toMatchObject({ ok: false, reason: "bad_asset_size" });
    expect(bad(p => { p.assets[0]!.mimeType = "text/html"; })).toMatchObject({ ok: false, reason: "bad_asset_type" });
    expect(bad(p => { p.tasks[1]!.parentRef = "k3"; })).toMatchObject({ ok: false, reason: "task_parent_unknown_or_after_step" });
    expect(bad(p => { p.tasks[0]!.waitsOn = ["k9"]; })).toMatchObject({ ok: false, reason: "bad_task_wait" });
    expect(bad(p => { p.tasks[0]!.waitsOn = ["k1"]; })).toMatchObject({ ok: false, reason: "bad_task_wait" });
    expect(bad(p => { p.resources[0]!.imageUrl = "javascript:alert(1)"; })).toMatchObject({ ok: false, reason: "bad_resource_meta" });
    expect(bad(p => { (p as { format: string }).format = MAP_FORMAT_V1; })).toMatchObject({ ok: false });
  });

  it("refuses an asset whose bytes aren't what the map says", () => {
    const { pkg, assetData } = full();
    const files = unzipSync(packArchive(pkg, { assetData }).bytes);
    const g = JSON.parse(strFromU8(files["graph.json"]!));
    // Claim the PDF is the PNG: same size and checksum, so only the type check catches it.
    const pdfMeta = g.assets.find((a: { ref: string }) => a.ref === "a2");
    g.assets[0] = { ...g.assets[0], bytes: pdfMeta.bytes, sha256: pdfMeta.sha256 };
    const swapped = { ...files, "assets/images/a1.png": files["assets/documents/a2.pdf"]!, "graph.json": strToU8(JSON.stringify(g)) };
    const m = JSON.parse(strFromU8(files["manifest.json"]!));
    const { createHash } = require("node:crypto") as typeof import("node:crypto");
    m.files = m.files.map((f: { path: string }) => swapped[f.path as keyof typeof swapped] ? { ...f, bytes: swapped[f.path as keyof typeof swapped]!.length, sha256: createHash("sha256").update(swapped[f.path as keyof typeof swapped]!).digest("hex") } : f);
    expect(unpackArchive(zipSync({ ...swapped, "manifest.json": strToU8(JSON.stringify(m)) }))).toMatchObject({ ok: false, reason: "bad_asset" });
  });

  it("import helpers: asset refs rewritten, details compared, tasks read back", () => {
    expect(rewriteAssetRefs("![x](kivo-image:a1) [f](kivo-file:a2) ![y](kivo-image:missing)", { a1: "img9", a2: "file9" })).toBe("![x](kivo-image:img9) [f](kivo-file:file9) ![y](kivo-image:missing)");
    const { pkg } = full();
    const names = { s1: "Algorithms", s2: "DP", s3: "OS" };
    const structure = { version: "v", subjects: [
      { id: "A", name: "Algorithms", topics: [] }, { id: "D", name: "DP", parentId: "A", topics: [{ id: "TK", name: "Knapsack", hasHistory: false }, { id: "T01", name: "0/1 knapsack", parentId: "TK", hasHistory: false }] },
      { id: "O", name: "OS", topics: [{ id: "TS", name: "Build a shell", kind: "milestone" as const, hasHistory: false }] },
    ] } as never;
    expect(missingDetailEdits(pkg, names, structure, new Map()).map(e => (e as { topicId: string }).topicId)).toEqual(["TK", "TS"]);
    expect(missingDetailEdits(pkg, names, structure, new Map<string, unknown>([["TK", pkg.topics[0]!.details], ["TS", pkg.topics.find(t => t.name === "Build a shell")!.details]]))).toEqual([]);
    const made = [
      { id: "x1", title: "Solve 5 knapsack problems", status: "todo", subjectId: "D", topicName: "Knapsack", parentId: null, after: [] },
      { id: "x2", title: "Write the recurrence", status: "todo", subjectId: "D", topicName: "Knapsack", parentId: "x1", after: [] },
      { id: "x3", title: "Revise", status: "todo", subjectId: "D", topicName: null, parentId: null, after: ["x1"] },
    ];
    expect(verifyTasks(pkg, made, "p-", names, structure)).toEqual({ ok: true });
    expect(verifyTasks(pkg, made.map(t => t.id === "x3" ? { ...t, after: [] } : t), "p-", names, structure)).toMatchObject({ ok: false });
    expect(verifyTasks(pkg, made.map(t => t.id === "x1" ? { ...t, status: "done" } : t), "p-", names, structure)).toMatchObject({ ok: false });
    expect(verifyTasks(pkg, made.slice(0, 2), "p-", names, structure)).toMatchObject({ ok: false });
  });
});
