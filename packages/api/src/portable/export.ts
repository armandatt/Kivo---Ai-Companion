// ─── Exporting a Knowledge Map as a .kivo file ───────────────────────────────
// Reads only, and only the learner's own records, each through its owner:
// the subject tree (setup-edit), what each topic's plan says
// (topic-mastery-engine), every note filed in the scope (notes.ts) with its
// images (note-images.ts) and files (note-attachments.ts), the saved pages
// filed there (learning-events.ts) and the tasks filed there (tasks.ts).
// Every export from 25 Nov is format 2 (map-package.ts), for one subject or
// the whole map: everything in scope goes in unless the learner chose fewer
// notes or left saved pages or tasks out, and what is not carried is counted
// (excluded) and shown before the download. Writes nothing, anywhere. The
// file is checked by unpacking it again before it is handed back, so an
// export Kivo cannot import is never downloaded.

import { loadStudyStructure } from "../nova/product/setup-edit";
import { listNoteTitlesIn, notesForExport, notesInSubjectsForExport, unfiledNoteCount } from "../nova/product/notes";
import { listFiledLinks, savedPagesLeftOut } from "../nova/product/learning-events";
import { imageSizesOfNotes, imagesOfNotes } from "../nova/product/note-images";
import { attachmentBytes, attachmentsOfNotes } from "../nova/product/note-attachments";
import { listTasksInSubjects } from "../nova/product/tasks";
import { topicDetailsOf } from "../nova/engines/topic-mastery-engine";
import { buildPackage, LICENSES, MAP_FORMAT_V2, PACKAGE_LIMITS, type License, type SourceFile, type SourceResource, type SourceSubject, type SourceTask, type SourceTopic } from "./map-package";
import { packArchive, unpackArchive, type Manifest } from "./kivo-archive";

// What to export: one subject (by id) or the whole map.
export const WHOLE_MAP = "map";
export type ExportScope = { kind: "subject"; rootSubjectId: string } | { kind: "map" };

export interface ExportPreview {
  ok: true;
  scope: "subject" | "map";
  root: { id: string; name: string };      // for the whole map: id "map", the first subject's name
  roots: Array<{ id: string; name: string }>;
  subjects: Array<{ id: string; name: string; depth: number }>;
  topics: number;
  notes: Array<{ id: string; title: string; subjectId: string | null; images: number; files: number }>;
  links: number;
  linksLeftOut: number;                    // over PACKAGE_LIMITS.resources: said, not silently dropped
  // Format 2: everything else the file will hold, and what it will not.
  format: "kivo.map/2";
  topicDetails: number;                    // topics whose plan text (explanation, sources…) goes in
  images: number; files: number;
  storageBytes: number;                    // images and files together: what an import will need
  tasks: number;
  leftOut: {
    archivedTopics: number;
    unfiledNotes: number;                  // whole map only: notes filed under no subject
    unfiledPages: number;                  // whole map only: saved pages filed under no subject
    passages: number;                      // passages saved from pages (selection saves)
    notesOverLimit: number;
    tasksOverLimit: number;
    tooLarge: boolean;                     // images and files past what one file can hold
  };
  // Kivo has no private-note flag: every note filed in the scope is included
  // unless the learner unticks it. Said in the preview, not guessed.
  privateNotes: "no_private_flag";
  limits: typeof PACKAGE_LIMITS;
}
export type ExportFailure = { ok: false; error: "not_found" | "invalid" | "too_large" | "failed"; message: string };

// The root and every subject inside it, root first.
function subtree(subjects: Array<{ id: string; name: string; parentId?: string | null }>, rootId: string) {
  const out: Array<{ id: string; name: string; parentId: string | null; depth: number }> = [];
  const walk = (id: string, depth: number) => {
    const s = subjects.find(x => x.id === id);
    if (!s) return;
    out.push({ id: s.id, name: s.name, parentId: s.id === rootId ? null : (s.parentId ?? null), depth });
    for (const c of subjects.filter(x => x.parentId === id)) walk(c.id, depth + 1);
  };
  walk(rootId, 1);
  return out;
}

