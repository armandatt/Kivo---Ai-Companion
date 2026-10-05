// ─── Nova Onboarding Validator ────────────────────────────────────────────────
// Deterministic normalization only. No LLM. No DB.
// Takes raw extraction output → returns clean, DB-safe values.
// Every function here is pure: same input always produces same output.
// Owner: Validator layer.

import type { AcademicExtractedFacts } from "./nova-onboarding-extractor";

// ── Degree normalization ──────────────────────────────────────────────────────

const DEGREE_MAP: Array<[RegExp, string]> = [
  [/^integrated\s*m\.?tech$/i,         "Integrated M.Tech"],
  [/^b\.?tech$/i,                       "B.Tech"],
  [/^b\.?e\.?$/i,                       "B.Tech"],
  [/^m\.?tech$/i,                       "M.Tech"],
  [/^m\.?e\.?$/i,                       "M.Tech"],
  [/^b\.?c\.?a\.?$/i,                   "BCA"],
  [/^m\.?c\.?a\.?$/i,                   "MCA"],
  [/^b\.?sc\.?$/i,                      "B.Sc"],
  [/^m\.?sc\.?$/i,                      "M.Sc"],
  [/^m\.?b\.?a\.?$/i,                   "MBA"],
  [/^ph\.?d\.?$/i,                      "Ph.D"],
  [/^b\.?b\.?a\.?$/i,                   "BBA"],
  [/^b\.?com\.?$/i,                     "B.Com"],
];

export function normalizeDegree(raw: string): string {
  const t = raw.trim();
  for (const [pattern, canonical] of DEGREE_MAP) {
    if (pattern.test(t)) return canonical;
  }
  // Title-case fallback
  return t.replace(/\b\w/g, c => c.toUpperCase());
}

// ── Branch/Major normalization ────────────────────────────────────────────────

const BRANCH_MAP: Array<[RegExp, string]> = [
  [/^(cse|cs|computer\s*science(\s*(and\s*)?engineering)?|computer\s*engg?)$/i, "CSE"],
  [/^(ece|electronics?\s*(and\s*)?(communication\s*)?(engineering)?|e&c)$/i,    "ECE"],
  [/^(eee|electrical\s*(and\s*electronics\s*)?engineering?|electrical)$/i,       "EEE"],
  [/^(me|mech(anical(\s*engineering)?)?)$/i,                                     "ME"],
  [/^(ce|civil(\s*engineering)?)$/i,                                             "CE"],
  [/^(it|information\s*technology)$/i,                                           "IT"],
  [/^(ai|artificial\s*intelligence)$/i,                                          "AI"],
  [/^(ds|data\s*science)$/i,                                                     "DS"],
  [/^(aids?|ai\s*(and|&)\s*ds|artificial\s*intelligence\s*(and|&)\s*data\s*science)$/i, "AIDS"],
  [/^(aiml|ai\s*(and|&)\s*ml|artificial\s*intelligence\s*(and|&)\s*machine\s*learning)$/i, "AIML"],
  [/^(cy|cyber\s*security)$/i,                                                   "CY"],
  [/^(chem(ical)?(\s*engineering)?)$/i,                                          "ChE"],
  [/^(bio(tech(nology)?|medical\s*engineering)?)$/i,                             "BT"],
];

export function normalizeBranch(raw: string): string {
  const t = raw.trim();
  for (const [pattern, canonical] of BRANCH_MAP) {
    if (pattern.test(t)) return canonical;
  }
  return t.toUpperCase();
}

// ── Year of study normalization ───────────────────────────────────────────────
// Accepts number (from extractor) or raw string.
// Semester → year: ceil(sem / 2). Final year defaults to 4 for B.Tech.

export function normalizeYearOfStudy(raw: number | string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") {
    const y = Math.round(raw);
    return y >= 1 && y <= 6 ? y : null;
  }
  const t = String(raw).toLowerCase().trim();
  const numWord: Record<string, number> = {
    first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6,
    "1st": 1, "2nd": 2, "3rd": 3, "4th": 4, "5th": 5, "6th": 6,
  };
  for (const [word, year] of Object.entries(numWord)) {
    if (t.includes(word)) return year;
  }
  if (/final\s*year/i.test(t)) return 4;
  const digit = t.match(/\d+/);
  if (digit) {
    const n = parseInt(digit[0]!, 10);
    if (n >= 1 && n <= 6)   return n;           // year directly
    if (n >= 1 && n <= 12)  return Math.ceil(n / 2); // semester → year
  }
  return null;
}

// ── GPA normalization ─────────────────────────────────────────────────────────
// Handles both 10-point (CGPA) and 4-point (GPA) scales.
// Stores as-is (don't convert between scales — we don't know which scale).

export function normalizeTargetGpa(raw: number | string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const n = typeof raw === "number" ? raw : parseFloat(String(raw));
  if (isNaN(n)) return null;
  if (n > 0 && n <= 10) return Math.round(n * 10) / 10; // one decimal place
  return null;
}

// ── Goals normalization ───────────────────────────────────────────────────────

const GOAL_CANONICAL = new Set([
  "placement", "higher_studies", "competitive_exam",
  "internship", "skill_building", "gpa_improvement", "personal_projects",
]);

export function normalizeGoals(raw: string[]): string[] {
  return raw
    .map(g => g.toLowerCase().trim())
    .filter(g => GOAL_CANONICAL.has(g))
    .filter((g, i, arr) => arr.indexOf(g) === i); // deduplicate
}

// ── Study hours normalization ─────────────────────────────────────────────────

