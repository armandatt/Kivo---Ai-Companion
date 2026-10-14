// ─── Learning context ─────────────────────────────────────────────────────────
// What a learner is learning for: school, college, work, or something else.
// It is a hint they give and can change, and they may give more than one: a
// college student preparing for placements is both.
//
// It changes words, the order setup asks things in, and which starting
// points are offered first. It changes no decision: the same planner, the
// same learner record and the same rules run for everyone, and nothing here
// is read by an engine.
//
// Pure, no imports, so the web app reads it directly.

export const LEARNING_CONTEXTS = ["school", "college", "working", "other"] as const;
export type LearningContext = (typeof LEARNING_CONTEXTS)[number];

export const LEARNING_CONTEXT_LABEL: Record<LearningContext, { label: string; hint: string }> = {
  school:  { label: "School",                hint: "subjects, chapters, tests and exams" },
  college: { label: "College or university", hint: "courses, assignments, projects and exams" },
  working: { label: "Work or career",        hint: "a skill, a project, a certification or an interview" },
  other:   { label: "Something else",        hint: "anything you are teaching yourself" },
};

// A list of contexts as stored: each one known, none twice, in the fixed
// order above. null: not a list of contexts at all, and nothing is kept of it.
export function normalizeLearningContexts(value: unknown): LearningContext[] | null {
  if (!Array.isArray(value) || value.length > LEARNING_CONTEXTS.length * 2) return null;
  const known = new Set<string>(LEARNING_CONTEXTS);
  if (value.some(v => typeof v !== "string" || !known.has(v))) return null;
  return LEARNING_CONTEXTS.filter(c => value.includes(c));
}

// Which set of words fits. Somebody at school or college and also learning
// for work gets the words that assume neither.
export type VocabularyKind = "general" | "school" | "college" | "outcome";

export function vocabularyKind(contexts: readonly LearningContext[]): VocabularyKind {
  const academic = contexts.includes("school") || contexts.includes("college");
  const outcome  = contexts.includes("working") || contexts.includes("other");
  if (academic && outcome) return "general";
  if (contexts.includes("college")) return "college";
  if (contexts.includes("school")) return "school";
  if (outcome) return "outcome";
  return "general";
}

export interface SetupVocabulary {
  kind:             VocabularyKind;
  // The setup form.
  areasHeading:     string;
  areaLabel:        string;      // names one row, for a screen reader
  areaPlaceholder:  string;
  partsLabel:       string;
  partsPlaceholder: string;
  addArea:          string;
  datesHeading:     string;
  dateAreaLabel:    string;
  dateLabel:        string;
  addDate:          string;
  dailyQuestion:    string;
  timeQuestion:     string;
  // What a date is called when the learner gave it no name.
  dateTitleSuffix:  string;
  // What Nova asks for in chat, one thing at a time.
  questions: {
    subjects:      string;
    topics:        (subject: string) => string;
    exams:         string;
    daily_minutes: string;
    study_time:    string;
  };
}

// The wording setup had before a learner could say what they are learning
// for. It is what a learner with no context on record is still asked in chat.
const ACADEMIC_QUESTIONS: SetupVocabulary["questions"] = {
  subjects:      "Which subjects are you taking this term?",
  topics:        subject => `What does ${subject} cover this term? List the topics or chapters, in any order.`,
  exams:         "Any exam or deadline dates yet? Tell me the subject and the day.",
  daily_minutes: "How long do you usually have to study on a normal day?",
  study_time:    "When do you usually study: morning, afternoon, evening or night?",
};

// For a learner who has not said what they are learning for, or who is both
// studying and working: nothing here assumes a term, a course or a school.
const GENERAL_QUESTIONS: SetupVocabulary["questions"] = {
  ...ACADEMIC_QUESTIONS,
  subjects: "What are you learning? Name your subjects, or a skill or project.",
  topics:   subject => `What does ${subject} cover? List the topics or parts, in any order.`,
};

