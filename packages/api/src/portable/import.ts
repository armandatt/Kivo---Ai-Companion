// ─── Importing a .kivo map: an independent copy, made by the map's own writers
// Nothing here writes a subject, topic, note, image, file, saved page or task
// directly; each is made by its own writer, as the learner's own:
//   structure  subjects and topics: setup-edit applyStudyEdits (versioned, all
//              or nothing per batch of up to STUDY_EDITS_MAX edits)
//   details    what each topic's plan says: applyStudyEdits update_topic
//   notes      notes.ts createNoteIn (in one transaction with this job's
//              record of it), then their images (note-images.ts) and files
//              (note-attachments.ts) under keys made from the package, then
//              the text rewritten to name the new ids (notes.ts updateNote)
//   links      saved pages: learning-events.ts importSavedLink (filed under
//              the same subject and topic, with their metadata and tags)
//   tasks      task definitions: tasks.ts createTasksIn (keys made from the
//              package; never a status, due day or completion)
//   about      the provenance note
//   verify     everything read back and compared with the package
// The only table this file writes is NovaImportJob, which records how far an
// import got, so that:
//   - one package is imported once per learner (unique profile + packageId),
//     unless the learner asks for another copy ("<packageId>#2", …);
//   - a stopped import resumes and makes nothing twice (each stage checks what
//     is already there, or uses keys made from the package);
//   - storage for every image and file is reserved before anything is written
//     (admit: the route passes the learner's storage admission);
//   - success is reported only after the result is read back and matches the
//     package, byte for byte for images and files.
// No model is called and no credit is spent: an import is the learner's own
// copy of content, on any plan.
// Package refs are mapped to the learner's new ids by name inside the new
// subjects, which are named so they do not clash with any subject the learner
// already has. The exporter's account is never touched: a package carries no
// ids, and nothing here reads any account but the importer's.

import { prisma } from "@repo/db/client";
import { applyStudyEdits, loadStudyStructure, subjectName } from "../nova/product/setup-edit";
import { createNote, createNoteIn, notesByIds, updateNote } from "../nova/product/notes";
import { importSavedLink, linksByClientIds, type ImportedLinkOutcome } from "../nova/product/learning-events";
import { imagesByKeys, saveNoteImageBytes } from "../nova/product/note-images";
import { attachmentsByKeys, saveNoteAttachmentBytes } from "../nova/product/note-attachments";
import { createTasksIn, listTasksWithKeyPrefix, openTaskRoom } from "../nova/product/tasks";
import { topicDetailsOf } from "../nova/engines/topic-mastery-engine";
import { readTopicDetails } from "../nova/product/topic-tree";
import { createHash } from "node:crypto";
import { STUDY_EDITS_MAX, SUBJECT_DEPTH_MAX, SUBJECT_NAME_MAX, TOPIC_NAME_MAX, type StudyEdit, type StudyStructure } from "../nova/product/setup-edit.types";
import { TOPIC_DEPTH_MAX } from "../nova/product/topic-tree";
import { TASK_DEPTH_MAX } from "../nova/product/task-tree";
import { normalizeTopicName } from "../nova/engines/topic-mastery-engine";
import { sha, unpackArchive, type UnpackFailure } from "./kivo-archive";
import { packageRoots, validatePackage, type MapPackage } from "./map-package";

const NAMES_PER_EDIT = 100;
const LEASE_MS = 2 * 60_000;

const key = (name: string) => normalizeTopicName(name).toLowerCase();
const topicNameOf = (raw: string) => normalizeTopicName(raw).slice(0, TOPIC_NAME_MAX);

export interface ImportProgress {
  subjectNames: Record<string, string>;   // package subject ref → the name it gets here
  notesDone: string[];                    // package note refs whole (text, images, files)
  // Format 2: package note ref → the note made for it (recorded in the same
  // transaction that made it); package asset ref → the image or file made.
  noteIds?: Record<string, string>;
  assetIds?: Record<string, string>;
  tasksDone?: boolean;
  // Package resource ref → what happened to it (absent: not yet done). Jobs
  // started before the links stage existed have none and run it on resume.
  links?: Record<string, ImportedLinkOutcome>;
  aboutNoteId: string | null;
  rootSubjectIds?: string[];
  counts?: ImportCounts;
}
export interface ImportCounts { subjects: number; topics: number; notes: number; links?: number; linksAlreadySaved?: number; images?: number; files?: number; tasks?: number; topicDetails?: number }

// The saved page made from one link of one package: the same id every run, so
// a resumed or repeated import makes it once (unique per learner).
export const linkClientId = (packageId: string, ref: string) => `kivo-${createHash("sha256").update(`${packageId}:${ref}`).digest("hex").slice(0, 40)}`;
// The same for an image or file (note-images / note-attachments clientKey),
// and the prefix every task of one import is keyed under (tasks.ts clientKey).
export const assetClientKey = (jobKey: string, ref: string) => `kivo-${createHash("sha256").update(`${jobKey}:asset:${ref}`).digest("hex").slice(0, 40)}`;
export const taskKeyPrefix = (jobKey: string) => `kivo-${createHash("sha256").update(`${jobKey}:tasks`).digest("hex").slice(0, 24)}-`;

/** A note's text with its package asset refs (a1…) replaced by the ids made here. Pure. */
export function rewriteAssetRefs(body: string, ids: Record<string, string>): string {
  return body
    .replace(/\(kivo-image:(a\d{1,5})\)/g, (w, ref: string) => ids[ref] ? `(kivo-image:${ids[ref]})` : w)
    .replace(/\]\(kivo-file:(a\d{1,5})\)/g, (w, ref: string) => ids[ref] ? `](kivo-file:${ids[ref]})` : w);
}

