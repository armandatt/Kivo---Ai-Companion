// ─── First focus: what the learner wants Nova's help with first ───────────────
// The second onboarding question. One concrete thing, chosen from a short list
// (with an optional sentence of their own), instead of a broad life goal.
//
// What it changes, and nothing else:
//   • the order setup offers its starting templates (templatesFor)
//   • the one "where to start" step the setup page shows (firstStepFor)
//   • one line in Nova's context, as the learner's own answer (firstFocusLine)
//   • the sign-up goal it seeds, once, into NovaAcademicProfile.goals
//     (onboarding writes it on the web account; goals.ts copies it)
// It is read by no engine and no decision: the plan, the Decision Graph and
// every gate are the same whatever was chosen.
//
// Kept with the other onboarding answers at UserProfile.onboardingAnswers.
// firstFocus; there is no column. adapters/account-preferences-adapter.ts is
// the one reader in Nova; onboarding and Settings are the only writers.
//
// Pure, and imports only companion.ts (itself pure), so the web app reads it
// directly.

import { BOARD_PATH } from "./companion";

export const FIRST_FOCUS = ["understand", "exam", "habit", "skill", "assignments", "organize", "other"] as const;
export type FirstFocusId = (typeof FIRST_FOCUS)[number];

// The audience answer (onboarding's first question). The same values as the
// learning contexts it is stored as, minus "other", which onboarding no
// longer offers.
export const AUDIENCES = ["school", "college", "working"] as const;
export type Audience = (typeof AUDIENCES)[number];

export const AUDIENCE_LABEL: Record<Audience, { label: string; hint: string }> = {
  school:  { label: "School student",             hint: "Subjects, chapters, tests and board exams." },
  college: { label: "University student",         hint: "Courses, assignments, projects and semester exams." },
  working: { label: "Working professional",       hint: "A skill, a certification, an interview or a work project." },
};

export const FIRST_FOCUS_DETAIL_MAX = 140;

export interface FirstFocus {
  id:     FirstFocusId;
  // Their own words, when they gave any. Required for "other".
  detail: string | null;
}

type Worded = { label: string; hint: string };

// The wording follows the audience; the id does not. Someone who has not
// said who they are gets the general words.
const GENERAL: Record<FirstFocusId, Worded> = {
  understand:  { label: "Understand a subject or difficult concept", hint: "Get unstuck on something that isn't clicking." },
  exam:        { label: "Prepare for an exam or assessment",         hint: "Plan the days before a date that matters." },
  habit:       { label: "Build a consistent study habit",            hint: "Show up a little every day." },
  skill:       { label: "Learn a new skill",                         hint: "Go from zero to useful, step by step." },
  assignments: { label: "Complete assignments or projects",          hint: "Break work into steps and finish on time." },
  organize:    { label: "Organize my workload and deadlines",        hint: "See everything due in one place." },
  other:       { label: "Something else",                            hint: "Tell Nova in a sentence." },
};

const BY_AUDIENCE: Record<Audience, Partial<Record<FirstFocusId, Worded>>> = {
  school: {
    exam:        { label: "Prepare for a test or exam",   hint: "Unit tests, finals or board exams." },
    assignments: { label: "Finish homework or a project", hint: "Break it into steps and hand it in on time." },
  },
  college: {},
  working: {
    understand:  { label: "Understand a topic or difficult concept",  hint: "Get unstuck on something that isn't clicking." },
    exam:        { label: "Prepare for a certification or interview", hint: "Plan the days before a date that matters." },
    habit:       { label: "Build a consistent learning habit",        hint: "A little every day, around work." },
    assignments: { label: "Finish a work or side project",            hint: "Break it into steps and ship it." },
  },
};

export function firstFocusWording(id: FirstFocusId, audience: Audience | null): Worded {
  return (audience ? BY_AUDIENCE[audience][id] : undefined) ?? GENERAL[id];
}

// Every option, in the order shown, worded for this audience.
export function firstFocusOptions(audience: Audience | null): Array<{ id: FirstFocusId } & Worded> {
  return FIRST_FOCUS.map(id => ({ id, ...firstFocusWording(id, audience) }));
}

// The audience among stored learning contexts: exactly one of the three, or
// none (an older answer may hold several, or "other").
export function audienceOf(contexts: readonly string[]): Audience | null {
  const known = AUDIENCES.filter(a => contexts.includes(a));
  return known.length === 1 ? known[0]! : null;
}

