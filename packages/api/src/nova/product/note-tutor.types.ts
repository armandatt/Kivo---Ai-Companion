// ─── Nova as a tutor on a note: the contract with the notes page ──────────────
// No imports beyond the assist contract's types, so the web app imports it
// directly. Rules: product/note-tutor.ts.

import type { NoteAssistSource } from "./note-assist.types";

// What the learner asked for. Each is one model call on the learner's request.
//   explain     explain the note, the passage or their question, intuition first
//   simpler     the last explanation again, more plainly
//   example     a worked example or analogy
//   steps       a walk-through in stages, each tried before it is shown
//   check       find gaps: one question that tests the idea, nothing told yet
//   practice    one exercise grounded in the note
//   evaluate    check the learner's answer to an exercise
//   quiz        a short quiz (choices, with why each answer is right)
//   brainstorm  ideas, questions, angles from the material
//   flashcards  question and answer cards from the note
//   summary     the note or passage, briefly
//   compare     two concepts side by side
//   connect     which of their notes and saved pages this connects to
//   organize    a title, overview, headings, concepts and questions for raw material
export const TUTOR_MODES = [
  "explain", "simpler", "example", "steps", "check", "practice", "evaluate", "quiz",
  "brainstorm", "flashcards", "summary", "compare", "connect", "organize",
] as const;
export type TutorMode = (typeof TUTOR_MODES)[number];

export const TUTOR_MESSAGE_MAX   = 1_000;
export const TUTOR_SELECTION_MAX = 2_000;
export const TUTOR_ANSWER_MAX    = 2_000;
export const TUTOR_HISTORY_MAX   = 8;       // turns the page sends back
export const TUTOR_TURN_MAX      = 1_500;   // characters of each turn
export const TUTOR_BODY_MAX      = 24 * 1024;

export type TutorBasis = "notes" | "nova";
export type TutorResult = "correct" | "partly" | "incorrect";

// A turn of the conversation as the page recorded it.
export interface TutorTurn { role: "learner" | "nova"; text: string }

// An exercise Nova set. It travels back with the learner's answer: the
// server keeps no conversation. `answer` is the expected answer, which the
// page keeps folded until the learner has tried.
export interface TutorExercise {
  question: string;
  kind:     "open" | "choice";
  choices:  string[];          // empty for an open question
  answer:   string;
  hint:     string | null;
  basis:    TutorBasis;
}

export interface TutorRequest {
  mode:         TutorMode;
  message?:     string;         // what the learner typed
  selection?:   string;         // the passage they chose in the note
  noteVersion?: string;         // the note's updatedAt as the page has it
  history?:     TutorTurn[];
  results?:     TutorResult[];  // how their last answers went, newest last
  exercise?:    TutorExercise;  // evaluate only
  answer?:      string;         // evaluate only
}

// A part of an explanation. "notes" means what the learner's sources say,
// with the [S#] it rests on; a part with no citation of a given source is
// shown as Nova's own, whatever the model called it.
export interface TutorSection { basis: TutorBasis; heading: string | null; text: string }
// A stage of a walk-through. `prompt` is what the learner may try before it
// is shown.
export interface TutorStep { title: string; text: string; prompt: string | null }
export interface TutorQuizItem { question: string; choices: string[]; answer: number; why: string; basis: TutorBasis }
export interface TutorIdea { title: string; text: string; basis: TutorBasis }
export interface TutorCard { front: string; back: string; basis: TutorBasis }
export interface TutorVerdict { result: TutorResult; feedback: string; next: string }
// For raw material: suggestions only. The page offers each to add; nothing
// replaces the learner's text.
export interface TutorOrganize {
  title:     string | null;
  overview:  string | null;
  outline:   string | null;     // a structured version, '# ' headings and '- ' lists
  concepts:  string[];
  questions: string[];
  tags:      string[];
}

export interface TutorReply {
  ok: true;
  mode:         TutorMode;
  sources:      NoteAssistSource[];
  // The saved version the answer was given from, and whether the page said
  // it had a different one.
  noteVersion:  string;
  versionDiffers: boolean;
  // The passage discussed, and the heading it sits under in the note. found:
  // false when the note as saved does not contain it.
  passage:      { text: string; heading: string | null; found: boolean } | null;
  // Only part of a long note was given.
  partial:      boolean;
  sections:     TutorSection[];
  steps:        TutorStep[];
  exercise:     TutorExercise | null;
  quiz:         TutorQuizItem[];
  ideas:        TutorIdea[];
  cards:        TutorCard[];
  verdict:      TutorVerdict | null;
  organize:     TutorOrganize | null;
  // Notes and saved pages it connects to, from the sources given.
  related:      Array<{ sourceId: string; why: string }>;
  followUps:    string[];
  // The sources do not contain what was asked.
  notInSources: boolean;
}

export type TutorError =
  | "invalid" | "too_long" | "not_found" | "empty" | "unavailable" | "rate_limited"
  | "unauthenticated" | "not_nova" | "not_connected" | "onboarding_incomplete" | "allowance_used" | "failed";

export type TutorResponse = TutorReply | { ok: false; error: TutorError; message: string };