// The update_topic edits still needed to give each topic what its plan says.
// Pure; a topic whose details already match is left alone.
export function missingDetailEdits(pkg: MapPackage, names: Record<string, string>, structure: StudyStructure, have: Map<string, unknown>): StudyEdit[] {
  const byName = new Map(structure.subjects.map(s => [key(s.name), s]));
  const edits: StudyEdit[] = [];
  for (const t of pkg.topics) {
    if (!t.details) continue;
    const subject = byName.get(key(names[t.subjectRef]!));
    const topic = subject?.topics.find(x => key(x.name) === key(topicNameOf(t.name)));
    if (!topic) continue;
    if (JSON.stringify(readTopicDetails(have.get(topic.id))) === JSON.stringify(readTopicDetails(t.details))) continue;
    edits.push({ op: "update_topic", topicId: topic.id, details: t.details as Record<string, unknown> });
  }
  return edits;
}

// ── Checks a package must pass before anything is made ──
export type ImportCheck = { ok: true } | { ok: false; reason: "too_deep" | "name_too_long"; detail: string };

export function checkImportable(pkg: MapPackage): ImportCheck {
  const depth = new Map<string, number>();
  for (const s of pkg.subjects) {
    const d = s.parentRef ? (depth.get(s.parentRef) ?? 0) + 1 : 1;
    if (d > SUBJECT_DEPTH_MAX) return { ok: false, reason: "too_deep", detail: `"${s.name}" sits ${d} subjects deep; Kivo allows ${SUBJECT_DEPTH_MAX}.` };
    depth.set(s.ref, d);
    if (normalizeTopicName(s.name).length > SUBJECT_NAME_MAX) return { ok: false, reason: "name_too_long", detail: `Subject "${s.name.slice(0, 40)}…" is longer than ${SUBJECT_NAME_MAX} characters.` };
  }
  const tDepth = new Map<string, number>();
  for (const t of pkg.topics) {
    const d = t.parentRef ? (tDepth.get(t.parentRef) ?? 0) + 1 : 1;
    if (d > TOPIC_DEPTH_MAX) return { ok: false, reason: "too_deep", detail: `"${t.name}" sits ${d} topics deep; Kivo allows ${TOPIC_DEPTH_MAX}.` };
    tDepth.set(t.ref, d);
    if (normalizeTopicName(t.name).length > TOPIC_NAME_MAX) return { ok: false, reason: "name_too_long", detail: `Topic "${t.name.slice(0, 40)}…" is longer than ${TOPIC_NAME_MAX} characters.` };
  }
  const kDepth = new Map<string, number>();
  for (const k of pkg.tasks) {
    const d = k.parentRef ? (kDepth.get(k.parentRef) ?? 0) + 1 : 1;
    if (d > TASK_DEPTH_MAX) return { ok: false, reason: "too_deep", detail: `The task "${k.title.slice(0, 40)}" sits ${d} steps deep; Kivo allows ${TASK_DEPTH_MAX}.` };
    kDepth.set(k.ref, d);
  }
  return { ok: true };
}

// Names for the package's subjects that clash with nothing the learner has
// (subject names are unique per learner): "Compiler Design (imported)", then
// "(imported 2)", … Pure.
export function planSubjectNames(pkg: MapPackage, existing: Iterable<string>): Record<string, string> {
  const taken = new Set([...existing].map(key));
  const out: Record<string, string> = {};
  for (const s of pkg.subjects) {
    const base = subjectName(s.name);
    let name = base, n = 1;
    while (taken.has(key(name))) {
      const suffix = n === 1 ? " (imported)" : ` (imported ${n})`;
      name = base.slice(0, SUBJECT_NAME_MAX - suffix.length).trimEnd() + suffix;
      n += 1;
    }
    taken.add(key(name));
    out[s.ref] = name;
  }
  return out;
}

// The edits still needed to make the package's subjects and topics, given the
// structure as it is now. Pure; re-run after every batch, so a resumed import
// adds only what is missing.
export function missingEdits(pkg: MapPackage, names: Record<string, string>, structure: StudyStructure): StudyEdit[] {
  const byName = new Map(structure.subjects.map(s => [key(s.name), s]));
  const edits: StudyEdit[] = [];
  const missingSubjects = pkg.subjects.filter(s => !byName.has(key(names[s.ref]!)));
  for (const s of missingSubjects) edits.push({ op: "add_subject", name: names[s.ref]!, topics: [], ...(s.parentRef ? { parentName: names[s.parentRef]! } : {}) });
  if (missingSubjects.length > 0) return edits;     // topics need their subjects' ids: next pass

  const groups: Array<{ subjectId: string; parentName: string | null; kind: "milestone" | null; names: string[] }> = [];
  const groupKey = new Map<string, number>();
  const tName = new Map(pkg.topics.map(t => [t.ref, topicNameOf(t.name)]));
  for (const t of pkg.topics) {
    const subject = byName.get(key(names[t.subjectRef]!))!;
    const here = new Set(subject.topics.map(x => key(x.name)));
    const name = tName.get(t.ref)!;
    if (here.has(key(name))) continue;
    const parentName = t.parentRef ? tName.get(t.parentRef)! : null;
    const k = `${subject.id}|${parentName ?? ""}|${t.kind ?? ""}`;
    let gi = groupKey.get(k);
    if (gi === undefined || groups[gi]!.names.length >= NAMES_PER_EDIT) { gi = groups.length; groupKey.set(k, gi); groups.push({ subjectId: subject.id, parentName, kind: t.kind, names: [] }); }
    groups[gi]!.names.push(name);
  }
  for (const g of groups) edits.push({ op: "add_topics", subjectId: g.subjectId, names: g.names, ...(g.parentName ? { parentName: g.parentName } : {}), ...(g.kind ? { kind: g.kind } : {}) });
  return edits;
}

