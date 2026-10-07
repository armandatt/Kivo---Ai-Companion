// ─── Study setup: the contract between Nova and the setup page ────────────────
// What the page sends, what the server says saving it would do, and what is
// on record. This file has no imports so the web app can import its types
// directly. The rules live in setup.ts.

export type SetupStudyTime = "morning" | "afternoon" | "evening" | "night";
export type SetupGapName = "subjects" | "topics" | "exams" | "daily_minutes" | "study_time";

export interface SetupDraft {
  subjects:     Array<{ name: string; topics: string[] }>;
  exams:        Array<{ subjectName: string; date: string; title: string | null }>;   // date: YYYY-MM-DD
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
