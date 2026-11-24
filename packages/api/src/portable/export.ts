// ─── Exporting a Knowledge Map as a .kivo file ───────────────────────────────
// Reads only: the learner's own subject tree (setup-edit), the notes they
// ticked (notes.ts), the links filed under it (learning-events.ts). One
// subject and everything inside it is a format 1 package; the whole map (every
// top-level subject) is format 2 (map-package.ts). Writes
// nothing, anywhere. The file is checked by unpacking it again before it is
// handed back, so an export Kivo cannot import is never downloaded.

import { loadStudyStructure } from "../nova/product/setup-edit";
import { listNoteTitlesIn, notesForExport } from "../nova/product/notes";
import { listFiledLinks } from "../nova/product/learning-events";
import { buildPackage, LICENSES, PACKAGE_LIMITS, type License, type SourceResource, type SourceSubject, type SourceTopic } from "./map-package";
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
  notes: Array<{ id: string; title: string; subjectId: string | null }>;
  links: number;
  linksLeftOut: number;                    // over PACKAGE_LIMITS.resources: said, not silently dropped
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
  const topics = structure.subjects.filter(s => ids.includes(s.id)).reduce((n, s) => n + s.topics.filter(t => !t.archived).length, 0);
  const notes = await listNoteTitlesIn(profileId, ids, PACKAGE_LIMITS.notes + 1);
  const all = (await listFiledLinks(profileId, ids, PACKAGE_LIMITS.resources * 4)).filter(r => httpLink(r.url)).length;
  const links = Math.min(all, PACKAGE_LIMITS.resources);
  return {
    ok: true, scope: scope.kind,
    root: scope.kind === "map" ? { id: WHOLE_MAP, name: roots[0]!.name } : { id: tree[0]!.id, name: tree[0]!.name },
    roots: roots.map(r => ({ id: r.id, name: r.name })),
    subjects: tree.map(s => ({ id: s.id, name: s.name, depth: s.depth })), topics, notes: notes.map(n => ({ id: n.id, title: n.title, subjectId: n.subjectId })),
    links, linksLeftOut: all - links, limits: PACKAGE_LIMITS,
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
  rootSubjectId: unknown; noteIds?: unknown; includeLinks?: unknown;
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

  const subjects: SourceSubject[] = tree.map(s => ({ id: s.id, name: s.name, parentId: s.parentId }));
  const topics: SourceTopic[] = structure.subjects.filter(s => ids.includes(s.id)).flatMap(s =>
    s.topics.map((t, i) => ({ id: t.id, subjectId: s.id, name: t.name, parentId: t.parentId ?? null, kind: t.kind === "milestone" ? "milestone" as const : null, position: i, archived: Boolean(t.archived) })));
  const wanted = (input.noteIds as string[] | undefined) ?? [];
  if (wanted.length > PACKAGE_LIMITS.notes) return { ok: false, error: "too_large", message: `A map can carry up to ${PACKAGE_LIMITS.notes} notes.` };
  const notes = await notesForExport(profileId, wanted, ids);
  const allNotes = await listNoteTitlesIn(profileId, ids, 10_000);
  // Links are included unless the learner turned them off (an older page sent includeLinks: true to include them).
  const links: SourceResource[] = input.includeLinks !== false
    ? (await listFiledLinks(profileId, ids, PACKAGE_LIMITS.resources * 4)).filter(r => httpLink(r.url)).slice(0, PACKAGE_LIMITS.resources)
        .map(r => ({ id: r.id, title: r.title.slice(0, PACKAGE_LIMITS.title) || r.domain, url: r.url, domain: r.domain, subjectId: r.subjectId, topicName: r.topicName, description: r.description, resourceType: r.resourceType, siteName: r.siteName }))
    : [];
  if (subjects.length > PACKAGE_LIMITS.subjects || topics.length > PACKAGE_LIMITS.topics) return { ok: false, error: "too_large", message: "This map is larger than a .kivo file can carry. Export a subject inside it instead." };

  const pkg = buildPackage({
    ...(scope.kind === "map" ? { rootSubjectIds: roots.map(r => r.id) } : { rootSubjectId: scope.rootSubjectId }),
    subjects, topics, notes, resources: links,
    title: text(input.title, PACKAGE_LIMITS.title) ?? (scope.kind === "map" ? "My Knowledge Map" : tree[0]!.name),
    description: text(input.description, PACKAGE_LIMITS.description),
    license,
    attribution: { creator: text(input.credit, 120), source: text(input.source, 200), packageId: null, exportedAt: null },
    privateNotesLeftOut: Math.max(0, allNotes.length - notes.length),
  });
  const { bytes, manifest } = packArchive(pkg, { now });
  // What leaves is what an import accepts: unpack it again before handing it over.
  const check = unpackArchive(bytes);
  if (!check.ok) { console.error(`[portable] export failed its own check: ${check.reason}`); return { ok: false, error: "failed", message: "The file couldn't be made. Nothing was changed; try again." }; }
  return { ok: true, bytes, filename: kivoFileName(pkg.title), manifest };
}
