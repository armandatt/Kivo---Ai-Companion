// Founder review #11 (preparation): one note as a portable file.
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { buildNotePackage, packNote, unpackNote, NOTE_FORMAT } from "../note-package";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const sample = () => buildNotePackage({
  title: "Deadlocks", body: "# Deadlocks\n**Four** conditions.\n![graph](kivo-image:abc)\nAgain ![same](kivo-image:abc)\n![gone](kivo-image:zzz)\n$$x^2$$",
  subjectName: "Operating Systems", topicName: "Deadlocks", source: { title: "Lecture 12", url: "https://example.edu/l12" },
  creator: "Asha", images: [{ id: "abc", mimeType: "image/png", bytes: PNG }],
});

describe("note packages (kivo.note/1)", () => {
  it("keeps the Markdown, filing names, source and images; private image ids never leave", () => {
    const pkg = sample();
    expect(pkg.body).toContain("**Four**");
    expect(pkg.body).toContain("(kivo-image:i1)");
    expect(pkg.body.match(/kivo-image:i1/g)).toHaveLength(2);
    expect(pkg.body).not.toContain("abc");
    expect(pkg.excluded.images).toBe(1);
    const out = unpackNote(packNote(pkg));
    if (!out.ok) throw new Error(out.reason);
    expect(out.pkg).toMatchObject({ format: NOTE_FORMAT, title: "Deadlocks", subjectName: "Operating Systems", topicName: "Deadlocks", source: { url: "https://example.edu/l12" }, attribution: { creator: "Asha" } });
    expect(out.pkg.body).toBe(pkg.body);
    expect(Array.from(out.pkg.images[0]!.bytes)).toEqual(Array.from(PNG));
  });

  it("refuses a tampered, padded or mislabelled file", () => {
    const bytes = packNote(sample());
    const files = unzipSync(bytes);
    const tampered = { ...files, "note.md": strToU8("changed") };
    expect(unpackNote(zipSync(tampered))).toMatchObject({ ok: false, reason: "checksum_mismatch" });
    expect(unpackNote(zipSync({ ...files, "../evil.sh": strToU8("x") }))).toMatchObject({ ok: false });
    expect(unpackNote(zipSync({ ...files, "extra.txt": strToU8("x") }))).toMatchObject({ ok: false, reason: "unexpected_file" });
    // A script claiming to be a PNG.
    const fake = new Uint8Array(strToU8("<script>alert(1)</script>"));
    const m = JSON.parse(strFromU8(files["manifest.json"]!));
    m.files = m.files.map((f: { path: string }) => (f.path === "images/i1.png" ? { ...f, bytes: fake.length, sha256: require("node:crypto").createHash("sha256").update(fake).digest("hex") } : f));
    expect(unpackNote(zipSync({ ...files, "images/i1.png": fake, "manifest.json": strToU8(JSON.stringify(m)) }))).toMatchObject({ ok: false, reason: "bad_image" });
  });

  it("refuses non-web sources and unknown versions", () => {
    const pkg = sample(); pkg.source = { title: "x", url: "javascript:alert(1)" };
    expect(unpackNote(packNote(pkg))).toMatchObject({ ok: false, reason: "bad_note" });
    const files = unzipSync(packNote(sample()));
    const m = JSON.parse(strFromU8(files["manifest.json"]!)); m.format = "kivo.note/9";
    expect(unpackNote(zipSync({ ...files, "manifest.json": strToU8(JSON.stringify(m)) }))).toMatchObject({ ok: false, reason: "unsupported_version" });
    expect(unpackNote(strToU8("not a zip"))).toMatchObject({ ok: false, reason: "not_a_note_file" });
  });
});
