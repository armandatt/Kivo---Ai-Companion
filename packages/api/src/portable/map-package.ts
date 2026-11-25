// ─── A Knowledge Map, as a portable package (the graph inside a .kivo file) ──
// Pure: no database, no model. This is the transport form of a map: what an
// export writes into graph.json and content/, and what an import is rebuilt
// from (portable/kivo-archive.ts packs and unpacks the file). It is never
// canonical: after an import the learner's own subjects, topics and notes are
// the source of truth, made through their own writers.
//
// Format "kivo.map/1": one subject tree (one root subject), notes as text
// only (images replaced by a line saying so), saved pages as links. Kept so
// every file made before 25 Nov still imports unchanged.
// Format "kivo.map/2" (every export from 25 Nov, one subject or the whole
// map): one or more root subjects and the full content of the scope (the
// cofounder review's "complete Knowledge Map export"): what each topic's plan
// says (details), every note filed in the scope with its images and files
// (assets, by package-local refs a1, a2…), each saved page's metadata and
// tags, and the task definitions filed there (never their progress). What is
// deliberately not carried is counted in `excluded`, never dropped silently.
// Every reference inside is local to the package
// ("s1", "t3", "n2"): no private database id ever leaves the owner's
// account. Learning state (mastery, reviews, sessions, Learning DNA) is never
// part of a package: a map shares what was learned about, not how one person
// is doing at it.

import { createHash } from "node:crypto";
import { readTopicDetails, type TopicDetails } from "../nova/product/topic-tree";
import { TASK_MINUTES_MAX, TASK_MINUTES_MIN, TASK_PRIORITIES, TASK_TITLE_MAX } from "../nova/product/tasks.types";

export const MAP_FORMAT_V1 = "kivo.map/1";
export const MAP_FORMAT_V2 = "kivo.map/2";
/** The format of a one-subject package (kept as the default name for older callers). */
export const MAP_FORMAT = MAP_FORMAT_V1;
export const MAP_FORMATS = [MAP_FORMAT_V1, MAP_FORMAT_V2] as const;
export type MapFormat = typeof MAP_FORMATS[number];

// Limits a package must keep. An export, an upload and an import are all
// refused above them, so none of them can exhaust the server.
export const PACKAGE_LIMITS = {
  subjects:    200,
  topics:      2_000,
  notes:       1_000,
  resources:   2_000,
  tasks:       300,         // TASK_OPEN_MAX: an import can always fit them in an empty account
  assets:      400,
  noteBody:    1_000_000,   // characters per note (notes.types NOTE_BODY_MAX)
  name:        200,
  title:       200,
  description: 2_000,
  url:         2_048,
  details:     8_000,       // a topic's details, as JSON
  bytes:       40_000_000,  // the whole package without its assets, as JSON
  imageBytes:  2_500_000,   // one image (note-images NOTE_IMAGE_BYTES_MAX)
  fileBytes:   10_000_000,  // one file (note-files NOTE_FILE_BYTES_MAX)
  assetBytes:  40_000_000,  // every asset together
} as const;

export const LICENSES = ["all-rights-reserved", "cc-by-4.0", "cc-by-sa-4.0", "cc-by-nc-4.0", "cc0-1.0"] as const;
export type License = typeof LICENSES[number];

export interface PackageSubject  { ref: string; name: string; parentRef: string | null }
export interface PackageTopic    {
  ref: string; subjectRef: string; parentRef: string | null; name: string; kind: "milestone" | null; position: number;
  // Format 2: what the plan says about it (explanation, sources; a milestone's
  // effort, goals, exercises…), as topic-tree.ts readTopicDetails keeps it.
  details?: TopicDetails | null;
}
// A note's body names its assets by package ref: ![caption](kivo-image:a1),
// [file.pdf](kivo-file:a2) (format 2 only).
export interface PackageNote     { ref: string; title: string; body: string; subjectRef: string | null; topicName: string | null }
export interface PackageResource {
  ref: string; title: string; url: string; domain: string; subjectRef: string | null; topicName: string | null;
  // Optional in both formats (older files have none): what the page said about
  // itself when it was saved, so the copy reads like the original.
  description?: string | null; resourceType?: string | null; siteName?: string | null;
  // Format 2: the rest of it, and the creator's tags.
  canonicalUrl?: string | null; imageUrl?: string | null; author?: string | null; publishedAt?: string | null; durationSeconds?: number | null; tags?: string[];
}
// An image or file of a note (format 2). Its bytes are a file of their own in
// the archive (assets/images/a1.png, assets/documents/a2.pdf), checked by
// size and sha256 before anything is made.
export interface PackageAsset {
  ref: string; noteRef: string; kind: "image" | "document";
  mimeType: string; fileName: string | null; bytes: number; sha256: string;
  width?: number | null; height?: number | null;
  source?: { url: string | null; title: string | null; page: number | null } | null;
}
// A task's definition (format 2): what it is and where it sits, never whether
// or when the creator did it (status, due day, completion stay theirs).
export interface PackageTask {
  ref: string; title: string; subjectRef: string | null; topicName: string | null; parentRef: string | null;
  priority: "low" | "medium" | "high" | null; estimatedMinutes: number | null; waitsOn: string[];
}
export interface PackageExcluded {
  noteImages: number; privateNotes: number; learningState: true;
  // Format 2: what the export left out, so the preview and the import say so.
  archivedTopics?: number;      // archived topics (and anything only they held) stay with the creator
  unfiledNotes?: number;        // whole map: notes filed under no subject
  unfiledPages?: number;        // whole map: saved pages filed under no subject
  passages?: number;            // selected passages saved from pages (not saved pages)
  pagesOverLimit?: number;      // saved pages past PACKAGE_LIMITS.resources
  imagesNotCarried?: number;    // images a note named that could not be carried (missing or unsupported)
  filesNotCarried?: number;
  taskProgress?: true;          // status, due days and completion are never carried
  pagePersonalState?: true;     // reading status, collections and the creator's own page notes
}

