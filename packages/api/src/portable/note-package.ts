// ─── One note, as a portable file (founder review #11; preparation) ─────────
// Pure (no database). Packs a single note (its Markdown, title, filing names,
// source and its images) into a ZIP with a checksummed manifest, and unpacks
// one treating it as hostile, with the same checks as a .kivo map
// (kivo-archive.ts): allowed paths only, sizes looked at before inflating,
// compression ratio, checksums, nothing unlisted.
//
// NOT SHIPPED: no route or page uses this yet ("for later", owner, 25 Nov).
// The extension is ".kio" (owner's choice; ".qvo", first proposed, is
// QlikView's). Maps stay ".kivo". The format is named inside the manifest
// (`kivo.note/1`), as maps' is.
//
// Images: a note's text names its images `![caption](kivo-image:<id>)`, ids
// private to the owner's account. In the package each becomes
// `kivo-image:i1`, `i2`… with the bytes in images/; an import stores them as
// the importer's own images (note-images.ts) and writes their new ids back.

import { strFromU8, strToU8, unzipSync, zipSync, type Unzipped } from "fflate";
import { createHash, randomUUID } from "node:crypto";
import { safeArchivePath } from "./kivo-archive";

export const NOTE_FORMAT = "kivo.note/1";
export const NOTE_EXTENSION = ".kio";   // owner's choice, 25 Nov 2026 (docs/KIVO_NOTE_FORMAT.md)
export const NOTE_MIME = "application/vnd.kivo.note+zip";

export const NOTE_PACKAGE_LIMITS = {
  title: 200,
  body: 1_000_000,              // notes.types NOTE_BODY_MAX
  images: 20,
  imageBytes: 2_500_000,        // note-images NOTE_IMAGE_BYTES_MAX
  compressedBytes: 30_000_000,
  ratio: 200,
} as const;

const IMAGE_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const ALLOWED = /^(manifest\.json|note\.md|note\.json|images\/i\d{1,3}\.(png|jpg|webp))$/;
const IMAGE_REF = /\(kivo-image:([A-Za-z0-9_-]{1,64})\)/g;

export interface NoteImage { id: string; mimeType: string; bytes: Uint8Array }
export interface NoteSource { title: string | null; url: string | null }
export interface NotePackage {
  format: typeof NOTE_FORMAT;
  title: string;
  body: string;                          // Markdown, images as kivo-image:i<n>
  subjectName: string | null;            // where the creator filed it, as names (a hint; the importer chooses)
  topicName: string | null;
  source: NoteSource | null;
  attribution: { creator: string | null; exportedAt: string; packageId: string };
  images: Array<{ ref: string; mimeType: string; bytes: Uint8Array }>;
  excluded: { images: number };          // images the note named that could not be carried
}

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

export function buildNotePackage(input: {
  title: string; body: string; subjectName: string | null; topicName: string | null; source: NoteSource | null;
  creator: string | null; images: NoteImage[]; now?: Date; packageId?: string;
}): NotePackage {
  const byId = new Map(input.images.map(i => [i.id, i]));
  const refs = new Map<string, string>();
  const images: NotePackage["images"] = [];
  let excluded = 0;
  const body = input.body.replace(IMAGE_REF, (whole, id: string) => {
    if (refs.has(id)) return `(kivo-image:${refs.get(id)})`;
    const img = byId.get(id);
    if (!img || !IMAGE_TYPES[img.mimeType] || img.bytes.length > NOTE_PACKAGE_LIMITS.imageBytes || images.length >= NOTE_PACKAGE_LIMITS.images) { excluded++; return "(kivo-image:missing)"; }
    const ref = `i${images.length + 1}`;
    refs.set(id, ref);
    images.push({ ref, mimeType: img.mimeType, bytes: img.bytes });
    return `(kivo-image:${ref})`;
  });
  return {
    format: NOTE_FORMAT, title: input.title.slice(0, NOTE_PACKAGE_LIMITS.title), body: body.slice(0, NOTE_PACKAGE_LIMITS.body),
    subjectName: input.subjectName, topicName: input.topicName, source: input.source,
    attribution: { creator: input.creator, exportedAt: (input.now ?? new Date()).toISOString(), packageId: input.packageId ?? randomUUID() },
    images, excluded: { images: excluded },
  };
}