// Read back: every subject in place under its parent, every topic under its
// subject and parent. Pure.
export function verifyStructure(pkg: MapPackage, names: Record<string, string>, structure: StudyStructure): { ok: true; rootSubjectId: string; rootSubjectIds: string[] } | { ok: false; detail: string } {
  const byName = new Map(structure.subjects.map(s => [key(s.name), s]));
  for (const s of pkg.subjects) {
    const here = byName.get(key(names[s.ref]!));
    if (!here) return { ok: false, detail: `subject ${s.ref} missing` };
    const parent = s.parentRef ? byName.get(key(names[s.parentRef]!)) : null;
    if ((here.parentId ?? null) !== (parent?.id ?? null)) return { ok: false, detail: `subject ${s.ref} not under its parent` };
  }
  const tName = new Map(pkg.topics.map(t => [t.ref, topicNameOf(t.name)]));
  for (const t of pkg.topics) {
    const subject = byName.get(key(names[t.subjectRef]!))!;
    const topic = subject.topics.find(x => key(x.name) === key(tName.get(t.ref)!));
    if (!topic) return { ok: false, detail: `topic ${t.ref} missing` };
    const parent = t.parentRef ? subject.topics.find(x => key(x.name) === key(tName.get(t.parentRef!)!)) : null;
    if ((topic.parentId ?? null) !== (parent?.id ?? null)) return { ok: false, detail: `topic ${t.ref} not under its parent` };
  }
  const rootSubjectIds = packageRoots(pkg).map(r => byName.get(key(names[r.ref]!))!.id);
  return { ok: true, rootSubjectId: rootSubjectIds[0]!, rootSubjectIds };
}

// Read back: every link saved here is a saved page filed under its subject and
// topic as in the map. A link the learner had already saved and filed
// elsewhere is theirs and is not moved (outcome "already_saved"). Pure.
export function verifyLinks(
  pkg: MapPackage, names: Record<string, string>, structure: StudyStructure, packageId: string,
  outcomes: Record<string, ImportedLinkOutcome>, rows: Array<{ clientEventId: string; subjectId: string | null; topicName: string | null }>,
): { ok: true; saved: number; alreadySaved: number } | { ok: false; detail: string } {
  const byName = new Map(structure.subjects.map(s => [key(s.name), s]));
  const byClient = new Map(rows.map(r => [r.clientEventId, r]));
  let saved = 0, alreadySaved = 0;
  for (const r of pkg.resources) {
    if (!r.subjectRef) continue;
    const outcome = outcomes[r.ref];
    if (!outcome) return { ok: false, detail: `link ${r.ref} not done` };
    if (outcome === "already_saved") { alreadySaved += 1; continue; }
    if (outcome === "filed_existing") { saved += 1; continue; }
    if (outcome === "invalid") return { ok: false, detail: `link ${r.ref} invalid` };
    const row = byClient.get(linkClientId(packageId, r.ref));
    if (!row) return { ok: false, detail: `link ${r.ref} missing` };
    const subject = byName.get(key(names[r.subjectRef]!));
    if (!subject || row.subjectId !== subject.id) return { ok: false, detail: `link ${r.ref} not under its subject` };
    if ((r.topicName ? key(r.topicName) : null) !== (row.topicName ? key(row.topicName) : null)) return { ok: false, detail: `link ${r.ref} not under its topic` };
    saved += 1;
  }
  return { ok: true, saved, alreadySaved };
}

// The provenance note at the root (or, for a whole map with several roots,
// filed nowhere): where the map came from, its licence, what was not carried,
// and its links as a list (each is also a saved page of its own).
export function aboutNoteBody(pkg: MapPackage, names: Record<string, string>, importedAt: Date): string {
  const lic: Record<string, string> = {
    "all-rights-reserved": "All rights reserved by the creator. For your own study; don't redistribute it.",
    "cc-by-4.0": "CC BY 4.0: share and adapt, with credit to the creator.",
    "cc-by-sa-4.0": "CC BY-SA 4.0: share and adapt, with credit, under the same licence.",
    "cc-by-nc-4.0": "CC BY-NC 4.0: share and adapt for non-commercial use, with credit.",
    "cc0-1.0": "CC0: no rights reserved.",
  };
  const a = pkg.attribution;
  const lines = [
    `> [!source] Imported map`,
    `> **${pkg.title}**`,
    ...(pkg.description ? [`> ${pkg.description}`] : []),
    ...(a.creator ? [`> Made by: ${a.creator}`] : []),
    ...(a.source ? [`> Source: ${a.source}`] : []),
    `> Licence: ${lic[pkg.license]}`,
    ...(a.exportedAt ? [`> Exported: ${a.exportedAt.slice(0, 10)}`] : []),
    `> Imported: ${importedAt.toISOString().slice(0, 10)}`,
    ...(a.packageId ? [`> Package: ${a.packageId}`] : []),
    "",
    "This map is your own copy. Change, reorganise or delete anything in it; nothing you do here reaches the creator, and nothing they change reaches you.",
  ];
  const ex = pkg.excluded;
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  const left = [
    ex.noteImages ? `${n(ex.noteImages, "image", "images")} in notes` : null,
    ex.imagesNotCarried ? `${n(ex.imagesNotCarried, "image", "images")} the creator's notes named but that could not be carried` : null,
    ex.filesNotCarried ? `${n(ex.filesNotCarried, "file", "files")} that could not be carried` : null,
    ex.archivedTopics ? n(ex.archivedTopics, "archived topic", "archived topics") : null,
    ex.unfiledNotes ? `${n(ex.unfiledNotes, "note", "notes")} the creator had filed under no subject` : null,
    ex.unfiledPages ? `${n(ex.unfiledPages, "saved page", "saved pages")} filed under no subject` : null,
    ex.passages ? `${n(ex.passages, "saved passage", "saved passages")} (selections from pages)` : null,
    ex.pagesOverLimit ? `${n(ex.pagesOverLimit, "saved page", "saved pages")} past what one file carries` : null,
    ex.taskProgress ? "whether and when the creator did each task" : null,
    ex.pagePersonalState ? "the creator's reading status, collections and own notes on saved pages" : null,
    "the creator's study progress (it was never in the file)",
  ].filter(Boolean);
  lines.push("", `Not included: ${left.join("; ")}.`);
  if (pkg.resources.length > 0) {
    lines.push("", "## Links in this map", "", "Each one is also in your Saved pages, filed under its subject and topic.");
    const bySubject = new Map<string, typeof pkg.resources>();
    for (const r of pkg.resources) { const k = r.subjectRef ?? ""; bySubject.set(k, [...(bySubject.get(k) ?? []), r]); }
    for (const [ref, rs] of bySubject) {
      lines.push("", `### ${ref ? names[ref] ?? "Other" : "Other"}`);
      for (const r of rs) lines.push(`- [${r.title.replace(/[[\]]/g, "")}](${r.url.replace(/\)/g, "%29")}) · ${r.domain}${r.topicName ? ` · ${r.topicName}` : ""}`);
    }
  }
  return lines.join("\n");
}

