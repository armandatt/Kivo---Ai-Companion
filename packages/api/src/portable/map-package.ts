// ─── A Knowledge Map, as a portable package (the graph inside a .kivo file) ──
// Pure: no database, no model. This is the transport form of a map: what an
// export writes into graph.json and content/, and what an import is rebuilt
// from (portable/kivo-archive.ts packs and unpacks the file). It is never
// canonical: after an import the learner's own subjects, topics and notes are
// the source of truth, made through their own writers.
//
// Format "kivo.map/1". Every reference inside is local to the package
// ("s1", "t3", "n2"): no private database id ever leaves the owner's
// account. Learning state (mastery, reviews, sessions, Learning DNA) is never
// part of a package: a map shares what was learned about, not how one person
// is doing at it.

import { createHash } from "node:crypto";

export const MAP_FORMAT = "kivo.map/1";

// Limits a package must keep. An export, an upload and an import are all
// refused above them, so none of them can exhaust the server.
export const PACKAGE_LIMITS = {
  subjects:    200,
  topics:      2_000,
  notes:       300,
  resources:   500,
  noteBody:    60_000,      // characters per note (NOTE_BODY_MAX-sized)
  name:        200,
  title:       200,
  description: 2_000,
  url:         2_048,
  bytes:       5_000_000,   // the whole package, as JSON
} as const;

export const LICENSES = ["all-rights-reserved", "cc-by-4.0", "cc-by-sa-4.0", "cc-by-nc-4.0", "cc0-1.0"] as const;
export type License = typeof LICENSES[number];

export interface PackageSubject  { ref: string; name: string; parentRef: string | null }
export interface PackageTopic    { ref: string; subjectRef: string; parentRef: string | null; name: string; kind: "milestone" | null; position: number }
export interface PackageNote     { ref: string; title: string; body: string; subjectRef: string | null; topicName: string | null }
export interface PackageResource { ref: string; title: string; url: string; domain: string; subjectRef: string | null; topicName: string | null }

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
  format:      typeof MAP_FORMAT;
  title:       string;
  description: string | null;
  license:     License;
  attribution: Attribution;
  // The root subjects of the map (refs of subjects with no parent in the package).
  subjects:    PackageSubject[];
  topics:      PackageTopic[];
  notes:       PackageNote[];
  resources:   PackageResource[];
  // What was deliberately left out, so a reader is told rather than guessing.
  excluded:    { noteImages: number; privateNotes: number; learningState: true };
}

// ── Building a package from the owner's own records (already read and owned) ──

export interface SourceSubject  { id: string; name: string; parentId: string | null }
export interface SourceTopic    { id: string; subjectId: string; name: string; parentId: string | null; kind: "milestone" | null; position: number; archived: boolean }
export interface SourceNote     { id: string; title: string; body: string; subjectId: string | null; topicName: string | null }
export interface SourceResource { id: string; title: string; url: string; domain: string; subjectId: string | null; topicName: string | null }

const IMAGE_LINE = /^!\[[^\]]*\]\(kivo-image:[^)]+\)\s*$/gm;

// Note images are not carried in format 1: the line says so in place, and the
// count is reported in `excluded`.
export function stripNoteImages(body: string): { body: string; images: number } {
  let images = 0;
  const out = body.replace(IMAGE_LINE, () => { images += 1; return "> *An image here was not included in the shared map.*"; });
  return { body: out, images };
}

