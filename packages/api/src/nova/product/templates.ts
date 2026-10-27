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

// Where a template is listed. A template may be listed in more than one
// place (a skill plan is both a student's and a professional's); it is still
// one template, with one id.
export const TEMPLATE_CATEGORIES = ["college", "professional", "competitive"] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

export const CATEGORY_INFO: Record<TemplateCategory, { label: string; blurb: string; subcategories: Record<string, string> }> = {
  college:      { label: "College",           blurb: "Semester learning, skills and student life.",
                  subcategories: { semester: "Semester learning", skills: "Skill development", management: "Student management" } },
  professional: { label: "Professionals",     blurb: "Career growth, new skills and work.",
                  subcategories: { growth: "Career and skill growth", work: "Work management" } },
  competitive:  { label: "Competitive Exams", blurb: "Syllabus, notes, references and revision.",
                  subcategories: { syllabus: "Syllabus and preparation", revision: "Notes and revision" } },
};

// What a template is for, as one kind of outcome. Matching a request to a
// template compares this (product/workspace-routing.ts), never words.
export const TEMPLATE_OUTCOMES = [
  "semester", "exam", "skill", "project", "interview", "certification", "school",
  "competitive_exam", "revision", "work_projects", "career_growth",
] as const;
export type TemplateOutcome = (typeof TEMPLATE_OUTCOMES)[number];

export interface TemplateNote {
  key:   string;
  title: string;
  // "#" headings and "-" lists, left empty: a template states nothing the
  // learner knows.
  body:  string;
}

export interface StudyTemplate {
  id:          string;
  // Raised when what applying it creates changes. A workspace records the
  // version it was made from.
  version:     number;
  name:        string;
  // One line for the card. The description is for the preview.
  purpose:     string;
  description: string;
  outcome:     TemplateOutcome;
  placements:  Array<{ category: TemplateCategory; subcategory: string }>;
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
  // The learner's own list of sections or projects, one subject each,
  // instead of the one named subject (competitive-exam sections, work projects).
  asksSubjectList?: { label: string; required: boolean };
  tasks:       TemplateTask[];
  notes?:      TemplateNote[];
}

