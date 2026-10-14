// ─── Deadline types ───────────────────────────────────────────────────────────
// A dated thing a learner is working toward. All of them are one record
// (NovaExam, whose `examType` holds the type) read by one planner; the type
// says what the date is and how far it may shape a day. There is no second
// planner and no second table.
//
//   exam, certification   a test of what you know. Its subject's topics are
//                         prepared for inside the planning window, and
//                         inside three days it takes the whole day.
//   interview             prepared for the same way, but it never takes the
//                         whole day: other work keeps its place.
//   assignment, project,  work to hand in. Its steps are the learner's tasks,
//   other                 not topics to master, so it changes no study block.
//                         It is a date: shown, counted down, and nothing more.
//
// A stored value that is not one of these (older rows hold "midterm" and the
// like) is an exam, which is what every such row was.
// Pure, no imports, so the web app reads it directly.

export const DEADLINE_TYPES = ["exam", "assignment", "project", "interview", "certification", "other"] as const;
export type DeadlineType = (typeof DEADLINE_TYPES)[number];

export const deadlineType = (stored: string | null | undefined): DeadlineType =>
  DEADLINE_TYPES.find(t => t === stored) ?? "exam";

// A type given by a request. null: not one of the types.
export const parseDeadlineType = (value: unknown): DeadlineType | null =>
  DEADLINE_TYPES.find(t => t === value) ?? null;

const days = (n: number, word: string) => (n <= 0 ? `${word} today` : n === 1 ? `${word} tomorrow` : `${word} in ${n} days`);

export const DEADLINE_RULES: Record<DeadlineType, {
  label:           string;                   // shown beside the date
  titleSuffix:     string;                   // "<subject> <suffix>" when it was given no name
  // The planner works on its subject's topics inside the planning window.
  preparesTopics:  boolean;
  // Inside three days every block of the day is for it.
  takesOverTheDay: boolean;
  // Why a block is on today's plan because of it.
  reason:          (daysUntil: number) => string;
}> = {
  exam:          { label: "Exam",          titleSuffix: "exam",          preparesTopics: true,  takesOverTheDay: true,  reason: n => days(n, "exam") },
  certification: { label: "Certification", titleSuffix: "certification", preparesTopics: true,  takesOverTheDay: true,  reason: n => days(n, "certification test") },
  interview:     { label: "Interview",     titleSuffix: "interview",     preparesTopics: true,  takesOverTheDay: false, reason: n => days(n, "interview") },
  assignment:    { label: "Assignment",    titleSuffix: "assignment",    preparesTopics: false, takesOverTheDay: false, reason: n => days(n, "assignment due") },
  project:       { label: "Project",       titleSuffix: "project",       preparesTopics: false, takesOverTheDay: false, reason: n => days(n, "project due") },
  other:         { label: "Date",          titleSuffix: "target date",   preparesTopics: false, takesOverTheDay: false, reason: n => days(n, "due") },
};

type Typed = { examType: string };
export const preparesTopics  = (e: Typed): boolean => DEADLINE_RULES[deadlineType(e.examType)].preparesTopics;
export const takesOverTheDay = (e: Typed): boolean => DEADLINE_RULES[deadlineType(e.examType)].takesOverTheDay;
