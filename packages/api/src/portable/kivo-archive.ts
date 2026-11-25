// ─── The .kivo file: one hardened envelope for maps and notes ────────────────
// Pure (no database). A .kivo file is a ZIP whose manifest.json says what it
// is and lists every other file with its size, type and sha256. Every upload
// is hostile until it passes the same checks, whatever it claims to be:
// sizes looked at before anything is inflated, a compression-ratio guard,
// allowed paths only, every listed file present with its checksum, nothing
// unlisted. Only then is its content read (and validated whole).
//
// Identity (manifest.json), from 25 Nov 2026:
//   format          "kivo.archive/1"       the envelope
//   packageType     "map" | "note"         what is inside
//   contentFormat   "kivo.map/2" | "kivo.note/1" (or "kivo.map/1")
// A map's manifest also keeps `mapFormat` (= contentFormat), which is how
// files made before 25 Nov say what they are; a manifest without
// packageType is a map. A map importer refuses a note and a note importer a
// map, before anything is written (wrong_package_type).
//
// A map (portable/map-package.ts):
//   manifest.json  graph.json  provenance.json
//   content/notes/n<k>.md            one note each, Markdown
//   assets/images/a<k>.png|jpg|webp  format 2: images in notes
//   assets/documents/a<k>.pdf        format 2: files kept with notes
// A note (portable/note-package.ts):
//   manifest.json  note.json  content/note.md  provenance.json
//   assets/images/…  assets/documents/…
// assets/other/ is reserved: nothing writes it, and a file there is refused.

import { strFromU8, strToU8, unzipSync, zipSync, type Unzipped } from "fflate";
import { createHash, randomUUID } from "node:crypto";
import { IMAGE_MIME_EXT, MAP_FORMAT_V1, MAP_FORMAT_V2, MAP_FORMATS, PACKAGE_LIMITS, validatePackage, type MapFormat, type MapPackage, type PackageAsset } from "./map-package";
import { imageInfo } from "../nova/product/image-info";
import { fileInfo } from "../nova/product/note-files";

export const ARCHIVE_FORMAT = "kivo.archive/1";
export const KIVO_EXTENSION = ".kivo";
export const KIVO_MIME = "application/vnd.kivo.map+zip";
export const KIVO_NOTE_MIME = "application/vnd.kivo.note+zip";
export type PackageType = "map" | "note";

// What an upload may be. Checked before anything is inflated.
export const ARCHIVE_LIMITS = {
  compressedBytes:   50_000_000,   // the uploaded file
  files:             PACKAGE_LIMITS.notes + PACKAGE_LIMITS.assets + 8,
  fileBytes:         Math.max(PACKAGE_LIMITS.noteBody * 4 + 4_096, PACKAGE_LIMITS.fileBytes),   // one entry, inflated (UTF-8 can be up to 4 bytes a character)
  totalBytes:        PACKAGE_LIMITS.bytes + PACKAGE_LIMITS.assetBytes,                          // all entries, inflated
  ratio:             200,          // inflated : compressed, per entry over 1 MB
} as const;

export interface ManifestEntry { path: string; bytes: number; type: string; sha256: string }
export interface EnvelopeManifest {
  format:        typeof ARCHIVE_FORMAT;
  packageType:   PackageType;
  contentFormat: string;
  packageId:     string;
  createdAt:     string;
  title:         string;
  files:         ManifestEntry[];
}
export interface Manifest extends EnvelopeManifest {
  mapFormat:  MapFormat;
  counts:     { subjects: number; topics: number; notes: number; resources: number; edges: number; nestedSubjects: number; images?: number; files?: number; tasks?: number; assetBytes?: number };
}

export const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const ZIP_TIME = new Date("2020-01-01T00:00:00Z");

// Edges a map draws from a package: a subject inside a subject, a topic in
// its subject, a topic inside a topic, a note or resource filed under one.
export function edgeCount(pkg: MapPackage): number {
  return pkg.subjects.filter(s => s.parentRef).length + pkg.topics.length + pkg.topics.filter(t => t.parentRef).length
    + pkg.notes.filter(n => n.subjectRef).length + pkg.resources.filter(r => r.subjectRef).length;
}

