// ─── Notes ────────────────────────────────────────────────────────────────────
// The learner's own notes: create, read, edit, delete, list, search.
// Owner of NovaNote. Nothing else writes that table.
//
// The boundary this file holds:
//   - A note is learner-owned content. It is not evidence and not memory.
//     Nothing here touches topic mastery, the review schedule, UserFact,
//     UserReality, BehavioralPattern, cognitive state or Learning DNA.
//   - Note text never reaches the Understanding Brain, the Response Brain or
//     consolidation. This file imports no brain, no orchestrator, no
//     consolidation module and no LLM client, and a test keeps it that way.
//   - Every read and write is scoped to the learner's own profile. A note id
//     alone is never enough to reach a note.
// What can change Nova's picture of the learner is a study session started
// from a note, through the ordinary session route.

import { prisma } from "@repo/db/client";
import { learnerKey } from "./learner-key";
import { REVIEW_BLOCK_MINUTES } from "../engines/planning-engine";
import { likeLiteral, normalizeTopicName } from "../engines/topic-mastery-engine";
import {
  NOTE_BODY_MAX, NOTE_PREVIEW_LENGTH, NOTE_TITLE_MAX, NOTE_TOPIC_MAX,
  type NoteDetail, type NoteError, type NoteInput, type NoteLinkRef, type NoteSubjectOption, type NoteSummary, type NovaNotesView,
} from "./notes.types";
import { linkContext, linkedTitles, linkKey } from "./note-links";

// ── Validation (pure) ─────────────────────────────────────────────────────────

export type NoteChanges = { title?: string; body?: string; subjectId?: string | null; topicName?: string | null; baseUpdatedAt?: Date };

type Parsed =
  | { ok: true; changes: NoteChanges }
  | { ok: false; error: NoteError; message: string };

const reject = (error: NoteError, message: string): Parsed => ({ ok: false, error, message });

// Reads an untrusted request body. Only title, body, subjectId and topicName
// are read: anything else in the request, including any id naming a learner
// or profile, is ignored. `creating` requires a title.
export function parseNoteInput(raw: unknown, creating: boolean): Parsed {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return reject("invalid", "That is not a note.");
  const input = raw as Record<string, unknown>;
  const changes: NoteChanges = {};

  if (input.title !== undefined || creating) {
    if (typeof input.title !== "string") return reject("title_required", "Give the note a title.");
    const title = input.title.trim().replace(/\s+/g, " ");
    if (!title) return reject("title_required", "Give the note a title.");
    if (title.length > NOTE_TITLE_MAX) return reject("title_too_long", `Keep the title under ${NOTE_TITLE_MAX} characters.`);
    changes.title = title;
  }

  if (input.body !== undefined || creating) {
    if (input.body !== undefined && typeof input.body !== "string") return reject("invalid", "The note's text must be text.");
    // The body is stored exactly as written. Only line endings are unified.
    const body = (typeof input.body === "string" ? input.body : "").replace(/\r\n?/g, "\n");
    if (body.length > NOTE_BODY_MAX) {
      return reject("body_too_long", `That note is too long. The limit is ${NOTE_BODY_MAX.toLocaleString("en-US")} characters.`);
    }
    changes.body = body;
  }

  if (input.subjectId !== undefined) {
    if (input.subjectId !== null && typeof input.subjectId !== "string") return reject("invalid", "That is not a subject.");
    changes.subjectId = input.subjectId ? input.subjectId : null;
  }

  if (input.topicName !== undefined) {
    if (input.topicName !== null && typeof input.topicName !== "string") return reject("invalid", "That is not a topic.");
    const topic = typeof input.topicName === "string" ? normalizeTopicName(input.topicName) : "";
    if (topic.length > NOTE_TOPIC_MAX) return reject("topic_too_long", `Keep the topic under ${NOTE_TOPIC_MAX} characters.`);
    changes.topicName = topic || null;
  }

  if (input.baseUpdatedAt !== undefined) {
    const base = typeof input.baseUpdatedAt === "string" ? new Date(input.baseUpdatedAt) : null;
    if (!base || Number.isNaN(base.getTime())) return reject("invalid", "That save could not be matched to the note you opened. Reload the note and try again.");
    changes.baseUpdatedAt = base;
  }

  return { ok: true, changes };
}

