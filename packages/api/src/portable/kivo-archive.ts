// ─── The .kivo file: a ZIP with a manifest, the graph, notes and provenance ──
// Pure (no database). Packs a MapPackage into bytes and unpacks bytes into a
// MapPackage, treating every uploaded file as hostile until it is checked.
//
//   manifest.json     format, package id, created time, inventory: every
//                     other file's path, size, type and sha256
//   graph.json        the map: subjects (nested), topics (nested), resources
//                     (external links), note references, all by package refs
//   content/notes/<ref>.md   one approved note each, Markdown
//   provenance.json   creator, source, licence, export time
//
// Format 1 carries no binary attachments: note images and PDFs are not in
// it (counted in graph.json `excluded`), and saved pages travel as links.
// A future format adds resources/ with the same inventory and checks.

import { strFromU8, strToU8, unzipSync, zipSync, type Unzipped } from "fflate";
import { createHash, randomUUID } from "node:crypto";
import { MAP_FORMAT, PACKAGE_LIMITS, validatePackage, type MapPackage } from "./map-package";

export const ARCHIVE_FORMAT = "kivo.archive/1";
export const KIVO_EXTENSION = ".kivo";
export const KIVO_MIME = "application/vnd.kivo.map+zip";

// What an upload may be. Checked before anything is inflated.
export const ARCHIVE_LIMITS = {
  compressedBytes:   10_000_000,   // the uploaded file
  files:             PACKAGE_LIMITS.notes + 8,
  fileBytes:         PACKAGE_LIMITS.noteBody * 4 + 4_096,   // one entry, inflated (UTF-8 can be up to 4 bytes a character)
  totalBytes:        PACKAGE_LIMITS.bytes * 2,              // all entries, inflated
  ratio:             200,          // inflated : compressed, per entry and overall
} as const;

const ALLOWED = /^(manifest\.json|graph\.json|provenance\.json|content\/notes\/n\d{1,5}\.md)$/;

export interface ManifestEntry { path: string; bytes: number; type: string; sha256: string }
export interface Manifest {
  format:     typeof ARCHIVE_FORMAT;
  mapFormat:  typeof MAP_FORMAT;
  packageId:  string;
  createdAt:  string;
  title:      string;
  counts:     { subjects: number; topics: number; notes: number; resources: number; edges: number; nestedSubjects: number };
  files:      ManifestEntry[];
}

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

// Edges a map draws from a package: a subject inside a subject, a topic in
// its subject, a topic inside a topic, a note or resource filed under one.
export function edgeCount(pkg: MapPackage): number {
  return pkg.subjects.filter(s => s.parentRef).length + pkg.topics.length + pkg.topics.filter(t => t.parentRef).length
    + pkg.notes.filter(n => n.subjectRef).length + pkg.resources.filter(r => r.subjectRef).length;
}

// ── Pack ──
export function packArchive(pkg: MapPackage, opts: { packageId?: string; now?: Date } = {}): { bytes: Uint8Array; manifest: Manifest } {
  const packageId = opts.packageId ?? randomUUID();
  const createdAt = (opts.now ?? new Date()).toISOString();
  const { notes, attribution, ...rest } = pkg;
  const graph = { ...rest, attribution: { ...attribution, packageId }, notes: notes.map(n => ({ ref: n.ref, title: n.title, subjectRef: n.subjectRef, topicName: n.topicName, path: `content/notes/${n.ref}.md` })) };
  const provenance = { creator: attribution.creator, source: attribution.source, license: pkg.license, exportedAt: createdAt, packageId, importedFrom: attribution.importedFrom ?? null };

  const files: Record<string, { data: Uint8Array; type: string }> = {
    "graph.json":      { data: strToU8(JSON.stringify(graph)), type: "application/json" },
    "provenance.json": { data: strToU8(JSON.stringify(provenance)), type: "application/json" },
  };
  for (const n of notes) files[`content/notes/${n.ref}.md`] = { data: strToU8(n.body), type: "text/markdown" };

  const manifest: Manifest = {
    format: ARCHIVE_FORMAT, mapFormat: MAP_FORMAT, packageId, createdAt, title: pkg.title,
    counts: { subjects: pkg.subjects.length, topics: pkg.topics.length, notes: notes.length, resources: pkg.resources.length, edges: edgeCount(pkg), nestedSubjects: pkg.subjects.filter(s => s.parentRef).length },
    files: Object.entries(files).map(([path, f]) => ({ path, bytes: f.data.length, type: f.type, sha256: sha(f.data) })),
  };
  const zipInput: Record<string, Uint8Array> = { "manifest.json": strToU8(JSON.stringify(manifest, null, 2)) };
  for (const [path, f] of Object.entries(files)) zipInput[path] = f.data;
  return { bytes: zipSync(zipInput, { level: 9, mtime: new Date("2020-01-01T00:00:00Z") }), manifest };
}

