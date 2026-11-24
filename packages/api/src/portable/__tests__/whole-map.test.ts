// Founder review #12 (whole-map export) and #15 (links kept as saved pages).
// Format 2 holds several top-level subjects; format 1 files still read as before.
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { buildPackage, MAP_FORMAT_V1, MAP_FORMAT_V2, packageRoots, validatePackage, type MapPackage } from "../map-package";
import { packArchive, unpackArchive } from "../kivo-archive";
import { linkClientId, missingEdits, planSubjectNames, verifyLinks, verifyStructure } from "../import";
import type { StudyStructure } from "../../nova/product/setup-edit.types";

const SUBJECTS = [
  { id: "S-os", name: "Operating Systems", parentId: null },
  { id: "S-os-lab", name: "OS Lab", parentId: "S-os" },
  { id: "S-dbms", name: "DBMS", parentId: null },
  { id: "S-math", name: "Discrete Maths", parentId: null },
];
const TOPICS = [
  { id: "T1", subjectId: "S-os", name: "Deadlocks", parentId: null, kind: null, position: 0, archived: false },
  { id: "T2", subjectId: "S-os", name: "Banker's algorithm", parentId: "T1", kind: null, position: 0, archived: false },
  { id: "T3", subjectId: "S-dbms", name: "Normalisation", parentId: null, kind: null, position: 0, archived: false },
  { id: "T4", subjectId: "S-os-lab", name: "Fork", parentId: null, kind: null, position: 0, archived: false },
] as const;
const LINKS = [
  { id: "R1", title: "Deadlock lecture", url: "https://youtube.com/watch?v=abc", domain: "youtube.com", subjectId: "S-os", topicName: "Deadlocks", description: "Lecture 12", resourceType: "video", siteName: "YouTube" },
  { id: "R2", title: "Banker's notes", url: "https://example.edu/bankers", domain: "example.edu", subjectId: "S-os", topicName: "Banker's algorithm" },
  { id: "R3", title: "3NF explained", url: "https://example.org/3nf", domain: "example.org", subjectId: "S-dbms", topicName: "Normalisation" },
  { id: "R4", title: "Fork man page", url: "https://man7.org/fork", domain: "man7.org", subjectId: "S-os-lab", topicName: null },
];

function whole(): MapPackage {
  return buildPackage({
    rootSubjectIds: ["S-os", "S-dbms", "S-math"], subjects: SUBJECTS, topics: TOPICS.map(t => ({ ...t })), notes: [], resources: LINKS,
    title: "2nd year roadmap", description: null, license: "all-rights-reserved",
    attribution: { creator: "CSE 2nd year", source: null, packageId: null, exportedAt: null }, privateNotesLeftOut: 0,
  });
}

describe("whole-map packages (format 2)", () => {
  it("keeps every top-level subject, with what is inside each", () => {
    const pkg = whole();
    expect(pkg.format).toBe(MAP_FORMAT_V2);
    expect(packageRoots(pkg).map(s => s.name)).toEqual(["Operating Systems", "DBMS", "Discrete Maths"]);
    expect(pkg.subjects.find(s => s.name === "OS Lab")!.parentRef).toBe(pkg.subjects.find(s => s.name === "Operating Systems")!.ref);
    expect(pkg.topics).toHaveLength(4);
    expect(pkg.resources).toHaveLength(4);
    expect(validatePackage(pkg).ok).toBe(true);
  });

  it("one subject is still format 1, so older Kivo can open it", () => {
    const one = buildPackage({ rootSubjectId: "S-os", subjects: SUBJECTS, topics: TOPICS.map(t => ({ ...t })), notes: [], resources: LINKS, title: "OS", description: null, license: "all-rights-reserved", attribution: { creator: null, source: null, packageId: null, exportedAt: null }, privateNotesLeftOut: 0 });
    expect(one.format).toBe(MAP_FORMAT_V1);
    expect(packageRoots(one)).toHaveLength(1);
    expect(one.resources.map(r => r.title).sort()).toEqual(["Banker's notes", "Deadlock lecture", "Fork man page"]);
  });

  it("format 1 still refuses a second root; format 2 needs at least one", () => {
    const v1 = { ...whole(), format: MAP_FORMAT_V1 };
    expect(validatePackage(v1)).toMatchObject({ ok: false, reason: "one_root_subject" });
    const none = whole(); none.subjects = [];
    expect(validatePackage(none)).toMatchObject({ ok: false });
  });

  it("round-trips through a .kivo file with every root, link and its metadata", () => {
    const { bytes, manifest } = packArchive(whole());
    expect(manifest.mapFormat).toBe(MAP_FORMAT_V2);
    const out = unpackArchive(bytes);
    if (!out.ok) throw new Error(out.reason);
    expect(packageRoots(out.pkg)).toHaveLength(3);
    const lecture = out.pkg.resources.find(r => r.title === "Deadlock lecture")!;
    expect(lecture).toMatchObject({ url: "https://youtube.com/watch?v=abc", topicName: "Deadlocks", description: "Lecture 12", resourceType: "video", siteName: "YouTube" });
  });

  it("a file whose manifest and graph disagree on the format is refused", () => {
    const { bytes } = packArchive(whole());
    const files = unzipSync(bytes);
    const m = JSON.parse(strFromU8(files["manifest.json"]!)); m.mapFormat = MAP_FORMAT_V1;
    files["manifest.json"] = strToU8(JSON.stringify(m));
    expect(unpackArchive(zipSync(files))).toMatchObject({ ok: false, reason: "bad_manifest" });
  });

  it("unknown fields on a link are dropped, oversized metadata is refused", () => {
    const pkg = whole() as unknown as { resources: Array<Record<string, unknown>> };
    pkg.resources[0]!.evil = "<script>";
    const ok = validatePackage(pkg);
    expect(ok.ok && JSON.stringify(ok.pkg.resources[0])).not.toContain("evil");
    pkg.resources[0]!.description = "x".repeat(700);
    expect(validatePackage(pkg)).toMatchObject({ ok: false, reason: "bad_resource_meta" });
  });
});