// ── What the learner sees before anything is made ──
export interface StorageAdmit {
  /** Reserves this many bytes on the learner's storage allowance before anything is written; refused: a message to show. */
  (bytes: number): Promise<{ refused: string | null; release: () => Promise<void> }>;
}

export type ImportPreview =
  | { ok: true; packageId: string; title: string; description: string | null; creator: string | null; source: string | null; license: string; exportedAt: string | null;
      format: string;
      counts: { subjects: number; topics: number; notes: number; links: number; edges: number; nestedSubjects: number; images: number; files: number; tasks: number; topicDetails: number };
      excluded: MapPackage["excluded"]; renames: Array<{ from: string; to: string }>; outline: Array<{ name: string; depth: number; topics: number }>;
      storageBytes: number; taskRoom: number;
      job: { id: string; status: string; rootSubjectId: string | null } | null; copies: number }
  | { ok: false; reason: UnpackFailure | "too_deep" | "name_too_long" | "different_file" | "too_many_tasks"; detail?: string; message: string; found?: "map" | "note" };

const MESSAGES: Record<string, string> = {
  too_large: "That file is too large for a Kivo map (50 MB at most).",
  not_a_kivo_file: "That isn't a .kivo map file.",
  unsupported_version: "This map was made by a newer version of Kivo. Ask for a new export, or try again after Kivo updates.",
  checksum_mismatch: "This file was changed or damaged after it was exported, so it can't be imported safely. Ask for the file again.",
  missing_file: "This file is incomplete. Ask for the file again.",
  inventory_mismatch: "This file holds something it shouldn't, so it can't be imported safely.",
  unsafe_path: "This file holds something it shouldn't, so it can't be imported safely.",
  unexpected_file: "This file holds something it shouldn't, so it can't be imported safely.",
  compression_bomb: "This file expands to far more than a map holds, so it can't be imported.",
  entry_too_large: "Part of this file is larger than a map allows.",
  too_many_files: "This file holds more items than a map allows.",
  bad_asset: "An image or file inside this map isn't what the map says it is, so it can't be imported safely. Ask for the file again.",
  wrong_package_type: "This .kivo file is a single note, not a map. Import it from Notes → More → Import a shared note or PDF.",
  too_deep: "This map nests deeper than Kivo allows.",
  name_too_long: "A name in this map is longer than Kivo allows.",
  too_many_tasks: "This map has more tasks than you have room for. Finish or remove some open tasks first.",
  different_file: "A different file with the same package id was imported before. Ask the creator for a fresh export.",
  file_needed: "To finish this import, choose the same .kivo file again: its images and files are read from the file, never kept on the server.",
};
const message = (reason: string, detail?: string) => (reason === "too_deep" || reason === "name_too_long") && detail ? detail : MESSAGES[reason] ?? "This file can't be read as a Kivo map.";

function read(bytes: Uint8Array) {
  const out = unpackArchive(bytes);
  if (!out.ok) return { ok: false as const, reason: out.reason, detail: out.detail, message: message(out.reason, out.detail), ...(out.found ? { found: out.found } : {}) };
  const fit = checkImportable(out.pkg);
  if (!fit.ok) return { ok: false as const, reason: fit.reason, detail: fit.detail, message: message(fit.reason, fit.detail), found: undefined };
  return { ok: true as const, pkg: out.pkg, manifest: out.manifest, sha256: out.sha256, assetData: out.assetData };
}

const assetBytesOf = (pkg: MapPackage) => pkg.assets.reduce((n, a) => n + a.bytes, 0);
// Jobs of this package for this learner: the first import and any copies ("<id>#2"…).
const jobsOf = (profileId: string, packageId: string) => prisma.novaImportJob.findMany({
  where: { profileId, OR: [{ packageId }, { packageId: { startsWith: `${packageId}#` } }] },
  orderBy: { createdAt: "asc" }, select: { id: true, packageId: true, status: true, rootSubjectId: true, packageSha256: true },
});

export async function previewImport(profileId: string, bytes: Uint8Array): Promise<ImportPreview> {
  const r = read(bytes);
  if (!r.ok) return r;
  const { pkg, manifest } = r;
  const structure = await loadStudyStructure(profileId);
  const names = planSubjectNames(pkg, structure.subjects.map(s => s.name));
  const jobs = await jobsOf(profileId, manifest.packageId);
  const job = jobs.find(j => j.packageId === manifest.packageId) ?? null;
  const depth = new Map<string, number>();
  const outline = pkg.subjects.map(s => { const d = s.parentRef ? (depth.get(s.parentRef) ?? 0) + 1 : 1; depth.set(s.ref, d); return { name: names[s.ref]!, depth: d, topics: pkg.topics.filter(t => t.subjectRef === s.ref).length }; });
  return {
    ok: true, packageId: manifest.packageId, title: pkg.title, description: pkg.description, creator: pkg.attribution.creator, source: pkg.attribution.source, license: pkg.license, exportedAt: pkg.attribution.exportedAt ?? manifest.createdAt,
    format: pkg.format,
    counts: {
      subjects: manifest.counts.subjects, topics: manifest.counts.topics, notes: manifest.counts.notes, links: manifest.counts.resources, edges: manifest.counts.edges, nestedSubjects: manifest.counts.nestedSubjects,
      images: pkg.assets.filter(a => a.kind === "image").length, files: pkg.assets.filter(a => a.kind === "document").length, tasks: pkg.tasks.length, topicDetails: pkg.topics.filter(t => t.details).length,
    },
    excluded: pkg.excluded,
    renames: pkg.subjects.filter(s => names[s.ref] !== subjectName(s.name)).map(s => ({ from: s.name, to: names[s.ref]! })),
    outline: outline.slice(0, 200), storageBytes: assetBytesOf(pkg), taskRoom: await openTaskRoom(profileId),
    job: job ? { id: job.id, status: job.status, rootSubjectId: job.rootSubjectId } : null,
    copies: jobs.length,
  };
}