// Collapses runs of whitespace and control characters to one space.
const oneLine = (text: string): string => {
  let out = "";
  let gap = false;
  for (const ch of text) {
    const blank = ch.trim() === "" || ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127;
    if (blank) { gap = out.length > 0; continue; }
    if (gap) out += " ";
    out += ch;
    gap = false;
  }
  return out;
};

export type FirstFocusCheck =
  | { ok: true; value: FirstFocus }
  | { ok: false; reason: "unknown" | "detail_required" | "detail_too_long" };

// What the browser sent, checked. A detail longer than the limit is refused,
// not cut: the learner sees why and shortens it.
export function checkFirstFocus(value: unknown): FirstFocusCheck {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, reason: "unknown" };
  const raw = value as { id?: unknown; detail?: unknown };
  if (typeof raw.id !== "string" || !(FIRST_FOCUS as readonly string[]).includes(raw.id)) return { ok: false, reason: "unknown" };
  const id = raw.id as FirstFocusId;
  const detail = typeof raw.detail === "string" ? oneLine(raw.detail) : "";
  if (detail.length > FIRST_FOCUS_DETAIL_MAX) return { ok: false, reason: "detail_too_long" };
  if (id === "other" && !detail) return { ok: false, reason: "detail_required" };
  return { ok: true, value: { id, detail: detail || null } };
}

// A stored answer read back. Anything unreadable is "not said".
export function normalizeFirstFocus(value: unknown): FirstFocus | null {
  const checked = checkFirstFocus(value);
  return checked.ok ? checked.value : null;
}

// The sign-up goal this answer makes: their own sentence when they wrote one,
// with the option it belongs to; otherwise the option they picked. It is a
// statement of intent and is copied once (goals.ts, seedGoalFromSignup).
export function goalFromFirstFocus(focus: FirstFocus, audience: Audience | null): string {
  const label = firstFocusWording(focus.id, audience).label;
  if (!focus.detail) return label;
  return focus.id === "other" ? focus.detail : `${label}: ${focus.detail}`;
}

// What Nova's model is told, or null when the learner has not said. Their
// answer, and nothing Nova has concluded from it.
export function firstFocusLine(focus: FirstFocus | null): string | null {
  if (!focus) return null;
  const said = focus.id === "other" ? "something of their own (see their goals)" : GENERAL[focus.id].label.toLowerCase();
  return `First asked Nova to help with: ${said} (their own answer at sign-up; what they ask now comes first).`;
}

// Which starting templates (product/templates.ts ids) fit this answer best,
// most fitting first. Empty: no template is about it.
export function focusTemplateIds(focus: FirstFocus | null, audience: Audience | null): string[] {
  if (!focus) return [];
  switch (focus.id) {
    case "exam":        return audience === "working" ? ["certification", "interview-preparation"] : ["exam-preparation"];
    case "skill":       return ["skill-building"];
    case "assignments": return ["project-sprint"];
    case "organize":    return audience === "school" ? ["school-subjects"] : audience === "college" ? ["semester-subjects"] : [];
    default:            return [];
  }
}

// The one place the setup page suggests starting. Each points at a page that
// exists; none of them writes anything.
export interface FirstStep { title: string; body: string; href: string; action: string }

export function firstStepFor(focus: FirstFocus | null): FirstStep | null {
  if (!focus) return null;
  switch (focus.id) {
    case "exam":
      return { title: "Start with the date", body: "Add the exam below with its subject and topics. Nova plans the days before it from what is not solid yet.", href: "#setup-dates", action: "Add the date" };
    case "organize":
      return { title: "Start with your calendar", body: "Put your deadlines and classes on the calendar. Tasks with a due day and exam dates show up there too.", href: "/calendar", action: "Open the calendar" };
    case "assignments":
      return { title: "Start with the work itself", body: "Add the subject and its parts below, then break the assignment into tasks on the Board in Today.", href: BOARD_PATH, action: "Open the board" };
    case "habit":
      return { title: "Start small", body: "Add one subject and the time you usually have. Nova keeps each day's plan inside that time.", href: "#setup-routine", action: "Set your usual time" };
    case "skill":
      return { title: "Start with what you want to learn", body: "Name the skill and list its parts below. A rough list is enough; Nova starts with the first one.", href: "#setup-subjects", action: "Add the skill" };
    case "understand":
      return { title: "Start with the topic", body: "Add the subject and the topic that isn't clicking. Then ask Nova about it from Today.", href: "#setup-subjects", action: "Add the topic" };
    case "other":
      return null;
  }
}