/** Where an asset's bytes live in the archive. */
export function assetPath(a: Pick<PackageAsset, "ref" | "kind" | "mimeType">): string {
  return a.kind === "image" ? `assets/images/${a.ref}.${IMAGE_MIME_EXT[a.mimeType]}` : `assets/documents/${a.ref}.pdf`;
}

// ── The envelope, for any content ──

export function packEnvelope(
  files: Record<string, { data: Uint8Array; type: string }>,
  manifest: Omit<EnvelopeManifest, "files" | "format"> & Record<string, unknown>,
): { bytes: Uint8Array; manifest: EnvelopeManifest & Record<string, unknown> } {
  const full = { format: ARCHIVE_FORMAT, ...manifest, files: Object.entries(files).map(([path, f]) => ({ path, bytes: f.data.length, type: f.type, sha256: sha(f.data) })) } as EnvelopeManifest & Record<string, unknown>;
  const zipInput: Record<string, Uint8Array> = { "manifest.json": strToU8(JSON.stringify(full, null, 2)) };
  // Already-compressed assets are stored, not deflated again.
  for (const [path, f] of Object.entries(files)) zipInput[path] = f.data;
  const input: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = { ...zipInput };
  for (const p of Object.keys(files)) if (p.startsWith("assets/")) input[p] = [zipInput[p]!, { level: 0 }];
  return { bytes: zipSync(input, { level: 9, mtime: ZIP_TIME }), manifest: full };
}

export type UnpackFailure =
  | "too_large" | "not_a_kivo_file" | "too_many_files" | "unsafe_path" | "unexpected_file" | "entry_too_large"
  | "compression_bomb" | "missing_manifest" | "bad_manifest" | "unsupported_version" | "missing_file" | "checksum_mismatch"
  | "inventory_mismatch" | "bad_graph" | "bad_note" | "bad_asset" | "wrong_package_type";

export function safeArchivePath(path: string): boolean {
  if (!path || path.length > 200) return false;
  if (path.startsWith("/") || path.includes("\\") || path.includes("\0") || /[\x00-\x1f]/.test(path)) return false;
  if (path.split("/").some(part => part === ".." || part === "." || part === "")) return false;
  return true;
}

const ALLOWED_ANY = /^(manifest\.json|graph\.json|note\.json|provenance\.json|content\/note\.md|content\/notes\/n\d{1,5}\.md|assets\/images\/a\d{1,5}\.(png|jpg|webp)|assets\/documents\/a\d{1,5}\.pdf)$/;
const ALLOWED: Record<PackageType, RegExp> = {
  map:  /^(manifest\.json|graph\.json|provenance\.json|content\/notes\/n\d{1,5}\.md|assets\/images\/a\d{1,5}\.(png|jpg|webp)|assets\/documents\/a\d{1,5}\.pdf)$/,
  note: /^(manifest\.json|note\.json|provenance\.json|content\/note\.md|assets\/images\/a\d{1,5}\.(png|jpg|webp)|assets\/documents\/a\d{1,5}\.pdf)$/,
};

export type EnvelopeResult =
  | { ok: true; files: Unzipped; manifest: EnvelopeManifest & Record<string, unknown>; packageType: PackageType; sha256: string }
  | { ok: false; reason: UnpackFailure; detail?: string; found?: PackageType };

// What a manifest says it is. A manifest from before 25 Nov has no
// packageType: a map says mapFormat, the unshipped note preparation said
// format "kivo.note/1".
function identity(m: Record<string, unknown>): { packageType: PackageType; contentFormat: string } | null {
  if (m.packageType === "map" || m.packageType === "note") return typeof m.contentFormat === "string" ? { packageType: m.packageType, contentFormat: m.contentFormat } : null;
  if (m.packageType !== undefined) return null;
  if (typeof m.mapFormat === "string") return { packageType: "map", contentFormat: m.mapFormat };
  if (m.format === "kivo.note/1") return { packageType: "note", contentFormat: "kivo.note/1" };
  return null;
}