// The import's pure parts for several roots, links included.
describe("importing a whole map", () => {
  const pkg = whole();
  const names = planSubjectNames(pkg, ["DBMS"]);   // the learner already has a DBMS
  it("names only the clashing root differently", () => {
    expect(Object.values(names)).toEqual(["Operating Systems", "OS Lab", "DBMS (imported)", "Discrete Maths"]);
  });

  // A structure as the writers would leave it once every edit applied.
  const built = (): StudyStructure => {
    const id = (ref: string) => `id-${ref}`;
    return {
      version: 1,
      subjects: pkg.subjects.map(s => ({
        id: id(s.ref), name: names[s.ref]!, parentId: s.parentRef ? id(s.parentRef) : null,
        topics: pkg.topics.filter(t => t.subjectRef === s.ref).map(t => ({ id: id(t.ref), name: t.name, parentId: t.parentRef ? id(t.parentRef) : null })),
      })),
    } as unknown as StudyStructure;
  };

  it("adds subjects for every root first, then their topics", () => {
    const empty = { version: 0, subjects: [{ id: "mine", name: "DBMS", parentId: null, topics: [] }] } as unknown as StudyStructure;
    const first = missingEdits(pkg, names, empty);
    expect(first.every(e => e.op === "add_subject")).toBe(true);
    expect(first).toHaveLength(4);
    expect(missingEdits(pkg, names, built())).toEqual([]);
  });

  it("reads back every root", () => {
    const v = verifyStructure(pkg, names, built());
    expect(v).toMatchObject({ ok: true, rootSubjectIds: ["id-s1", "id-s3", "id-s4"] });
  });

  it("checks each link is a saved page under its subject and topic", () => {
    const pid = "11111111-2222-3333-4444-555555555555";
    const rowOf = (ref: string, subjectRef: string, topicName: string | null) => ({ clientEventId: linkClientId(pid, ref), subjectId: `id-${subjectRef}`, topicName });
    const outcomes = Object.fromEntries(pkg.resources.map(r => [r.ref, "created" as const]));
    const rows = pkg.resources.map(r => rowOf(r.ref, r.subjectRef!, r.topicName));
    expect(verifyLinks(pkg, names, built(), pid, outcomes, rows)).toEqual({ ok: true, saved: 4, alreadySaved: 0 });
    // Filed under the wrong topic: refused.
    const wrong = rows.map((r, i) => (i === 0 ? { ...r, topicName: "Paging" } : r));
    expect(verifyLinks(pkg, names, built(), pid, outcomes, wrong)).toMatchObject({ ok: false });
    // Missing row: refused. Not yet done: said so (the import runs the stage).
    expect(verifyLinks(pkg, names, built(), pid, outcomes, rows.slice(1))).toMatchObject({ ok: false, detail: expect.stringContaining("missing") });
    expect(verifyLinks(pkg, names, built(), pid, {}, rows)).toMatchObject({ ok: false, detail: expect.stringContaining("not done") });
    // A page the learner already had, filed elsewhere, is theirs: counted, not moved.
    expect(verifyLinks(pkg, names, built(), pid, { ...outcomes, r1: "already_saved" }, rows.slice(1))).toEqual({ ok: true, saved: 3, alreadySaved: 1 });
  });

  it("gives each link one stable id per package", () => {
    expect(linkClientId("p", "r1")).toBe(linkClientId("p", "r1"));
    expect(linkClientId("p", "r1")).not.toBe(linkClientId("q", "r1"));
    expect(linkClientId("p", "r1")).toMatch(/^kivo-[0-9a-f]{40}$/);
  });
});
