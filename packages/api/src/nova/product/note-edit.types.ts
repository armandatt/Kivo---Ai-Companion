// ─── Nova as an editor of a note: the contract with the notes page ────────────
// Type imports only, so the web app imports it directly. Rules:
// product/note-edit.ts.

import type { EditChange } from "./note-outline";

// What the learner asked the editor for. Each is one model call they made.
//   structure  headings and order for what is there (moves and headings, the same words)
//   rewrite    the passage (or the note) said more clearly, the same meaning
//   expand     an incomplete explanation filled out
//   grammar    spelling, grammar and wording only
//   dedupe     repetition taken out
//   summary    a summary section of the note
//   takeaways  key takeaways and definitions
//   examples   examples where an idea needs one
//   integrate  material from the tutor worked in where it belongs
//   custom     what they typed
export const EDIT_KINDS = ["structure", "rewrite", "expand", "grammar", "dedupe", "summary", "takeaways", "examples", "integrate", "custom"] as const;
export type EditKind = (typeof EDIT_KINDS)[number];

export const EDIT_INSTRUCTION_MAX = 1_000;
export const EDIT_MATERIAL_MAX    = 6_000;
// The request, history included (EDIT_HISTORY_MAX turns of EDIT_TURN_TEXT_MAX twice).
export const EDIT_BODY_MAX        = 40 * 1024;

export interface EditRequest {
  kind:         EditKind;
  instruction?: string;
  // The passage they chose in the note.
  selection?:   string;
  // What the tutor wrote, to be worked into the note (integrate).
  material?:    string;
  noteVersion?: string;
  // What happened earlier in this editing conversation, oldest first, so a
  // request can refer to an earlier one ("do the same for the next section").
  // The note itself is always read fresh from the database: this is the
  // conversation, never a copy of the note.
  history?:     EditTurn[];
  // The question Nova asked last that this message answers.
  answering?:   string;
  // Screenshots stored on this note first (POST /api/nova/notes/images), by
  // id: with this request, and from the request before (sent again so a
  // follow-up can still see them). At most 4. Images already in the note are
  // its ![caption](kivo-image:id) lines and need no id here.
  images?:        string[];
  earlierImages?: string[];
}

// One earlier request and what came of it, as the page saw it.
export interface EditTurn {
  asked:    string;
  // proposed: shown, not acted on yet; applied: in the note and saved;
  // discarded: the learner left it; question: Nova asked something; failed: nothing came of it.
  outcome:  "proposed" | "applied" | "discarded" | "question" | "failed";
  // Nova's summary of its proposal, or its question.
  said?:    string;
}
export const EDIT_HISTORY_MAX = 10;
export const EDIT_TURN_TEXT_MAX = 400;

export interface EditProposal {
  ok: true;
  kind:        EditKind;
  // The saved version the changes were proposed on; the page checks each
  // change against the text as it is when they are applied (applyEdits).
  noteVersion: string;
  summary:     string;
  changes:     EditChange[];
  // Nova needs to know something first (where to put it, which passage).
  question:    string | null;
  // What was left out, and why ("that would change a section you didn't choose").
  dropped:     string[];
  // The changes rewrite most of the note: the page says so before applying.
  large:       boolean;
  // Only part of a long note was given.
  partial:     boolean;
}

export type EditError =
  | "invalid" | "too_long" | "not_found" | "empty" | "unavailable" | "rate_limited" | "nothing_usable"
  | "unauthenticated" | "not_nova" | "not_connected" | "onboarding_incomplete" | "allowance_used" | "failed";

// retryable: trying the same request again may work (the model was busy, slow,
// or its reply came back incomplete); false or absent: it will not as it is.
export type EditResponse = EditProposal | { ok: false; error: EditError; message: string; retryable?: boolean };
