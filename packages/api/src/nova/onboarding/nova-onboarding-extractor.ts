// ─── Nova Onboarding Extractor (Understanding Brain) ─────────────────────────
// SKILL.md §Understanding Brain: extracts and classifies. Never expresses.
// Responsibility ends here. No reply. No routing. No completion decisions.
//
// Single gpt-4o-mini call: returns structured extraction of academic facts.
// Confidence, intent, and unknownAspects are passed downstream to the
// Decision Engine (determines what to ask) and Response Brain (writes the reply).
// Owner: Understanding Brain layer. No DB access.

import { generateOpenAIText } from "../../services/openai.service.js";

// ── Shared types ──────────────────────────────────────────────────────────────

export interface SubjectInput {
  name:     string;
  code:     string | null;
  credits:  number | null;
  type:     "core" | "elective" | "lab" | null;
  isWeak:   boolean;
  isStrong: boolean;
}

export interface ExamInput {
  title:       string;
  subjectName: string | null;
  examType:    "midterm" | "final" | "quiz" | "assignment" | "other";
  scheduledAt: string | null;
}

export interface RealityInput {
  category:    "time_constraint" | "work_constraint" | "health_constraint" | "academic_constraint" | "other";
  description: string;
}

export interface AcademicExtractedFacts {
  institution?:               string;
  degree?:                    string;
  major?:                     string;
  yearOfStudy?:               number;
  targetGpa?:                 number;
  goals?:                     string[];
  subjects?:                  SubjectInput[];
  exams?:                     ExamInput[];
  preferredStudyHoursPerDay?: number;
  preferredStudyTime?:        "morning" | "afternoon" | "evening" | "night";
  studyStyle?:                string;
  biggestStruggle?:           string;
  strongSubjectNames?:        string[];
  weakSubjectNames?:          string[];
  realityFacts?:              RealityInput[];
}

// ── Extraction result — facts only, no reply, no routing ─────────────────────

export interface AcademicExtractionResult {
  extracted:      AcademicExtractedFacts;
  confidence:     number;       // 0-1: overall extraction confidence
  intent:         "info" | "question" | "correction" | "offtopic";
  unknownAspects: string[];     // things mentioned but couldn't be parsed (e.g. unrecognised subject)
}

// ── Current profile state passed in (loaded by persistence layer) ─────────────

export interface OnboardingCurrentState {
  institution:               string | null;
  degree:                    string | null;
  major:                     string | null;
  yearOfStudy:               number | null;
  targetGpa:                 number | null;
  goals:                     string[];
  subjectCount:              number;
  subjectNames:              string[];
  hasExams:                  boolean;
  preferredStudyHoursPerDay: number | null;
  preferredStudyTime:        string | null;
  biggestStruggle:           string | null;
}

const FALLBACK: AcademicExtractionResult = {
  extracted:      {},
  confidence:     0.3,
  intent:         "offtopic",
  unknownAspects: [],
};

// ── System prompt ─────────────────────────────────────────────────────────────

