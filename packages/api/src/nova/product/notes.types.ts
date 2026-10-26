// ─── Notes: the contract between Nova and the Notes pages ─────────────────────
// A note is what the learner wrote. It is their content, not Nova's state:
// it is never mastery, memory or evidence, and only the learner's own save
// writes it. No imports, so the web app can import the types directly.

export const NOTE_TITLE_MAX = 200;
export const NOTE_BODY_MAX  = 50_000;   // characters
export const NOTE_TOPIC_MAX = 120;
export const NOTE_PREVIEW_LENGTH = 180;

export interface NoteSummary {
  id:          string;
  title:       string;
  subjectId:   string | null;
  subjectName: string | null;
  topicName:   string | null;
  // The start of the body, for the list. The full body is only returned
  // when one note is opened.
  preview:     string;
  createdAt:   string;
  updatedAt:   string;
}

// A note this note links to with [[Title]], or a note that links here.
export interface NoteLinkRef {
  title:     string;          // as written in the link, or the linking note's title
  // The note it opens. null: no note of the learner's has that title yet.
  noteId:    string | null;
  // A topic of the learner's with that name, when no note has it.
  topicId:   string | null;
  // For a backlink: the line the link sits on.
  context?:  string;
  subjectName?: string | null;
}

export interface NoteDetail extends NoteSummary {
  body: string;
  // [[Links]] written in this note, resolved against the learner's own notes
  // and topics; and the learner's notes that link here. Derived from what
  // they wrote: nothing about a link is stored apart from the text.
  links: { outgoing: NoteLinkRef[]; backlinks: NoteLinkRef[] };
  // "Study this" starts an ordinary study session on the note's subject and
  // topic. The note is context for it; the session is the evidence.
  study: {
    available: boolean;
    // Why it is not available, when it is not. Nothing is guessed to fill
    // the gap.
    blockedBy: "no_subject" | "no_topic" | null;
    minutes:   number;
  };
}

// A subject the learner has, with the topic names already in use under it
// (from their knowledge and their notes), for the pickers.
export interface NoteSubjectOption {
  id:     string;
  name:   string;
  topics: string[];
  // The subject it sits inside (subjects inside subjects), and each topic's
  // parent topic by name, so a picker can show the whole path. Optional: an
  // older API leaves them out.
  parentId?:     string | null;
  topicParents?: Record<string, string | null>;
}

export interface NovaNotesReady {
  status:   "ready";
  notes:    NoteSummary[];           // most recently updated first
  subjects: NoteSubjectOption[];
  // How many notes the learner has in all, whatever the search or filter.
  total:    number;
  // A session is running: one at a time, so another cannot be started.
  activeSession: { topicName: string | null } | null;
  // What the learner said they are learning for (product/learning-context.ts),
  // so the page offers the note templates that fit first. Added by the route.
  learningContexts?: string[];
}

export type NovaNotesView =
  | NovaNotesReady
  | { status: "not_nova" }
  | { status: "not_connected" }
  | { status: "onboarding_incomplete" };

// What the learner may write. Ownership is never part of it: the note
// belongs to whoever is signed in.
export interface NoteInput {
  title?:     string;
  body?:      string;
  subjectId?: string | null;
  topicName?: string | null;
  // The note's updatedAt when the editor opened it. Given, the save is made
  // only if the note has not changed since; otherwise it is refused as a
  // conflict and the note as it now stands comes back. Left out: last write
  // wins, as before.
  baseUpdatedAt?: string;
  // Creating only: a capture or import that may be sent twice. The same title
  // and text saved in the last ten minutes is returned instead of a second note.
  once?: boolean;
}

export type NoteError =
  | "unauthenticated" | "not_nova" | "not_connected" | "onboarding_incomplete"
  | "invalid" | "title_required" | "title_too_long" | "body_too_long" | "topic_too_long"
  | "unknown_subject" | "not_found" | "conflict" | "failed";

export type NoteResponse =
  | { ok: true; note: NoteDetail }
  | { ok: false; error: NoteError; message: string; current?: NoteDetail };

export type NoteDeleteResponse =
  | { ok: true }
  | { ok: false; error: NoteError; message: string };