const VOCABULARY: Record<VocabularyKind, SetupVocabulary> = {
  general: {
    kind: "general",
    areasHeading:     "What you're learning, and what each part covers",
    areaLabel:        "Subject or skill",
    areaPlaceholder:  "A subject or a skill, e.g. Operating Systems, or Public speaking",
    partsLabel:       "Topics",
    partsPlaceholder: "Topics or parts, one per line or separated by commas. Paste an outline if you have one.",
    addArea:          "Add another",
    datesHeading:     "Exams and deadlines",
    dateAreaLabel:    "What the date is for",
    dateLabel:        "Date",
    addDate:          "Add a date",
    dailyQuestion:    "How long do you usually have on a normal day?",
    timeQuestion:     "When do you usually study?",
    dateTitleSuffix:  "exam",
    questions:        GENERAL_QUESTIONS,
  },
  school: {
    kind: "school",
    areasHeading:     "Your subjects, and the chapters in each",
    areaLabel:        "Subject",
    areaPlaceholder:  "Subject, e.g. Science",
    partsLabel:       "Chapters",
    partsPlaceholder: "Chapters, one per line or separated by commas. Copy them from your textbook's contents page or your syllabus.",
    addArea:          "Add a subject",
    datesHeading:     "Tests and exams",
    dateAreaLabel:    "Test or exam subject",
    dateLabel:        "Test or exam date",
    addDate:          "Add a test or exam date",
    dailyQuestion:    "How long do you usually have for study on a normal day, after school and tuition?",
    timeQuestion:     "When do you usually study?",
    dateTitleSuffix:  "exam",
    questions: {
      subjects:      "Which subjects are you studying? Start with the one you need most help with.",
      topics:        subject => `Which chapters does ${subject} cover? List them in any order.`,
      exams:         "Any test or exam dates yet? Tell me the subject and the day.",
      daily_minutes: "How long do you usually have for study on a normal day, after school and tuition?",
      study_time:    "When do you usually study: morning, afternoon, evening or night?",
    },
  },
  college: {
    kind: "college",
    areasHeading:     "Your subjects, and what each covers",
    areaLabel:        "Subject",
    areaPlaceholder:  "A course, or something you are preparing for, e.g. Operating Systems, or Placement prep",
    partsLabel:       "Topics",
    partsPlaceholder: "Topics or units, one per line or separated by commas. Paste your syllabus if you have it.",
    addArea:          "Add a subject",
    datesHeading:     "Exams and deadlines",
    dateAreaLabel:    "Exam subject",
    dateLabel:        "Exam date",
    addDate:          "Add an exam date",
    dailyQuestion:    "How long do you usually have on a normal day?",
    timeQuestion:     "When do you usually study?",
    dateTitleSuffix:  "exam",
    questions: {
      ...ACADEMIC_QUESTIONS,
      subjects: "Which subjects are you taking this term? Add anything you are preparing for alongside them, like placements or a project.",
    },
  },
  // Nothing here names a school, a term, a syllabus or an exam: someone
  // learning for work is asked what they want and how much time they have.
  outcome: {
    kind: "outcome",
    areasHeading:     "What you want to learn, and the parts of it",
    areaLabel:        "Skill or project",
    areaPlaceholder:  "What you want to learn or build, e.g. System design, or A portfolio site",
    partsLabel:       "Parts",
    partsPlaceholder: "The parts you want to cover, one per line or separated by commas. A rough list is enough; you can change it later.",
    addArea:          "Add another",
    datesHeading:     "A date you are working toward",
    dateAreaLabel:    "What the date is for",
    dateLabel:        "Target date",
    addDate:          "Add a date",
    dailyQuestion:    "How long can you usually give it on a normal day?",
    timeQuestion:     "When do you usually get to it?",
    dateTitleSuffix:  "target date",
    questions: {
      subjects:      "What do you want to learn or get done? Name the skill or the project.",
      topics:        subject => `What does ${subject} involve? List the parts you want to cover, in any order.`,
      exams:         "Is there a date you are working toward? Tell me what it is for and the day.",
      daily_minutes: "How long can you usually give it on a normal day?",
      study_time:    "When do you usually get to it: morning, afternoon, evening or night?",
    },
  },
};

export const setupVocabulary = (contexts: readonly LearningContext[]): SetupVocabulary => VOCABULARY[vocabularyKind(contexts)];

// The one line Nova's model is given about this, or null when the learner has
// not said. It says what they told Nova and nothing it has concluded.
export function learningContextLine(contexts: readonly LearningContext[]): string | null {
  if (contexts.length === 0) return null;
  const said = contexts.map(c => ({
    school: "school", college: "college or university", working: "work or their career", other: "their own interest",
  })[c]);
  const list = said.length === 1 ? said[0]! : `${said.slice(0, -1).join(", ")} and ${said[said.length - 1]!}`;
  const academic = contexts.includes("school") || contexts.includes("college");
  return academic
    ? `Learning for: ${list} (their own answer).`
    : `Learning for: ${list} (their own answer). They have not said they are at school or college: do not assume classes, a syllabus, a term or exams.`;
}