// Where a package came from. Carried into every import; never used to decide
// anything (it is the exporter's word, shown as such).
export interface Attribution {
  creator:      string | null;     // the exporter's chosen credit line, or null
  source:       string | null;     // free text, e.g. "Kivo curated maps"
  packageId:    string | null;     // the exporter's random id for this package
  exportedAt:   string | null;     // ISO
  importedFrom?: string | null;    // when the map was itself imported: the packageId it came from
}

export interface MapPackage {
  format:      MapFormat;
  title:       string;
  description: string | null;
  license:     License;
  attribution: Attribution;
  // Every subject, parents before children. Format 1 has exactly one with no
  // parent (the root); format 2 has one or more.
  subjects:    PackageSubject[];
  topics:      PackageTopic[];
  notes:       PackageNote[];
  resources:   PackageResource[];
  // Format 2 (empty in format 1).
  assets:      PackageAsset[];
  tasks:       PackageTask[];
  // What was deliberately left out, so a reader is told rather than guessing.
  excluded:    PackageExcluded;
}

// ── Building a package from the owner's own records (already read and owned) ──

export interface SourceSubject  { id: string; name: string; parentId: string | null }
export interface SourceTopic    { id: string; subjectId: string; name: string; parentId: string | null; kind: "milestone" | null; position: number; archived: boolean; details?: unknown }
export interface SourceNote     { id: string; title: string; body: string; subjectId: string | null; topicName: string | null }
export interface SourceResource {
  id: string; title: string; url: string; domain: string; subjectId: string | null; topicName: string | null; description?: string | null; resourceType?: string | null; siteName?: string | null;
  canonicalUrl?: string | null; imageUrl?: string | null; author?: string | null; publishedAt?: Date | string | null; durationSeconds?: number | null; tags?: string[];
}
export interface SourceImage    { id: string; noteId: string; mimeType: string; width: number; height: number; bytes: Uint8Array; sourceUrl?: string | null; sourceTitle?: string | null; page?: number | null }
export interface SourceFile     { id: string; noteId: string; fileName: string; mimeType: string; bytes: Uint8Array }
export interface SourceTask     { id: string; title: string; subjectId: string | null; topicName: string | null; parentId: string | null; priority: string | null; estimatedMinutes: number | null; after?: string[] }

export const RESOURCE_DESCRIPTION_MAX = 600;

const IMAGE_LINE = /^!\[[^\]]*\]\(kivo-image:[^)]+\)\s*$/gm;

// Note images are not carried in format 1: the line says so in place, and the
// count is reported in `excluded`.
export function stripNoteImages(body: string): { body: string; images: number } {
  let images = 0;
  const out = body.replace(IMAGE_LINE, () => { images += 1; return "> *An image here was not included in the shared map.*"; });
  return { body: out, images };
}