/**
 * Opens a .kivo file as the `expect`ed type, or says why not. Refuses a file
 * of the other type (wrong_package_type, with `found`) before anything is
 * written. Every check here is on bytes alone.
 */
export function unpackEnvelope(bytes: Uint8Array, expect: PackageType, contentFormats: readonly string[]): EnvelopeResult {
  if (bytes.length === 0 || bytes.length > ARCHIVE_LIMITS.compressedBytes) return { ok: false, reason: "too_large" };
  // A ZIP starts with a local file header (PK\x03\x04).
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) return { ok: false, reason: "not_a_kivo_file" };

  // Look at every entry's declared sizes before inflating anything.
  let refusal: { reason: UnpackFailure; detail?: string } | null = null;
  let count = 0, declared = 0;
  let files: Unzipped;
  try {
    files = unzipSync(bytes, {
      filter: f => {
        count += 1;
        if (refusal) return false;
        if (count > ARCHIVE_LIMITS.files) refusal = { reason: "too_many_files" };
        else if (!safeArchivePath(f.name)) refusal = { reason: "unsafe_path", detail: f.name.slice(0, 80) };
        else if (!ALLOWED_ANY.test(f.name)) refusal = { reason: "unexpected_file", detail: f.name.slice(0, 80) };
        else if (f.originalSize > ARCHIVE_LIMITS.fileBytes) refusal = { reason: "entry_too_large", detail: f.name };
        else if (f.size > 0 && f.originalSize / f.size > ARCHIVE_LIMITS.ratio && f.originalSize > 1_000_000) refusal = { reason: "compression_bomb", detail: f.name };
        else { declared += f.originalSize; if (declared > ARCHIVE_LIMITS.totalBytes) refusal = { reason: "compression_bomb" }; }
        return !refusal;
      },
    });
  } catch {
    return { ok: false, reason: refusal ? (refusal as { reason: UnpackFailure }).reason : "not_a_kivo_file" };
  }
  if (refusal) return { ok: false, ...(refusal as { reason: UnpackFailure; detail?: string }) };
  // Sizes as inflated, not as declared: a header can lie.
  let actual = 0;
  for (const [name, data] of Object.entries(files)) {
    if (data.length > ARCHIVE_LIMITS.fileBytes) return { ok: false, reason: "entry_too_large", detail: name };
    actual += data.length;
  }
  if (actual > ARCHIVE_LIMITS.totalBytes) return { ok: false, reason: "compression_bomb" };

  const raw = files["manifest.json"];
  if (!raw) return { ok: false, reason: "missing_manifest" };
  let manifest: Record<string, unknown> | null = null;
  try { manifest = JSON.parse(strFromU8(raw)) as Record<string, unknown>; } catch { manifest = null; }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest) || !Array.isArray(manifest.files)) return { ok: false, reason: "bad_manifest" };
  const id = identity(manifest);
  if (!id) return { ok: false, reason: "unsupported_version", detail: `${String(manifest.format)} / ${String(manifest.packageType ?? manifest.mapFormat)}` };
  // The other kind of .kivo: said before anything else about it is trusted.
  if (id.packageType !== expect) return { ok: false, reason: "wrong_package_type", found: id.packageType };
  const envelopeOk = manifest.format === ARCHIVE_FORMAT || (id.packageType === "note" && manifest.format === "kivo.note/1");
  if (!envelopeOk || !contentFormats.includes(id.contentFormat)) return { ok: false, reason: "unsupported_version", detail: `${String(manifest.format)} / ${id.contentFormat}` };
  if (typeof manifest.packageId !== "string" || !/^[0-9a-f-]{36}$/i.test(manifest.packageId)) return { ok: false, reason: "bad_manifest", detail: "packageId" };

  // Every listed file is present with its checksum, and nothing else is there.
  const allowed = ALLOWED[expect];
  const listed = new Set<string>();
  for (const e of manifest.files as Array<Record<string, unknown>>) {
    if (!e || typeof e.path !== "string" || !allowed.test(e.path) || e.path === "manifest.json" || typeof e.sha256 !== "string" || listed.has(e.path)) return { ok: false, reason: "bad_manifest", detail: "files" };
    const data = files[e.path];
    if (!data) return { ok: false, reason: "missing_file", detail: e.path };
    if (sha(data) !== e.sha256 || data.length !== e.bytes) return { ok: false, reason: "checksum_mismatch", detail: e.path };
    listed.add(e.path);
  }
  for (const name of Object.keys(files)) {
    if (name === "manifest.json") continue;
    if (!allowed.test(name)) return { ok: false, reason: "unexpected_file", detail: name.slice(0, 80) };
    if (!listed.has(name)) return { ok: false, reason: "inventory_mismatch", detail: name };
  }
  return {
    ok: true, files, packageType: id.packageType, sha256: sha(bytes),
    manifest: { ...manifest, packageType: id.packageType, contentFormat: id.contentFormat } as EnvelopeManifest & Record<string, unknown>,
  };
}