function buildSystemPrompt(
  state:   OnboardingCurrentState,
  history: Array<{ role: "user" | "nova"; text: string }>,
): string {
  const known: string[] = [];
  if (state.institution)  known.push(`College: ${state.institution}`);
  if (state.degree)       known.push(`Degree: ${state.degree}`);
  if (state.major)        known.push(`Branch: ${state.major}`);
  if (state.yearOfStudy)  known.push(`Year: ${state.yearOfStudy}`);
  if (state.goals.length) known.push(`Goals: ${state.goals.join(", ")}`);
  if (state.subjectCount) known.push(`Subjects already known: ${state.subjectNames.join(", ")}`);

  const historyText = history.length > 0
    ? history.slice(-8).map(m =>
        `  ${m.role === "user" ? "Student" : "Nova"}: ${m.text.slice(0, 200)}`
      ).join("\n")
    : "  (first message)";

  return `You are the Understanding Brain for Nova — an academic study companion.

TASK: Extract EVERY academic fact from the student message.
Return ONLY valid compact JSON. No markdown. No text outside JSON.

ALREADY KNOWN (do NOT re-extract — skip these fields):
${known.length ? known.map(l => `  ${l}`).join("\n") : "  (nothing yet — first message)"}

RECENT CONVERSATION:
${historyText}

─── JSON SCHEMA (return exactly this) ──────────────────────────────────────────
{
  "extracted": {
    "institution": string | null,
    "degree": string | null,
    "major": string | null,
    "yearOfStudy": number | null,
    "targetGpa": number | null,
    "goals": string[],
    "subjects": [{ "name": string, "code": string | null, "credits": number | null, "type": "core"|"elective"|"lab"|null, "isWeak": boolean, "isStrong": boolean }],
    "exams": [{ "title": string, "subjectName": string | null, "examType": "midterm"|"final"|"quiz"|"assignment"|"other", "scheduledAt": string | null }],
    "preferredStudyHoursPerDay": number | null,
    "preferredStudyTime": "morning"|"afternoon"|"evening"|"night"|null,
    "studyStyle": string | null,
    "biggestStruggle": string | null,
    "strongSubjectNames": string[],
    "weakSubjectNames": string[],
    "realityFacts": [{ "category": "time_constraint"|"work_constraint"|"health_constraint"|"academic_constraint"|"other", "description": string }]
  },
  "confidence": 0.0-1.0,
  "intent": "info"|"question"|"correction"|"offtopic",
  "unknownAspects": string[]
}

─── WHAT confidence MEANS ───────────────────────────────────────────────────────
0.9-1.0: clear, unambiguous academic information
0.7-0.9: probably correct but some ambiguity
0.4-0.7: partial or unclear (e.g. "I have some exams coming up" — no specifics)
0.0-0.4: offtopic or unparseable

─── WHAT unknownAspects CONTAINS ────────────────────────────────────────────────
List things the student mentioned that you couldn't confidently parse.
Examples:
  Student mentions a subject you can't identify → "Subject 'LICS' could not be identified"
  Student mentions an institution that seems misspelled → "Institution unclear: 'Benett'"
  Student says "I have a project due" but no date → "Project deadline — no date given"
Keep each entry under 60 characters.

─── EXTRACTION RULES ────────────────────────────────────────────────────────────
Extract ALL facts, even if mentioned casually. Be aggressive.

yearOfStudy (integer 1–6):
  "2nd year", "second year" → 2
  "3rd sem", "semester 3" → 2  (ceil of sem/2)
  "5th sem" → 3
  "final year" → 4  (for B.Tech / 4-year programs)
  "1st year", "freshman" → 1

degree normalization:
  btech / b.tech / be / b.e. → "B.Tech"
  mtech / m.tech / me / m.e. → "M.Tech"
  bca → "BCA" | mca → "MCA" | bsc → "B.Sc" | mba → "MBA" | phd → "Ph.D"
  integrated mtech → "Integrated M.Tech"

major/branch normalization:
  cse / cs / computer science / computer science engineering → "CSE"
  ece / electronics / electronics and communication → "ECE"
  eee / electrical → "EEE"
  me / mechanical / mech → "ME"
  ce / civil → "CE"
  it / information technology → "IT"
  ai / artificial intelligence → "AI"
  ds / data science → "DS"

goals (canonical values — extract as many as mentioned):
  placements / campus placement / job → "placement"
  higher studies / masters / ms abroad / mtech → "higher_studies"
  gate / cat / competitive exam / jee / upsc → "competitive_exam"
  internship → "internship"
  skill building / learning / coding / projects → "skill_building"
  gpa / cgpa / grades / score → "gpa_improvement"
  startup / side project / personal project → "personal_projects"

subjects:
  Expand abbreviations: OS → "Operating Systems", DBMS → "Database Management Systems",
  CN → "Computer Networks", DS → "Data Structures", ADA/DAA → "Design and Analysis of Algorithms",
  COA → "Computer Organization and Architecture", TOC → "Theory of Computation"
  "weak in OS" → subjects: [{ name: "Operating Systems", isWeak: true }]
  "good at Maths" → subjects: [{ name: "Mathematics", isStrong: true }]
  List any subject name you cannot confidently expand in unknownAspects.

exams:
  "OS exam in 2 weeks" → { title: "OS Exam", subjectName: "Operating Systems", examType: "midterm", scheduledAt: null }
  "finals in December" → { title: "Final Exams", subjectName: null, examType: "final", scheduledAt: null }
  Set scheduledAt = null (relative dates resolved downstream)

realityFacts:
  "part-time job" → work_constraint: "has a part-time job"
  "long commute" → time_constraint: "long daily commute"
  "health issues" → health_constraint: <description>
  "family responsibilities" → time_constraint: "family responsibilities"

preferredStudyHoursPerDay: number (not string)
  "3 hours" → 3.0 | "2-3 hours" → 2.5 | "4+ hours" → 4.0

─── INTENT TYPES ────────────────────────────────────────────────────────────────
info: student sharing academic information (most common)
question: student asking about Nova, onboarding, or how something works
correction: student explicitly correcting a previously stated fact
  ("actually I'm in 3rd year", "no it's ECE not CSE")
offtopic: message unrelated to academic context`.trim();
}

// ── Parse helper ──────────────────────────────────────────────────────────────

