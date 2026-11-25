// ─── One note, as a .kivo file (packageType "note", kivo.note/1) ─────────────
// Pure (no database). One note, lossless for Kivo: its Markdown exactly as
// written, its title, where its creator filed it (as names, a hint the
// importer may ignore), its source, and every image and file it holds, with
// the same hardened envelope as a map (kivo-archive.ts). The extension is
// .kivo, as for maps ("for now .kivo is perfectly fine", owner, 25 Nov; .kio
// is kept for later and .qvo is not used); the manifest says which it is.
//
//   manifest.json      envelope identity + inventory (sha256 of every file)
//   note.json          title, filing hint, source, assets, what was left out
//   content/note.md    the body; images as ![caption](kivo-image:a1),
//                      files as [name.pdf](kivo-file:a2)
//   assets/images/a<k>.png|jpg|webp
//   assets/documents/a<k>.pdf
//   provenance.json    creator, licence, export time, package id
//
// Image and file ids are private to the owner's account: in the package each
// is a package-local ref (a1, a2…); an import stores the bytes as the
// importer's own (note-images.ts, note-attachments.ts) and writes their new
// ids back into the text.

import { strFromU8, strToU8 } from "fflate";
import { randomUUID } from "node:crypto";
import { assetPath, packEnvelope, readAssets, sha, unpackEnvelope, type UnpackFailure } from "./kivo-archive";
import { IMAGE_MIME_EXT, LICENSES, safeHttpUrl, type License, type PackageAsset } from "./map-package";
import { KIVO_EXTENSION } from "./kivo-archive";

export const NOTE_FORMAT = "kivo.note/1";
export const NOTE_EXTENSION = KIVO_EXTENSION;   // ".kivo" for notes too (owner, 25 Nov 2026)
export const NOTE_MIME = "application/vnd.kivo.note+zip";

export const NOTE_PACKAGE_LIMITS = {
  title: 200,
  body: 1_000_000,              // notes.types NOTE_BODY_MAX
  images: 40,
  files: 10,
  imageBytes: 2_500_000,        // note-images NOTE_IMAGE_BYTES_MAX
  fileBytes: 10_000_000,        // note-files NOTE_FILE_BYTES_MAX
  assetBytes: 40_000_000,
} as const;

export type NoteAsset = Omit<PackageAsset, "noteRef">;
export interface NoteSource { title: string | null; url: string | null }
export interface NotePackage {
  format: typeof NOTE_FORMAT;
  title: string;
  body: string;                          // Markdown, assets by package ref
  subjectName: string | null;            // where the creator filed it, as names (a hint; the importer chooses)
  topicName: string | null;
  source: NoteSource | null;
  license: License;
  attribution: { creator: string | null; exportedAt: string; packageId: string };
  assets: NoteAsset[];
  excluded: { images: number; files: number };   // what the note named that could not be carried
}

export interface SourceNoteImage { id: string; mimeType: string; width: number; height: number; bytes: Uint8Array; sourceUrl?: string | null; sourceTitle?: string | null; page?: number | null }
export interface SourceNoteFile  { id: string; fileName: string; mimeType: string; bytes: Uint8Array }

const IMAGE_REF = /\(kivo-image:([A-Za-z0-9_-]{1,64})\)/g;
const FILE_REF = /\]\(kivo-file:([A-Za-z0-9_-]{1,64})\)/g;