/** What a .kivo file says it is (map or note), from its manifest alone, or null. For routing an upload and for messages; never a substitute for unpacking. */
export function sniffPackageType(bytes: Uint8Array): PackageType | null {
  const r = unpackEnvelope(bytes, "map", MAP_FORMATS);
  if (r.ok) return "map";
  if (r.reason === "wrong_package_type") return r.found ?? null;
  return null;
}

/** Checks each asset's bytes against what the package says about it: size, sha256 and real type (magic bytes). */
export function readAssets(files: Unzipped, assets: PackageAsset[]): { ok: true; data: Map<string, Uint8Array> } | { ok: false; detail: string } {
  const data = new Map<string, Uint8Array>();
  for (const a of assets) {
    const b = files[assetPath(a)];
    if (!b) return { ok: false, detail: `${a.ref} missing` };
    if (b.length !== a.bytes || sha(b) !== a.sha256) return { ok: false, detail: `${a.ref} checksum` };
    if (a.kind === "image") {
      const info = imageInfo(b);
      if (!info || info.type !== a.mimeType) return { ok: false, detail: `${a.ref} not the image it says` };
    } else if (!fileInfo(b)) return { ok: false, detail: `${a.ref} not a PDF` };
    data.set(a.ref, b);
  }
  // Nothing under assets/ that the package does not name.
  const named = new Set(assets.map(assetPath));
  for (const name of Object.keys(files)) if (name.startsWith("assets/") && !named.has(name)) return { ok: false, detail: `${name} not in the package` };
  return { ok: true, data };
}

// ── A map ──

export function packArchive(pkg: MapPackage, opts: { packageId?: string; now?: Date; assetData?: Map<string, Uint8Array> } = {}): { bytes: Uint8Array; manifest: Manifest } {
  const packageId = opts.packageId ?? randomUUID();
  const createdAt = (opts.now ?? new Date()).toISOString();
  const { notes, attribution, assets, tasks, ...rest } = pkg;
  const v2 = pkg.format === MAP_FORMAT_V2;
  const graph = {
    ...rest, attribution: { ...attribution, packageId },
    notes: notes.map(n => ({ ref: n.ref, title: n.title, subjectRef: n.subjectRef, topicName: n.topicName, path: `content/notes/${n.ref}.md` })),
    // Format 1 files never had these keys; older Kivo reads them as they were.
    ...(v2 ? { assets: assets.map(a => ({ ...a, path: assetPath(a) })), tasks } : {}),
  };
  const provenance = { creator: attribution.creator, source: attribution.source, license: pkg.license, exportedAt: createdAt, packageId, importedFrom: attribution.importedFrom ?? null };

  const files: Record<string, { data: Uint8Array; type: string }> = {
    "graph.json":      { data: strToU8(JSON.stringify(graph)), type: "application/json" },
    "provenance.json": { data: strToU8(JSON.stringify(provenance)), type: "application/json" },
  };
  for (const n of notes) files[`content/notes/${n.ref}.md`] = { data: strToU8(n.body), type: "text/markdown" };
  if (v2) for (const a of assets) {
    const data = opts.assetData?.get(a.ref);
    if (!data) throw new Error(`asset ${a.ref} has no bytes`);
    files[assetPath(a)] = { data, type: a.mimeType };
  }

  const { bytes, manifest } = packEnvelope(files, {
    packageType: "map", contentFormat: pkg.format, mapFormat: pkg.format, packageId, createdAt, title: pkg.title,
    counts: {
      subjects: pkg.subjects.length, topics: pkg.topics.length, notes: notes.length, resources: pkg.resources.length, edges: edgeCount(pkg), nestedSubjects: pkg.subjects.filter(s => s.parentRef).length,
      ...(v2 ? { images: assets.filter(a => a.kind === "image").length, files: assets.filter(a => a.kind === "document").length, tasks: tasks.length, assetBytes: assets.reduce((n, a) => n + a.bytes, 0) } : {}),
    },
  });
  return { bytes, manifest: manifest as unknown as Manifest };
}