export function buildPackage(input: {
  // One subject (its tree), or several top-level subjects (the whole map).
  // Order is kept.
  rootSubjectId?: string;
  rootSubjectIds?: string[];
  // The format to write. Absent: format 1 for one subject, 2 for several (as
  // before 25 Nov). Exports from 25 Nov always ask for format 2.
  format?: MapFormat;
  subjects: SourceSubject[];          // the owner's subjects (any; only the roots' subtrees are used)
  topics: SourceTopic[];
  notes: SourceNote[];                // the notes going in (format 2: every note filed in the scope)
  resources: SourceResource[];        // saved pages filed in the scope (empty when the owner left them out)
  images?: SourceImage[];             // format 2: the images of those notes, with their bytes
  files?: SourceFile[];               // format 2: the files kept with those notes, with their bytes
  tasks?: SourceTask[];               // format 2: the tasks filed in the scope
  title: string; description: string | null; license: License; attribution: Attribution;
  privateNotesLeftOut: number;
  leftOut?: Omit<PackageExcluded, "noteImages" | "privateNotes" | "learningState" | "imagesNotCarried" | "filesNotCarried">;
}): { pkg: MapPackage; assetData: Map<string, Uint8Array> } {
  // Each root and every subject inside it, root first, parents before children.
  const rootIds = input.rootSubjectIds ?? (input.rootSubjectId ? [input.rootSubjectId] : []);
  const format: MapFormat = input.format ?? (input.rootSubjectIds !== undefined ? MAP_FORMAT_V2 : MAP_FORMAT_V1);
  const v2 = format === MAP_FORMAT_V2;
  if (rootIds.length === 0) throw new Error("root subject not found");
  const byParent = new Map<string | null, SourceSubject[]>();
  for (const s of input.subjects) byParent.set(s.parentId, [...(byParent.get(s.parentId) ?? []), s]);
  const ordered: SourceSubject[] = [];
  const seen = new Set<string>();
  const walk = (s: SourceSubject) => { if (seen.has(s.id)) return; seen.add(s.id); ordered.push(s); for (const c of byParent.get(s.id) ?? []) walk(c); };
  const roots = new Set<string>();
  for (const id of rootIds) {
    const root = input.subjects.find(s => s.id === id);
    if (!root) throw new Error("root subject not found");
    if (seen.has(root.id)) continue;      // already inside an earlier root
    roots.add(root.id);
    walk(root);
  }
  if (!v2 && roots.size !== 1) throw new Error("format 1 holds one subject");

  const sRef = new Map<string, string>(ordered.map((s, i) => [s.id, `s${i + 1}`]));
  const subjects: PackageSubject[] = ordered.map(s => ({ ref: sRef.get(s.id)!, name: s.name, parentRef: roots.has(s.id) ? null : (s.parentId ? sRef.get(s.parentId) ?? null : null) }));

  // Topics of those subjects, archived ones left out, parents before children.
  const inScope = input.topics.filter(t => sRef.has(t.subjectId));
  const live = inScope.filter(t => !t.archived);
  const liveIds = new Set(live.map(t => t.id));
  const tChildren = new Map<string | null, SourceTopic[]>();
  for (const t of live) { const p = t.parentId && liveIds.has(t.parentId) ? t.parentId : null; tChildren.set(`${t.subjectId}|${p}`, [...(tChildren.get(`${t.subjectId}|${p}`) ?? []), t]); }
  const tOrdered: SourceTopic[] = [];
  const tWalk = (subjectId: string, parent: string | null) => {
    const kids = (tChildren.get(`${subjectId}|${parent}`) ?? []).sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
    for (const k of kids) { tOrdered.push(k); tWalk(subjectId, k.id); }
  };
  for (const s of ordered) tWalk(s.id, null);
  const tRef = new Map<string, string>(tOrdered.map((t, i) => [t.id, `t${i + 1}`]));
  const topics: PackageTopic[] = tOrdered.map((t, i) => {
    const details = v2 ? readTopicDetails(t.details) : null;
    return {
      ref: tRef.get(t.id)!, subjectRef: sRef.get(t.subjectId)!, parentRef: t.parentId ? tRef.get(t.parentId) ?? null : null,
      name: t.name, kind: t.kind === "milestone" ? "milestone" as const : null, position: i,
      ...(details && JSON.stringify(details).length <= PACKAGE_LIMITS.details ? { details } : {}),
    };
  });

  const inNotes = input.notes.filter(n => n.subjectId === null || sRef.has(n.subjectId));
  let noteImages = 0, imagesNotCarried = 0, filesNotCarried = 0;
  const assets: PackageAsset[] = [];
  const assetData = new Map<string, Uint8Array>();
  let assetTotal = 0;
  const imagesById = new Map((input.images ?? []).map(i => [i.id, i]));
  const filesByNote = new Map<string, SourceFile[]>();
  for (const f of input.files ?? []) filesByNote.set(f.noteId, [...(filesByNote.get(f.noteId) ?? []), f]);
  const room = (bytes: number) => assets.length < PACKAGE_LIMITS.assets && assetTotal + bytes <= PACKAGE_LIMITS.assetBytes;
  const notes: PackageNote[] = inNotes.map((n, i) => {
    const ref = `n${i + 1}`;
    if (!v2) {
      const { body, images } = stripNoteImages(n.body);
      noteImages += images;
      return { ref, title: n.title, body, subjectRef: n.subjectId ? sRef.get(n.subjectId)! : null, topicName: n.topicName };
    }
    // Images: each one the text names, once, as a package ref.
    const imageRefs = new Map<string, string>();
    let body = n.body.replace(IMAGE_REF_ANY, (_whole, id: string) => {
      const known = imageRefs.get(id);
      if (known) return `(kivo-image:${known})`;
      const img = imagesById.get(id);
      if (!img || !IMAGE_MIME_EXT[img.mimeType] || img.bytes.length > PACKAGE_LIMITS.imageBytes || !room(img.bytes.length)) { imagesNotCarried += 1; return "(kivo-image:missing)"; }
      const aref = `a${assets.length + 1}`;
      imageRefs.set(id, aref);
      assets.push({ ref: aref, noteRef: ref, kind: "image", mimeType: img.mimeType, fileName: null, bytes: img.bytes.length, sha256: sha(img.bytes), width: img.width, height: img.height,
        source: img.sourceUrl || img.sourceTitle || img.page ? { url: img.sourceUrl && /^https?:\/\//i.test(img.sourceUrl) ? img.sourceUrl.slice(0, PACKAGE_LIMITS.url) : null, title: img.sourceTitle?.slice(0, 300) ?? null, page: img.page ?? null } : null });
      assetData.set(aref, img.bytes); assetTotal += img.bytes.length;
      return `(kivo-image:${aref})`;
    });
    // Files: each one the text names; a file kept with the note but not named
    // in its text is added at the end, so nothing the note holds is dropped.
    const files = filesByNote.get(n.id) ?? [];
    const fileRefs = new Map<string, string>();
    const take = (f: SourceFile): string | null => {
      if (fileRefs.has(f.id)) return fileRefs.get(f.id)!;
      if (f.mimeType !== "application/pdf" || f.bytes.length > PACKAGE_LIMITS.fileBytes || !room(f.bytes.length)) { filesNotCarried += 1; return null; }
      const aref = `a${assets.length + 1}`;
      fileRefs.set(f.id, aref);
      assets.push({ ref: aref, noteRef: ref, kind: "document", mimeType: f.mimeType, fileName: f.fileName.slice(0, 160), bytes: f.bytes.length, sha256: sha(f.bytes) });
      assetData.set(aref, f.bytes); assetTotal += f.bytes.length;
      return aref;
    };
    const fileById = new Map(files.map(f => [f.id, f]));
    body = body.replace(FILE_REF_ANY, (_whole, id: string) => {
      const f = fileById.get(id);
      const aref = f ? take(f) : (filesNotCarried += 1, null);
      return `](kivo-file:${aref ?? "missing"})`;
    });
    const unnamed = files.filter(f => !fileRefs.has(f.id)).map(f => ({ f, aref: take(f) })).filter(x => x.aref);
    if (unnamed.length) body = `${body.replace(/\s+$/, "")}\n\n${unnamed.map(x => `[${x.f.fileName.replace(/[[\]\n]/g, " ")}](kivo-file:${x.aref})`).join("\n")}\n`;
    return { ref, title: n.title, body, subjectRef: n.subjectId ? sRef.get(n.subjectId)! : null, topicName: n.topicName };
  });

  const resources: PackageResource[] = input.resources
    .filter(r => r.subjectId !== null && sRef.has(r.subjectId) && /^https?:\/\//i.test(r.url))
    .map((r, i) => {
      const publishedAt = r.publishedAt ? new Date(r.publishedAt) : null;
      return {
        ref: `r${i + 1}`, title: r.title, url: r.url, domain: r.domain, subjectRef: sRef.get(r.subjectId!)!, topicName: r.topicName,
        ...(r.description ? { description: r.description.slice(0, RESOURCE_DESCRIPTION_MAX) } : {}),
        ...(r.resourceType ? { resourceType: r.resourceType.slice(0, 40) } : {}),
        ...(r.siteName ? { siteName: r.siteName.slice(0, 120) } : {}),
        ...(v2 && r.canonicalUrl && safeHttpUrl(r.canonicalUrl) && r.canonicalUrl.length <= PACKAGE_LIMITS.url ? { canonicalUrl: r.canonicalUrl } : {}),
        ...(v2 && r.imageUrl && safeHttpUrl(r.imageUrl) && r.imageUrl.length <= PACKAGE_LIMITS.url ? { imageUrl: r.imageUrl } : {}),
        ...(v2 && r.author ? { author: r.author.slice(0, 200) } : {}),
        ...(v2 && publishedAt && !Number.isNaN(publishedAt.getTime()) ? { publishedAt: publishedAt.toISOString() } : {}),
        ...(v2 && r.durationSeconds && Number.isInteger(r.durationSeconds) && r.durationSeconds > 0 ? { durationSeconds: r.durationSeconds } : {}),
        ...(v2 && r.tags?.length ? { tags: r.tags.filter(t => typeof t === "string" && t.length > 0 && t.length <= 40).slice(0, 20) } : {}),
      };
    });

  // Tasks filed in the scope, parents before steps. A step whose parent is not
  // in the scope stands on its own here.
  const tasks: PackageTask[] = [];
  if (v2) {
    const scoped = (input.tasks ?? []).filter(t => t.subjectId !== null && sRef.has(t.subjectId));
    const ids = new Set(scoped.map(t => t.id));
    const kids = new Map<string | null, SourceTask[]>();
    for (const t of scoped) { const p = t.parentId && ids.has(t.parentId) ? t.parentId : null; kids.set(p, [...(kids.get(p) ?? []), t]); }
    const kOrdered: SourceTask[] = [];
    const kWalk = (p: string | null) => { for (const t of kids.get(p) ?? []) { kOrdered.push(t); kWalk(t.id); } };
    kWalk(null);
    const kRef = new Map(kOrdered.map((t, i) => [t.id, `k${i + 1}`]));
    for (const t of kOrdered.slice(0, PACKAGE_LIMITS.tasks)) {
      tasks.push({
        ref: kRef.get(t.id)!, title: t.title.slice(0, TASK_TITLE_MAX), subjectRef: sRef.get(t.subjectId!)!, topicName: t.topicName,
        parentRef: t.parentId && kRef.has(t.parentId) ? kRef.get(t.parentId)! : null,
        priority: (TASK_PRIORITIES as readonly string[]).includes(t.priority ?? "") ? t.priority as PackageTask["priority"] : null,
        estimatedMinutes: t.estimatedMinutes && t.estimatedMinutes >= TASK_MINUTES_MIN && t.estimatedMinutes <= TASK_MINUTES_MAX ? t.estimatedMinutes : null,
        waitsOn: (t.after ?? []).filter(id => kRef.has(id) && id !== t.id).map(id => kRef.get(id)!),
      });
    }
    // A task past the limit takes its waits with it.
    const kept = new Set(tasks.map(t => t.ref));
    for (const t of tasks) t.waitsOn = t.waitsOn.filter(r => kept.has(r));
  }

  const archivedTopics = inScope.length - live.length;
  return {
    pkg: {
      format, title: input.title, description: input.description, license: input.license, attribution: input.attribution,
      subjects, topics, notes, resources, assets, tasks,
      excluded: v2
        ? { noteImages: 0, privateNotes: input.privateNotesLeftOut, learningState: true, archivedTopics, imagesNotCarried, filesNotCarried, taskProgress: true, pagePersonalState: true, ...(input.leftOut ?? {}) }
        : { noteImages, privateNotes: input.privateNotesLeftOut, learningState: true },
    },
    assetData,
  };
}

const IMAGE_REF_ANY = /\(kivo-image:([A-Za-z0-9_-]{1,64})\)/g;
const FILE_REF_ANY = /\]\(kivo-file:([A-Za-z0-9_-]{1,64})\)/g;
export const IMAGE_MIME_EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

// ── Validation: every package from outside (an upload, a stored version read
// back) is checked before it is used. Nothing in it is trusted. ──

export type PackageCheck = { ok: true; pkg: MapPackage } | { ok: false; reason: string };

const isStr = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max;
const optStr = (v: unknown, max: number) => v === null || v === undefined || (typeof v === "string" && v.length <= max);
const REF = /^[srntak]\d{1,5}$/;   // s: subject, t: topic, n: note, r: resource, a: asset, k: task

export function validatePackage(raw: unknown): PackageCheck {
  if (!raw || typeof raw !== "object") return { ok: false, reason: "not_an_object" };
  const p = raw as Record<string, unknown>;
  if (!(MAP_FORMATS as readonly unknown[]).includes(p.format)) return { ok: false, reason: "unknown_format" };
  const format = p.format as MapFormat;
  if (!isStr(p.title, PACKAGE_LIMITS.title)) return { ok: false, reason: "bad_title" };
  if (!optStr(p.description, PACKAGE_LIMITS.description)) return { ok: false, reason: "bad_description" };
  if (!LICENSES.includes(p.license as License)) return { ok: false, reason: "bad_license" };
  const arr = (k: string, max: number) => Array.isArray(p[k]) && (p[k] as unknown[]).length <= max ? p[k] as Record<string, unknown>[] : null;
  const subjects = arr("subjects", PACKAGE_LIMITS.subjects), topics = arr("topics", PACKAGE_LIMITS.topics);
  const notes = arr("notes", PACKAGE_LIMITS.notes), resources = arr("resources", PACKAGE_LIMITS.resources);
  if (!subjects || !topics || !notes || !resources) return { ok: false, reason: "too_large_or_missing" };
  const v2 = format === MAP_FORMAT_V2;
  // Format 1 carries no assets or tasks; format 2 may omit either list (none).
  const assets = p.assets === undefined ? [] : arr("assets", v2 ? PACKAGE_LIMITS.assets : 0);
  const tasks = p.tasks === undefined ? [] : arr("tasks", v2 ? PACKAGE_LIMITS.tasks : 0);
  if (!assets || !tasks) return { ok: false, reason: v2 ? "too_large_or_missing" : "format_1_has_no_assets" };
  if (subjects.length === 0) return { ok: false, reason: "no_subjects" };

  const sRefs = new Set<string>(), tRefs = new Map<string, string>(), names = new Set<string>();
  for (const s of subjects) {
    if (!isStr(s.ref, 8) || !REF.test(s.ref) || !s.ref.startsWith("s") || sRefs.has(s.ref)) return { ok: false, reason: "bad_subject_ref" };
    if (!isStr(s.name, PACKAGE_LIMITS.name)) return { ok: false, reason: "bad_subject_name" };
    if (s.parentRef !== null && !(typeof s.parentRef === "string" && sRefs.has(s.parentRef))) return { ok: false, reason: "subject_parent_unknown_or_after_child" };
    const key = s.name.trim().toLowerCase();
    if (names.has(key)) return { ok: false, reason: "duplicate_subject_name" };
    names.add(key); sRefs.add(s.ref);
  }
  const rootCount = subjects.filter(s => s.parentRef === null).length;
  if (format === MAP_FORMAT_V1 ? rootCount !== 1 : rootCount < 1) return { ok: false, reason: "one_root_subject" };

  const topicNames = new Set<string>();
  for (const t of topics) {
    if (!isStr(t.ref, 8) || !REF.test(t.ref) || !t.ref.startsWith("t") || tRefs.has(t.ref)) return { ok: false, reason: "bad_topic_ref" };
    if (!isStr(t.subjectRef, 8) || !sRefs.has(t.subjectRef)) return { ok: false, reason: "topic_subject_unknown" };
    if (!isStr(t.name, PACKAGE_LIMITS.name)) return { ok: false, reason: "bad_topic_name" };
    if (t.parentRef !== null && !(typeof t.parentRef === "string" && tRefs.get(t.parentRef) === t.subjectRef)) return { ok: false, reason: "topic_parent_unknown_or_other_subject" };
    if (t.kind !== null && t.kind !== "milestone") return { ok: false, reason: "bad_topic_kind" };
    if (typeof t.position !== "number" || !Number.isInteger(t.position) || t.position < 0) return { ok: false, reason: "bad_topic_position" };
    if (t.details !== undefined && t.details !== null && (!v2 || typeof t.details !== "object" || Array.isArray(t.details) || JSON.stringify(t.details).length > PACKAGE_LIMITS.details)) return { ok: false, reason: "bad_topic_details" };
    const key = `${t.subjectRef}|${t.name.trim().toLowerCase()}`;
    if (topicNames.has(key)) return { ok: false, reason: "duplicate_topic_name" };
    topicNames.add(key); tRefs.set(t.ref, t.subjectRef);
  }
  // Assets first: a note may name only its own.
  const aRefs = new Map<string, { noteRef: string; kind: string }>();
  let assetTotal = 0;
  for (const x of assets) {
    if (!isStr(x.ref, 8) || !REF.test(x.ref) || !x.ref.startsWith("a") || aRefs.has(x.ref)) return { ok: false, reason: "bad_asset_ref" };
    if (!isStr(x.noteRef, 8) || (x.kind !== "image" && x.kind !== "document")) return { ok: false, reason: "bad_asset" };
    const ext = x.kind === "image" ? IMAGE_MIME_EXT[x.mimeType as string] : x.mimeType === "application/pdf" ? "pdf" : undefined;
    if (!ext) return { ok: false, reason: "bad_asset_type" };
    const max = x.kind === "image" ? PACKAGE_LIMITS.imageBytes : PACKAGE_LIMITS.fileBytes;
    if (typeof x.bytes !== "number" || !Number.isInteger(x.bytes) || x.bytes < 1 || x.bytes > max) return { ok: false, reason: "bad_asset_size" };
    if (typeof x.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(x.sha256)) return { ok: false, reason: "bad_asset_checksum" };
    if (!optStr(x.fileName, 160)) return { ok: false, reason: "bad_asset" };
    assetTotal += x.bytes;
    aRefs.set(x.ref, { noteRef: x.noteRef, kind: x.kind });
  }
  if (assetTotal > PACKAGE_LIMITS.assetBytes) return { ok: false, reason: "assets_too_large" };
  const noteRefSet = new Set(notes.map(n => n.ref));
  for (const x of aRefs.values()) if (!noteRefSet.has(x.noteRef)) return { ok: false, reason: "asset_note_unknown" };

  const nRefs = new Set<string>();
  for (const n of notes) {
    if (!isStr(n.ref, 8) || !REF.test(n.ref) || !n.ref.startsWith("n") || nRefs.has(n.ref)) return { ok: false, reason: "bad_note_ref" };
    if (!isStr(n.title, PACKAGE_LIMITS.title) || typeof n.body !== "string" || n.body.length > PACKAGE_LIMITS.noteBody) return { ok: false, reason: "bad_note" };
    if (n.subjectRef !== null && !(typeof n.subjectRef === "string" && sRefs.has(n.subjectRef))) return { ok: false, reason: "note_subject_unknown" };
    if (!optStr(n.topicName, PACKAGE_LIMITS.name)) return { ok: false, reason: "bad_note_topic" };
    if (!v2) { if (/\(kivo-image:/i.test(n.body)) return { ok: false, reason: "note_references_private_image" }; }
    else {
      // Every image and file the text names is one of this note's assets of that kind (or the "missing" marker).
      for (const m of n.body.matchAll(/\(kivo-image:([^)\s]{0,80})\)/gi)) {
        const a = aRefs.get(m[1]!);
        if (m[1] !== "missing" && !(a && a.noteRef === n.ref && a.kind === "image")) return { ok: false, reason: "note_references_unknown_image" };
      }
      for (const m of n.body.matchAll(/\]\(kivo-file:([^)\s]{0,80})\)/gi)) {
        const a = aRefs.get(m[1]!);
        if (m[1] !== "missing" && !(a && a.noteRef === n.ref && a.kind === "document")) return { ok: false, reason: "note_references_unknown_file" };
      }
    }
    nRefs.add(n.ref);
  }
  const rRefs = new Set<string>();
  for (const r of resources) {
    if (!isStr(r.ref, 8) || !REF.test(r.ref) || !r.ref.startsWith("r") || rRefs.has(r.ref)) return { ok: false, reason: "bad_resource_ref" };
    if (!isStr(r.title, PACKAGE_LIMITS.title) || !isStr(r.url, PACKAGE_LIMITS.url) || !safeHttpUrl(r.url)) return { ok: false, reason: "bad_resource_url" };
    if (!isStr(r.domain, 255)) return { ok: false, reason: "bad_resource_domain" };
    if (r.subjectRef !== null && !(typeof r.subjectRef === "string" && sRefs.has(r.subjectRef))) return { ok: false, reason: "resource_subject_unknown" };
    if (!optStr(r.topicName, PACKAGE_LIMITS.name)) return { ok: false, reason: "bad_resource_topic" };
    if (!optStr(r.description, RESOURCE_DESCRIPTION_MAX) || !optStr(r.resourceType, 40) || !optStr(r.siteName, 120)) return { ok: false, reason: "bad_resource_meta" };
    if (!optStr(r.canonicalUrl, PACKAGE_LIMITS.url) || (typeof r.canonicalUrl === "string" && r.canonicalUrl && !safeHttpUrl(r.canonicalUrl))) return { ok: false, reason: "bad_resource_meta" };
    if (!optStr(r.imageUrl, PACKAGE_LIMITS.url) || (typeof r.imageUrl === "string" && r.imageUrl && !safeHttpUrl(r.imageUrl))) return { ok: false, reason: "bad_resource_meta" };
    if (!optStr(r.author, 200) || !optStr(r.publishedAt, 40) || !(r.durationSeconds === undefined || r.durationSeconds === null || (typeof r.durationSeconds === "number" && Number.isInteger(r.durationSeconds) && r.durationSeconds > 0))) return { ok: false, reason: "bad_resource_meta" };
    if (r.tags !== undefined && !(Array.isArray(r.tags) && r.tags.length <= 20 && r.tags.every(t => isStr(t, 40)))) return { ok: false, reason: "bad_resource_meta" };
    rRefs.add(r.ref);
  }
  const kRefs = new Set<string>();
  for (const t of tasks) {
    if (!isStr(t.ref, 8) || !REF.test(t.ref) || !t.ref.startsWith("k") || kRefs.has(t.ref)) return { ok: false, reason: "bad_task_ref" };
    if (!isStr(t.title, TASK_TITLE_MAX) || !(t.title as string).trim()) return { ok: false, reason: "bad_task" };
    if (t.subjectRef !== null && !(typeof t.subjectRef === "string" && sRefs.has(t.subjectRef))) return { ok: false, reason: "task_subject_unknown" };
    if (!optStr(t.topicName, PACKAGE_LIMITS.name)) return { ok: false, reason: "bad_task" };
    if (t.parentRef !== null && !(typeof t.parentRef === "string" && kRefs.has(t.parentRef))) return { ok: false, reason: "task_parent_unknown_or_after_step" };
    if (t.priority !== null && !(TASK_PRIORITIES as readonly unknown[]).includes(t.priority)) return { ok: false, reason: "bad_task" };
    if (t.estimatedMinutes !== null && !(typeof t.estimatedMinutes === "number" && Number.isInteger(t.estimatedMinutes) && t.estimatedMinutes >= TASK_MINUTES_MIN && t.estimatedMinutes <= TASK_MINUTES_MAX)) return { ok: false, reason: "bad_task" };
    if (!Array.isArray(t.waitsOn) || t.waitsOn.length > 50 || !t.waitsOn.every(w => typeof w === "string" && REF.test(w) && w.startsWith("k") && w !== t.ref)) return { ok: false, reason: "bad_task_wait" };
    kRefs.add(t.ref);
  }
  for (const t of tasks) if (!(t.waitsOn as string[]).every(w => kRefs.has(w))) return { ok: false, reason: "bad_task_wait" };
  const a = p.attribution as Record<string, unknown> | undefined;
  if (!a || typeof a !== "object" || !optStr(a.creator, 120) || !optStr(a.source, 200) || !optStr(a.packageId, 64) || !optStr(a.exportedAt, 40) || !optStr(a.importedFrom, 64)) {
    return { ok: false, reason: "bad_attribution" };
  }
  if (JSON.stringify(raw).length > PACKAGE_LIMITS.bytes) return { ok: false, reason: "too_large" };
  const ex = p.excluded as Record<string, unknown> | undefined;
  const count = (k: string) => { const n = Number(ex?.[k]); return Number.isInteger(n) && n > 0 ? n : 0; };
  const excluded: PackageExcluded = { noteImages: count("noteImages"), privateNotes: count("privateNotes"), learningState: true };
  if (v2) {
    for (const k of ["archivedTopics", "unfiledNotes", "unfiledPages", "passages", "pagesOverLimit", "imagesNotCarried", "filesNotCarried"] as const) excluded[k] = count(k);
    excluded.taskProgress = true; excluded.pagePersonalState = true;
  }
  return {
    ok: true,
    pkg: {
      format, title: p.title as string, description: (p.description as string | null) ?? null, license: p.license as License,
      attribution: { creator: (a.creator as string | null) ?? null, source: (a.source as string | null) ?? null, packageId: (a.packageId as string | null) ?? null, exportedAt: (a.exportedAt as string | null) ?? null, importedFrom: (a.importedFrom as string | null) ?? null },
      subjects: subjects as unknown as PackageSubject[],
      topics: topics.map(t => {
        const details = v2 ? readTopicDetails(t.details) : null;
        return { ref: t.ref as string, subjectRef: t.subjectRef as string, parentRef: (t.parentRef as string | null) ?? null, name: t.name as string, kind: t.kind === "milestone" ? "milestone" as const : null, position: t.position as number, ...(details ? { details } : {}) };
      }),
      notes: notes as unknown as PackageNote[],
      // Only the fields a resource has: anything else in the file is dropped here.
      resources: resources.map(r => ({
        ref: r.ref as string, title: r.title as string, url: r.url as string, domain: r.domain as string,
        subjectRef: (r.subjectRef as string | null) ?? null, topicName: (r.topicName as string | null) ?? null,
        ...(r.description ? { description: r.description as string } : {}),
        ...(r.resourceType ? { resourceType: r.resourceType as string } : {}),
        ...(r.siteName ? { siteName: r.siteName as string } : {}),
        ...(v2 && r.canonicalUrl ? { canonicalUrl: r.canonicalUrl as string } : {}),
        ...(v2 && r.imageUrl ? { imageUrl: r.imageUrl as string } : {}),
        ...(v2 && r.author ? { author: r.author as string } : {}),
        ...(v2 && r.publishedAt ? { publishedAt: r.publishedAt as string } : {}),
        ...(v2 && r.durationSeconds ? { durationSeconds: r.durationSeconds as number } : {}),
        ...(v2 && Array.isArray(r.tags) && r.tags.length ? { tags: r.tags as string[] } : {}),
      })),
      assets: assets.map(x => ({
        ref: x.ref as string, noteRef: x.noteRef as string, kind: x.kind as "image" | "document", mimeType: x.mimeType as string, fileName: (x.fileName as string | null) ?? null,
        bytes: x.bytes as number, sha256: x.sha256 as string,
        ...(typeof x.width === "number" ? { width: x.width } : {}), ...(typeof x.height === "number" ? { height: x.height } : {}),
        ...(x.source && typeof x.source === "object" ? { source: readAssetSource(x.source) } : {}),
      })),
      tasks: tasks.map(t => ({
        ref: t.ref as string, title: (t.title as string).trim(), subjectRef: (t.subjectRef as string | null) ?? null, topicName: (t.topicName as string | null) ?? null,
        parentRef: (t.parentRef as string | null) ?? null, priority: (t.priority as PackageTask["priority"]) ?? null, estimatedMinutes: (t.estimatedMinutes as number | null) ?? null, waitsOn: t.waitsOn as string[],
      })),
      excluded,
    },
  };
}

function readAssetSource(raw: unknown): PackageAsset["source"] {
  const r = raw as Record<string, unknown>;
  const url = typeof r.url === "string" && r.url.length <= PACKAGE_LIMITS.url && safeHttpUrl(r.url) ? r.url : null;
  const title = typeof r.title === "string" ? r.title.slice(0, 300) : null;
  const page = typeof r.page === "number" && Number.isInteger(r.page) && r.page > 0 && r.page <= 100_000 ? r.page : null;
  return url || title || page ? { url, title, page } : null;
}

// Only plain web addresses: no javascript:, data:, file:, credentials or
// non-web ports. Export, import and the preview all use this.
export function safeHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    if (u.username || u.password) return false;
    return true;
  } catch { return false; }
}

// A stable fingerprint of a package's content (keys sorted), for integrity
// checks on stored versions and uploaded packages.
export function packageHash(pkg: MapPackage): string {
  const canon = (v: unknown): unknown => Array.isArray(v) ? v.map(canon) : v && typeof v === "object"
    ? Object.fromEntries(Object.keys(v as object).sort().map(k => [k, canon((v as Record<string, unknown>)[k])])) : v;
  return createHash("sha256").update(JSON.stringify(canon(pkg))).digest("hex");
}

// What a package holds, for the import preview and the manifest.
/** The package's root subjects (no parent), in order. */
export const packageRoots = (pkg: MapPackage): PackageSubject[] => pkg.subjects.filter(s => s.parentRef === null);

export function packageCounts(pkg: MapPackage) {
  return {
    subjects: pkg.subjects.length, topics: pkg.topics.length, notes: pkg.notes.length, resources: pkg.resources.length,
    images: pkg.assets.filter(a => a.kind === "image").length, files: pkg.assets.filter(a => a.kind === "document").length,
    assetBytes: pkg.assets.reduce((n, a) => n + a.bytes, 0), tasks: pkg.tasks.length, topicDetails: pkg.topics.filter(t => t.details).length,
    excluded: pkg.excluded,
  };
}
