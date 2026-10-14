// ─── Exams: the contract between Nova and the exam-date editor ────────────────
// The dated exams a learner has on record, and what changing or removing one
// answers. No imports, so the web app can import the types directly.

export const EXAM_TITLE_MAX       = 80;
// The whole request that changes one exam: a title and a date.
export const EXAM_BODY_MAX_BYTES  = 2 * 1024;

// Where a learner changes or removes an exam date. Pages that show one link here.
export const EXAMS_HREF = "/settings/study#exams";

export interface NovaExamItem {
  id:          string;
  title:       string;
  subjectName: string | null;
  date:        string;   // YYYY-MM-DD, the day the learner gave
  daysUntil:   number;   // in the learner's own calendar days
}

export type NovaExamsView =
  | { status: "ready"; exams: NovaExamItem[] }
  | { status: "not_nova" }
  | { status: "not_connected" };

export type ExamChangeError =
  | "invalid"        // not a change this route understands
  | "no_title"
  | "bad_date"
  | "in_the_past"
  | "too_far"
  | "duplicate"      // the same subject already has an exam that day
  | "not_found";

// A change or a removal answers with the list as it now stands, so the page
// never has to guess what the server kept.
export type ExamResponse =
  | { ok: true; exams: NovaExamItem[] }
  | { ok: false; error: ExamChangeError | "too_large" | "unauthenticated" | "not_nova" | "not_connected" | "failed"; message: string };
