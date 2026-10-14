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
// Pure data and one ordering rule, importing types only, so the web app reads
// it directly.

import type { LearningContext } from "./learning-context";

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
  // Who it was written for. It decides only the order templates are offered
  // in: every template stays available to everyone.
  audiences:   LearningContext[];
  // What applying it puts in the form, in words, shown before it is chosen.
  creates:     string[];
  // name "": the learner names it (the form shows `namePrompt`).
  subjects:    Array<{ name: string; topics: string[] }>;
  namePrompt?: string;
  // Whether the form opens a date row for the first subject, and what kind
  // of date that row starts as (left out: the form's own default).
  asksExamDate: boolean;
  dateType?:    "exam" | "assignment" | "project" | "interview" | "certification" | "other";
  tasks:       TemplateTask[];
}

export const STUDY_TEMPLATES: StudyTemplate[] = [
  {
    id: "engineering-semester",
    audiences: ["college"],
    name: "Computer science semester",
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
    audiences: ["school", "college"],
    name: "Exam preparation",
    description: "One exam, worked back from its date. Name the subject, paste its topics, and set the date; the tasks are the usual order of a revision.",
    creates: ["1 subject you name, with the topics you paste", "An exam date", "5 revision tasks, in order"],
    subjects: [{ name: "", topics: [] }],
    namePrompt: "Which subject is the exam in?",
    asksExamDate: true, dateType: "exam",
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
    audiences: ["working", "other"],
    name: "Learn a skill",
    description: "One skill you are teaching yourself, at your own pace. Name it, adjust the stages, and keep the weekly rhythm small enough to hold.",
    creates: ["1 skill you name, with three stages as topics", "4 tasks to start and keep a weekly rhythm"],
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
  {
    id: "school-subjects",
    audiences: ["school"],
    name: "School subjects",
    description: "Your school subjects, with room for each one's chapters. Name them as your school does and add the chapters from your textbook as you go.",
    creates: ["3 subjects you name, ready for their chapters", "3 tasks for homework, tests and a weekly look back"],
    subjects: [{ name: "", topics: [] }, { name: "", topics: [] }, { name: "", topics: [] }],
    namePrompt: "A subject, e.g. Science",
    asksExamDate: false,
    tasks: [
      { key: "chapters", title: "Add this term's chapters for each subject", priority: "high" },
      { key: "homework", title: "Add homework as it is set, with the day it is due" },
      { key: "weekly-review", title: "Once a week, go back over what was taught", priority: "low" },
    ],
  },
  {
    id: "semester-subjects",
    audiences: ["college"],
    name: "Semester subjects",
    description: "Any course, in any field. Name this semester's subjects and paste each syllabus; the tasks cover the dates and coursework a term brings.",
    creates: ["4 subjects you name, with the topics you paste", "4 tasks for dates, assignments and revision"],
    subjects: [{ name: "", topics: [] }, { name: "", topics: [] }, { name: "", topics: [] }, { name: "", topics: [] }],
    namePrompt: "A subject you are taking",
    asksExamDate: false,
    tasks: [
      { key: "syllabus", title: "Paste the syllabus for each subject", priority: "high" },
      { key: "exam-dates", title: "Add exam dates as they are announced" },
      { key: "assignments", title: "List this semester's assignments with their due dates", priority: "medium" },
      { key: "revision", title: "Pick one evening a week for revision", priority: "low" },
    ],
  },
  {
    id: "project-sprint",
    audiences: ["college", "working", "other"],
    name: "Project sprint",
    description: "One project taken from an idea to something finished. Name it, adjust the stages to fit, and add the date it is due if it has one.",
    creates: ["1 project you name, with four stages as topics", "4 tasks, one to open each stage"],
    subjects: [{ name: "", topics: ["Scope and plan", "First working version", "Feedback and fixes", "Finish and hand in"] }],
    namePrompt: "What is the project?",
    asksExamDate: true, dateType: "project",
    tasks: [
      { key: "scope", title: "Write down what done looks like", priority: "high" },
      { key: "first-version", title: "Build the smallest version that works", priority: "high" },
      { key: "feedback", title: "Show it to one person and note what they say", priority: "medium" },
      { key: "finish", title: "Fix what matters and hand it in", priority: "medium" },
    ],
  },
  {
    id: "interview-preparation",
    audiences: ["college", "working"],
    name: "Interview preparation",
    description: "Getting ready for an interview or a round of them. Name the role, keep the areas that apply, and add the interview date when you have it.",
    creates: ["1 goal you name, with four areas to prepare as topics", "4 tasks, from the role's requirements to a practice run"],
    subjects: [{ name: "", topics: ["What the role asks for", "Core knowledge", "Practice questions", "Talking through your work"] }],
    namePrompt: "Which role or interview?",
    asksExamDate: true, dateType: "interview",
    tasks: [
      { key: "requirements", title: "List what the role asks for, from the job description", priority: "high" },
      { key: "gaps", title: "Mark which of those you are least ready for", priority: "high" },
      { key: "practice", title: "Answer five practice questions out loud", priority: "medium" },
      { key: "mock", title: "Do one full practice interview with someone", priority: "medium" },
    ],
  },
  {
    id: "certification",
    audiences: ["working", "college"],
    name: "Certification",
    description: "A certification with a published outline. Name it, paste the outline's sections as topics, and add the test date once it is booked.",
    creates: ["1 certification you name, with the sections you paste", "4 tasks, from the outline to a practice test"],
    subjects: [{ name: "", topics: [] }],
    namePrompt: "Which certification?",
    asksExamDate: true, dateType: "certification",
    tasks: [
      { key: "outline", title: "Paste the official outline as topics", priority: "high" },
      { key: "book", title: "Book the test, or pick a target week" },
      { key: "first-pass", title: "First pass through every section", priority: "medium" },
      { key: "practice-test", title: "Take one full practice test", priority: "medium" },
    ],
  },
];

// The templates in the order to offer them to this learner: the ones written
// for what they said they are learning for come first, the rest follow in
// their own order. Nobody loses a template by what they answered.
export function templatesFor(contexts: readonly LearningContext[]): StudyTemplate[] {
  const fits = (t: StudyTemplate) => t.audiences.some(a => contexts.includes(a));
  return [...STUDY_TEMPLATES.filter(fits), ...STUDY_TEMPLATES.filter(t => !fits(t))];
}

export const templateById = (id: string): StudyTemplate | null => STUDY_TEMPLATES.find(t => t.id === id) ?? null;

// The key a template's task is created under. The same template applied
// again produces the same keys, so the task writer returns what exists.
export const templateTaskKey = (templateId: string, taskKey: string): string => `template:${templateId}:${taskKey}`;
