import { strToU8, zipSync } from "fflate";
import { buildPackage, stripNoteImages, validatePackage, type MapPackage } from "../map-package";
import { ARCHIVE_LIMITS, packArchive, safeArchivePath, unpackArchive } from "../kivo-archive";

// A small map: CSE (root) › Year 3 › Compiler Design, with a nested topic tree,
// one approved note (with a private image), one link, and one note left out.
function sample(): MapPackage {
  return buildPackage({
    rootSubjectId: "S-root",
    subjects: [
      { id: "S-root", name: "B.Tech CSE", parentId: null },
      { id: "S-y3", name: "Year 3", parentId: "S-root" },
      { id: "S-cd", name: "Compiler Design", parentId: "S-y3" },
      { id: "S-other", name: "My private subject", parentId: null },
    ],
    topics: [
      { id: "T1", subjectId: "S-cd", name: "Lexical analysis", parentId: null, kind: null, position: 0, archived: false },
      { id: "T2", subjectId: "S-cd", name: "Regular expressions", parentId: "T1", kind: null, position: 0, archived: false },
      { id: "T3", subjectId: "S-cd", name: "Parsing", parentId: null, kind: null, position: 1, archived: false },
      { id: "T4", subjectId: "S-cd", name: "Old topic", parentId: null, kind: null, position: 2, archived: true },
      { id: "T5", subjectId: "S-other", name: "Secret", parentId: null, kind: null, position: 0, archived: false },
    ],
    notes: [{ id: "N1", title: "Lexers", body: "# Lexers\nTokens.\n![diagram](kivo-image:abc123)\nEnd.", subjectId: "S-cd", topicName: "Lexical analysis" }],
    resources: [
      { id: "R1", title: "Dragon book notes", url: "https://example.edu/dragon", domain: "example.edu", subjectId: "S-cd", topicName: "Parsing" },
      { id: "R2", title: "Bad", url: "javascript:alert(1)", domain: "x", subjectId: "S-cd", topicName: null },
      { id: "R3", title: "Private", url: "https://example.com/p", domain: "example.com", subjectId: "S-other", topicName: null },
    ],
    title: "Bennett B.Tech CSE · Year 3", description: "Third-year subjects.", license: "cc-by-4.0",
    attribution: { creator: "Kivo", source: "Kivo curated maps", packageId: null, exportedAt: null },
    privateNotesLeftOut: 1,
  });
}

describe("map package (graph and content)", () => {
  it("takes only the chosen subtree; ids never leave the account; learning state is never included", () => {
    const pkg = sample();
    expect(pkg.subjects.map(s => [s.ref, s.name, s.parentRef])).toEqual([["s1", "B.Tech CSE", null], ["s2", "Year 3", "s1"], ["s3", "Compiler Design", "s2"]]);
    expect(pkg.topics.map(t => [t.ref, t.name, t.parentRef])).toEqual([["t1", "Lexical analysis", null], ["t2", "Regular expressions", "t1"], ["t3", "Parsing", null]]);
    const text = JSON.stringify(pkg);
    for (const id of ["S-root", "S-y3", "S-cd", "S-other", "T1", "N1", "R1", "Secret", "My private subject", "Old topic", "example.com/p"]) expect(text).not.toContain(id);
    expect(text).not.toMatch(/mastery|review|session/i);
    expect(pkg.excluded).toEqual({ noteImages: 1, privateNotes: 1, learningState: true });
  });

  it("keeps only plain web links, and replaces private note images with a line saying so", () => {
    const pkg = sample();
    expect(pkg.resources.map(r => r.url)).toEqual(["https://example.edu/dragon"]);
    expect(pkg.notes[0]!.body).not.toContain("kivo-image");
    expect(stripNoteImages("a\n![x](kivo-image:1)\nb").images).toBe(1);
  });

  it("validation refuses what an import cannot safely rebuild", () => {
    const pkg = sample();
    expect(validatePackage(pkg).ok).toBe(true);
    const bad = (patch: (p: MapPackage) => void) => { const p = structuredClone(pkg); patch(p); return validatePackage(p); };
    expect(bad(p => { p.format = "kivo.map/9" as never; })).toMatchObject({ ok: false, reason: "unknown_format" });
    expect(bad(p => { p.subjects[1]!.parentRef = "s9"; })).toMatchObject({ ok: false });
    expect(bad(p => { p.subjects.push({ ref: "s9", name: "Second root", parentRef: null }); })).toMatchObject({ ok: false, reason: "one_root_subject" });
    expect(bad(p => { p.topics[1]!.parentRef = "t9"; })).toMatchObject({ ok: false });
    expect(bad(p => { p.topics.push({ ...p.topics[0]!, ref: "t9" }); })).toMatchObject({ ok: false, reason: "duplicate_topic_name" });
    expect(bad(p => { p.notes[0]!.body += "\n![x](kivo-image:zzz)"; })).toMatchObject({ ok: false, reason: "note_references_private_image" });
    expect(bad(p => { p.resources[0]!.url = "file:///etc/passwd"; })).toMatchObject({ ok: false, reason: "bad_resource_url" });
    expect(bad(p => { (p as { license: string }).license = "whatever"; })).toMatchObject({ ok: false, reason: "bad_license" });
  });
});