export function packNote(pkg: NotePackage): Uint8Array {
  const meta = { format: pkg.format, title: pkg.title, subjectName: pkg.subjectName, topicName: pkg.topicName, source: pkg.source, attribution: pkg.attribution, excluded: pkg.excluded, images: pkg.images.map(i => ({ ref: i.ref, mimeType: i.mimeType })) };
  const files: Record<string, Uint8Array> = { "note.md": strToU8(pkg.body), "note.json": strToU8(JSON.stringify(meta)) };
  for (const i of pkg.images) files[`images/${i.ref}.${IMAGE_TYPES[i.mimeType]}`] = i.bytes;
  const manifest = { format: NOTE_FORMAT, packageId: pkg.attribution.packageId, files: Object.entries(files).map(([path, b]) => ({ path, bytes: b.length, sha256: sha(b) })) };
  return zipSync({ "manifest.json": strToU8(JSON.stringify(manifest)), ...files }, { level: 9, mtime: new Date("2020-01-01T00:00:00Z") });
}

export type NoteUnpack = { ok: true; pkg: NotePackage } | { ok: false; reason: string; detail?: string };

const isStr = (v: unknown, max: number) => typeof v === "string" && v.length <= max;
const optStr = (v: unknown, max: number) => v === null || v === undefined || isStr(v, max);