// ── Unpack: every check before the package is used ──
export type UnpackResult =
  | { ok: true; pkg: MapPackage; manifest: Manifest; sha256: string }
  | { ok: false; reason: UnpackFailure; detail?: string };

export type UnpackFailure =
  | "too_large" | "not_a_kivo_file" | "too_many_files" | "unsafe_path" | "unexpected_file" | "entry_too_large"
  | "compression_bomb" | "missing_manifest" | "bad_manifest" | "unsupported_version" | "missing_file" | "checksum_mismatch"
  | "inventory_mismatch" | "bad_graph" | "bad_note";

export function safeArchivePath(path: string): boolean {
  if (!path || path.length > 200) return false;
  if (path.startsWith("/") || path.includes("\\") || path.includes("\0") || /[\x00-\x1f]/.test(path)) return false;
  if (path.split("/").some(part => part === ".." || part === "." || part === "")) return false;
  return true;
}

export function unpackArchive(bytes: Uint8Array): UnpackResult {
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
        else if (!ALLOWED.test(f.name)) refusal = { reason: "unexpected_file", detail: f.name.slice(0, 80) };
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

  const json = (name: string): unknown => { const f = files[name]; if (!f) return undefined; try { return JSON.parse(strFromU8(f)); } catch { return null; } };
  const manifest = json("manifest.json") as Manifest | undefined | null;
  if (manifest === undefined) return { ok: false, reason: "missing_manifest" };
  if (!manifest || typeof manifest !== "object" || !Array.isArray(manifest.files)) return { ok: false, reason: "bad_manifest" };
  if (manifest.format !== ARCHIVE_FORMAT || manifest.mapFormat !== MAP_FORMAT) return { ok: false, reason: "unsupported_version", detail: `${String(manifest.format)} / ${String(manifest.mapFormat)}` };
  if (typeof manifest.packageId !== "string" || !/^[0-9a-f-]{36}$/i.test(manifest.packageId)) return { ok: false, reason: "bad_manifest", detail: "packageId" };

  // Every listed file is present with its checksum, and nothing else is there.
  const listed = new Set<string>();
  for (const e of manifest.files) {
    if (!e || typeof e.path !== "string" || !ALLOWED.test(e.path) || e.path === "manifest.json" || typeof e.sha256 !== "string") return { ok: false, reason: "bad_manifest", detail: "files" };
    const data = files[e.path];
    if (!data) return { ok: false, reason: "missing_file", detail: e.path };
    if (sha(data) !== e.sha256 || data.length !== e.bytes) return { ok: false, reason: "checksum_mismatch", detail: e.path };
    listed.add(e.path);
  }
  for (const name of Object.keys(files)) if (name !== "manifest.json" && !listed.has(name)) return { ok: false, reason: "inventory_mismatch", detail: name };

  // Rebuild the package from graph.json and the note files, then validate it whole.
  const graph = json("graph.json") as Record<string, unknown> | null | undefined;
  if (!graph || typeof graph !== "object" || !Array.isArray(graph.notes)) return { ok: false, reason: "bad_graph" };
  const notes: unknown[] = [];
  for (const n of graph.notes as Array<Record<string, unknown>>) {
    const path = typeof n?.ref === "string" ? `content/notes/${n.ref}.md` : "";
    if (!path || n.path !== path || !files[path]) return { ok: false, reason: "bad_note", detail: String(n?.ref ?? "") };
    notes.push({ ref: n.ref, title: n.title, body: strFromU8(files[path]!), subjectRef: n.subjectRef ?? null, topicName: n.topicName ?? null });
  }
  const checked = validatePackage({ ...graph, notes });
  if (!checked.ok) return { ok: false, reason: "bad_graph", detail: checked.reason };
  return { ok: true, pkg: checked.pkg, manifest, sha256: sha(bytes) };
}
