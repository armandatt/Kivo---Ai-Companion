// ─── Finding a template, and deciding what to do with a request ───────────────
// Two jobs, both pure:
//
//   the library   search (the learner's own typing: a text match over names,
//                 purposes and categories) and recommendation (who they said
//                 they are; every template stays open to everyone).
//
//   a request     "Create with Nova" and chat. The model reads the request
//                 once into a CreationIntent (workspace-generation.ts); code
//                 decides from it, by the outcome each template is for, never
//                 by words the request and a template happen to share:
//
//                   not_creation  a question or a remark: nothing is made
//                   clarify       a creation request too vague to act on:
//                                 one question back, nothing is made
//                   use           a template fits as it is: it is applied to
//                                 what the request gave (name, date), no
//                                 further model call
//                   adapt         a template fits the kind of work, but the
//                                 request or the files need it filled in:
//                                 Nova writes the plan with the template as
//                                 its base
//                   custom        no template is for this: Nova writes it
//
// A decision is a proposal. Nothing is created until the learner has seen
// the plan and pressed Create (workspaces.ts).

import {
  CATEGORY_INFO, STUDY_TEMPLATES, TEMPLATE_CATEGORIES, TEMPLATE_OUTCOMES,
  type StudyTemplate, type TemplateCategory, type TemplateOutcome,
} from "./templates";
import { oneLine, isIsoDay } from "./workspace-plan";

// ── The library ───────────────────────────────────────────────────────────────

export function templatesIn(category: TemplateCategory, subcategory?: string): StudyTemplate[] {
  return STUDY_TEMPLATES.filter(t => t.placements.some(p => p.category === category && (!subcategory || p.subcategory === subcategory)));
}

const words = (text: string) => {
  const out: string[] = [];
  let w = "";
  for (const ch of text.toLowerCase()) {
    if ((ch >= "a" && ch <= "z") || (ch >= "0" && ch <= "9")) w += ch;
    else { if (w) out.push(w); w = ""; }
  }
  if (w) out.push(w);
  return out;
};

// The learner's typing in the search box: every word they typed must start a
// word of the template's name, purpose, description, what it creates, or a
// place it is listed. Best matches (name hits) first.
export function searchTemplates(query: string, pool: readonly StudyTemplate[] = STUDY_TEMPLATES): StudyTemplate[] {
  const asked = words(query);
  if (asked.length === 0) return [...pool];
  const scored = pool.map(t => {
    const place = t.placements.flatMap(p => [CATEGORY_INFO[p.category].label, CATEGORY_INFO[p.category].subcategories[p.subcategory] ?? ""]);
    const all = words([t.name, t.purpose, t.description, ...t.creates, ...place].join(" "));
    const name = words(t.name);
    if (!asked.every(a => all.some(w => w.startsWith(a)))) return null;
    return { t, score: asked.filter(a => name.some(w => w.startsWith(a))).length };
  }).filter((x): x is { t: StudyTemplate; score: number } => x !== null);
  return scored.sort((a, b) => b.score - a.score).map(x => x.t);
}

// Which category to open first, from what the learner said they do and are
// working on. Only an order: every category stays one tap away.
export function recommendedCategory(contexts: readonly string[], workingOn: readonly string[] = []): TemplateCategory {
  if (workingOn.includes("competitive_exams")) return "competitive";
  if (contexts.includes("working") && !contexts.includes("college")) return "professional";
  if (contexts.includes("school") && !contexts.includes("college")) return "competitive";
  return "college";
}

// Templates to suggest first: those whose outcome matches what they said
// they are working on, then the recommended category's.
const OUTCOMES_OF_WORK: Record<string, TemplateOutcome[]> = {
  startup: ["project"], semester_exams: ["semester", "exam"], school_exams: ["school", "exam"],
  competitive_exams: ["competitive_exam", "revision"], coursework: ["semester", "project"], new_skill: ["skill"],
  project_portfolio: ["project"], interviews: ["interview"], work_goals: ["work_projects", "career_growth"], habits: [],
};
export function recommendedTemplates(contexts: readonly string[], workingOn: readonly string[] = [], max = 4): StudyTemplate[] {
  // In the order they listed what they are working on.
  const first: StudyTemplate[] = [];
  for (const outcome of workingOn.flatMap(w => OUTCOMES_OF_WORK[w] ?? [])) {
    for (const t of STUDY_TEMPLATES) if (t.outcome === outcome && !first.includes(t)) first.push(t);
  }
  const fits = templatesIn(recommendedCategory(contexts, workingOn)).filter(t => !first.includes(t));
  return [...first, ...fits].slice(0, max);
}

