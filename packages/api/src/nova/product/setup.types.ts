// ─── Study setup: the contract between Nova and the setup page ────────────────
// What the page sends, what the server says saving it would do, and what is
// on record. This file imports types only, from files with no imports,
// so the web app can import it directly. The rules live in setup.ts.

import type { LearningContext } from "./learning-context";
import type { FirstFocus } from "./first-focus";

export type SetupStudyTime = "morning" | "afternoon" | "evening" | "night";
export type SetupGapName = "subjects" | "topics" | "exams" | "daily_minutes" | "study_time";

export interface SetupDraft {
  subjects:     Array<{ name: string; topics: string[] }>;
  // date: YYYY-MM-DD. type: what kind of date (deadline-types.ts); left out, an exam.
  exams:        Array<{ subjectName: string; date: string; title: string | null; type?: "exam" | "assignment" | "project" | "interview" | "certification" | "other" }>;
  dailyMinutes: number | null;      // null: not said
  studyTime:    SetupStudyTime | null;   // null: not said
}

export interface SetupIssue { field: string; message: string }

export interface SetupView {
  subjects:     Array<{ name: string; topics: string[] }>;
  exams:        Array<{ subjectName: string | null; title: string; date: string }>;
  dailyMinutes: number | null;
  studyTime:    string | null;
  // Enough to plan from: at least one subject with a topic.
  complete:     boolean;
  missing:      SetupGapName[];
  nextQuestion: string | null;
  // What the learner said they are learning for (empty: not said). The page
  // words itself from this; nothing about what is saved depends on it.
  learningContexts: LearningContext[];
  // The starting points to offer, most fitting first.
  templateIds:  string[];
  // What they asked Nova to help with first (onboarding), when said. Only the
  // page's own view carries it; it orders templateIds and picks one first step.
  firstFocus?:  FirstFocus | null;
}

export interface SetupChanges {
  newSubjects:    string[];
  newTopics:      Array<{ subject: string; topics: string[] }>;
  knownTopics:    number;        // in the draft and already on record
  newExams:       Array<{ subjectName: string; date: string }>;
  knownExams:     number;
  dailyMinutes:   { from: number | null; to: number | null } | null;   // null: unchanged
  studyTime:      { from: string | null; to: string | null } | null;
  // Whether, with this saved, there is enough to plan from.
  complete:       boolean;
}
