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

export interface NoteDetail extends NoteSummary {
  body: string;
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
}

export interface NovaNotesReady {
  status:   "ready";
  notes:    NoteSummary[];           // most recently updated first
  subjects: NoteSubjectOption[];
  // How many notes the learner has in all, whatever the search or filter.
  total:    number;
  // A session is running: one at a time, so another cannot be started.
  activeSession: { topicName: string | null } | null;
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
}

export type NoteError =
  | "unauthenticated" | "not_nova" | "not_connected" | "onboarding_incomplete"
  | "invalid" | "title_required" | "title_too_long" | "body_too_long" | "topic_too_long"
  | "unknown_subject" | "not_found" | "failed";

export type NoteResponse =
  | { ok: true; note: NoteDetail }
  | { ok: false; error: NoteError; message: string };

export type NoteDeleteResponse =
  | { ok: true }
  | { ok: false; error: NoteError; message: string };