export function unpackNote(bytes: Uint8Array): NoteUnpack {
  if (bytes.length === 0 || bytes.length > NOTE_PACKAGE_LIMITS.compressedBytes) return { ok: false, reason: "too_large" };
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) return { ok: false, reason: "not_a_note_file" };
  let refusal: { reason: string; detail?: string } | null = null, count = 0, declared = 0;
  const fileMax = Math.max(NOTE_PACKAGE_LIMITS.body * 4, NOTE_PACKAGE_LIMITS.imageBytes) + 4096;
  let files: Unzipped;
  try {
    files = unzipSync(bytes, {
      filter: f => {
        count++;
        if (refusal) return false;
        if (count > NOTE_PACKAGE_LIMITS.images + 4) refusal = { reason: "too_many_files" };
        else if (!safeArchivePath(f.name)) refusal = { reason: "unsafe_path", detail: f.name.slice(0, 80) };
        else if (!ALLOWED.test(f.name)) refusal = { reason: "unexpected_file", detail: f.name.slice(0, 80) };
        else if (f.originalSize > fileMax) refusal = { reason: "entry_too_large", detail: f.name };
        else if (f.size > 0 && f.originalSize / f.size > NOTE_PACKAGE_LIMITS.ratio && f.originalSize > 1_000_000) refusal = { reason: "compression_bomb", detail: f.name };
        else { declared += f.originalSize; if (declared > fileMax * 2) refusal = { reason: "compression_bomb" }; }
        return !refusal;
      },
    });
  } catch { return { ok: false, reason: refusal ? (refusal as { reason: string }).reason : "not_a_note_file" }; }
  if (refusal) return { ok: false, ...(refusal as { reason: string; detail?: string }) };
  for (const [name, data] of Object.entries(files)) if (data.length > fileMax) return { ok: false, reason: "entry_too_large", detail: name };

  const json = (name: string): unknown => { const f = files[name]; if (!f) return undefined; try { return JSON.parse(strFromU8(f)); } catch { return null; } };
  const manifest = json("manifest.json") as { format?: unknown; packageId?: unknown; files?: Array<{ path: unknown; bytes: unknown; sha256: unknown }> } | null | undefined;
  if (!manifest || !Array.isArray(manifest.files)) return { ok: false, reason: "bad_manifest" };
  if (manifest.format !== NOTE_FORMAT) return { ok: false, reason: "unsupported_version" };
  const listed = new Set<string>();
  for (const e of manifest.files) {
    if (typeof e?.path !== "string" || !ALLOWED.test(e.path) || e.path === "manifest.json") return { ok: false, reason: "bad_manifest" };
    const data = files[e.path];
    if (!data) return { ok: false, reason: "missing_file", detail: e.path };
    if (sha(data) !== e.sha256 || data.length !== e.bytes) return { ok: false, reason: "checksum_mismatch", detail: e.path };
    listed.add(e.path);
  }
  for (const name of Object.keys(files)) if (name !== "manifest.json" && !listed.has(name)) return { ok: false, reason: "inventory_mismatch", detail: name };

  const meta = json("note.json") as Record<string, unknown> | null | undefined;
  const md = files["note.md"];
  if (!meta || !md) return { ok: false, reason: "bad_note" };
  const body = strFromU8(md);
  const a = meta.attribution as Record<string, unknown> | undefined;
  const src = meta.source as Record<string, unknown> | null | undefined;
  if (meta.format !== NOTE_FORMAT || typeof meta.title !== "string" || !meta.title.trim() || meta.title.length > NOTE_PACKAGE_LIMITS.title || body.length > NOTE_PACKAGE_LIMITS.body
    || !optStr(meta.subjectName, 200) || !optStr(meta.topicName, 200)
    || !a || !optStr(a.creator, 120) || !isStr(a.exportedAt, 40) || !(typeof a.packageId === "string" && a.packageId === manifest.packageId && /^[0-9a-f-]{36}$/i.test(a.packageId))
    || (src !== null && src !== undefined && (!optStr(src.title, 300) || !optStr(src.url, 2048) || (typeof src.url === "string" && !/^https?:\/\//i.test(src.url))))) {
    return { ok: false, reason: "bad_note" };
  }
  const declaredImages = Array.isArray(meta.images) ? meta.images as Array<{ ref: unknown; mimeType: unknown }> : [];
  const images: NotePackage["images"] = [];
  for (const d of declaredImages) {
    if (typeof d.ref !== "string" || !/^i\d{1,3}$/.test(d.ref) || typeof d.mimeType !== "string" || !IMAGE_TYPES[d.mimeType]) return { ok: false, reason: "bad_image" };
    const data = files[`images/${d.ref}.${IMAGE_TYPES[d.mimeType]}`];
    if (!data || data.length > NOTE_PACKAGE_LIMITS.imageBytes || !sniffMatches(data, d.mimeType)) return { ok: false, reason: "bad_image", detail: d.ref };
    images.push({ ref: d.ref, mimeType: d.mimeType, bytes: data });
  }
  // The text may name only images the file carries (or the "missing" marker).
  const known = new Set(images.map(i => i.ref));
  for (const m of body.matchAll(IMAGE_REF)) if (m[1] !== "missing" && !known.has(m[1]!)) return { ok: false, reason: "image_not_in_file", detail: m[1] };
  return {
    ok: true,
    pkg: {
      format: NOTE_FORMAT, title: meta.title, body, subjectName: (meta.subjectName as string | null) ?? null, topicName: (meta.topicName as string | null) ?? null,
      source: src ? { title: (src.title as string | null) ?? null, url: (src.url as string | null) ?? null } : null,
      attribution: { creator: (a.creator as string | null) ?? null, exportedAt: a.exportedAt as string, packageId: a.packageId as string },
      images, excluded: { images: Number((meta.excluded as Record<string, unknown> | undefined)?.images) || 0 },
    },
  };
}

// The bytes are the image type they claim (magic numbers), so a script can't pass as a picture.
function sniffMatches(b: Uint8Array, mime: string): boolean {
  if (mime === "image/png") return b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  if (mime === "image/jpeg") return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (mime === "image/webp") return b.length > 12 && strFromU8(b.subarray(0, 4)) === "RIFF" && strFromU8(b.subarray(8, 12)) === "WEBP";
  return false;
}