describe(".kivo archive", () => {
  it("round-trips: manifest inventory and checksums, nothing lost", () => {
    const pkg = sample();
    const { bytes, manifest } = packArchive(pkg, { packageId: "11111111-2222-3333-4444-555555555555", now: new Date("2026-11-24T00:00:00Z") });
    expect(manifest.counts).toEqual({ subjects: 3, topics: 3, notes: 1, resources: 1, edges: 2 + 3 + 1 + 1 + 1, nestedSubjects: 2 });
    expect(manifest.files.map(f => f.path).sort()).toEqual(["content/notes/n1.md", "graph.json", "provenance.json"]);
    const out = unpackArchive(bytes);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.pkg.subjects).toEqual(pkg.subjects);
    expect(out.pkg.topics).toEqual(pkg.topics);
    expect(out.pkg.notes).toEqual(pkg.notes);
    expect(out.pkg.resources).toEqual(pkg.resources);
    expect(out.pkg.attribution).toMatchObject({ creator: "Kivo", packageId: "11111111-2222-3333-4444-555555555555" });
    expect(out.manifest.title).toBe("Bennett B.Tech CSE · Year 3");
  });

  const zip = (files: Record<string, string | Uint8Array>) => zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, typeof v === "string" ? strToU8(v) : v])));
  const good = () => { const { bytes } = packArchive(sample(), { packageId: "11111111-2222-3333-4444-555555555555" }); return bytes; };

  it("refuses files that are not .kivo archives, and oversized uploads", () => {
    expect(unpackArchive(strToU8("hello"))).toMatchObject({ ok: false, reason: "not_a_kivo_file" });
    expect(unpackArchive(new Uint8Array(0))).toMatchObject({ ok: false, reason: "too_large" });
    expect(unpackArchive(new Uint8Array(ARCHIVE_LIMITS.compressedBytes + 1))).toMatchObject({ ok: false, reason: "too_large" });
  });

  it("refuses path traversal and any path it does not expect", () => {
    for (const p of ["../evil.json", "/etc/passwd", "content/../../x", "a\\b", "content//notes/n1.md", "./graph.json"]) expect(safeArchivePath(p)).toBe(false);
    expect(unpackArchive(zip({ "manifest.json": "{}", "../evil.json": "x" }))).toMatchObject({ ok: false, reason: "unsafe_path" });
    expect(unpackArchive(zip({ "manifest.json": "{}", "scripts/run.sh": "rm -rf /" }))).toMatchObject({ ok: false, reason: "unexpected_file" });
  });

  it("refuses a decompression bomb before inflating it", () => {
    const zeros = new Uint8Array(ARCHIVE_LIMITS.fileBytes + 10);
    expect(unpackArchive(zip({ "manifest.json": "{}", "content/notes/n1.md": zeros }))).toMatchObject({ ok: false });
    const many: Record<string, string> = { "manifest.json": "{}" };
    for (let i = 1; i <= ARCHIVE_LIMITS.files + 1; i++) many[`content/notes/n${i}.md`] = "x";
    expect(unpackArchive(zip(many))).toMatchObject({ ok: false, reason: "too_many_files" });
  });

  it("refuses a tampered file, a missing file, an extra file and an unknown version", () => {
    const { unzipSync } = require("fflate") as typeof import("fflate");
    const files = unzipSync(good());
    const tampered = { ...files, "content/notes/n1.md": strToU8("changed") };
    expect(unpackArchive(zipSync(tampered))).toMatchObject({ ok: false, reason: "checksum_mismatch" });
    const { ["provenance.json"]: _gone, ...missing } = files;
    expect(unpackArchive(zipSync(missing))).toMatchObject({ ok: false, reason: "missing_file" });
    expect(unpackArchive(zipSync({ ...files, "content/notes/n2.md": strToU8("smuggled") }))).toMatchObject({ ok: false, reason: "inventory_mismatch" });
    const m = JSON.parse(new TextDecoder().decode(files["manifest.json"]));
    expect(unpackArchive(zipSync({ ...files, "manifest.json": strToU8(JSON.stringify({ ...m, format: "kivo.archive/2" })) }))).toMatchObject({ ok: false, reason: "unsupported_version" });
    expect(unpackArchive(zipSync({ ...files, "manifest.json": strToU8("not json") }))).toMatchObject({ ok: false, reason: "bad_manifest" });
  });

  it("a graph rewritten inside a valid archive is still validated whole", () => {
    const { unzipSync } = require("fflate") as typeof import("fflate");
    const files = unzipSync(good());
    const graph = JSON.parse(new TextDecoder().decode(files["graph.json"]));
    graph.subjects.push({ ref: "s9", name: "Second root", parentRef: null });
    const g = strToU8(JSON.stringify(graph));
    const m = JSON.parse(new TextDecoder().decode(files["manifest.json"]));
    const { createHash } = require("node:crypto") as typeof import("node:crypto");
    m.files = m.files.map((f: { path: string }) => f.path === "graph.json" ? { ...f, bytes: g.length, sha256: createHash("sha256").update(g).digest("hex") } : f);
    const out = unpackArchive(zipSync({ ...files, "graph.json": g, "manifest.json": strToU8(JSON.stringify(m)) }));
    expect(out).toMatchObject({ ok: false, reason: "bad_graph", detail: "one_root_subject" });
  });
});