// ── Running an import ──
export type ImportResult =
  | { ok: true; status: "complete"; jobId: string; rootSubjectId: string; rootSubjectIds: string[]; already: boolean; counts: ImportCounts }
  | { ok: true; status: "running"; jobId: string }
  | { ok: false; status: "failed" | "refused"; jobId?: string; reason: string; message: string; found?: "map" | "note" };

export interface ImportOptions { now?: Date; admit?: StorageAdmit; copy?: boolean }

export async function startImport(profileId: string, bytes: Uint8Array, options: ImportOptions | Date = {}): Promise<ImportResult> {
  const opts: ImportOptions = options instanceof Date ? { now: options } : options;
  const now = opts.now ?? new Date();
  const r = read(bytes);
  if (!r.ok) return { ok: false, status: "refused", reason: r.reason, message: r.message, ...(r.found ? { found: r.found } : {}) };
  const { pkg, manifest, sha256, assetData } = r;
  const jobs = await jobsOf(profileId, manifest.packageId);
  if (jobs.some(j => j.packageSha256 !== sha256)) return { ok: false, status: "refused", reason: "different_file", message: MESSAGES.different_file! };
  // Another copy of a package already imported, when asked: a job of its own.
  const unfinished = jobs.find(j => j.status !== "complete");
  let jobKey = manifest.packageId;
  if (opts.copy && jobs.length > 0 && !unfinished) jobKey = `${manifest.packageId}#${jobs.length + 1}`;
  else if (unfinished) jobKey = unfinished.packageId;
  else if (jobs.length > 0) { const first = await prisma.novaImportJob.findUniqueOrThrow({ where: { id: jobs[0]!.id } }); return completed(first, true); }

  let job = await prisma.novaImportJob.findUnique({ where: { profileId_packageId: { profileId, packageId: jobKey } } });
  if (job?.status === "complete") return completed(job, true);
  if (!job) {
    // Everything checked before anything is written: room for the tasks, then storage.
    if (pkg.tasks.length > 0 && pkg.tasks.length > await openTaskRoom(profileId)) return { ok: false, status: "refused", reason: "too_many_tasks", message: MESSAGES.too_many_tasks! };
    const structure = await loadStudyStructure(profileId);
    const progress: ImportProgress = { subjectNames: planSubjectNames(pkg, structure.subjects.map(s => s.name)), notesDone: [], noteIds: {}, assetIds: {}, aboutNoteId: null };
    try {
      job = await prisma.novaImportJob.create({ data: { profileId, packageId: jobKey, packageSha256: sha256, packageType: "map", title: pkg.title.slice(0, 200), status: "running", stage: "structure", pkg: pkg as never, progress: progress as never } });
    } catch (err) {
      // Two requests at once: the other made the job and runs it.
      if ((err as { code?: string }).code !== "P2002") throw err;
      job = await prisma.novaImportJob.findUnique({ where: { profileId_packageId: { profileId, packageId: jobKey } } });
      if (!job) throw err;
      return resumeImport(profileId, job.id, { ...opts, assetData });
    }
    return withStorage(pkg, opts, async () => runImport(job!.id, profileId, now, assetData));
  }
  return resumeImport(profileId, job.id, { ...opts, assetData });
}

// Storage for every image and file, reserved before the import writes any.
async function withStorage(pkg: MapPackage, opts: ImportOptions, run: () => Promise<ImportResult>): Promise<ImportResult> {
  const bytes = assetBytesOf(pkg);
  if (bytes === 0 || !opts.admit) return run();
  const admission = await opts.admit(bytes);
  if (admission.refused) return { ok: false, status: "refused", reason: "storage", message: admission.refused };
  try { return await run(); } finally { await admission.release(); }
}

export async function resumeImport(profileId: string, jobId: string, options: (ImportOptions & { assetData?: Map<string, Uint8Array> }) | Date = {}): Promise<ImportResult> {
  const opts = options instanceof Date ? { now: options } : options;
  const now = opts.now ?? new Date();
  // Only the learner's own job, and only a map's (a note's runs in note-import.ts).
  const own = await prisma.novaImportJob.findFirst({ where: { id: jobId, profileId, packageType: "map" }, select: { id: true, status: true, rootSubjectId: true, progress: true, pkg: true } });
  if (!own) return { ok: false, status: "refused", reason: "not_found", message: "That import isn't yours, or no longer exists." };
  if (own.status === "complete") return completed(own, true);
  // A package with images or files needs its file again to finish them.
  const checked = validatePackage(own.pkg);
  if (checked.ok && checked.pkg.assets.length > 0 && !opts.assetData) {
    const progress = own.progress as unknown as ImportProgress;
    if (progress.notesDone.length < checked.pkg.notes.length) return { ok: false, status: "refused", jobId, reason: "file_needed", message: MESSAGES.file_needed! };
  }
  // Claim the job: only one request runs it at a time; a run that stopped
  // (its lease older than LEASE_MS) can be taken over.
  const claimed = await prisma.novaImportJob.updateMany({
    where: { id: jobId, profileId, OR: [{ status: "failed" }, { status: "running", updatedAt: { lt: new Date(now.getTime() - LEASE_MS) } }] },
    data:  { status: "running", error: null },
  });
  if (claimed.count === 0) return { ok: true, status: "running", jobId };
  if (!checked.ok) return runImport(jobId, profileId, now, opts.assetData);
  return withStorage(checked.pkg, opts, () => runImport(jobId, profileId, now, opts.assetData));
}