export function normalizeStudyHours(raw: number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (raw <= 0 || raw > 16) return null;
  return Math.round(raw * 2) / 2; // round to nearest 0.5
}

// ── Subject name expansion (common abbreviations) ─────────────────────────────

const SUBJECT_EXPANSION: Record<string, string> = {
  "OS":   "Operating Systems",
  "DBMS": "Database Management Systems",
  "CN":   "Computer Networks",
  "DS":   "Data Structures",
  "ADA":  "Design and Analysis of Algorithms",
  "DAA":  "Design and Analysis of Algorithms",
  "COA":  "Computer Organization and Architecture",
  "TOC":  "Theory of Computation",
  "CD":   "Compiler Design",
  "SE":   "Software Engineering",
  "CC":   "Cloud Computing",
  "ML":   "Machine Learning",
  "DL":   "Deep Learning",
  "CV":   "Computer Vision",
  "NLP":  "Natural Language Processing",
  "AI":   "Artificial Intelligence",
  "HCI":  "Human Computer Interaction",
  "IS":   "Information Security",
  "DC":   "Distributed Computing",
  "CA":   "Computer Architecture",
  "PPL":  "Principles of Programming Languages",
  "M1":   "Mathematics I",
  "M2":   "Mathematics II",
  "M3":   "Mathematics III",
  "M4":   "Mathematics IV",
};

export function expandSubjectName(name: string): string {
  const trimmed = name.trim();
  return SUBJECT_EXPANSION[trimmed.toUpperCase()] ?? trimmed;
}

// ── Institution normalization ─────────────────────────────────────────────────
// Title-case only. No canonical mapping (too many institutions).

export function normalizeInstitution(raw: string): string {
  return raw.trim().replace(/\b\w/g, c => c.toUpperCase());
}

// ── Validate and clean the full extraction ────────────────────────────────────

export interface ValidatedExtraction {
  institution?:              string;
  degree?:                   string;
  major?:                    string;
  yearOfStudy?:              number;
  targetGpa?:                number;
  goals:                     string[];
  subjects:                  Array<{
    name:     string;
    code:     string | null;
    credits:  number | null;
    type:     "core" | "elective" | "lab" | null;
    isWeak:   boolean;
    isStrong: boolean;
  }>;
  exams: Array<{
    title:       string;
    subjectName: string | null;
    examType:    "midterm" | "final" | "quiz" | "assignment" | "other";
    scheduledAt: string | null;
  }>;
  preferredStudyHoursPerDay?: number;
  preferredStudyTime?:       "morning" | "afternoon" | "evening" | "night";
  studyStyle?:               string;
  biggestStruggle?:          string;
  realityFacts: Array<{
    category:    string;
    description: string;
  }>;
}

export function validateExtraction(raw: AcademicExtractedFacts): ValidatedExtraction {
  const out: ValidatedExtraction = {
    goals:       [],
    subjects:    [],
    exams:       [],
    realityFacts: [],
  };

  if (raw.institution) {
    const v = normalizeInstitution(raw.institution);
    if (v.length >= 2) out.institution = v;
  }

  if (raw.degree) {
    const v = normalizeDegree(raw.degree);
    if (v.length >= 2) out.degree = v;
  }

  if (raw.major) {
    const v = normalizeBranch(raw.major);
    if (v.length >= 1) out.major = v;
  }

  const year = normalizeYearOfStudy(raw.yearOfStudy);
  if (year) out.yearOfStudy = year;

  const gpa = normalizeTargetGpa(raw.targetGpa);
  if (gpa) out.targetGpa = gpa;

  out.goals = normalizeGoals(raw.goals ?? []);

  const hours = normalizeStudyHours(raw.preferredStudyHoursPerDay ?? null);
  if (hours) out.preferredStudyHoursPerDay = hours;

  if (raw.preferredStudyTime) out.preferredStudyTime = raw.preferredStudyTime;
  if (raw.studyStyle?.trim())  out.studyStyle      = raw.studyStyle.trim().slice(0, 200);
  if (raw.biggestStruggle?.trim()) out.biggestStruggle = raw.biggestStruggle.trim().slice(0, 300);

  out.subjects = (raw.subjects ?? [])
    .filter(s => s.name && s.name.trim().length >= 2)
    .map(s => ({
      name:     expandSubjectName(s.name),
      code:     s.code?.trim().toUpperCase() ?? null,
      credits:  s.credits && s.credits > 0 ? s.credits : null,
      type:     s.type,
      isWeak:   s.isWeak,
      isStrong: s.isStrong,
    }));

  // Merge weak/strong signals from explicit name arrays
  const weakSet   = new Set((raw.weakSubjectNames   ?? []).map(n => expandSubjectName(n).toLowerCase()));
  const strongSet = new Set((raw.strongSubjectNames ?? []).map(n => expandSubjectName(n).toLowerCase()));
  for (const subj of out.subjects) {
    if (weakSet.has(subj.name.toLowerCase()))   subj.isWeak   = true;
    if (strongSet.has(subj.name.toLowerCase())) subj.isStrong = true;
  }

  out.exams = (raw.exams ?? [])
    .filter(e => e.title?.trim().length >= 2)
    .map(e => ({
      title:       e.title.trim(),
      subjectName: e.subjectName?.trim() ?? null,
      examType:    e.examType,
      scheduledAt: e.scheduledAt,
    }));

  out.realityFacts = (raw.realityFacts ?? [])
    .filter(rf => rf.description?.trim().length >= 4)
    .map(rf => ({
      category:    rf.category,
      description: rf.description.trim().slice(0, 300),
    }));

  return out;
}