/** Reads what a request asks to export: a subject id, or "map" for the whole map. */
export function readScope(rootSubjectId: unknown): ExportScope | null {
  if (rootSubjectId === WHOLE_MAP) return { kind: "map" };
  if (typeof rootSubjectId !== "string" || !rootSubjectId || rootSubjectId.length > 40) return null;
  return { kind: "subject", rootSubjectId };
}

type Tree = Array<{ id: string; name: string; parentId: string | null; depth: number }>;
// The subjects an export holds: one subject's tree, or every top-level subject's in order.
function treeOf(subjects: Array<{ id: string; name: string; parentId?: string | null }>, scope: ExportScope): { tree: Tree; roots: Tree } {
  if (scope.kind === "subject") { const tree = subtree(subjects, scope.rootSubjectId); return { tree, roots: tree.slice(0, 1) }; }
  const known = new Set(subjects.map(s => s.id));
  const tops = subjects.filter(s => !s.parentId || !known.has(s.parentId));
  const tree = tops.flatMap(t => subtree(subjects, t.id));
  return { tree, roots: tree.filter(s => s.depth === 1) };
}

const httpLink = (url: string) => /^https?:\/\//i.test(url);

export async function previewExport(profileId: string, rootSubjectId: unknown): Promise<ExportPreview | ExportFailure> {
  const scope = readScope(rootSubjectId);
  if (!scope) return { ok: false, error: "invalid", message: "Choose a subject to export." };
  const structure = await loadStudyStructure(profileId);
  const { tree, roots } = treeOf(structure.subjects, scope);
  if (tree.length === 0) return scope.kind === "map" ? { ok: false, error: "not_found", message: "Your map has no subjects yet." } : { ok: false, error: "not_found", message: "That subject isn't one of yours." };
  const ids = tree.map(s => s.id);
  const inScope = structure.subjects.filter(s => ids.includes(s.id));
  const liveTopics = inScope.flatMap(s => s.topics.filter(t => !t.archived));
  const archivedTopics = inScope.reduce((n, s) => n + s.topics.filter(t => t.archived).length, 0);
  const [allNotes, linkRows, details, tasks, left] = await Promise.all([
    listNoteTitlesIn(profileId, ids, PACKAGE_LIMITS.notes * 5),
    listFiledLinks(profileId, ids, PACKAGE_LIMITS.resources * 4),
    topicDetailsOf(profileId, ids),
    listTasksInSubjects(profileId, ids),
    savedPagesLeftOut(profileId, ids),
  ]);
  const notes = allNotes.slice(0, PACKAGE_LIMITS.notes);
  const noteIds = notes.map(n => n.id);
  const [imageSizes, fileRows] = await Promise.all([imageSizesOfNotes(profileId, noteIds), attachmentsOfNotes(profileId, noteIds)]);
  const all = linkRows.filter(r => httpLink(r.url)).length;
  const links = Math.min(all, PACKAGE_LIMITS.resources);
  const storageBytes = imageSizes.reduce((n, i) => n + i.bytes, 0) + fileRows.reduce((n, f) => n + f.byteSize, 0);
  const perNote = (rows: Array<{ noteId: string }>) => { const m = new Map<string, number>(); for (const r of rows) m.set(r.noteId, (m.get(r.noteId) ?? 0) + 1); return m; };
  const imagesBy = perNote(imageSizes), filesBy = perNote(fileRows);
  return {
    ok: true, scope: scope.kind, format: MAP_FORMAT_V2,
    root: scope.kind === "map" ? { id: WHOLE_MAP, name: roots[0]!.name } : { id: tree[0]!.id, name: tree[0]!.name },
    roots: roots.map(r => ({ id: r.id, name: r.name })),
    subjects: tree.map(s => ({ id: s.id, name: s.name, depth: s.depth })), topics: liveTopics.length,
    topicDetails: liveTopics.filter(t => details.has(t.id)).length,
    notes: notes.map(n => ({ id: n.id, title: n.title, subjectId: n.subjectId, images: imagesBy.get(n.id) ?? 0, files: filesBy.get(n.id) ?? 0 })),
    images: imageSizes.length, files: fileRows.length, storageBytes,
    tasks: Math.min(tasks.length, PACKAGE_LIMITS.tasks),
    links, linksLeftOut: all - links,
    leftOut: {
      archivedTopics,
      unfiledNotes: scope.kind === "map" ? await unfiledNoteCount(profileId) : 0,
      unfiledPages: scope.kind === "map" ? left.unfiledPages : 0,
      passages: left.passages,
      notesOverLimit: Math.max(0, allNotes.length - notes.length),
      tasksOverLimit: Math.max(0, tasks.length - PACKAGE_LIMITS.tasks),
      tooLarge: imageSizes.length + fileRows.length > PACKAGE_LIMITS.assets || storageBytes > PACKAGE_LIMITS.assetBytes,
    },
    privateNotes: "no_private_flag",
    limits: PACKAGE_LIMITS,
  };
}