export function buildPackage(input: {
  rootSubjectId: string;
  subjects: SourceSubject[];          // the owner's subjects (any; only the root's subtree is used)
  topics: SourceTopic[];
  notes: SourceNote[];                // only the notes the owner selected
  resources: SourceResource[];        // only when the owner chose to include saved pages
  title: string; description: string | null; license: License; attribution: Attribution;
  privateNotesLeftOut: number;
}): MapPackage {
  // The root and every subject inside it, root first, parents before children.
  const byParent = new Map<string | null, SourceSubject[]>();
  for (const s of input.subjects) byParent.set(s.parentId, [...(byParent.get(s.parentId) ?? []), s]);
  const root = input.subjects.find(s => s.id === input.rootSubjectId);
  if (!root) throw new Error("root subject not found");
  const ordered: SourceSubject[] = [];
  const walk = (s: SourceSubject) => { ordered.push(s); for (const c of byParent.get(s.id) ?? []) walk(c); };
  walk(root);

  const sRef = new Map<string, string>(ordered.map((s, i) => [s.id, `s${i + 1}`]));
  const subjects: PackageSubject[] = ordered.map(s => ({ ref: sRef.get(s.id)!, name: s.name, parentRef: s.id === root.id ? null : (s.parentId ? sRef.get(s.parentId) ?? null : null) }));

  // Topics of those subjects, archived ones left out, parents before children.
  const live = input.topics.filter(t => sRef.has(t.subjectId) && !t.archived);
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
  const topics: PackageTopic[] = tOrdered.map((t, i) => ({
    ref: tRef.get(t.id)!, subjectRef: sRef.get(t.subjectId)!, parentRef: t.parentId ? tRef.get(t.parentId) ?? null : null,
    name: t.name, kind: t.kind === "milestone" ? "milestone" : null, position: i,
  }));

  let noteImages = 0;
  const notes: PackageNote[] = input.notes
    .filter(n => n.subjectId === null || sRef.has(n.subjectId))
    .map((n, i) => {
      const { body, images } = stripNoteImages(n.body);
      noteImages += images;
      return { ref: `n${i + 1}`, title: n.title, body, subjectRef: n.subjectId ? sRef.get(n.subjectId)! : null, topicName: n.topicName };
    });

  const resources: PackageResource[] = input.resources
    .filter(r => r.subjectId !== null && sRef.has(r.subjectId) && /^https?:\/\//i.test(r.url))
    .map((r, i) => ({ ref: `r${i + 1}`, title: r.title, url: r.url, domain: r.domain, subjectRef: sRef.get(r.subjectId!)!, topicName: r.topicName }));

  return {
    format: MAP_FORMAT, title: input.title, description: input.description, license: input.license, attribution: input.attribution,
    subjects, topics, notes, resources,
    excluded: { noteImages, privateNotes: input.privateNotesLeftOut, learningState: true },
  };
}

// ── Validation: every package from outside (an upload, a stored version read
// back) is checked before it is used. Nothing in it is trusted. ──

export type PackageCheck = { ok: true; pkg: MapPackage } | { ok: false; reason: string };

const isStr = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max;
const optStr = (v: unknown, max: number) => v === null || v === undefined || (typeof v === "string" && v.length <= max);
const REF = /^[srnt]\d{1,5}$/;   // s: subject, t: topic, n: note, r: resource

export function validatePackage(raw: unknown): PackageCheck {
  if (!raw || typeof raw !== "object") return { ok: false, reason: "not_an_object" };
  const p = raw as Record<string, unknown>;
  if (p.format !== MAP_FORMAT) return { ok: false, reason: "unknown_format" };
  if (!isStr(p.title, PACKAGE_LIMITS.title)) return { ok: false, reason: "bad_title" };
  if (!optStr(p.description, PACKAGE_LIMITS.description)) return { ok: false, reason: "bad_description" };
  if (!LICENSES.includes(p.license as License)) return { ok: false, reason: "bad_license" };
  const arr = (k: string, max: number) => Array.isArray(p[k]) && (p[k] as unknown[]).length <= max ? p[k] as Record<string, unknown>[] : null;
  const subjects = arr("subjects", PACKAGE_LIMITS.subjects), topics = arr("topics", PACKAGE_LIMITS.topics);
  const notes = arr("notes", PACKAGE_LIMITS.notes), resources = arr("resources", PACKAGE_LIMITS.resources);
  if (!subjects || !topics || !notes || !resources) return { ok: false, reason: "too_large_or_missing" };
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
  if (subjects.filter(s => s.parentRef === null).length !== 1) return { ok: false, reason: "one_root_subject" };

  const topicNames = new Set<string>();
  for (const t of topics) {
    if (!isStr(t.ref, 8) || !REF.test(t.ref) || !t.ref.startsWith("t") || tRefs.has(t.ref)) return { ok: false, reason: "bad_topic_ref" };
    if (!isStr(t.subjectRef, 8) || !sRefs.has(t.subjectRef)) return { ok: false, reason: "topic_subject_unknown" };
    if (!isStr(t.name, PACKAGE_LIMITS.name)) return { ok: false, reason: "bad_topic_name" };
    if (t.parentRef !== null && !(typeof t.parentRef === "string" && tRefs.get(t.parentRef) === t.subjectRef)) return { ok: false, reason: "topic_parent_unknown_or_other_subject" };
    if (t.kind !== null && t.kind !== "milestone") return { ok: false, reason: "bad_topic_kind" };
    if (typeof t.position !== "number" || !Number.isInteger(t.position) || t.position < 0) return { ok: false, reason: "bad_topic_position" };
    const key = `${t.subjectRef}|${t.name.trim().toLowerCase()}`;
    if (topicNames.has(key)) return { ok: false, reason: "duplicate_topic_name" };
    topicNames.add(key); tRefs.set(t.ref, t.subjectRef);
  }
  const nRefs = new Set<string>();
  for (const n of notes) {
    if (!isStr(n.ref, 8) || !REF.test(n.ref) || !n.ref.startsWith("n") || nRefs.has(n.ref)) return { ok: false, reason: "bad_note_ref" };
    if (!isStr(n.title, PACKAGE_LIMITS.title) || typeof n.body !== "string" || n.body.length > PACKAGE_LIMITS.noteBody) return { ok: false, reason: "bad_note" };
    if (n.subjectRef !== null && !(typeof n.subjectRef === "string" && sRefs.has(n.subjectRef))) return { ok: false, reason: "note_subject_unknown" };
    if (!optStr(n.topicName, PACKAGE_LIMITS.name)) return { ok: false, reason: "bad_note_topic" };
    if (/\(kivo-image:/i.test(n.body)) return { ok: false, reason: "note_references_private_image" };
    nRefs.add(n.ref);
  }
  const rRefs = new Set<string>();
  for (const r of resources) {
    if (!isStr(r.ref, 8) || !REF.test(r.ref) || !r.ref.startsWith("r") || rRefs.has(r.ref)) return { ok: false, reason: "bad_resource_ref" };
    if (!isStr(r.title, PACKAGE_LIMITS.title) || !isStr(r.url, PACKAGE_LIMITS.url) || !safeHttpUrl(r.url)) return { ok: false, reason: "bad_resource_url" };
    if (!isStr(r.domain, 255)) return { ok: false, reason: "bad_resource_domain" };
    if (r.subjectRef !== null && !(typeof r.subjectRef === "string" && sRefs.has(r.subjectRef))) return { ok: false, reason: "resource_subject_unknown" };
    if (!optStr(r.topicName, PACKAGE_LIMITS.name)) return { ok: false, reason: "bad_resource_topic" };
    rRefs.add(r.ref);
  }
  const a = p.attribution as Record<string, unknown> | undefined;
  if (!a || typeof a !== "object" || !optStr(a.creator, 120) || !optStr(a.source, 200) || !optStr(a.packageId, 64) || !optStr(a.exportedAt, 40) || !optStr(a.importedFrom, 64)) {
    return { ok: false, reason: "bad_attribution" };
  }
  if (JSON.stringify(raw).length > PACKAGE_LIMITS.bytes) return { ok: false, reason: "too_large" };
  const ex = p.excluded as Record<string, unknown> | undefined;
  return {
    ok: true,
    pkg: {
      format: MAP_FORMAT, title: p.title as string, description: (p.description as string | null) ?? null, license: p.license as License,
      attribution: { creator: (a.creator as string | null) ?? null, source: (a.source as string | null) ?? null, packageId: (a.packageId as string | null) ?? null, exportedAt: (a.exportedAt as string | null) ?? null, importedFrom: (a.importedFrom as string | null) ?? null },
      subjects: subjects as unknown as PackageSubject[], topics: topics as unknown as PackageTopic[],
      notes: notes as unknown as PackageNote[], resources: resources as unknown as PackageResource[],
      excluded: { noteImages: Number(ex?.noteImages) || 0, privateNotes: Number(ex?.privateNotes) || 0, learningState: true },
    },
  };
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
export function packageCounts(pkg: MapPackage) {
  return { subjects: pkg.subjects.length, topics: pkg.topics.length, notes: pkg.notes.length, resources: pkg.resources.length, excluded: pkg.excluded };
}
