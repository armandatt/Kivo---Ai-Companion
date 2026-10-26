// ─── Importing a research paper: the contract with the notes page ────────────
// Type imports only, so the web app imports it directly. Rules:
// product/paper-import.ts.

import type { PaperKind, PaperTextStatus } from "./paper-source";

export const PAPER_URL_MAX = 2_000;
export const PAPER_BODY_MAX = 80_000;   // a request with a transcript of a PDF the learner uploaded
export const PAPER_TRANSCRIPT_MAX = 48_000;

// POST /api/nova/notes/papers/preview { url }: what importing would bring in.
export interface PaperPreview {
  ok: true;
  kind:      PaperKind;
  key:       string;
  title:     string;
  authors:   string[];
  abstract:  string | null;
  published: string | null;
  venue:     string | null;
  doi:       string | null;
  arxivId:   string | null;
  pmid:      string | null;
  pmcid:     string | null;
  sourceUrl: string;
  pdfUrl:    string | null;
  keywords:  string[];
  detailsFrom: string;
  // What the note would hold, as found now (before a size cut or a PDF read).
  status:    PaperTextStatus;
  textFrom:  string | null;
  sections:  string[];
  textChars: number;
  notes:     string[];
  // A PDF that Nova could transcribe, on request, when there is no full text.
  canTranscribe: boolean;
  // The learner already has this paper as a note.
  existing:  { id: string; title: string } | null;
}

// POST /api/nova/notes/papers { url, subjectId, topicName, title?, transcribe?, transcript? }
export interface PaperImportRequest {
  url:        string;
  subjectId?: string | null;
  topicName?: string | null;
  // A better title, when the source gave none (a bare PDF).
  title?:     string;
  // Have Nova transcribe the paper's PDF (one model call, the AI allowance).
  transcribe?: boolean;
  // The text of a PDF the learner uploaded and Nova transcribed
  // (POST /api/nova/notes/import), to keep as the paper's text.
  transcript?: { fileName: string; text: string; complete: boolean; pages: number | null };
}

export interface PaperImported {
  ok: true;
  noteId:   string;
  title:    string;
  // The paper was already a note of theirs: nothing new was made.
  existing: boolean;
  status:   PaperTextStatus;
  notes:    string[];
}

export type PaperError =
  | "invalid" | "empty" | "not_a_link" | "not_https" | "private" | "not_found" | "not_a_paper" | "unavailable" | "busy"
  | "too_large" | "rate_limited" | "unknown_subject" | "transcription_failed"
  | "unauthenticated" | "not_nova" | "not_connected" | "onboarding_incomplete" | "allowance_used" | "failed";

export type PaperPreviewResponse = PaperPreview | { ok: false; error: PaperError; message: string };
export type PaperImportResponse = PaperImported | { ok: false; error: PaperError; message: string };