function completed(job: { id: string; rootSubjectId: string | null; progress: unknown }, already: boolean): ImportResult {
  const progress = job.progress as ImportProgress;
  return { ok: true, status: "complete", jobId: job.id, rootSubjectId: job.rootSubjectId!, rootSubjectIds: progress.rootSubjectIds ?? [job.rootSubjectId!], already, counts: progress.counts ?? { subjects: 0, topics: 0, notes: 0 } };
}

async function save(jobId: string, data: Record<string, unknown>) {
  await prisma.novaImportJob.update({ where: { id: jobId }, data: data as never });
}

class Stop extends Error { constructor(readonly reason: string, readonly userMessage: string) { super(reason); } }

async function runImport(jobId: string, profileId: string, now: Date, assetData?: Map<string, Uint8Array>): Promise<ImportResult> {
  const job = await prisma.novaImportJob.findUniqueOrThrow({ where: { id: jobId } });
  const checked = validatePackage(job.pkg);
  if (!checked.ok) { await save(jobId, { status: "failed", error: `stored package: ${checked.reason}` }); return { ok: false, status: "failed", jobId, reason: "bad_graph", message: "This import can't continue. Import the file again." }; }
  const pkg = checked.pkg;
  const progress = job.progress as unknown as ImportProgress;
  progress.noteIds ??= {}; progress.assetIds ??= {};
  const names = progress.subjectNames;
  const jobKey = job.packageId;
  let stage = job.stage;
  const fail = async (reason: string, msg: string): Promise<ImportResult> => {
    await save(jobId, { status: "failed", stage, error: reason.slice(0, 500) });
    console.error(`[portable] import ${jobId} failed at ${stage}: ${reason.slice(0, 200)}`);
    return { ok: false, status: "failed", jobId, reason, message: msg };
  };

  try {
    // 1. Subjects and topics, in batches the map's own writer accepts.
    if (stage === "structure") {
      for (let pass = 0; pass < 200; pass++) {
        const structure = await loadStudyStructure(profileId);
        const edits = missingEdits(pkg, names, structure);
        if (edits.length === 0) break;
        const batch = edits.slice(0, STUDY_EDITS_MAX);
        const res = await applyStudyEdits(profileId, { version: structure.version, edits: batch });
        if (!res.ok && res.error !== "stale") return fail(`structure: ${res.error} ${res.issues?.map(i => i.message).join("; ") ?? res.message}`, "Part of this map couldn't be made. Nothing else was changed; you can try again.");
        await save(jobId, {});   // renews the lease
      }
      stage = "details"; await save(jobId, { stage });
    }

    // 2. What each topic's plan says (format 2).
    if (stage === "details") {
      for (let pass = 0; pass < 100; pass++) {
        const structure = await loadStudyStructure(profileId);
        const have = await topicDetailsOf(profileId, structure.subjects.map(s => s.id));
        const edits = missingDetailEdits(pkg, names, structure, have);
        if (edits.length === 0) break;
        const res = await applyStudyEdits(profileId, { version: structure.version, edits: edits.slice(0, STUDY_EDITS_MAX) });
        if (!res.ok && res.error !== "stale") return fail(`details: ${res.error} ${res.message ?? ""}`, "What this map says about its topics couldn't be saved. Nothing else was changed; you can try again.");
        await save(jobId, {});
      }
      stage = "notes"; await save(jobId, { stage });
    }

    // 3. Notes, each once, with their images and files.
    if (stage === "notes") {
      const structure = await loadStudyStructure(profileId);
      const idOf = new Map(structure.subjects.map(s => [key(s.name), s.id]));
      const done = new Set(progress.notesDone);
      for (const n of pkg.notes) {
        if (done.has(n.ref)) continue;
        const subjectId = n.subjectRef ? idOf.get(key(names[n.subjectRef]!)) ?? null : null;
        const assets = pkg.assets.filter(a => a.noteRef === n.ref);
        if (assets.length > 0 && !assetData) return fail("file_needed", MESSAGES.file_needed!);
        let noteId: string | undefined = progress.noteIds[n.ref];
        // Made by an earlier run but gone since (the learner deleted it): made again.
        if (noteId && (await notesByIds(profileId, [noteId])).length === 0) {
          delete progress.noteIds[n.ref];
          for (const a of assets) delete progress.assetIds[a.ref];
          noteId = undefined;
        }
        if (!noteId) {
          // Made and recorded together: a stopped import never makes it twice.
          noteId = await prisma.$transaction(async tx => {
            const made = await createNoteIn(tx, profileId, { title: n.title, body: n.body, subjectId, topicName: n.topicName });
            if (!made.ok) throw new Stop(`note ${n.ref}: ${made.error}`, "A note in this map couldn't be saved. Nothing else was changed; you can try again.");
            const next = { ...progress, noteIds: { ...progress.noteIds, [n.ref]: made.id }, ...(assets.length === 0 ? { notesDone: [...done, n.ref] } : {}) };
            await tx.novaImportJob.update({ where: { id: jobId }, data: { progress: next as never } });
            return made.id;
          });
          progress.noteIds[n.ref] = noteId;
          if (assets.length === 0) { done.add(n.ref); progress.notesDone = [...done]; continue; }
        }
        for (const a of assets) {
          if (progress.assetIds[a.ref]) continue;
          const bytes = assetData!.get(a.ref);
          if (!bytes) return fail(`asset ${a.ref} missing`, MESSAGES.file_needed!);
          const clientKey = assetClientKey(jobKey, a.ref);
          const res = a.kind === "image"
            ? await saveNoteImageBytes(profileId, { noteId, bytes: Buffer.from(bytes), clientKey, sourceUrl: a.source?.url ?? null, sourceTitle: a.source?.title ?? null, page: a.source?.page ?? null })
            : await saveNoteAttachmentBytes(profileId, { noteId, bytes, fileName: a.fileName ?? "document.pdf", clientKey });
          if (!res.ok) return fail(`asset ${a.ref}: ${res.error}`, "An image or file in this map couldn't be saved. Nothing else was changed; you can try again.");
          progress.assetIds[a.ref] = "image" in res ? res.image.id : res.file.id;
          await save(jobId, { progress: progress as never });
        }
        const body = rewriteAssetRefs(n.body, progress.assetIds);
        const upd = await updateNote(profileId, noteId, { body });
        if (!upd.ok) return fail(`note ${n.ref} text: ${upd.error}`, "A note in this map couldn't be saved. Nothing else was changed; you can try again.");
        done.add(n.ref);
        progress.notesDone = [...done];
        await save(jobId, { progress: progress as never });
      }
      stage = "links"; await save(jobId, { stage });
    }

    // 4. Links, each saved once as a saved page under its subject and topic.
    if (stage === "links") {
      const structure = await loadStudyStructure(profileId);
      const idOf = new Map(structure.subjects.map(s => [key(s.name), s.id]));
      const outcomes = { ...(progress.links ?? {}) };
      const credit = [pkg.attribution.creator ? `made by ${pkg.attribution.creator}` : null, `imported ${now.toISOString().slice(0, 10)}`].filter(Boolean).join(", ");
      for (const r of pkg.resources) {
        if (outcomes[r.ref] || !r.subjectRef) continue;
        const subjectId = idOf.get(key(names[r.subjectRef]!));
        if (!subjectId) return fail(`link ${r.ref}: subject missing`, "A link in this map couldn't be saved. Nothing else was changed; you can try again.");
        const res = await importSavedLink(profileId, {
          clientEventId: linkClientId(jobKey, r.ref), url: r.url, title: r.title, domain: r.domain, subjectId, topicName: r.topicName,
          description: r.description ?? null, resourceType: r.resourceType ?? null, siteName: r.siteName ?? null,
          canonicalUrl: r.canonicalUrl ?? null, imageUrl: r.imageUrl ?? null, author: r.author ?? null, publishedAt: r.publishedAt ?? null, durationSeconds: r.durationSeconds ?? null, tags: r.tags ?? [],
          provenance: `From the shared map “${pkg.title}” (${credit}).`,
        }, now);
        outcomes[r.ref] = res.outcome;
        progress.links = outcomes;
        await save(jobId, { progress: progress as never });
      }
      progress.links = outcomes;
      stage = "tasks"; await save(jobId, { stage, progress: progress as never });
    }

    // 5. Task definitions, all at once, each under a key made from the package.
    if (stage === "tasks") {
      if (!progress.tasksDone && pkg.tasks.length > 0) {
        const structure = await loadStudyStructure(profileId);
        const idOf = new Map(structure.subjects.map(s => [key(s.name), s.id]));
        const prefix = taskKeyPrefix(jobKey);
        const rows = pkg.tasks.map(t => ({
          title: t.title, priority: t.priority, estimatedMinutes: t.estimatedMinutes, topicName: t.topicName,
          subjectId: t.subjectRef ? idOf.get(key(names[t.subjectRef]!)) ?? null : null,
          clientKey: `${prefix}${t.ref}`, ...(t.parentRef ? { parentKey: `${prefix}${t.parentRef}` } : {}),
          ...(t.waitsOn.length ? { afterKeys: t.waitsOn.map(w => `${prefix}${w}`) } : {}),
        }));
        const res = await prisma.$transaction(tx => createTasksIn(tx, profileId, rows), { timeout: 60_000 });
        if (!res.ok) return fail(`tasks: ${res.message}`, `The tasks in this map couldn't be added: ${res.message}`);
        progress.tasksDone = true;
        await save(jobId, { progress: progress as never });
      }
      stage = "about"; await save(jobId, { stage });
    }

    // 6. Where it came from, at its root.
    if (stage === "about") {
      if (!progress.aboutNoteId) {
        const structure = await loadStudyStructure(profileId);
        const roots = packageRoots(pkg);
        const rootId = roots.length === 1 ? structure.subjects.find(s => key(s.name) === key(names[roots[0]!.ref]!))?.id ?? null : null;
        const res = await createNote(profileId, { title: `About this map: ${pkg.title}`.slice(0, 200), body: aboutNoteBody(pkg, names, now), subjectId: rootId, once: true });
        if (!res.ok) return fail(`about: ${res.error}`, "The map was made, but its source note couldn't be saved. You can try again.");
        progress.aboutNoteId = res.note.id;
        await save(jobId, { progress: progress as never });
      }
      stage = "verify"; await save(jobId, { stage });
    }

    // 7. Read it back before saying it worked.
    const structure = await loadStudyStructure(profileId);
    const v = verifyStructure(pkg, names, structure);
    if (!v.ok) return fail(`verify: ${v.detail}`, "The map was made but doesn't match the file. You can try again.");
    const detailEdits = missingDetailEdits(pkg, names, structure, await topicDetailsOf(profileId, structure.subjects.map(s => s.id)));
    if (detailEdits.length) return fail("verify: topic details", "What this map says about a topic wasn't saved. You can try again.");
    if (progress.notesDone.length !== pkg.notes.length) return fail("verify: notes", "Not every note was saved. You can try again.");
    const nv = await verifyNotes(profileId, pkg, progress, jobKey);
    if (!nv.ok) return fail(`verify: ${nv.detail}`, "A note, image or file doesn't match the file. You can try again.");
    const filed = pkg.resources.filter(r => r.subjectRef);
    const rows = await linksByClientIds(profileId, filed.map(r => linkClientId(jobKey, r.ref)));
    const l = verifyLinks(pkg, names, structure, jobKey, progress.links ?? {}, rows);
    if (!l.ok) {
      // A link not done yet (a job that reached here before the links stage existed): do it now.
      if (/not done/.test(l.detail)) { await save(jobId, { stage: "links", status: "running" }); return runImport(jobId, profileId, now, assetData); }
      return fail(`verify: ${l.detail}`, "The map was made but a link doesn't match the file. You can try again.");
    }
    if (pkg.tasks.length > 0) {
      const made = await listTasksWithKeyPrefix(profileId, taskKeyPrefix(jobKey));
      const t = verifyTasks(pkg, made, taskKeyPrefix(jobKey), names, structure);
      if (!t.ok) return fail(`verify: ${t.detail}`, "The map was made but a task doesn't match the file. You can try again.");
    }
    progress.rootSubjectIds = v.rootSubjectIds;
    progress.counts = {
      subjects: pkg.subjects.length, topics: pkg.topics.length, notes: pkg.notes.length, links: l.saved, linksAlreadySaved: l.alreadySaved,
      images: pkg.assets.filter(a => a.kind === "image").length, files: pkg.assets.filter(a => a.kind === "document").length, tasks: pkg.tasks.length, topicDetails: pkg.topics.filter(x => x.details).length,
    };
    await save(jobId, { status: "complete", stage: "done", pkg: null as never, progress: progress as never, rootSubjectId: v.rootSubjectId, completedAt: new Date(), error: null });
    return { ok: true, status: "complete", jobId, rootSubjectId: v.rootSubjectId, rootSubjectIds: v.rootSubjectIds, already: false, counts: progress.counts };
  } catch (err) {
    if (err instanceof Stop) return fail(err.reason, err.userMessage);
    return fail(`error: ${(err as Error).name}: ${(err as Error).message}`, "The import stopped. Nothing was lost; you can try again and it continues where it stopped.");
  }
}

