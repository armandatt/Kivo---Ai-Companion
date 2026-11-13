// ─── A passage from a page, into a note ───────────────────────────────────────
// Save selection's two destinations beside Saved pages: a note the learner
// already has, or a new one. A note is a Markdown string (NovaNote.body), so a
// passage becomes a section at its end (note-capture.ts selectionSection):
// what is there is never touched, and the section is edited like the rest.
//
// Three different things, kept apart:
//   the note      the document. Keeps its title, its subject and topic, so its
//                 place on the Knowledge Map stays as it is. No map node is made.
//   the section   the passage, with its source's title and address in the text.
//   the source    the saved passage (NovaLearningEvent "selection_saved"), filed
//                 where the note is filed, or left for Nova to look at when the
//                 note is filed nowhere. Same row as Save selection's own, so the
//                 same passage is one saved entry however it was saved.
//
// A retry adds nothing:
//   - the note and the saved passage change in one transaction, so a failure
//     leaves neither, and the request's clientEventId can be sent again;
//   - that id is stored with the passage: seen before means already done;
//   - a passage the note already holds is not added again, whatever the id.
// The write is conditional on the version just read, so it never replaces a
// change made in between: it reads again and adds to that. An editor open on
// the note then gets the conflict every stale save gets (notes.ts updateNote),
// with both texts, rather than overwriting this.

import { prisma } from "@repo/db/client";
import { appendToBody, captureBody, hasSelection, selectionSection } from "./note-capture";
import { linkTarget, mergeIntoBody, siteOf } from "./capture-draft-rules";
import { eventsLastMinute, parseLearningEvent, passageSeen, recordLearningEvent, recordPassageIn } from "./learning-events";
import { createNote, listNoteRows, noteRowIn, noteRowWithBody, replaceBodyIn, type NoteChoiceRow } from "./notes";
import { EVENTS_PER_MINUTE, type LearningEventSource } from "./learning-events.types";
import { NOTE_BODY_MAX, NOTE_TITLE_MAX, notePath } from "./notes.types";

export const NOTE_CHOICES_PAGE = 30;
const QUERY_MAX = 120;
const WRITE_ATTEMPTS = 3;
const HEADINGS_SHOWN = 8;

export interface NoteChoice {
  id: string; title: string; subjectId: string | null; subjectName: string | null; topicName: string | null;
  // The subjects above it and the subject, then its topic.
  path: string; updatedAt: string;
}
export interface NoteChoicesView { notes: NoteChoice[]; total: number; hasMore: boolean }
export interface NoteChoicePreview extends NoteChoice { length: number; headings: string[]; ending: string }

export type SaveToNoteResult =
  | { success: true; action: "added" | "already_in_note" | "created"; duplicate: boolean; note: NoteChoice; added: number }
  | { success: false; error: "invalid" | "not_found" | "too_long" | "rate_limited" | "unknown_subject" | "conflict"; message: string };

const fail = (error: Extract<SaveToNoteResult, { success: false }>["error"], message: string): SaveToNoteResult => ({ success: false, error, message });

type NoteRow = NoteChoiceRow;
type SubjectRow = { id: string; name: string; parentId: string | null };

const subjectsOf = (profileId: string): Promise<SubjectRow[]> =>
  prisma.novaSubject.findMany({ where: { profileId }, select: { id: true, name: true, parentId: true } });

function choiceOf(row: NoteRow, subjects: SubjectRow[]): NoteChoice {
  const subject = subjects.find(s => s.id === row.subjectId) ?? null;
  return {
    id: row.id, title: row.title, subjectId: row.subjectId, subjectName: subject?.name ?? null, topicName: row.topicName,
    path: notePath(subject?.id ?? null, row.topicName, subjects), updatedAt: row.updatedAt.toISOString(),
  };
}