// ── A request ─────────────────────────────────────────────────────────────────

export interface CreationIntent {
  // Does the learner ask for something to be set up (a plan, a syllabus, a
  // workspace), rather than ask a question or chat?
  creating:     boolean;
  // What kind of work it is: one of the template outcomes, "other" for a
  // kind no template is for, or null when the request does not say.
  outcome:      TemplateOutcome | "other" | null;
  // The thing itself: the exam, skill, role, course or project, in their words.
  subject:      string | null;
  date:         string | null;     // a day the request names (YYYY-MM-DD)
  hoursPerWeek: number | null;
  experience:   "new" | "some" | "experienced" | null;
  // The request names specifics a template's stock structure does not hold
  // (a particular syllabus, a curriculum, a stack, a list of chapters).
  specific:     boolean;
  // One short question when it is a creation request that cannot be acted on.
  question:     string | null;
}

export const NOT_CREATING: CreationIntent = { creating: false, outcome: null, subject: null, date: null, hoursPerWeek: null, experience: null, specific: false, question: null };

// The model's reading, checked. Anything malformed reads as "not creating":
// a misread request makes nothing.
export function parseCreationIntent(raw: string): CreationIntent {
  const start = raw.indexOf("{"), end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return NOT_CREATING;
  let r: Record<string, unknown>;
  try { r = JSON.parse(raw.slice(start, end + 1)); } catch { return NOT_CREATING; }
  if (!r || typeof r !== "object") return NOT_CREATING;
  const outcome = r.outcome === "other" ? "other" : TEMPLATE_OUTCOMES.find(o => o === r.outcome) ?? null;
  const hours = typeof r.hoursPerWeek === "number" && Number.isFinite(r.hoursPerWeek) && r.hoursPerWeek > 0 && r.hoursPerWeek <= 80 ? r.hoursPerWeek : null;
  return {
    creating: r.creating === true,
    outcome,
    subject: oneLine(r.subject, 80) || null,
    date: isIsoDay(r.date) ? r.date : null,
    hoursPerWeek: hours,
    experience: r.experience === "new" || r.experience === "some" || r.experience === "experienced" ? r.experience : null,
    specific: r.specific === true,
    question: oneLine(r.question, 200) || null,
  };
}

export type RouteDecision =
  | { action: "not_creation" }
  | { action: "clarify"; question: string }
  | { action: "use"; template: StudyTemplate; reason: string }
  | { action: "adapt"; template: StudyTemplate; reason: string }
  | { action: "custom"; reason: string };

// Templates written for this outcome whose own stock topics stand on their
// own (a semester, a project) can be used as they are; those that are empty
// until the syllabus or skill is known need filling in.
const NEEDS_CONTENT: ReadonlySet<TemplateOutcome> = new Set(["skill", "competitive_exam", "certification", "exam", "interview"]);

export function routeRequest(intent: CreationIntent, opts: { hasFiles: boolean; category?: TemplateCategory | null }): RouteDecision {
  if (!intent.creating) return { action: "not_creation" };
  if (intent.outcome === null && !intent.subject && !opts.hasFiles) {
    return { action: "clarify", question: intent.question ?? "What should the workspace be for: a course, an exam, a skill, or your work?" };
  }
  const candidates = intent.outcome && intent.outcome !== "other" ? STUDY_TEMPLATES.filter(t => t.outcome === intent.outcome) : [];
  if (candidates.length === 0) {
    return { action: "custom", reason: intent.outcome === "other" || intent.outcome === null ? "No template is made for this, so Nova will build one." : "No template fits this, so Nova will build one." };
  }
  // Of several for the same outcome, the one listed where the learner is looking.
  const template = candidates.find(t => opts.category && t.placements.some(p => p.category === opts.category)) ?? candidates[0]!;
  const needsName = template.subjects[0]?.name === "";
  if (needsName && !intent.subject) {
    return { action: "clarify", question: intent.question ?? `${template.namePrompt ?? "What is it for?"}` };
  }
  if (opts.hasFiles || intent.specific || NEEDS_CONTENT.has(template.outcome)) {
    return { action: "adapt", template, reason: opts.hasFiles ? `Built on the ${template.name} template, filled in from your files.` : `Built on the ${template.name} template, filled in for ${intent.subject ?? "your request"}.` };
  }
  return { action: "use", template, reason: `The ${template.name} template fits this as it is.` };
}

export const ALL_CATEGORIES = TEMPLATE_CATEGORIES;
