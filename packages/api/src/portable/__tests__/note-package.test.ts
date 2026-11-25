import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { buildNotePackage, NOTE_EXTENSION, NOTE_FORMAT, packNote, unpackNote } from "../note-package";
import { packArchive, sniffPackageType, unpackArchive } from "../kivo-archive";
import { buildPackage, MAP_FORMAT_V2 } from "../map-package";
import { pdf, png, webp } from "./fixtures";

const PNG = png(40, 30, 3), PDF = pdf("lecture"), WEBP = webp();
const sample = () => buildNotePackage({
  title: "Dynamic programming", subjectName: "Algorithms", topicName: "DP", source: null, creator: "Asha", now: new Date("2026-11-25T00:00:00Z"),
  body: "# DP\n**Four** steps.\n![tree](kivo-image:img-1)\nAgain ![same](kivo-image:img-1)\n![gone](kivo-image:img-x)\n[Lecture 4.pdf](kivo-file:file-1)\n",
  images: [{ id: "img-1", mimeType: "image/png", width: 40, height: 30, bytes: PNG, sourceUrl: "https://example.edu/l4.pdf", sourceTitle: "L4", page: 3 }],
  files: [{ id: "file-1", fileName: "Lecture 4.pdf", mimeType: "application/pdf", bytes: PDF }, { id: "file-2", fileName: "Extra reading.pdf", mimeType: "application/pdf", bytes: pdf("extra") }],
});

describe(".kivo note packages (packageType note, kivo.note/1)", () => {
  it("uses .kivo, never .kio or .qvo", () => {
    expect(NOTE_EXTENSION).toBe(".kivo");
  });

  it("carries the text exactly, with private ids replaced by package refs and every asset byte for byte", () => {
    const { pkg, assetData } = sample();
    expect(pkg.body).toContain("**Four**");
    expect(pkg.body.match(/kivo-image:a1/g)).toHaveLength(2);
    expect(pkg.body).toContain("(kivo-image:missing)");
    expect(pkg.body).toContain("[Lecture 4.pdf](kivo-file:a2)");
    // A file kept with the note but not named in its text is added, never dropped.
    expect(pkg.body).toContain("[Extra reading.pdf](kivo-file:a3)");
    expect(pkg.body).not.toMatch(/img-1|file-1|file-2/);
    expect(pkg.excluded).toEqual({ images: 1, files: 0 });
    const bytes = packNote(pkg, assetData);
    const out = unpackNote(bytes);
    if (!out.ok) throw new Error(out.reason);
    expect(out.pkg.body).toBe(pkg.body);
    expect(out.pkg.title).toBe("Dynamic programming");
    expect(out.pkg.subjectName).toBe("Algorithms");
    expect(Buffer.from(out.assetData.get("a1")!).equals(Buffer.from(PNG))).toBe(true);
    expect(Buffer.from(out.assetData.get("a2")!).equals(Buffer.from(PDF))).toBe(true);
    expect(out.pkg.assets.map(a => [a.ref, a.kind, a.mimeType])).toEqual([["a1", "image", "image/png"], ["a2", "document", "application/pdf"], ["a3", "document", "application/pdf"]]);
  });

  it("is laid out as the format says, with an envelope that names it", () => {
    const { pkg, assetData } = sample();
    const files = unzipSync(packNote(pkg, assetData));
    expect(Object.keys(files).sort()).toEqual(["assets/documents/a2.pdf", "assets/documents/a3.pdf", "assets/images/a1.png", "content/note.md", "manifest.json", "note.json", "provenance.json"]);
    const m = JSON.parse(strFromU8(files["manifest.json"]!));
    expect(m).toMatchObject({ format: "kivo.archive/1", packageType: "note", contentFormat: NOTE_FORMAT });
    expect(m.files).toHaveLength(6);
  });

  it("a map importer refuses a note, and a note importer refuses a map, before anything else", () => {
    const { pkg, assetData } = sample();
    const note = packNote(pkg, assetData);
    expect(unpackArchive(note)).toMatchObject({ ok: false, reason: "wrong_package_type", found: "note" });
    const map = packArchive(buildPackage({ rootSubjectId: "s", format: MAP_FORMAT_V2, subjects: [{ id: "s", name: "OS", parentId: null }], topics: [], notes: [], resources: [], title: "OS", description: null, license: "all-rights-reserved", attribution: { creator: null, source: null, packageId: null, exportedAt: null }, privateNotesLeftOut: 0 }).pkg).bytes;
    expect(unpackNote(map)).toMatchObject({ ok: false, reason: "wrong_package_type", found: "map" });
    expect(sniffPackageType(note)).toBe("note");
    expect(sniffPackageType(map)).toBe("map");
  });

  it("refuses a tampered asset, an asset that isn't what it says, an unknown ref and unexpected paths", () => {
    const { pkg, assetData } = sample();
    const files = unzipSync(packNote(pkg, assetData));
    const tampered = { ...files, "assets/images/a1.png": new Uint8Array([...files["assets/images/a1.png"]!].map((b, i) => i === 50 ? b ^ 1 : b)) };
    expect(unpackNote(zipSync(tampered))).toMatchObject({ ok: false, reason: "checksum_mismatch" });
    // A PDF passed off as a PNG: checksums rewritten so only the type check can catch it.
    const lie = buildNotePackage({ title: "x", body: "![a](kivo-image:i)", subjectName: null, topicName: null, source: null, creator: null, images: [{ id: "i", mimeType: "image/png", width: 1, height: 1, bytes: PDF }] });
    expect(unpackNote(packNote(lie.pkg, lie.assetData))).toMatchObject({ ok: false, reason: "bad_asset" });
    const unknown = buildNotePackage({ title: "x", body: "plain", subjectName: null, topicName: null, source: null, creator: null, images: [] });
    unknown.pkg.body = "![a](kivo-image:a9)";
    expect(unpackNote(packNote(unknown.pkg, unknown.assetData))).toMatchObject({ ok: false, reason: "image_not_in_file" });
    expect(unpackNote(zipSync({ ...files, "assets/other/run.sh": strToU8("rm -rf /") }))).toMatchObject({ ok: false, reason: "unexpected_file" });
    expect(unpackNote(zipSync({ ...files, "../x.md": strToU8("x") }))).toMatchObject({ ok: false, reason: "unsafe_path" });
    expect(unpackNote(zipSync({ ...files, "content/notes/n1.md": strToU8("x") }))).toMatchObject({ ok: false, reason: "unexpected_file" });
  });

  it("keeps WebP images and refuses a note over its limits", () => {
    const w = buildNotePackage({ title: "w", body: "![w](kivo-image:w1)", subjectName: null, topicName: null, source: null, creator: null, images: [{ id: "w1", mimeType: "image/webp", width: 64, height: 48, bytes: WEBP }] });
    const out = unpackNote(packNote(w.pkg, w.assetData));
    expect(out.ok && out.pkg.assets[0]!.mimeType).toBe("image/webp");
    const many = buildNotePackage({ title: "m", body: Array.from({ length: 45 }, (_, i) => `![i](kivo-image:x${i})`).join("\n"), subjectName: null, topicName: null, source: null, creator: null,
      images: Array.from({ length: 45 }, (_, i) => ({ id: `x${i}`, mimeType: "image/png", width: 4, height: 4, bytes: png(4, 4, i + 1) })) });
    expect(many.pkg.assets).toHaveLength(40);
    expect(many.pkg.excluded.images).toBe(5);
  });
});