export function buildNotePackage(input: {
  title: string; body: string; subjectName: string | null; topicName: string | null; source: NoteSource | null;
  creator: string | null; license?: License; images: SourceNoteImage[]; files?: SourceNoteFile[]; now?: Date; packageId?: string;
}): { pkg: NotePackage; assetData: Map<string, Uint8Array> } {
  const assets: NoteAsset[] = [];
  const data = new Map<string, Uint8Array>();
  let total = 0, imagesOut = 0, filesOut = 0;
  const fits = (n: number) => total + n <= NOTE_PACKAGE_LIMITS.assetBytes;
  const imageById = new Map(input.images.map(i => [i.id, i]));
  const imageRefs = new Map<string, string>();
  let body = input.body.replace(IMAGE_REF, (_w, id: string) => {
    if (imageRefs.has(id)) return `(kivo-image:${imageRefs.get(id)})`;
    const img = imageById.get(id);
    const count = assets.filter(a => a.kind === "image").length;
    if (!img || !IMAGE_MIME_EXT[img.mimeType] || img.bytes.length > NOTE_PACKAGE_LIMITS.imageBytes || count >= NOTE_PACKAGE_LIMITS.images || !fits(img.bytes.length)) { imagesOut++; return "(kivo-image:missing)"; }
    const ref = `a${assets.length + 1}`;
    imageRefs.set(id, ref);
    assets.push({ ref, kind: "image", mimeType: img.mimeType, fileName: null, bytes: img.bytes.length, sha256: sha(img.bytes), width: img.width, height: img.height,
      source: img.sourceUrl || img.sourceTitle || img.page ? { url: img.sourceUrl && safeHttpUrl(img.sourceUrl) ? img.sourceUrl : null, title: img.sourceTitle ?? null, page: img.page ?? null } : null });
    data.set(ref, img.bytes); total += img.bytes.length;
    return `(kivo-image:${ref})`;
  });
  const files = input.files ?? [];
  const fileById = new Map(files.map(f => [f.id, f]));
  const fileRefs = new Map<string, string>();
  const take = (f: SourceNoteFile): string | null => {
    if (fileRefs.has(f.id)) return fileRefs.get(f.id)!;
    const count = assets.filter(a => a.kind === "document").length;
    if (f.mimeType !== "application/pdf" || f.bytes.length > NOTE_PACKAGE_LIMITS.fileBytes || count >= NOTE_PACKAGE_LIMITS.files || !fits(f.bytes.length)) { filesOut++; return null; }
    const ref = `a${assets.length + 1}`;
    fileRefs.set(f.id, ref);
    assets.push({ ref, kind: "document", mimeType: f.mimeType, fileName: f.fileName.slice(0, 160), bytes: f.bytes.length, sha256: sha(f.bytes) });
    data.set(ref, f.bytes); total += f.bytes.length;
    return ref;
  };
  body = body.replace(FILE_REF, (_w, id: string) => {
    const f = fileById.get(id);
    const ref = f ? take(f) : (filesOut++, null);
    return `](kivo-file:${ref ?? "missing"})`;
  });
  // A file kept with the note but not named in its text goes at the end, so nothing it holds is dropped.
  const unnamed = files.filter(f => !fileRefs.has(f.id)).map(f => ({ f, ref: take(f) })).filter(x => x.ref);
  if (unnamed.length) body = `${body.replace(/\s+$/, "")}\n\n${unnamed.map(x => `[${x.f.fileName.replace(/[[\]\n]/g, " ")}](kivo-file:${x.ref})`).join("\n")}\n`;
  return {
    pkg: {
      format: NOTE_FORMAT, title: input.title.slice(0, NOTE_PACKAGE_LIMITS.title), body: body.slice(0, NOTE_PACKAGE_LIMITS.body),
      subjectName: input.subjectName, topicName: input.topicName, source: input.source && input.source.url && !safeHttpUrl(input.source.url) ? { title: input.source.title, url: null } : input.source,
      license: input.license ?? "all-rights-reserved",
      attribution: { creator: input.creator, exportedAt: (input.now ?? new Date()).toISOString(), packageId: input.packageId ?? randomUUID() },
      assets, excluded: { images: imagesOut, files: filesOut },
    },
    assetData: data,
  };
}

export function packNote(pkg: NotePackage, assetData: Map<string, Uint8Array>): Uint8Array {
  const meta = { format: pkg.format, title: pkg.title, subjectName: pkg.subjectName, topicName: pkg.topicName, source: pkg.source, excluded: pkg.excluded, assets: pkg.assets.map(a => ({ ...a, path: assetPath(a) })) };
  const provenance = { creator: pkg.attribution.creator, license: pkg.license, exportedAt: pkg.attribution.exportedAt, packageId: pkg.attribution.packageId };
  const files: Record<string, { data: Uint8Array; type: string }> = {
    "note.json":       { data: strToU8(JSON.stringify(meta)), type: "application/json" },
    "content/note.md": { data: strToU8(pkg.body), type: "text/markdown" },
    "provenance.json": { data: strToU8(JSON.stringify(provenance)), type: "application/json" },
  };
  for (const a of pkg.assets) {
    const d = assetData.get(a.ref);
    if (!d) throw new Error(`asset ${a.ref} has no bytes`);
    files[assetPath(a)] = { data: d, type: a.mimeType };
  }
  return packEnvelope(files, {
    packageType: "note", contentFormat: NOTE_FORMAT, packageId: pkg.attribution.packageId, createdAt: pkg.attribution.exportedAt, title: pkg.title,
    counts: { images: pkg.assets.filter(a => a.kind === "image").length, files: pkg.assets.filter(a => a.kind === "document").length, assetBytes: pkg.assets.reduce((n, a) => n + a.bytes, 0) },
  }).bytes;
}

export type NoteUnpack =
  | { ok: true; pkg: NotePackage; assetData: Map<string, Uint8Array>; sha256: string }
  | { ok: false; reason: UnpackFailure | "bad_image" | "image_not_in_file"; detail?: string; found?: "map" | "note" };

const isStr = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;
const optStr = (v: unknown, max: number) => v === null || v === undefined || isStr(v, max);