function parseExtraction(raw: string): AcademicExtractionResult {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { ...FALLBACK };

  const p = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

  const extracted: AcademicExtractedFacts = {};
  const e = (p["extracted"] ?? {}) as Record<string, unknown>;

  if (typeof e["institution"] === "string" && e["institution"]) extracted.institution = e["institution"];
  if (typeof e["degree"]      === "string" && e["degree"])      extracted.degree      = e["degree"];
  if (typeof e["major"]       === "string" && e["major"])       extracted.major       = e["major"];
  if (typeof e["yearOfStudy"] === "number" && (e["yearOfStudy"] as number) >= 1)
    extracted.yearOfStudy = Math.round(e["yearOfStudy"] as number);
  if (typeof e["targetGpa"] === "number" && (e["targetGpa"] as number) > 0)
    extracted.targetGpa = e["targetGpa"] as number;
  if (typeof e["preferredStudyHoursPerDay"] === "number")
    extracted.preferredStudyHoursPerDay = e["preferredStudyHoursPerDay"] as number;
  if (e["preferredStudyTime"] === "morning" || e["preferredStudyTime"] === "afternoon" ||
      e["preferredStudyTime"] === "evening" || e["preferredStudyTime"] === "night")
    extracted.preferredStudyTime = e["preferredStudyTime"] as "morning" | "afternoon" | "evening" | "night";
  if (typeof e["studyStyle"]      === "string" && e["studyStyle"])      extracted.studyStyle      = e["studyStyle"];
  if (typeof e["biggestStruggle"] === "string" && e["biggestStruggle"]) extracted.biggestStruggle = e["biggestStruggle"];

  if (Array.isArray(e["goals"]))
    extracted.goals = (e["goals"] as unknown[]).filter(g => typeof g === "string") as string[];
  if (Array.isArray(e["strongSubjectNames"]))
    extracted.strongSubjectNames = (e["strongSubjectNames"] as unknown[]).filter(s => typeof s === "string") as string[];
  if (Array.isArray(e["weakSubjectNames"]))
    extracted.weakSubjectNames = (e["weakSubjectNames"] as unknown[]).filter(s => typeof s === "string") as string[];

  if (Array.isArray(e["subjects"])) {
    extracted.subjects = (e["subjects"] as unknown[]).flatMap(s => {
      if (typeof s !== "object" || s === null) return [];
      const sub = s as Record<string, unknown>;
      if (typeof sub["name"] !== "string" || !sub["name"]) return [];
      return [{
        name:     sub["name"],
        code:     typeof sub["code"]    === "string" ? sub["code"]    : null,
        credits:  typeof sub["credits"] === "number" ? sub["credits"] : null,
        type:     (["core","elective","lab"] as const).find(t => t === sub["type"]) ?? null,
        isWeak:   sub["isWeak"]   === true,
        isStrong: sub["isStrong"] === true,
      }] satisfies SubjectInput[];
    });
  }

  if (Array.isArray(e["exams"])) {
    const TYPES = ["midterm","final","quiz","assignment","other"] as const;
    extracted.exams = (e["exams"] as unknown[]).flatMap(ex => {
      if (typeof ex !== "object" || ex === null) return [];
      const exam = ex as Record<string, unknown>;
      if (typeof exam["title"] !== "string" || !exam["title"]) return [];
      return [{
        title:       exam["title"],
        subjectName: typeof exam["subjectName"] === "string" ? exam["subjectName"] : null,
        examType:    TYPES.find(t => t === exam["examType"]) ?? "other",
        scheduledAt: typeof exam["scheduledAt"] === "string" ? exam["scheduledAt"] : null,
      }] satisfies ExamInput[];
    });
  }

  if (Array.isArray(e["realityFacts"])) {
    const CATS = ["time_constraint","work_constraint","health_constraint","academic_constraint","other"] as const;
    extracted.realityFacts = (e["realityFacts"] as unknown[]).flatMap(rf => {
      if (typeof rf !== "object" || rf === null) return [];
      const fact = rf as Record<string, unknown>;
      if (typeof fact["description"] !== "string" || !fact["description"]) return [];
      return [{
        category:    CATS.find(c => c === fact["category"]) ?? "other",
        description: fact["description"],
      }] satisfies RealityInput[];
    });
  }

  const VALID_INTENTS = ["info","question","correction","offtopic"] as const;
  const unknownAspects = Array.isArray(p["unknownAspects"])
    ? (p["unknownAspects"] as unknown[]).filter(u => typeof u === "string") as string[]
    : [];

  return {
    extracted,
    confidence:     typeof p["confidence"] === "number" ? Math.max(0, Math.min(1, p["confidence"] as number)) : 0.7,
    intent:         VALID_INTENTS.find(i => i === p["intent"]) ?? "info",
    unknownAspects,
  };
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function extractAcademicFacts(input: {
  message: string;
  state:   OnboardingCurrentState;
  history: Array<{ role: "user" | "nova"; text: string }>;
}): Promise<AcademicExtractionResult> {
  const { message, state, history } = input;

  try {
    const raw = await generateOpenAIText({
      model:             "gpt-4o-mini",
      maxOutputTokens:   600,
      systemInstruction: buildSystemPrompt(state, history),
      prompt:            `Student: ${message}`,
    });
    return parseExtraction(raw);
  } catch {
    return { ...FALLBACK };
  }
}
