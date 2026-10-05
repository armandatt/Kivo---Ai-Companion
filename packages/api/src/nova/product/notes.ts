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
import { REVIEW_BLOCK_MINUTES } from "../engines/planning-engine";
import { likeLiteral, normalizeTopicName } from "../engines/topic-mastery-engine";
import {
  NOTE_BODY_MAX, NOTE_PREVIEW_LENGTH, NOTE_TITLE_MAX, NOTE_TOPIC_MAX,
  type NoteDetail, type NoteError, type NoteInput, type NoteSubjectOption, type NoteSummary, type NovaNotesView,
} from "./notes.types";

// ── Validation (pure) ─────────────────────────────────────────────────────────

export type NoteChanges = { title?: string; body?: string; subjectId?: string | null; topicName?: string | null };

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
    where:  { platform_platformChatId: { platform: "telegram", platformChatId } },
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

function toDetail(row: NoteRow): NoteDetail {
  return { ...toSummary(row), body: row.body, study: studyAvailability(row) };
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
      select:  { id: true, name: true, topics: { select: { name: true } } },
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
  return row ? toDetail(row) : null;
}

// ── Writes ────────────────────────────────────────────────────────────────────

type WriteResult =
  | { ok: true; note: NoteDetail }
  | { ok: false; error: NoteError; message: string };

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
  return { ok: true, note: toDetail(row) };
}

export async function updateNote(profileId: string, noteId: string, raw: unknown): Promise<WriteResult> {
  const parsed = parseNoteInput(raw, false);
  if (!parsed.ok) return parsed;
  const changes = parsed.changes;

  if (changes.subjectId && !(await subjectIsLearners(profileId, changes.subjectId))) return UNKNOWN_SUBJECT;

  // Conditional on the note being this learner's. Only the four fields a
  // learner may write are ever set: profileId is not among them.
  const updated = await prisma.novaNote.updateMany({
    where: { id: noteId, profileId },
    data: {
      ...(changes.title     !== undefined ? { title:     changes.title } : {}),
      ...(changes.body      !== undefined ? { body:      changes.body } : {}),
      ...(changes.subjectId !== undefined ? { subjectId: changes.subjectId } : {}),
      ...(changes.topicName !== undefined ? { topicName: changes.topicName } : {}),
    },
  });
  if (updated.count !== 1) return NOT_FOUND;

  const note = await getNote(profileId, noteId);
  return note ? { ok: true, note } : NOT_FOUND;
}

export async function deleteNote(profileId: string, noteId: string): Promise<boolean> {
  const deleted = await prisma.novaNote.deleteMany({ where: { id: noteId, profileId } });
  return deleted.count === 1;
}