export type UnpackResult =
  | { ok: true; pkg: MapPackage; manifest: Manifest; sha256: string; assetData: Map<string, Uint8Array> }
  | { ok: false; reason: UnpackFailure; detail?: string; found?: PackageType };

export function unpackArchive(bytes: Uint8Array): UnpackResult {
  const env = unpackEnvelope(bytes, "map", MAP_FORMATS);
  if (!env.ok) return env;
  const { files } = env;
  const manifest = env.manifest as unknown as Manifest;
  if (!(MAP_FORMATS as readonly unknown[]).includes(manifest.mapFormat ?? manifest.contentFormat)) return { ok: false, reason: "unsupported_version" };
  const json = (name: string): unknown => { const f = files[name]; if (!f) return undefined; try { return JSON.parse(strFromU8(f)); } catch { return null; } };

  // Rebuild the package from graph.json and the note files, then validate it whole.
  const graph = json("graph.json") as Record<string, unknown> | null | undefined;
  if (!graph || typeof graph !== "object" || !Array.isArray(graph.notes)) return { ok: false, reason: "bad_graph" };
  const notes: unknown[] = [];
  for (const n of graph.notes as Array<Record<string, unknown>>) {
    const path = typeof n?.ref === "string" ? `content/notes/${n.ref}.md` : "";
    if (!path || n.path !== path || !files[path]) return { ok: false, reason: "bad_note", detail: String(n?.ref ?? "") };
    notes.push({ ref: n.ref, title: n.title, body: strFromU8(files[path]!), subjectRef: n.subjectRef ?? null, topicName: n.topicName ?? null });
  }
  // An asset's path is where assetPath puts it, nowhere else.
  const assets = Array.isArray(graph.assets) ? (graph.assets as Array<Record<string, unknown>>).map(a => {
    const { path, ...rest } = a ?? {};
    return { rest, path };
  }) : null;
  if (assets) for (const a of assets) {
    const r = a.rest as Record<string, unknown>;
    const ext = r.kind === "image" ? IMAGE_MIME_EXT[r.mimeType as string] : "pdf";
    if (typeof r.ref !== "string" || !ext || a.path !== (r.kind === "image" ? `assets/images/${r.ref}.${ext}` : `assets/documents/${r.ref}.pdf`)) return { ok: false, reason: "bad_asset", detail: String(r.ref ?? "") };
  }
  const checked = validatePackage({ ...graph, notes, ...(assets ? { assets: assets.map(a => a.rest) } : {}) });
  if (!checked.ok) return { ok: false, reason: "bad_graph", detail: checked.reason };
  // The graph and the manifest name the same format: a file can't say one and be the other.
  if (checked.pkg.format !== manifest.mapFormat || checked.pkg.format !== manifest.contentFormat) return { ok: false, reason: "bad_manifest", detail: "mapFormat" };
  const read = readAssets(files, checked.pkg.assets);
  if (!read.ok) return { ok: false, reason: "bad_asset", detail: read.detail };
  return { ok: true, pkg: checked.pkg, manifest, sha256: env.sha256, assetData: read.data };
}

export { MAP_FORMAT_V1, MAP_FORMAT_V2 };