export function notePreview(body: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length <= NOTE_PREVIEW_LENGTH ? flat : `${flat.slice(0, NOTE_PREVIEW_LENGTH).trimEnd()}…`;
}

// Why "Study this" can or cannot start. A session needs a subject and a
// topic; a note missing either is not given one.
export function studyAvailability(note: { subjectId: string | null; topicName: string | null }): NoteDetail["study"] {
  const blockedBy = !note.subjectId ? "no_subject" : !note.topicName ? "no_topic" : null;
  return { available: blockedBy === null, blockedBy, minutes: REVIEW_BLOCK_MINUTES };
}

// ── Learner ───────────────────────────────────────────────────────────────────

export type NoteLearner =
  | { status: "ready"; profileId: string }
  | { status: "not_connected" }
  | { status: "onboarding_incomplete" };

// The profile every note query is scoped to. The chat id comes from the
// signed-in session, resolved by the route; nothing from the request body or
// query string is ever passed here.
export async function resolveNoteLearner(platformChatId: string): Promise<NoteLearner> {
  const user = await prisma.messengerUser.findUnique({
    where:  learnerKey(platformChatId),
    select: { novaAcademicProfile: { select: { id: true, onboardingComplete: true } } },
  });
  if (!user) return { status: "not_connected" };
  if (!user.novaAcademicProfile?.onboardingComplete) return { status: "onboarding_incomplete" };
  return { status: "ready", profileId: user.novaAcademicProfile.id };
}

// ── Rows → contract ───────────────────────────────────────────────────────────

type NoteRow = {
  id: string; title: string; body: string; subjectId: string | null; topicName: string | null;
  createdAt: Date; updatedAt: Date; subject: { name: string } | null;
};

const NOTE_SELECT = {
  id: true, title: true, body: true, subjectId: true, topicName: true, createdAt: true, updatedAt: true,
  subject: { select: { name: true } },
} as const;

function toSummary(row: NoteRow): NoteSummary {
  return {
    id:          row.id,
    title:       row.title,
    subjectId:   row.subjectId,
    subjectName: row.subject?.name ?? null,
    topicName:   row.topicName,
    preview:     notePreview(row.body),
    createdAt:   row.createdAt.toISOString(),
    updatedAt:   row.updatedAt.toISOString(),
  };
}

function toDetail(row: NoteRow, links: NoteDetail["links"] = { outgoing: [], backlinks: [] }): NoteDetail {
  return { ...toSummary(row), body: row.body, study: studyAvailability(row), links };
}

// How many links and backlinks one note shows.
export const NOTE_LINKS_SHOWN = 50;