/**
 * The file's name: the title as the learner wrote it ("1st year knowledge
 * roadmap.kivo"), with only what a file system or a download header cannot
 * carry taken out: path and reserved characters, control characters, a
 * trailing ".kivo" typed twice. Never empty, never longer than 80 before the
 * extension.
 */
export function kivoFileName(title: string): string {
  const base = title.normalize("NFC")
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ").trim()
    .replace(/(\.kivo)+$/i, "").replace(/^\.+/, "").trim()
    .slice(0, 80).trim();
  return `${base || "map"}.kivo`;
}

/** The Content-Disposition header for a download: an ASCII name for old clients, the exact one (RFC 5987) for the rest. */
export function attachmentHeader(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export interface ExportInput {
  // noteIds absent: every note filed in the scope (the default, "everything").
  rootSubjectId: unknown; noteIds?: unknown; includeLinks?: unknown; includeTasks?: unknown;
  title?: unknown; description?: unknown; license?: unknown; credit?: unknown; source?: unknown;
}

const text = (v: unknown, max: number): string | null => typeof v === "string" && v.trim() ? v.trim().replace(/\s+/g, " ").slice(0, max) : null;

export async function exportMap(profileId: string, input: ExportInput, now = new Date()): Promise<{ ok: true; bytes: Uint8Array; filename: string; manifest: Manifest } | ExportFailure> {
  const license = (typeof input.license === "string" && (LICENSES as readonly string[]).includes(input.license) ? input.license : "all-rights-reserved") as License;
  if (input.noteIds !== undefined && !(Array.isArray(input.noteIds) && input.noteIds.every(i => typeof i === "string"))) return { ok: false, error: "invalid", message: "That note list can't be read." };
  const scope = readScope(input.rootSubjectId);
  if (!scope) return { ok: false, error: "invalid", message: "Choose a subject to export." };

  const structure = await loadStudyStructure(profileId);
  const { tree, roots } = treeOf(structure.subjects, scope);
  if (tree.length === 0) return scope.kind === "map" ? { ok: false, error: "not_found", message: "Your map has no subjects yet." } : { ok: false, error: "not_found", message: "That subject isn't one of yours." };
  const ids = tree.map(s => s.id);

  const details = await topicDetailsOf(profileId, ids);
  const subjects: SourceSubject[] = tree.map(s => ({ id: s.id, name: s.name, parentId: s.parentId }));
  const topics: SourceTopic[] = structure.subjects.filter(s => ids.includes(s.id)).flatMap(s =>
    s.topics.map((t, i) => ({ id: t.id, subjectId: s.id, name: t.name, parentId: t.parentId ?? null, kind: t.kind === "milestone" ? "milestone" as const : null, position: i, archived: Boolean(t.archived), details: details.get(t.id) })));
  if (subjects.length > PACKAGE_LIMITS.subjects || topics.length > PACKAGE_LIMITS.topics) return { ok: false, error: "too_large", message: "This map is larger than a .kivo file can carry. Export a subject inside it instead." };

  // Notes: every one filed in the scope, or the ones the learner chose.
  const allNotes = await listNoteTitlesIn(profileId, ids, PACKAGE_LIMITS.notes * 5);
  const wanted = input.noteIds as string[] | undefined;
  if (wanted && wanted.length > PACKAGE_LIMITS.notes) return { ok: false, error: "too_large", message: `A map can carry up to ${PACKAGE_LIMITS.notes} notes.` };
  if (!wanted && allNotes.length > PACKAGE_LIMITS.notes) return { ok: false, error: "too_large", message: `This map has ${allNotes.length} notes; a .kivo file carries up to ${PACKAGE_LIMITS.notes}. Export a subject inside it, or choose the notes to include.` };
  const notes = wanted ? await notesForExport(profileId, wanted, ids) : await notesInSubjectsForExport(profileId, ids, PACKAGE_LIMITS.notes);
  const noteIds = notes.map(n => n.id);
  const sizes = await imageSizesOfNotes(profileId, noteIds);
  const fileRows = await attachmentsOfNotes(profileId, noteIds);
  const assetBytes = sizes.reduce((n, i) => n + i.bytes, 0) + fileRows.reduce((n, f) => n + f.byteSize, 0);
  // Never a file that silently lacks them: too many to carry is said, and nothing is made.
  if (sizes.length + fileRows.length > PACKAGE_LIMITS.assets || assetBytes > PACKAGE_LIMITS.assetBytes) {
    return { ok: false, error: "too_large", message: `The images and files in these notes come to ${Math.ceil(assetBytes / 1_000_000)} MB; a .kivo file carries up to ${PACKAGE_LIMITS.assetBytes / 1_000_000} MB. Export a subject inside it, or choose fewer notes.` };
  }
  const images = await imagesOfNotes(profileId, noteIds);
  const fileData = await attachmentBytes(profileId, fileRows.map(f => f.id));
  const files: SourceFile[] = fileRows.flatMap(f => { const b = fileData.get(f.id); return b ? [{ id: f.id, noteId: f.noteId, fileName: f.fileName, mimeType: f.mimeType, bytes: b }] : []; });

  // Saved pages, unless the learner turned them off (an older page sent includeLinks: true to include them).
  const linkRows = input.includeLinks !== false ? (await listFiledLinks(profileId, ids, PACKAGE_LIMITS.resources * 4)).filter(r => httpLink(r.url)) : [];
  const links: SourceResource[] = linkRows.slice(0, PACKAGE_LIMITS.resources)
    .map(r => ({ id: r.id, title: r.title.slice(0, PACKAGE_LIMITS.title) || r.domain, url: r.url, domain: r.domain, subjectId: r.subjectId, topicName: r.topicName, description: r.description, resourceType: r.resourceType, siteName: r.siteName,
      canonicalUrl: r.canonicalUrl, imageUrl: r.imageUrl, author: r.author, publishedAt: r.publishedAt, durationSeconds: r.durationSeconds, tags: r.tags }));
  const tasks: SourceTask[] = input.includeTasks !== false
    ? (await listTasksInSubjects(profileId, ids)).map(t => ({ id: t.id, title: t.title, subjectId: t.subjectId, topicName: t.topicName, parentId: t.parentId, priority: t.priority, estimatedMinutes: t.estimatedMinutes, after: t.after ?? [] }))
    : [];
  const left = await savedPagesLeftOut(profileId, ids);

  const { pkg, assetData } = buildPackage({
    ...(scope.kind === "map" ? { rootSubjectIds: roots.map(r => r.id) } : { rootSubjectId: scope.rootSubjectId }),
    format: MAP_FORMAT_V2,
    subjects, topics, notes, resources: links, images, files, tasks,
    title: text(input.title, PACKAGE_LIMITS.title) ?? (scope.kind === "map" ? "My Knowledge Map" : tree[0]!.name),
    description: text(input.description, PACKAGE_LIMITS.description),
    license,
    attribution: { creator: text(input.credit, 120), source: text(input.source, 200), packageId: null, exportedAt: null },
    privateNotesLeftOut: Math.max(0, allNotes.length - notes.length),
    leftOut: {
      unfiledNotes: scope.kind === "map" ? await unfiledNoteCount(profileId) : 0,
      unfiledPages: scope.kind === "map" ? left.unfiledPages : 0,
      passages: left.passages,
      pagesOverLimit: Math.max(0, linkRows.length - links.length),
    },
  });
  const { bytes, manifest } = packArchive(pkg, { now, assetData });
  // What leaves is what an import accepts: unpack it again before handing it over.
  const check = unpackArchive(bytes);
  if (!check.ok) { console.error(`[portable] export failed its own check: ${check.reason} ${check.detail ?? ""}`); return { ok: false, error: "failed", message: "The file couldn't be made. Nothing was changed; try again." }; }
  return { ok: true, bytes, filename: kivoFileName(pkg.title), manifest };
}