export function unpackNote(bytes: Uint8Array): NoteUnpack {
  const env = unpackEnvelope(bytes, "note", [NOTE_FORMAT]);
  if (!env.ok) return env;
  const { files, manifest } = env;
  const json = (name: string): unknown => { const f = files[name]; if (!f) return undefined; try { return JSON.parse(strFromU8(f)); } catch { return null; } };
  const meta = json("note.json") as Record<string, unknown> | null | undefined;
  const prov = json("provenance.json") as Record<string, unknown> | null | undefined;
  const md = files["content/note.md"];
  if (!meta || !md || !prov) return { ok: false, reason: "bad_note", detail: "missing part" };
  const body = strFromU8(md);
  const src = meta.source as Record<string, unknown> | null | undefined;
  if (meta.format !== NOTE_FORMAT || typeof meta.title !== "string" || !meta.title.trim() || meta.title.length > NOTE_PACKAGE_LIMITS.title || body.length > NOTE_PACKAGE_LIMITS.body
    || !optStr(meta.subjectName, 200) || !optStr(meta.topicName, 200)
    || !optStr(prov.creator, 120) || !isStr(prov.exportedAt, 40) || prov.packageId !== manifest.packageId
    || (src !== null && src !== undefined && (typeof src !== "object" || !optStr(src.title, 300) || !optStr(src.url, 2048) || (typeof src.url === "string" && !safeHttpUrl(src.url))))) {
    return { ok: false, reason: "bad_note" };
  }
  const license = (LICENSES as readonly unknown[]).includes(prov.license) ? prov.license as License : "all-rights-reserved";

  // Assets: declared in note.json, each at its own path, sizes within limits.
  const declared = Array.isArray(meta.assets) ? meta.assets as Array<Record<string, unknown>> : [];
  const assets: NoteAsset[] = [];
  let total = 0;
  for (const d of declared) {
    const kind = d.kind === "image" || d.kind === "document" ? d.kind : null;
    if (!kind || typeof d.ref !== "string" || !/^a\d{1,5}$/.test(d.ref) || assets.some(a => a.ref === d.ref)) return { ok: false, reason: "bad_asset", detail: String(d.ref ?? "") };
    const ext = kind === "image" ? IMAGE_MIME_EXT[d.mimeType as string] : d.mimeType === "application/pdf" ? "pdf" : undefined;
    if (!ext) return { ok: false, reason: "bad_asset", detail: d.ref };
    const max = kind === "image" ? NOTE_PACKAGE_LIMITS.imageBytes : NOTE_PACKAGE_LIMITS.fileBytes;
    if (typeof d.bytes !== "number" || !Number.isInteger(d.bytes) || d.bytes < 1 || d.bytes > max || typeof d.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(d.sha256)) return { ok: false, reason: "bad_asset", detail: d.ref };
    if (!optStr(d.fileName, 160)) return { ok: false, reason: "bad_asset", detail: d.ref };
    const a: NoteAsset = { ref: d.ref, kind, mimeType: d.mimeType as string, fileName: (d.fileName as string | null) ?? null, bytes: d.bytes, sha256: d.sha256,
      ...(typeof d.width === "number" ? { width: d.width } : {}), ...(typeof d.height === "number" ? { height: d.height } : {}) };
    if (d.path !== assetPath(a)) return { ok: false, reason: "bad_asset", detail: d.ref };
    total += d.bytes;
    assets.push(a);
  }
  if (assets.filter(a => a.kind === "image").length > NOTE_PACKAGE_LIMITS.images || assets.filter(a => a.kind === "document").length > NOTE_PACKAGE_LIMITS.files || total > NOTE_PACKAGE_LIMITS.assetBytes) return { ok: false, reason: "too_large" };
  const read = readAssets(files, assets.map(a => ({ ...a, noteRef: "n1" })));
  if (!read.ok) return { ok: false, reason: "bad_asset", detail: read.detail };
  // The text may name only assets the file carries, of the right kind (or the "missing" marker).
  const kindOf = new Map(assets.map(a => [a.ref, a.kind]));
  for (const m of body.matchAll(IMAGE_REF)) if (m[1] !== "missing" && kindOf.get(m[1]!) !== "image") return { ok: false, reason: "image_not_in_file", detail: m[1] };
  for (const m of body.matchAll(FILE_REF)) if (m[1] !== "missing" && kindOf.get(m[1]!) !== "document") return { ok: false, reason: "bad_asset", detail: m[1] };
  for (const m of body.matchAll(/\(kivo-image:([^)]*)\)/g)) if (!/^[A-Za-z0-9_-]{1,64}$/.test(m[1]!)) return { ok: false, reason: "image_not_in_file", detail: m[1]!.slice(0, 40) };
  const ex = meta.excluded as Record<string, unknown> | undefined;
  return {
    ok: true, sha256: env.sha256, assetData: read.data,
    pkg: {
      format: NOTE_FORMAT, title: meta.title.trim(), body, subjectName: (meta.subjectName as string | null) ?? null, topicName: (meta.topicName as string | null) ?? null,
      source: src ? { title: (src.title as string | null) ?? null, url: (src.url as string | null) ?? null } : null,
      license,
      attribution: { creator: (prov.creator as string | null) ?? null, exportedAt: prov.exportedAt as string, packageId: manifest.packageId },
      assets, excluded: { images: Number(ex?.images) || 0, files: Number(ex?.files) || 0 },
    },
  };
}
