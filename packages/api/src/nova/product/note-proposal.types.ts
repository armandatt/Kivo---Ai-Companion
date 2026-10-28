// ─── Nova's Editor starting a note: the contract ─────────────────────────────
// Before a note exists, the learner may ask Nova's Editor for a starting point:
// a title, an outline and where to file it. It is a proposal: nothing is
// created until the learner, having edited it as they like, creates the note
// through the ordinary notes route. No imports, so the web app imports it.

export const PROPOSAL_INTENT_MAX  = 1_500;
export const PROPOSAL_OUTLINE_MAX = 8_000;
export const PROPOSAL_REQUESTS_PER_MINUTE = 6;
// Room for three files (3 MB together) as base64, and the words.
export const PROPOSAL_BODY_MAX = 4_400_000;

export interface NoteProposalFile { name: string; data: string }

export interface NoteProposalRequest {
  title?:  string;
  // What they want to write or learn, in their words.
  intent?: string;
  files?:  NoteProposalFile[];
  // The outline shown last, when they ask for another: a different one is asked for.
  previous?: string;
}

// One of the learner's own subjects or topics, by the pair a note is filed by.
export interface ProposalDestination {
  subjectId: string;
  topicName: string | null;
  path:      string[];
  reason:    string | null;
}

export interface NoteProposal {
  title:   string;
  // Markdown: sections and subsections, with what to write under each (or,
  // from files, the points they make, said to be from them).
  outline: string;
  // Where Nova would file it, among what the learner has; null when nothing fits.
  destination: ProposalDestination | null;
  // When nothing fits: a topic Nova would add under one of their subjects. Only
  // a suggestion: the page makes it only when the learner asks.
  newTopic: { subjectId: string; path: string[]; name: string; reason: string | null } | null;
  // What became of each file: read, or not (and why), as Nova reported it.
  files: Array<{ name: string; read: boolean; note: string | null }>;
}

export type NoteProposalError =
  | "invalid" | "not_enough" | "too_long" | "too_large" | "too_many" | "unsupported" | "empty"
  | "unreadable" | "too_many_pages" | "encrypted" | "unavailable";

export type NoteProposalResponse =
  | { ok: true; proposal: NoteProposal }
  | { ok: false; error: NoteProposalError; message: string };