export const STUDY_TEMPLATES: StudyTemplate[] = [
  {
    id: "engineering-semester", version: 1, outcome: "semester",
    placements: [{ category: "college", subcategory: "semester" }],
    audiences: ["college"],
    name: "Computer science semester",
    purpose: "Core CS courses with their standard units, ready to plan.",
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
    id: "exam-preparation", version: 1, outcome: "exam",
    placements: [{ category: "college", subcategory: "semester" }],
    audiences: ["school", "college"],
    name: "Exam preparation",
    purpose: "One exam, worked back from its date.",
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
    id: "skill-building", version: 1, outcome: "skill",
    placements: [{ category: "college", subcategory: "skills" }, { category: "professional", subcategory: "growth" }],
    audiences: ["working", "other"],
    name: "Learn a skill",
    purpose: "One skill, in stages, at a pace you can hold.",
    description: "One skill you are teaching yourself, at your own pace. Name it, adjust the stages, and keep the weekly rhythm small enough to hold.",
    creates: ["1 skill you name, with three stages as topics", "4 tasks to start and keep a weekly rhythm"],
    subjects: [{ name: "", topics: ["Fundamentals", "Core practice", "First small project"] }],
    namePrompt: "What are you learning?",
    asksExamDate: false,
    tasks: [
      { key: "resource", title: "Pick one main resource and save it to Kio", priority: "high" },
      { key: "weekly-slot", title: "Choose the days and time you will study each week", priority: "medium" },
      { key: "project", title: "Decide on one small project to build", priority: "medium" },
      { key: "weekly-note", title: "Write a note on what you learned this week", priority: "low" },
    ],
  },
  {
    id: "school-subjects", version: 1, outcome: "school",
    placements: [{ category: "college", subcategory: "management" }],
    audiences: ["school"],
    name: "School subjects",
    purpose: "Your school subjects, homework and tests in one place.",
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
    id: "semester-subjects", version: 1, outcome: "semester",
    placements: [{ category: "college", subcategory: "semester" }],
    audiences: ["college"],
    name: "Semester subjects",
    purpose: "Any course in any field: your subjects and their syllabus.",
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
    id: "project-sprint", version: 1, outcome: "project",
    placements: [{ category: "college", subcategory: "skills" }, { category: "professional", subcategory: "work" }],
    audiences: ["college", "working", "other"],
    name: "Project sprint",
    purpose: "One project from idea to finished, in four stages.",
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
    id: "interview-preparation", version: 1, outcome: "interview",
    placements: [{ category: "college", subcategory: "management" }, { category: "professional", subcategory: "growth" }],
    audiences: ["college", "working"],
    name: "Interview preparation",
    purpose: "Placements or a job interview, from the role to a mock.",
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
    id: "certification", version: 1, outcome: "certification",
    placements: [{ category: "professional", subcategory: "growth" }, { category: "competitive", subcategory: "syllabus" }],
    audiences: ["working", "college"],
    name: "Certification",
    purpose: "A certification's official outline, worked to a practice test.",
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
  {
    id: "competitive-exam", version: 1, outcome: "competitive_exam",
    placements: [{ category: "competitive", subcategory: "syllabus" }],
    audiences: ["school", "college", "working"],
    name: "Competitive exam",
    purpose: "An entrance or recruitment exam, section by section.",
    description: "A competitive exam with a published syllabus. Name the exam, list its sections (each becomes a subject), paste each section's topics, and add the exam date. Notes hold the exam pattern and a facts sheet; tasks set up past papers and a mock rhythm.",
    creates: ["A subject for each section you list", "An exam date", "2 notes: exam pattern and a facts sheet", "5 tasks, from syllabus mapping to weekly mocks"],
    subjects: [{ name: "", topics: [] }],
    namePrompt: "Which exam? e.g. GATE CSE",
    asksSubjectList: { label: "Sections of the exam, one per line (optional)", required: false },
    asksExamDate: true, dateType: "exam",
    tasks: [
      { key: "syllabus-map", title: "Map the official syllabus onto each section's topics", priority: "high" },
      { key: "pyq", title: "Go through the last few years' papers and mark the topics that repeat", priority: "high" },
      { key: "first-pass", title: "First pass through every section", priority: "medium" },
      { key: "mock", title: "Fix one day a week for a full mock test", priority: "medium" },
      { key: "mock-review", title: "After each mock, log every mistake in the error log", priority: "medium" },
    ],
    notes: [
      { key: "pattern", title: "Exam pattern", body: "# Sections and marks\n- \n\n# Negative marking\n- \n\n# Time per section\n- \n\n# Source\n- Official notification: " },
      { key: "facts", title: "Facts and formula sheet", body: "# To memorise\n- \n\n# Formulas\n- \n\n# Often confused\n- " },
    ],
  },
  {
    id: "revision-notebook", version: 1, outcome: "revision",
    placements: [{ category: "competitive", subcategory: "revision" }],
    audiences: ["school", "college", "working"],
    name: "Revision notebook",
    purpose: "An error log, a facts sheet and a spaced revision rhythm.",
    description: "Notes and a rhythm for revising one exam or subject: an error log for mistakes in practice, a facts sheet, a past-paper log and spaced revision. Name what you are revising for.",
    creates: ["1 subject you name", "3 notes: error log, facts sheet, past-paper log", "3 tasks for a weekly revision rhythm"],
    subjects: [{ name: "", topics: [] }],
    namePrompt: "What are you revising for?",
    asksExamDate: false,
    tasks: [
      { key: "weekly-errors", title: "Once a week, redo every question in the error log", priority: "medium" },
      { key: "spaced", title: "Revise each finished topic again after 1, 7 and 21 days", priority: "medium" },
      { key: "facts", title: "Read the facts sheet aloud before each mock", priority: "low" },
    ],
    notes: [
      { key: "errors", title: "Error log", body: "# Question\n\n\n# What I did\n\n\n# The mistake\n\n\n# The rule to remember\n- " },
      { key: "facts", title: "Facts sheet", body: "# Facts\n- \n\n# Formulas\n- \n\n# Traps\n- " },
      { key: "papers", title: "Past-paper log", body: "# Paper\n- Year: \n- Score: \n\n# Topics that cost marks\n- \n\n# Next time\n- " },
    ],
  },
  {
    id: "work-projects", version: 1, outcome: "work_projects",
    placements: [{ category: "professional", subcategory: "work" }],
    audiences: ["working"],
    name: "Work projects",
    purpose: "Your projects at work, their deliverables and a weekly review.",
    description: "The projects you are responsible for, each with its stages, plus a weekly review and a decision log. List your projects; add the next deliverable's date if there is one.",
    creates: ["A subject for each project you list, with three stages", "A deliverable date", "2 notes: weekly review and decision log", "3 tasks for a weekly rhythm"],
    subjects: [{ name: "", topics: ["Plan", "Deliver", "Review"] }],
    namePrompt: "Your team or area, e.g. Growth team",
    asksSubjectList: { label: "Your projects, one per line", required: true },
    asksExamDate: true, dateType: "project",
    tasks: [
      { key: "priorities", title: "Every Monday, write this week's three priorities", priority: "high" },
      { key: "deliverables", title: "List each project's next deliverable and its date", priority: "high" },
      { key: "friday-review", title: "Every Friday, fill in the weekly review", priority: "medium" },
    ],
    notes: [
      { key: "weekly", title: "Weekly review", body: "# Done this week\n- \n\n# Slipped, and why\n- \n\n# Next week's three priorities\n- " },
      { key: "decisions", title: "Decision log", body: "# Decision\n\n\n# Options considered\n- \n\n# Why\n- \n\n# Revisit when\n- " },
    ],
  },
  {
    id: "career-growth", version: 1, outcome: "career_growth",
    placements: [{ category: "professional", subcategory: "growth" }],
    audiences: ["working"],
    name: "Career growth plan",
    purpose: "Grow toward a role: skills, visible work and feedback.",
    description: "A plan for growing toward a role or promotion: the skills to build, work that shows them, the people whose feedback counts, and a record of wins. Name the role and add a review date if you have one.",
    creates: ["1 goal you name, with four areas as topics", "A review date", "1 note: a record of your wins", "4 tasks to start"],
    subjects: [{ name: "", topics: ["Skills to build", "Visible work", "Feedback and mentors", "Interview and review readiness"] }],
    namePrompt: "Which role are you growing toward?",
    asksExamDate: true, dateType: "other",
    tasks: [
      { key: "skills", title: "List the three skills the role needs that you have least of", priority: "high" },
      { key: "feedback", title: "Ask your manager what would make the case for you", priority: "high" },
      { key: "visible", title: "Pick one piece of work that shows a missing skill", priority: "medium" },
      { key: "wins", title: "Add to the wins record every Friday", priority: "low" },
    ],
    notes: [
      { key: "wins", title: "Wins record", body: "# Win\n- What: \n- Impact: \n- Who saw it: \n\n# Feedback received\n- " },
    ],
  },
];

// The templates in the order to offer them to this learner: the ones written
// for what they said they are learning for come first, the rest follow in
// their own order. Nobody loses a template by what they answered.
// preferred: template ids that fit what they asked Nova to help with first
// (first-focus.ts, focusTemplateIds); those lead, in that order.
export function templatesFor(contexts: readonly LearningContext[], preferred: readonly string[] = []): StudyTemplate[] {
  const fits = (t: StudyTemplate) => t.audiences.some(a => contexts.includes(a));
  const lead = preferred.map(id => STUDY_TEMPLATES.find(t => t.id === id)).filter((t): t is StudyTemplate => t !== undefined);
  const rest = STUDY_TEMPLATES.filter(t => !lead.includes(t));
  return [...lead, ...rest.filter(fits), ...rest.filter(t => !fits(t))];
}

export const templateById = (id: string): StudyTemplate | null => STUDY_TEMPLATES.find(t => t.id === id) ?? null;

// The key a template's task is created under. The same template applied
// again produces the same keys, so the task writer returns what exists.
export const templateTaskKey = (templateId: string, taskKey: string): string => `template:${templateId}:${taskKey}`;

// ─── Note templates ───────────────────────────────────────────────────────────
// Starting text for a new note, in the same shape as the study templates:
// pure data, who each was written for, and the same ordering rule. Choosing
// one fills the editor; nothing is saved until the learner saves. A template
// states nothing about what the learner knows: its headings are empty.
//
// Bodies use what the note reader draws: "# " headings, "- " lists and
// [[links]] to other notes.

export interface NoteTemplate {
  id:          string;
  name:        string;
  description: string;
  audiences:   LearningContext[];
  body:        string;
}

export const NOTE_TEMPLATES: NoteTemplate[] = [
  {
    id: "concept", audiences: ["school", "college", "working", "other"],
    name: "Concept",
    description: "One idea in your own words, with an example and what it connects to.",
    body: "# In my own words\n\n\n# An example\n\n\n# How it connects\n- Builds on [[ ]]\n- Used in [[ ]]\n\n# Still unclear\n- ",
  },
  {
    id: "source", audiences: ["school", "college", "working", "other"],
    name: "Source notes",
    description: "Notes on one article, video, chapter or talk, kept apart from what you think of it.",
    body: "Source: \n\n# What it says\n- \n\n# What I think\n- \n\n# Worth linking to\n- [[ ]]",
  },
  {
    id: "class", audiences: ["school", "college"],
    name: "Class notes",
    description: "What was covered in one class or lecture, and what to do about it.",
    body: "# Covered today\n- \n\n# Key points\n- \n\n# Questions to ask\n- \n\n# To do\n- ",
  },
  {
    id: "chapter", audiences: ["school"],
    name: "Chapter summary",
    description: "One chapter in short: the main points, the words to know, and questions to test yourself.",
    body: "# Main points\n- \n\n# Words to know\n- \n\n# Questions to test myself\n- ",
  },
  {
    id: "doubts", audiences: ["school", "college"],
    name: "Doubts and mistakes",
    description: "What went wrong in practice, why, and what to remember next time.",
    body: "# The question\n\n\n# What I did\n\n\n# What went wrong\n\n\n# Next time\n- ",
  },
  {
    id: "decision", audiences: ["working", "other"],
    name: "Decision",
    description: "A choice you made while learning or building, and why, so you can come back to it.",
    body: "# The decision\n\n\n# Options I looked at\n- \n\n# Why this one\n- \n\n# Revisit when\n- ",
  },
  {
    id: "learning-log", audiences: ["working", "other", "college"],
    name: "Learning log",
    description: "A short entry after working on a skill or project: what you did and what comes next.",
    body: "# What I worked on\n- \n\n# What I learned\n- \n\n# Stuck on\n- \n\n# Next step\n- ",
  },
];

// The note templates in the order to offer them: the ones written for what
// the learner said they are learning for first. Nobody loses one.
export function noteTemplatesFor(contexts: readonly LearningContext[]): NoteTemplate[] {
  const fits = (t: NoteTemplate) => t.audiences.some(a => contexts.includes(a));
  return [...NOTE_TEMPLATES.filter(fits), ...NOTE_TEMPLATES.filter(t => !fits(t))];
}