// What a note's [[links]] open, and which of the learner's notes link to it.
// Only this learner's notes and topics are looked at. A backlink is a note
// whose body has a link naming this note's title: the database narrows the
// candidates on the text "[[" + title, and the link parser decides.
async function linksOf(profileId: string, note: { id: string; title: string; body: string }): Promise<NoteDetail["links"]> {
  const titles = linkedTitles(note.body).slice(0, NOTE_LINKS_SHOWN);
  const [named, topics, candidates] = await Promise.all([
    titles.length === 0 ? Promise.resolve([]) : prisma.novaNote.findMany({
      where:  { profileId, OR: titles.map(t => ({ title: { equals: t, mode: "insensitive" as const } })) },
      select: { id: true, title: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
    }),
    titles.length === 0 ? Promise.resolve([]) : prisma.novaTopicMastery.findMany({
      where:  { subject: { profileId }, archivedAt: null, OR: titles.map(t => ({ name: { equals: t, mode: "insensitive" as const } })) },
      select: { id: true, name: true },
    }),
    prisma.novaNote.findMany({
      where:   { profileId, id: { not: note.id }, body: { contains: `[[${likeLiteral(note.title).slice(0, 60)}`, mode: "insensitive" } },
      select:  { id: true, title: true, body: true, subject: { select: { name: true } } },
      orderBy: { updatedAt: "desc" },
      take:    NOTE_LINKS_SHOWN * 2,
    }),
  ]);
  // Two notes may share a title: a link opens the most recently updated one.
  const noteByKey  = new Map<string, string>();
  for (const n of named) if (!noteByKey.has(linkKey(n.title))) noteByKey.set(linkKey(n.title), n.id);
  const topicByKey = new Map(topics.map(t => [linkKey(t.name), t.id] as const));
  const outgoing: NoteLinkRef[] = titles.map(t => {
    const noteId = noteByKey.get(linkKey(t)) ?? null;
    return { title: t, noteId, topicId: noteId ? null : topicByKey.get(linkKey(t)) ?? null };
  });
  const backlinks: NoteLinkRef[] = candidates
    .filter(c => linkedTitles(c.body).some(t => linkKey(t) === linkKey(note.title)))
    .slice(0, NOTE_LINKS_SHOWN)
    .map(c => ({ title: c.title, noteId: c.id, topicId: null, context: linkContext(c.body, note.title), subjectName: c.subject?.name ?? null }));
  return { outgoing, backlinks };
}

// ── Reads ─────────────────────────────────────────────────────────────────────

export interface NoteFilters {
  q?:         string | null;   // case-insensitive substring of title or body
  subjectId?: string | null;
  topic?:     string | null;   // a topic name, compared without regard to case
}

export async function listNotes(profileId: string, filters: NoteFilters = {}): Promise<Extract<NovaNotesView, { status: "ready" }>> {
  // Both are matched as literal text: "%" finds notes containing a percent
  // sign, not every note.
  const q     = likeLiteral(filters.q?.trim().slice(0, 200) ?? "");
  const topic = likeLiteral(filters.topic ? normalizeTopicName(filters.topic) : "");

  const [rows, total, subjects, noteTopics, active] = await Promise.all([
    prisma.novaNote.findMany({
      // profileId is always part of the filter: a subject or topic filter
      // narrows the learner's own notes and can never widen past them.
      where: {
        profileId,
        ...(filters.subjectId ? { subjectId: filters.subjectId } : {}),
        ...(topic ? { topicName: { equals: topic, mode: "insensitive" as const } } : {}),
        ...(q ? { OR: [
          { title: { contains: q, mode: "insensitive" as const } },
          { body:  { contains: q, mode: "insensitive" as const } },
        ] } : {}),
      },
      orderBy: { updatedAt: "desc" },
      select:  NOTE_SELECT,
    }),
    prisma.novaNote.count({ where: { profileId } }),
    prisma.novaSubject.findMany({
      where:   { profileId },
      orderBy: { name: "asc" },
      select:  { id: true, name: true, topics: { where: { archivedAt: null }, select: { name: true } } },
    }),
    prisma.novaNote.findMany({
      where:    { profileId, subjectId: { not: null }, topicName: { not: null } },
      select:   { subjectId: true, topicName: true },
      distinct: ["subjectId", "topicName"],
    }),
    prisma.novaStudySession.findFirst({
      where:  { profileId, status: { in: ["in_progress", "paused"] } },
      select: { topicName: true },
    }),
  ]);

  const options: NoteSubjectOption[] = subjects.map(s => {
    const names = new Map<string, string>();
    // Topics Nova already has, then topics only notes use. Reading the names
    // here creates nothing: a topic typed into a note is not a mastery row.
    for (const t of s.topics) names.set(t.name.toLowerCase(), t.name);
    for (const n of noteTopics) {
      if (n.subjectId === s.id && n.topicName && !names.has(n.topicName.toLowerCase())) names.set(n.topicName.toLowerCase(), n.topicName);
    }
    return { id: s.id, name: s.name, topics: [...names.values()].sort((a, b) => a.localeCompare(b)) };
  });

  return {
    status: "ready",
    notes:  rows.map(toSummary),
    subjects: options,
    total,
    activeSession: active ? { topicName: active.topicName } : null,
  };
}

export async function getNote(profileId: string, noteId: string): Promise<NoteDetail | null> {
  // findFirst with the profile in the filter, not findUnique by id: another
  // learner's note is simply not found.
  const row = await prisma.novaNote.findFirst({ where: { id: noteId, profileId }, select: NOTE_SELECT });
  return row ? toDetail(row, await linksOf(profileId, row)) : null;
}

// ── Writes ────────────────────────────────────────────────────────────────────

type WriteResult =
  | { ok: true; note: NoteDetail }
  | { ok: false; error: NoteError; message: string; current?: NoteDetail };

async function subjectIsLearners(profileId: string, subjectId: string): Promise<boolean> {
  return (await prisma.novaSubject.count({ where: { id: subjectId, profileId } })) === 1;
}

const UNKNOWN_SUBJECT = { ok: false as const, error: "unknown_subject" as const, message: "That subject is not one of yours." };
const NOT_FOUND       = { ok: false as const, error: "not_found" as const, message: "That note doesn't exist." };

export async function createNote(profileId: string, raw: unknown): Promise<WriteResult> {
  const parsed = parseNoteInput(raw, true);
  if (!parsed.ok) return parsed;
  const { title, body, subjectId, topicName } = parsed.changes;

  if (subjectId && !(await subjectIsLearners(profileId, subjectId))) return UNKNOWN_SUBJECT;

  const row = await prisma.novaNote.create({
    data:   { profileId, title: title!, body: body ?? "", subjectId: subjectId ?? null, topicName: topicName ?? null },
    select: NOTE_SELECT,
  });
  return { ok: true, note: toDetail(row, await linksOf(profileId, row)) };
}

// A workspace's notes (product/workspaces.ts), inside its transaction, with
// the learner's approval of the plan they were in. Each is checked as
// createNote checks one. A note never replaces another: one whose title the
// learner already has (under any subject: [[links]] find notes by title) is
// left out and counted.
export async function createNotesIn(
  tx: Pick<typeof prisma, "novaNote">,
  profileId: string,
  notes: Array<{ title: string; body: string; subjectId: string | null; topicName: string | null }>,
): Promise<{ ok: true; added: number; skipped: string[] } | { ok: false; message: string }> {
  let added = 0;
  const skipped: string[] = [];
  for (const raw of notes) {
    const parsed = parseNoteInput(raw, true);
    if (!parsed.ok) return { ok: false, message: parsed.message };
    const { title, body, subjectId, topicName } = parsed.changes;
    const clash = await tx.novaNote.count({ where: { profileId, title: { equals: title!, mode: "insensitive" } } });
    if (clash > 0) { skipped.push(title!); continue; }
    await tx.novaNote.create({ data: { profileId, title: title!, body: body ?? "", subjectId: subjectId ?? null, topicName: topicName ?? null } });
    added++;
  }
  return { ok: true, added, skipped };
}

export async function updateNote(profileId: string, noteId: string, raw: unknown): Promise<WriteResult> {
  const parsed = parseNoteInput(raw, false);
  if (!parsed.ok) return parsed;
  const changes = parsed.changes;

  if (changes.subjectId && !(await subjectIsLearners(profileId, changes.subjectId))) return UNKNOWN_SUBJECT;

  // Conditional on the note being this learner's and, when the editor said
  // which version it opened, on the note still being that version: a save
  // from a stale tab never silently replaces newer text. Only the four fields
  // a learner may write are ever set: profileId is not among them.
  const updated = await prisma.novaNote.updateMany({
    where: { id: noteId, profileId, ...(changes.baseUpdatedAt ? { updatedAt: changes.baseUpdatedAt } : {}) },
    data: {
      ...(changes.title     !== undefined ? { title:     changes.title } : {}),
      ...(changes.body      !== undefined ? { body:      changes.body } : {}),
      ...(changes.subjectId !== undefined ? { subjectId: changes.subjectId } : {}),
      ...(changes.topicName !== undefined ? { topicName: changes.topicName } : {}),
    },
  });
  if (updated.count !== 1) {
    if (!changes.baseUpdatedAt) return NOT_FOUND;
    const current = await getNote(profileId, noteId);
    return current
      ? { ok: false, error: "conflict", message: "This note was changed somewhere else after you opened it. Nothing was overwritten.", current }
      : NOT_FOUND;
  }

  const note = await getNote(profileId, noteId);
  return note ? { ok: true, note } : NOT_FOUND;
}

export async function deleteNote(profileId: string, noteId: string): Promise<boolean> {
  const deleted = await prisma.novaNote.deleteMany({ where: { id: noteId, profileId } });
  return deleted.count === 1;
}

// ── For the Knowledge Map ─────────────────────────────────────────────────────
// What a note is filed under and the titles it links to with [[...]], and
// nothing else of what it says: the map draws a note as a point and never
// sees its body. The newest `take`, and how many there are in all.
export async function listNoteLinks(profileId: string, take: number): Promise<{
  notes: Array<{ id: string; title: string; subjectId: string | null; topicName: string | null; updatedAt: Date; linksTo: string[] }>;
  total: number;
}> {
  const [rows, total] = await Promise.all([
    prisma.novaNote.findMany({
      where: { profileId }, orderBy: { updatedAt: "desc" }, take,
      select: { id: true, title: true, subjectId: true, topicName: true, updatedAt: true, body: true },
    }),
    prisma.novaNote.count({ where: { profileId } }),
  ]);
  const notes = rows.map(({ body, ...n }) => ({ ...n, linksTo: linkedTitles(body).slice(0, NOTE_LINKS_SHOWN) }));
  return { notes, total };
}

// Titles of the learner's notes filed under these subjects, newest first:
// how a workspace shows its notes back. No body leaves this file.
export async function listNoteTitlesIn(profileId: string, subjectIds: string[], take = 40): Promise<Array<{ id: string; title: string; subjectId: string | null; updatedAt: Date }>> {
  if (subjectIds.length === 0) return [];
  return prisma.novaNote.findMany({ where: { profileId, subjectId: { in: subjectIds } }, orderBy: { updatedAt: "desc" }, take, select: { id: true, title: true, subjectId: true, updatedAt: true } });
}

// Of the learner's notes filed under these subjects, the ones with these
// titles that nobody has edited since they were made (a workspace's own
// notes, as Nova wrote them): the only notes a confirmed workspace deletion
// removes. A note the learner changed, or wrote, is theirs and stays. No body
// leaves this file.
export const UNTOUCHED_MS = 5_000;
export async function untouchedNotesIn(profileId: string, subjectIds: string[], titles: string[]): Promise<Array<{ id: string; title: string; subjectId: string | null }>> {
  if (subjectIds.length === 0 || titles.length === 0) return [];
  const wanted = new Set(titles.map(t => t.trim().toLowerCase()));
  const rows = await prisma.novaNote.findMany({ where: { profileId, subjectId: { in: subjectIds } }, select: { id: true, title: true, subjectId: true, createdAt: true, updatedAt: true }, take: 400 });
  return rows.filter(r => wanted.has(r.title.trim().toLowerCase()) && r.updatedAt.getTime() - r.createdAt.getTime() < UNTOUCHED_MS)
    .map(r => ({ id: r.id, title: r.title, subjectId: r.subjectId }));
}

// Removes these notes of the learner's inside the caller's transaction (a
// confirmed workspace deletion). One that is not theirs, or gone, stops it.
export class NoteChanged extends Error {}
export async function removeNotesIn(tx: Pick<typeof prisma, "novaNote">, profileId: string, noteIds: string[]): Promise<void> {
  if (noteIds.length === 0) return;
  const r = await tx.novaNote.deleteMany({ where: { id: { in: noteIds }, profileId } });
  if (r.count !== noteIds.length) throw new NoteChanged();
}

// ── For Nova's help on a note (product/note-assist.ts) ────────────────────────
// The note itself and a few of the learner's own notes that belong with it:
// the ones it links to, the ones that link to it, and others filed under the
// same topic or subject. Bounded, and only ever this learner's. This is the
// only way note text leaves this file, and only for an action the learner
// asked for on that note.
export const NOTE_SOURCE_BODY_MAX   = 6_000;
export const RELATED_SOURCE_MAX     = 6;
export const RELATED_SOURCE_BODY_MAX = 1_200;

export interface NoteSources {
  note:    { id: string; title: string; body: string; subjectId: string | null; subjectName: string | null; topicName: string | null };
  related: Array<{ id: string; title: string; body: string; why: "links_to" | "linked_from" | "same_topic" | "same_subject" }>;
}

export async function noteSources(profileId: string, noteId: string): Promise<NoteSources | null> {
  const row = await prisma.novaNote.findFirst({ where: { id: noteId, profileId }, select: NOTE_SELECT });
  if (!row) return null;
  const links = await linksOf(profileId, row);
  const linked = links.outgoing.filter(l => l.noteId).map(l => ({ id: l.noteId!, why: "links_to" as const }));
  const back   = links.backlinks.map(b => ({ id: b.noteId!, why: "linked_from" as const }));
  const nearby = row.subjectId ? await prisma.novaNote.findMany({
    where:   { profileId, subjectId: row.subjectId, id: { not: row.id } },
    orderBy: { updatedAt: "desc" }, take: RELATED_SOURCE_MAX,
    select:  { id: true, topicName: true },
  }) : [];
  const same = (a: string | null, b: string | null) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
  const wanted: Array<{ id: string; why: NoteSources["related"][number]["why"] }> = [];
  for (const c of [...linked, ...back,
    ...nearby.filter(n => same(n.topicName, row.topicName)).map(n => ({ id: n.id, why: "same_topic" as const })),
    ...nearby.map(n => ({ id: n.id, why: "same_subject" as const }))]) {
    if (c.id !== row.id && !wanted.some(w => w.id === c.id)) wanted.push(c);
    if (wanted.length >= RELATED_SOURCE_MAX) break;
  }
  const bodies = wanted.length === 0 ? [] : await prisma.novaNote.findMany({
    where: { profileId, id: { in: wanted.map(w => w.id) } }, select: { id: true, title: true, body: true },
  });
  const byId = new Map(bodies.map(b => [b.id, b]));
  return {
    note: {
      id: row.id, title: row.title, body: row.body.slice(0, NOTE_SOURCE_BODY_MAX),
      subjectId: row.subjectId, subjectName: row.subject?.name ?? null, topicName: row.topicName,
    },
    related: wanted.flatMap(w => {
      const b = byId.get(w.id);
      return b ? [{ id: b.id, title: b.title, body: b.body.slice(0, RELATED_SOURCE_BODY_MAX), why: w.why }] : [];
    }),
  };
}

// ── Study setup edits (product/setup-edit.ts) ─────────────────────────────────
// When the learner renames, moves or removes a topic, the notes filed under it
// follow, in the caller's transaction. Only the filing changes: a note's title
// and text are the learner's and are never touched here.
export async function refileNotesForTopic(
  tx: Pick<typeof prisma, "novaNote">,
  profileId: string,
  from: { subjectId: string; topicName: string },
  to: { subjectId: string; topicName: string | null },
): Promise<number> {
  const r = await tx.novaNote.updateMany({
    where: { profileId, subjectId: from.subjectId, topicName: { equals: from.topicName, mode: "insensitive" } },
    data:  { subjectId: to.subjectId, topicName: to.topicName },
  });
  return r.count;
}
