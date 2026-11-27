// A note's earlier text, kept before a change rewrites it (bug batch 28 Nov,
// item 6). Used by Kivo Connect (connect/changes.ts) so an assistant's
// replace or edit can be undone: restore_note_version puts a version back,
// after saving the current text as a version of its own.

import { prisma } from "@repo/db/client";

export const NOTE_VERSIONS_KEPT = 20;

export interface NoteVersionView { id: string; title: string; reason: string; source: string; createdAt: string; characters: number }

// Saves the note as it is now. Then keeps only the newest NOTE_VERSIONS_KEPT.
export async function saveNoteVersion(profileId: string, note: { id: string; title: string; body: string }, reason: string, source = "kivo_connect"): Promise<string> {
  const row = await prisma.novaNoteVersion.create({ data: { noteId: note.id, profileId, title: note.title, body: note.body, reason, source }, select: { id: true } });
  const old = await prisma.novaNoteVersion.findMany({ where: { noteId: note.id, profileId }, orderBy: { createdAt: "desc" }, skip: NOTE_VERSIONS_KEPT, select: { id: true } });
  if (old.length) await prisma.novaNoteVersion.deleteMany({ where: { id: { in: old.map(o => o.id) } } });
  return row.id;
}

export async function listNoteVersions(profileId: string, noteId: string): Promise<NoteVersionView[]> {
  const rows = await prisma.novaNoteVersion.findMany({ where: { noteId, profileId }, orderBy: { createdAt: "desc" }, select: { id: true, title: true, reason: true, source: true, createdAt: true, body: true } });
  return rows.map(r => ({ id: r.id, title: r.title, reason: r.reason, source: r.source, createdAt: r.createdAt.toISOString(), characters: r.body.length }));
}

// One version, the learner's own. With no id: the newest one saved before a
// change (not one saved by a restore), so undoing again goes further back
// instead of bouncing between two texts. A restore's version stays there to
// be named by id (a redo).
export async function noteVersion(profileId: string, noteId: string, versionId?: string): Promise<{ id: string; title: string; body: string } | null> {
  return prisma.novaNoteVersion.findFirst({
    where: { noteId, profileId, ...(versionId ? { id: versionId } : { reason: { not: "restore" } }) },
    orderBy: { createdAt: "desc" }, select: { id: true, title: true, body: true },
  });
}

// Exact find/replace, each passage found exactly once in the text as it
// stands when its turn comes; all or nothing. Pure.
export function applyExactEdits(body: string, edits: Array<{ find: string; replace: string }>): { ok: true; body: string } | { ok: false; index: number; reason: "missing" | "ambiguous"; count: number } {
  let text = body;
  for (const [index, e] of edits.entries()) {
    const first = text.indexOf(e.find);
    if (first < 0) return { ok: false, index, reason: "missing", count: 0 };
    let count = 0;
    for (let at = text.indexOf(e.find); at >= 0; at = text.indexOf(e.find, at + 1)) count++;
    if (count > 1) return { ok: false, index, reason: "ambiguous", count };
    text = text.slice(0, first) + e.replace + text.slice(first + e.find.length);
  }
  return { ok: true, body: text };
}
