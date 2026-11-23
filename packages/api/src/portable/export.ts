// ─── Exporting a Knowledge Map as a .kivo file ───────────────────────────────
// Reads only: the learner's own subject tree (setup-edit), the notes they
// ticked (notes.ts), the links filed under it (learning-events.ts). Writes
// nothing, anywhere. The file is checked by unpacking it again before it is
// handed back, so an export Kivo cannot import is never downloaded.

import { loadStudyStructure } from "../nova/product/setup-edit";
import { listNoteTitlesIn, notesForExport } from "../nova/product/notes";
import { listResourceLinks } from "../nova/product/learning-events";
import { buildPackage, LICENSES, PACKAGE_LIMITS, type License, type SourceResource, type SourceSubject, type SourceTopic } from "./map-package";
import { packArchive, unpackArchive, type Manifest } from "./kivo-archive";

export interface ExportPreview {
  ok: true;
  root: { id: string; name: string };
  subjects: Array<{ id: string; name: string; depth: number }>;
  topics: number;
  notes: Array<{ id: string; title: string; subjectId: string | null }>;
  links: number;
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

export async function previewExport(profileId: string, rootSubjectId: unknown): Promise<ExportPreview | ExportFailure> {
  if (typeof rootSubjectId !== "string" || rootSubjectId.length > 40) return { ok: false, error: "invalid", message: "Choose a subject to export." };
  const structure = await loadStudyStructure(profileId);
  const tree = subtree(structure.subjects, rootSubjectId);
  if (tree.length === 0) return { ok: false, error: "not_found", message: "That subject isn't one of yours." };
  const ids = tree.map(s => s.id);
  const topics = structure.subjects.filter(s => ids.includes(s.id)).reduce((n, s) => n + s.topics.filter(t => !t.archived).length, 0);
  const notes = await listNoteTitlesIn(profileId, ids, PACKAGE_LIMITS.notes + 1);
  const links = (await listResourceLinks(profileId, PACKAGE_LIMITS.resources * 2)).resources.filter(r => r.subjectId && ids.includes(r.subjectId) && /^https?:\/\//i.test(r.url)).length;
  return { ok: true, root: { id: tree[0]!.id, name: tree[0]!.name }, subjects: tree.map(s => ({ id: s.id, name: s.name, depth: s.depth })), topics, notes: notes.map(n => ({ id: n.id, title: n.title, subjectId: n.subjectId })), links, limits: PACKAGE_LIMITS };
}

export interface ExportInput {
  rootSubjectId: unknown; noteIds?: unknown; includeLinks?: unknown;
  title?: unknown; description?: unknown; license?: unknown; credit?: unknown; source?: unknown;
}

const text = (v: unknown, max: number): string | null => typeof v === "string" && v.trim() ? v.trim().replace(/\s+/g, " ").slice(0, max) : null;

export async function exportMap(profileId: string, input: ExportInput, now = new Date()): Promise<{ ok: true; bytes: Uint8Array; filename: string; manifest: Manifest } | ExportFailure> {
  const license = (typeof input.license === "string" && (LICENSES as readonly string[]).includes(input.license) ? input.license : "all-rights-reserved") as License;
  if (input.noteIds !== undefined && !(Array.isArray(input.noteIds) && input.noteIds.every(i => typeof i === "string"))) return { ok: false, error: "invalid", message: "That note list can't be read." };
  if (typeof input.rootSubjectId !== "string" || input.rootSubjectId.length > 40) return { ok: false, error: "invalid", message: "Choose a subject to export." };

  const structure = await loadStudyStructure(profileId);
  const tree = subtree(structure.subjects, input.rootSubjectId);
  if (tree.length === 0) return { ok: false, error: "not_found", message: "That subject isn't one of yours." };
  const ids = tree.map(s => s.id);

  const subjects: SourceSubject[] = tree.map(s => ({ id: s.id, name: s.name, parentId: s.parentId }));
  const topics: SourceTopic[] = structure.subjects.filter(s => ids.includes(s.id)).flatMap(s =>
    s.topics.map((t, i) => ({ id: t.id, subjectId: s.id, name: t.name, parentId: t.parentId ?? null, kind: t.kind === "milestone" ? "milestone" as const : null, position: i, archived: Boolean(t.archived) })));
  const wanted = (input.noteIds as string[] | undefined) ?? [];
  if (wanted.length > PACKAGE_LIMITS.notes) return { ok: false, error: "too_large", message: `A map can carry up to ${PACKAGE_LIMITS.notes} notes.` };
  const notes = await notesForExport(profileId, wanted, ids);
  const allNotes = await listNoteTitlesIn(profileId, ids, 10_000);
  const links: SourceResource[] = input.includeLinks === true
    ? (await listResourceLinks(profileId, PACKAGE_LIMITS.resources * 2)).resources.filter(r => r.subjectId && ids.includes(r.subjectId)).slice(0, PACKAGE_LIMITS.resources)
        .map(r => ({ id: r.id, title: r.title.slice(0, PACKAGE_LIMITS.title) || r.domain, url: r.url, domain: r.domain, subjectId: r.subjectId, topicName: r.topicName }))
    : [];
  if (subjects.length > PACKAGE_LIMITS.subjects || topics.length > PACKAGE_LIMITS.topics) return { ok: false, error: "too_large", message: "This map is larger than a .kivo file can carry. Export a subject inside it instead." };

  const pkg = buildPackage({
    rootSubjectId: input.rootSubjectId, subjects, topics, notes, resources: links,
    title: text(input.title, PACKAGE_LIMITS.title) ?? tree[0]!.name,
    description: text(input.description, PACKAGE_LIMITS.description),
    license,
    attribution: { creator: text(input.credit, 120), source: text(input.source, 200), packageId: null, exportedAt: null },
    privateNotesLeftOut: Math.max(0, allNotes.length - notes.length),
  });
  const { bytes, manifest } = packArchive(pkg, { now });
  // What leaves is what an import accepts: unpack it again before handing it over.
  const check = unpackArchive(bytes);
  if (!check.ok) { console.error(`[portable] export failed its own check: ${check.reason}`); return { ok: false, error: "failed", message: "The file couldn't be made. Nothing was changed; try again." }; }
  const slug = pkg.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "map";
  return { ok: true, bytes, filename: `${slug}.kivo`, manifest };
}