// Read back: every note's title, place and text as the package says (with its
// asset refs replaced by the ids made here), and every image and file byte
// for byte (size and sha256).
async function verifyNotes(profileId: string, pkg: MapPackage, progress: ImportProgress, jobKey: string): Promise<{ ok: true } | { ok: false; detail: string }> {
  const ids = progress.noteIds ?? {};
  const legacy = Object.keys(ids).length === 0;      // jobs before 25 Nov recorded only notesDone
  if (!legacy) {
    const rows = new Map((await notesByIds(profileId, Object.values(ids))).map(r => [r.id, r]));
    for (const n of pkg.notes) {
      const row = rows.get(ids[n.ref] ?? "");
      if (!row) return { ok: false, detail: `note ${n.ref} missing` };
      // As the note writer keeps them: a title's spaces made single, line endings unified.
      if (row.title !== n.title.trim().replace(/\s+/g, " ")) return { ok: false, detail: `note ${n.ref} title` };
      if (row.body !== rewriteAssetRefs(n.body, progress.assetIds ?? {}).replace(/\r\n?/g, "\n")) return { ok: false, detail: `note ${n.ref} text` };
    }
  }
  const images = pkg.assets.filter(a => a.kind === "image"), files = pkg.assets.filter(a => a.kind === "document");
  const imgRows = new Map((await imagesByKeys(profileId, images.map(a => assetClientKey(jobKey, a.ref)))).map(r => [r.clientKey, r]));
  for (const a of images) {
    const row = imgRows.get(assetClientKey(jobKey, a.ref));
    if (!row || row.noteId !== ids[a.noteRef] || row.bytes.length !== a.bytes || sha(row.bytes) !== a.sha256) return { ok: false, detail: `image ${a.ref}` };
  }
  const fileRows = new Map((await attachmentsByKeys(profileId, files.map(a => assetClientKey(jobKey, a.ref)))).map(r => [r.clientKey, r]));
  for (const a of files) {
    const row = fileRows.get(assetClientKey(jobKey, a.ref));
    if (!row || row.noteId !== ids[a.noteRef] || row.byteSize !== a.bytes || row.sha256 !== a.sha256) return { ok: false, detail: `file ${a.ref}` };
  }
  return { ok: true };
}

