// ─── Starting points ──────────────────────────────────────────────────────────
// A small, fixed set of templates a learner can start a workspace from. A
// template is a suggestion for the setup form and nothing more: the subjects
// and topics it lists are put into the form, where the learner edits them,
// reviews them and confirms, and they are saved by the ordinary setup writer
// (product/setup.ts), which merges and never duplicates. The tasks it lists
// are created by the ordinary task writer with a key of their own, so
// applying a template twice makes each task once.
//
// A template states no progress: its topics are declared with no mastery, no
// session and no review, and its tasks start as "to do".
// Pure data, no imports, so the web app reads it directly.

export interface TemplateTask {
  key:       string;            // unique within the template
  title:     string;
  priority?: "low" | "medium" | "high";
  // The subject the task belongs to, by the name it has in this template.
  subject?:  string;
}

export interface StudyTemplate {
  id:          string;
  name:        string;
  description: string;
  // What applying it puts in the form, in words, shown before it is chosen.
  creates:     string[];
  // name "": the learner names it (the form shows `namePrompt`).
  subjects:    Array<{ name: string; topics: string[] }>;
  namePrompt?: string;
  // Whether the form opens an exam date row for the first subject.
  asksExamDate: boolean;
  tasks:       TemplateTask[];
}

export const STUDY_TEMPLATES: StudyTemplate[] = [
  {
    id: "engineering-semester",
    name: "Engineering semester",
    description: "A term of core computer science courses, each with its usual units. Rename, remove or add subjects to match your own timetable.",
    creates: ["5 subjects with their standard units as topics", "3 tasks to get the term organised"],
    subjects: [
      { name: "Data Structures and Algorithms", topics: ["Arrays and strings", "Linked lists", "Stacks and queues", "Trees", "Graphs", "Sorting and searching", "Dynamic programming"] },
      { name: "Operating Systems", topics: ["Processes and threads", "CPU scheduling", "Deadlocks", "Memory management", "File systems"] },
      { name: "Database Systems", topics: ["ER modelling", "Relational model", "SQL", "Normalization", "Transactions", "Indexing"] },
      { name: "Computer Networks", topics: ["Network models", "Data link layer", "Network layer and routing", "Transport layer", "Application layer"] },
      { name: "Engineering Mathematics", topics: ["Linear algebra", "Calculus", "Probability", "Discrete mathematics"] },
    ],
    asksExamDate: false,
    tasks: [
      { key: "syllabus", title: "Collect the syllabus for each subject", priority: "high" },
      { key: "exam-dates", title: "Add exam dates as they are announced" },
      { key: "assignments", title: "List this term's assignments and their due dates" },
    ],
  },
  {
    id: "exam-preparation",
    name: "Exam preparation",
    description: "One exam, worked back from its date. Name the subject, paste its topics, and set the date; the tasks are the usual order of a revision.",
    creates: ["1 subject you name, with the topics you paste", "An exam date", "5 revision tasks, in order"],
    subjects: [{ name: "", topics: [] }],
    namePrompt: "Which subject is the exam in?",
    asksExamDate: true,
    tasks: [
      { key: "topics", title: "List every topic on the syllabus", priority: "high" },
      { key: "first-pass", title: "First pass through every topic", priority: "high" },
      { key: "past-paper", title: "Solve one past paper against the clock", priority: "medium" },
      { key: "weak-topics", title: "Go back over the topics that went badly", priority: "medium" },
      { key: "day-before", title: "Light review and an early night the day before", priority: "low" },
    ],
  },
  {
    id: "skill-building",
    name: "Personal learning",
    description: "One skill you are teaching yourself, at your own pace. Name it, adjust the stages, and keep the weekly rhythm small enough to hold.",
    creates: ["1 subject you name, with three stages as topics", "4 tasks to start and keep a weekly rhythm"],
    subjects: [{ name: "", topics: ["Fundamentals", "Core practice", "First small project"] }],
    namePrompt: "What are you learning?",
    asksExamDate: false,
    tasks: [
      { key: "resource", title: "Pick one main resource and save it to Kivo", priority: "high" },
      { key: "weekly-slot", title: "Choose the days and time you will study each week", priority: "medium" },
      { key: "project", title: "Decide on one small project to build", priority: "medium" },
      { key: "weekly-note", title: "Write a note on what you learned this week", priority: "low" },
    ],
  },
];

export const templateById = (id: string): StudyTemplate | null => STUDY_TEMPLATES.find(t => t.id === id) ?? null;

// The key a template's task is created under. The same template applied
// again produces the same keys, so the task writer returns what exists.
export const templateTaskKey = (templateId: string, taskKey: string): string => `template:${templateId}:${taskKey}`;