// A subject and the subjects inside it, to any depth.
function withInner(subjectId: string, subjects: SubjectRow[]): string[] {
  const out = [subjectId];
  for (let i = 0; i < out.length; i++) for (const s of subjects) if (s.parentId === out[i] && !out.includes(s.id)) out.push(s.id);
  return out;
}

// The learner's notes to choose from, newest first, by title and where they are
// filed. No note's text leaves here.
export async function listNoteChoices(
  profileId: string,
  filters: { query?: string | null; subjectId?: string | null; topicName?: string | null; skip?: number | null } = {},
): Promise<NoteChoicesView> {
  const subjects = await subjectsOf(profileId);
  const query = (filters.query ?? "").trim().slice(0, QUERY_MAX);
  const subject = filters.subjectId && subjects.some(s => s.id === filters.subjectId) ? filters.subjectId : null;
  const topic = subject ? (filters.topicName ?? "").trim() : "";
  const skip = Math.max(0, Math.floor(filters.skip ?? 0)) || 0;
  const { rows, total } = await listNoteRows(profileId, { query, subjectIds: subject ? withInner(subject, subjects) : null, topicName: topic, skip, take: NOTE_CHOICES_PAGE });
  return { notes: rows.map(r => choiceOf(r, subjects)), total, hasMore: skip + rows.length < total };
}

// Enough of one note to be sure it is the right one: where it is, its headings
// and how it ends, which is where the passage would go.
export async function noteChoicePreview(profileId: string, noteId: string): Promise<NoteChoicePreview | null> {
  const row = await noteRowWithBody(profileId, noteId);
  if (!row) return null;
  const lines = row.body.split("\n");
  const headings: string[] = [];
  for (const line of lines) {
    if (!line.startsWith("#")) continue;
    let at = 0;
    while (line[at] === "#") at++;
    if (at <= 6 && line[at] === " ") headings.push(line.slice(at + 1).trim());
  }
  return {
    ...choiceOf(row, await subjectsOf(profileId)),
    length: row.body.length, headings: headings.slice(-HEADINGS_SHOWN),
    ending: row.body.trim().slice(-160),
  };
}

class Stale extends Error {}
const isUniqueViolation = (err: unknown) => typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2002";

const dayOf = (raw: unknown, occurredAt: Date) => {
  // The learner's own day, when the client gave a well-formed one.
  if (typeof raw === "string" && raw.length === 10 && !Number.isNaN(Date.parse(raw))) return raw;
  return occurredAt.toISOString().slice(0, 10);
};
const viaOf = (source: LearningEventSource) => (source === "browser_extension" ? "extension" as const : "paste" as const);