// Read back: every task made once, under its subject and topic, under its
// parent, waiting on what it waited on, and never marked done. Pure.
export function verifyTasks(
  pkg: MapPackage, made: Array<{ id: string; title: string; status: string; subjectId: string | null; topicName: string | null; parentId: string | null; after?: string[] }> & Array<{ id: string }>,
  prefix: string, names: Record<string, string>, structure: StudyStructure,
): { ok: true } | { ok: false; detail: string } {
  const byName = new Map(structure.subjects.map(s => [key(s.name), s]));
  const keyed = made as Array<{ id: string; title: string; status: string; subjectId: string | null; topicName: string | null; parentId: string | null; after?: string[]; clientKey?: string }>;
  if (keyed.length !== pkg.tasks.length) return { ok: false, detail: `tasks ${keyed.length}/${pkg.tasks.length}` };
  const byTitle = (t: { title: string }) => keyed.filter(m => m.title === t.title);
  const idOfRef = new Map<string, string>();
  for (const t of pkg.tasks) {
    const parentId = t.parentRef ? idOfRef.get(t.parentRef) ?? null : null;
    const subjectId = t.subjectRef ? byName.get(key(names[t.subjectRef]!))?.id ?? null : null;
    const hit = byTitle(t).find(m => (m.parentId ?? null) === parentId && m.subjectId === subjectId && ![...idOfRef.values()].includes(m.id));
    if (!hit) return { ok: false, detail: `task ${t.ref}` };
    if (hit.status === "done") return { ok: false, detail: `task ${t.ref} done` };
    idOfRef.set(t.ref, hit.id);
  }
  for (const t of pkg.tasks) {
    const want = t.waitsOn.map(w => idOfRef.get(w)).sort();
    const got = [...(keyed.find(m => m.id === idOfRef.get(t.ref))?.after ?? [])].sort();
    if (JSON.stringify(want) !== JSON.stringify(got)) return { ok: false, detail: `task ${t.ref} waits` };
  }
  void prefix;
  return { ok: true };
}

// The learner's imports, newest first (for the import page).
export async function listImports(profileId: string) {
  return prisma.novaImportJob.findMany({ where: { profileId }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, title: true, status: true, stage: true, packageType: true, rootSubjectId: true, createdAt: true, completedAt: true, error: true } });
}