// raw: a selection_saved learning event's own fields, plus either noteId (add
// to that note) or newNote { title } (subject and topic are the event's).
export async function saveSelectionToNote(
  profileId: string,
  raw: unknown,
  options: { source: LearningEventSource; now?: Date },
): Promise<SaveToNoteResult> {
  const now = options.now ?? new Date();
  const input = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
  if (!input) return fail("invalid", "That isn't something Nova can save.");
  const parsed = parseLearningEvent({ ...input, eventType: "selection_saved" }, now);
  if (!parsed.ok) return fail(parsed.failure.error === "rate_limited" ? "rate_limited" : "invalid", parsed.failure.message);
  const event = parsed.event;
  if (!event.excerpt) return fail("invalid", "Select a passage first.");
  const day = dayOf(input.day, event.occurredAt);
  const via = viaOf(options.source);

  if (typeof input.noteId !== "string") return createFromSelection(profileId, input, { source: options.source, day, via });

  const noteId = input.noteId;
  const subjects = await subjectsOf(profileId);
  const section = selectionSection({ title: event.title, url: event.url, text: event.excerpt, day, via });
  const seen = await passageSeen(profileId, event.clientEventId);
  if (!seen) {
    const recent = await eventsLastMinute(profileId, now);
    if (recent >= EVENTS_PER_MINUTE) return fail("rate_limited", "That's a lot at once. Give it a minute.");
  }

  for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt++) {
    const note = await noteRowWithBody(profileId, noteId);
    if (!note) return fail("not_found", "That note isn't there any more. Choose another.");
    if (seen || hasSelection(note.body, event.excerpt)) {
      return { success: true, action: "already_in_note", duplicate: !!seen, note: choiceOf(note, subjects), added: 0 };
    }
    // A page this note already cites gets the passage in its section, under no
    // second heading; anything else is a new section at the end.
    const cites = event.url !== null && note.body.includes(`](${linkTarget(event.url)})`);
    const next = cites
      ? mergeIntoBody(note.body, [{ id: event.clientEventId, key: null, url: event.url, title: event.title, site: siteOf(new URL(event.url!).hostname), text: event.excerpt, context: null, note: "", capturedAt: event.occurredAt.toISOString() }], day)?.body ?? null
      : appendToBody(note.body, section, day);
    if (next === null) return fail("too_long", `That note can't take more: it would be over the ${NOTE_BODY_MAX.toLocaleString("en-US")} characters a note can hold. Choose another, or create a new note.`);
    try {
      const updated = await prisma.$transaction(async tx => {
        if (!(await replaceBodyIn(tx, profileId, note.id, note.updatedAt, next))) throw new Stale();
        await recordPassageIn(tx, profileId, event, { subjectId: note.subjectId, topicName: note.topicName }, options.source);
        return noteRowIn(tx, profileId, note.id);
      });
      if (!updated) return fail("not_found", "That note isn't there any more. Choose another.");
      return { success: true, action: "added", duplicate: false, note: choiceOf(updated, subjects), added: next.length - note.body.length };
    } catch (err) {
      // The note changed between reading and writing, or the same request got
      // there first (its transaction stands, this one left nothing): read again.
      if (err instanceof Stale || isUniqueViolation(err)) continue;
      throw err;
    }
  }
  return fail("conflict", "That note kept changing while Nova was adding to it. Nothing was added. Try again.");
}

// A new note from the passage, filed where they chose. createNote's `once`
// answers a retry with the same note, and the saved passage is the same one
// Save selection keeps.
async function createFromSelection(
  profileId: string,
  input: Record<string, unknown>,
  ctx: { source: LearningEventSource; day: string; via: "extension" | "paste" },
): Promise<SaveToNoteResult> {
  const fresh = input.newNote && typeof input.newNote === "object" ? input.newNote as Record<string, unknown> : null;
  if (!fresh) return fail("invalid", "Choose a note, or create a new one.");
  const stated = typeof fresh.title === "string" ? fresh.title.trim() : "";
  const title = (stated || (typeof input.title === "string" ? input.title.trim() : "") || "Captured passage").slice(0, NOTE_TITLE_MAX);
  const url = typeof input.url === "string" ? input.url : null;
  const body = captureBody({ url, title: typeof input.title === "string" ? input.title : "", text: String(input.excerpt ?? ""), via: ctx.via === "extension" ? "extension" : "paste" }, ctx.day);
  const made = await createNote(profileId, { title, body, subjectId: input.subjectId ?? null, topicName: input.topicName ?? null, once: true });
  if (!made.ok) return fail(made.error === "unknown_subject" ? "unknown_subject" : "invalid", made.message);
  const recorded = await recordLearningEvent(profileId, { ...input, eventType: "selection_saved" }, { source: ctx.source });
  if (!recorded.success && recorded.error !== "rate_limited") console.error("[nova:note-append] passage not recorded:", recorded.error);
  const subjects = await subjectsOf(profileId);
  const row = { id: made.note.id, title: made.note.title, subjectId: made.note.subjectId, topicName: made.note.topicName, updatedAt: new Date(made.note.updatedAt) };
  return { success: true, action: "created", duplicate: false, note: choiceOf(row, subjects), added: body.length };
}
