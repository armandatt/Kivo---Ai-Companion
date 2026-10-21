// ─── Web onboarding (v3): the options and how each answer is checked ──────────
// What the onboarding page offers and the server accepts, as data. The page
// renders from it and the route checks against it, so the two can never
// disagree about what an answer may be.
//
//   working on   → onboardingAnswers.workingOn   (ids + their own entries)
//   weekly time  → onboardingAnswers.weeklyHours (a number of hours)
//   obstacles    → onboardingAnswers.obstacles   (ids + their own entries)
//   language     → onboardingAnswers.language    (english / hindi / hinglish)
//   tone         → onboardingAnswers.tone        (product/tone.ts)
//   telegram     → onboardingAnswers.telegram    (yes / no: an intention only)
//
// What reads each one is in onboarding-answers.ts. Custom entries are the
// learner's own: kept on their account and offered to nobody else.
//
// Pure, no imports beyond other pure modules, so the web app uses it directly.

import type { Audience } from "./first-focus";
import type { FirstFocusId } from "./first-focus";

// ── Their own entries ─────────────────────────────────────────────────────────

export const CUSTOM_ENTRY_MAX = 60;     // characters in one entry
export const CUSTOM_ENTRIES_MAX = 5;    // entries on one question

// Whitespace and control characters collapsed to single spaces, trimmed.
export function oneLine(text: string): string {
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
}

const sameEntry = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase();

export type CustomEntryCheck =
  | { ok: true; entry: string }
  | { ok: false; reason: "empty" | "too_long" | "duplicate" | "too_many" };

// One entry typed in the page, against the ones already there (and the
// labels of the fixed options, so "Learning a new skill" typed out is the
// option, not a second copy of it).
export function checkCustomEntry(raw: string, existing: readonly string[], labels: readonly string[] = []): CustomEntryCheck {
  const entry = oneLine(raw);
  if (!entry) return { ok: false, reason: "empty" };
  if ([...entry].length > CUSTOM_ENTRY_MAX) return { ok: false, reason: "too_long" };
  if (existing.some(e => sameEntry(e, entry)) || labels.some(l => sameEntry(l, entry))) return { ok: false, reason: "duplicate" };
  if (existing.length >= CUSTOM_ENTRIES_MAX) return { ok: false, reason: "too_many" };
  return { ok: true, entry };
}

export const CUSTOM_ENTRY_MESSAGE: Record<Exclude<CustomEntryCheck, { ok: true }>["reason"], string> = {
  empty:     "Type something first.",
  too_long:  `Keep it to ${CUSTOM_ENTRY_MAX} characters.`,
  duplicate: "That one is already on the list.",
  too_many:  `You can add up to ${CUSTOM_ENTRIES_MAX} of your own.`,
};

// ── A multi-select answer: fixed ids plus their own entries ───────────────────

export interface MultiAnswer<Id extends string> {
  selected: Id[];
  custom:   string[];
}

export type MultiCheck<Id extends string> =
  | { ok: true; value: MultiAnswer<Id> }
  | { ok: false; reason: "empty" | "unknown" | "bad_entry" };

// What the browser sent, checked on its own. Known ids once each, in the
// order of the list; entries one line each, distinct, within the limits.
// An entry that breaks a limit refuses the answer: nothing is cut to fit.
export function checkMultiAnswer<Id extends string>(
  value: unknown, ids: readonly Id[], labels: readonly string[], opts: { required: boolean },
): MultiCheck<Id> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, reason: "unknown" };
  const raw = value as { selected?: unknown; custom?: unknown };
  const selectedRaw = raw.selected ?? [];
  const customRaw = raw.custom ?? [];
  if (!Array.isArray(selectedRaw) || !Array.isArray(customRaw)) return { ok: false, reason: "unknown" };
  if (selectedRaw.length > ids.length || customRaw.length > CUSTOM_ENTRIES_MAX) return { ok: false, reason: "bad_entry" };
  if (selectedRaw.some(s => typeof s !== "string" || !(ids as readonly string[]).includes(s))) return { ok: false, reason: "unknown" };
  const selected = ids.filter(id => selectedRaw.includes(id));
  const custom: string[] = [];
  for (const entry of customRaw) {
    if (typeof entry !== "string") return { ok: false, reason: "bad_entry" };
    const checked = checkCustomEntry(entry, custom, labels);
    if (!checked.ok) {
      // A repeat of one already given, or of an option, is the same answer.
      if (checked.reason === "duplicate") continue;
      return { ok: false, reason: "bad_entry" };
    }
    custom.push(checked.entry);
  }
  if (opts.required && selected.length === 0 && custom.length === 0) return { ok: false, reason: "empty" };
  return { ok: true, value: { selected, custom } };
}

// A stored answer read back. Anything unreadable is "not said".
export function readMultiAnswer<Id extends string>(value: unknown, ids: readonly Id[], labels: readonly string[]): MultiAnswer<Id> | null {
  const checked = checkMultiAnswer(value, ids, labels, { required: true });
  return checked.ok ? checked.value : null;
}

// ── 2. What are you currently working on? ─────────────────────────────────────

export const WORKING_ON = [
  "startup", "semester_exams", "school_exams", "competitive_exams", "coursework",
  "new_skill", "project_portfolio", "interviews", "work_goals", "habits",
] as const;
export type WorkingOnId = (typeof WORKING_ON)[number];

export const WORKING_ON_LABEL: Record<WorkingOnId, string> = {
  startup:           "Building a startup or business",
  semester_exams:    "Preparing for semester exams",
  school_exams:      "Preparing for school exams",
  competitive_exams: "Preparing for competitive exams",
  coursework:        "Completing assignments or coursework",
  new_skill:         "Learning a new skill",
  project_portfolio: "Building a project or portfolio",
  interviews:        "Preparing for interviews or placements",
  work_goals:        "Managing work and professional goals",
  habits:            "Improving my habits and personal goals",
};

// The most likely first for each audience. Every option is still offered:
// the order changes, never what can be chosen.
const WORKING_ON_ORDER: Record<Audience, readonly WorkingOnId[]> = {
  school:  ["school_exams", "competitive_exams", "coursework", "new_skill", "habits", "project_portfolio", "startup", "semester_exams", "interviews", "work_goals"],
  college: ["semester_exams", "coursework", "interviews", "project_portfolio", "new_skill", "competitive_exams", "startup", "habits", "work_goals", "school_exams"],
  working: ["work_goals", "new_skill", "startup", "project_portfolio", "interviews", "competitive_exams", "habits", "coursework", "semester_exams", "school_exams"],
};

export function workingOnOptions(audience: Audience | null): Array<{ id: WorkingOnId; label: string }> {
  return (audience ? WORKING_ON_ORDER[audience] : WORKING_ON).map(id => ({ id, label: WORKING_ON_LABEL[id] }));
}

export const WORKING_ON_LABELS: readonly string[] = WORKING_ON.map(id => WORKING_ON_LABEL[id]);

// The older single answer (product/first-focus.ts) this list stands in for,
// so the setup page's templates and its one "where to start" card follow
// the first thing chosen. Their own entry names no kind of work: none.
const FOCUS_OF: Record<WorkingOnId, FirstFocusId> = {
  startup:           "assignments",
  semester_exams:    "exam",
  school_exams:      "exam",
  competitive_exams: "exam",
  coursework:        "assignments",
  new_skill:         "skill",
  project_portfolio: "assignments",
  interviews:        "exam",
  work_goals:        "organize",
  habits:            "habit",
};

export function focusOfWorkingOn(answer: MultiAnswer<WorkingOnId> | null): FirstFocusId | null {
  const first = answer?.selected[0];
  return first ? FOCUS_OF[first] : null;
}

// What Nova's model is told: what they said they are working on, as context.
// None of it is a task, a goal or a deadline.
export function workingOnLine(answer: MultiAnswer<WorkingOnId> | null): string | null {
  if (!answer) return null;
  const items = [...answer.selected.map(id => WORKING_ON_LABEL[id].toLowerCase()), ...answer.custom.map(c => `"${c}"`)];
  if (items.length === 0) return null;
  return `Working on (their own answer at sign-up; context for suggestions, not tasks or deadlines): ${items.join("; ")}.`;
}

// ── 3. How much time each week ────────────────────────────────────────────────
// A range is stored as one number of hours a week, its middle, so every
// reader has the same figure. The learner's own figure is stored as given.

export const WEEKLY_HOURS_MAX = 80;
export const WEEKLY_PRESETS = [
  { id: "under_3",  label: "Under 3 hours",      hours: 2 },
  { id: "3_5",      label: "3–5 hours",          hours: 4 },
  { id: "6_10",     label: "6–10 hours",         hours: 8 },
  { id: "11_20",    label: "11–20 hours",        hours: 15 },
  { id: "21_30",    label: "21–30 hours",        hours: 25 },
  { id: "over_30",  label: "More than 30 hours", hours: 35 },
] as const;
export type WeeklyPresetId = (typeof WEEKLY_PRESETS)[number]["id"];

export interface WeeklyHours {
  hours:  number;                       // 0 to WEEKLY_HOURS_MAX, one decimal
  preset: WeeklyPresetId | "custom";
}

export type WeeklyHoursCheck = { ok: true; value: WeeklyHours } | { ok: false; message: string };

// "7.5", "7,5" and 7.5 are the same; "-2" is -2 (refused as negative by the
// check, with that reason); "", "abc", "1e9", "Infinity" are not numbers.
export function parseHours(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  // One leading minus, then an ordinary figure.
  if (trimmed.startsWith("-")) {
    const rest = trimmed.slice(1);
    const value = rest.startsWith("-") ? null : parseHours(rest);
    return value === null ? null : -value;
  }
  const text = trimmed.split(",").join(".");
  if (!text || text.length > 6) return null;
  let dots = 0;
  for (const ch of text) {
    if (ch === ".") dots++;
    else if (ch < "0" || ch > "9") return null;
  }
  if (dots > 1 || text === ".") return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

export function checkWeeklyHours(value: unknown): WeeklyHoursCheck {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, message: "Choose how much time you have each week." };
  const raw = value as { preset?: unknown; hours?: unknown };
  const preset = WEEKLY_PRESETS.find(p => p.id === raw.preset);
  if (preset) return { ok: true, value: { hours: preset.hours, preset: preset.id } };
  if (raw.preset !== "custom") return { ok: false, message: "Choose how much time you have each week." };
  const hours = parseHours(raw.hours);
  if (hours === null) return { ok: false, message: "Enter a number of hours, like 6 or 7.5." };
  if (hours < 0) return { ok: false, message: "Hours can't be negative." };
  if (hours > WEEKLY_HOURS_MAX) return { ok: false, message: `Enter ${WEEKLY_HOURS_MAX} hours or fewer.` };
  return { ok: true, value: { hours: Math.round(hours * 10) / 10, preset: "custom" } };
}

export function readWeeklyHours(value: unknown): WeeklyHours | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as { preset?: unknown; hours?: unknown };
  const checked = checkWeeklyHours(raw.preset === "custom" ? raw : { preset: raw.preset });
  return checked.ok ? checked.value : null;
}

// The usual day this gives the planner: the week spread over seven days,
// to five minutes. null under ten minutes a day: too little to plan a block
// around, so planning says it is assuming instead of planning nothing.
export const MIN_PLANNED_DAY = 10;
export function dailyMinutesFromWeekly(weekly: WeeklyHours | null): number | null {
  if (!weekly) return null;
  const daily = Math.round((weekly.hours * 60) / 7 / 5) * 5;
  return daily >= MIN_PLANNED_DAY ? daily : null;
}

const hoursText = (h: number) => `${h} hour${h === 1 ? "" : "s"}`;

export function weeklyHoursLabel(weekly: WeeklyHours): string {
  const preset = WEEKLY_PRESETS.find(p => p.id === weekly.preset);
  return preset ? preset.label.toLowerCase() : hoursText(weekly.hours);
}

export function weeklyHoursLine(weekly: WeeklyHours | null): string | null {
  if (!weekly) return null;
  return `Time they said they can realistically give each week: about ${weeklyHoursLabel(weekly)} (their estimate at sign-up, not a commitment; never hold them to it or comment on it being low).`;
}

// ── 4. What gets in the way ───────────────────────────────────────────────────
// Each answer names a kind of help that may suit them. A suggestion for the
// wording, never a rule: no reminder, task or message follows from it.

export const OBSTACLES = [
  "discipline", "consistency", "procrastination", "distraction", "prioritizing", "overwhelmed",
  "time_management", "understanding", "deadlines", "finishing", "motivation", "balance", "not_sure",
] as const;
export type ObstacleId = (typeof OBSTACLES)[number];

export const OBSTACLE: Record<ObstacleId, { label: string; help: string | null }> = {
  discipline:      { label: "Staying disciplined",                       help: "be clear and steady about the one thing to do next" },
  consistency:     { label: "Being consistent",                          help: "suggest a manageable routine; check-ins only if they ask for them" },
  procrastination: { label: "Procrastination or getting started",        help: "make the first step small enough to start now; a focus session is an option, not a demand" },
  distraction:     { label: "Getting distracted",                        help: "suggest short, single-topic blocks" },
  prioritizing:    { label: "Not knowing what to prioritize",            help: "say clearly what comes first and why" },
  overwhelmed:     { label: "Feeling overwhelmed by too much to do",     help: "narrow it to one next step; do not hand over long lists" },
  time_management: { label: "Managing time",                             help: "keep suggestions inside the time they have" },
  understanding:   { label: "Understanding difficult concepts",          help: "explain clearly, check understanding, build up step by step" },
  deadlines:       { label: "Remembering deadlines and important dates", help: "when a date comes up, point them to adding it to their calendar or dates" },
  finishing:       { label: "Finishing what I start",                    help: "help them close out what is open before starting something new" },
  motivation:      { label: "Losing motivation",                         help: "connect the next step to what they are working toward" },
  balance:         { label: "Balancing work, study, and personal life",  help: "respect their other commitments; do not pile on" },
  not_sure:        { label: "I am not sure yet",                         help: null },
};

export const OBSTACLE_LABELS: readonly string[] = OBSTACLES.map(id => OBSTACLE[id].label);

// "Not sure" is an answer of its own: chosen with others, the others say more.
export function withoutNotSure(answer: MultiAnswer<ObstacleId>): MultiAnswer<ObstacleId> {
  if (!answer.selected.includes("not_sure")) return answer;
  const rest = answer.selected.filter(id => id !== "not_sure");
  return rest.length > 0 || answer.custom.length > 0 ? { ...answer, selected: rest } : answer;
}

export const OBSTACLES_HEADER =
  "What they said usually makes progress hard (their own answer at sign-up). These are suggestions for how to help, " +
  "used only when they fit this message; never assume they need all of them, never mention this list, " +
  "and never set reminders or send messages because of it:";

export function obstacleLines(answer: MultiAnswer<ObstacleId> | null): string[] {
  if (!answer) return [];
  const lines = answer.selected.flatMap(id => {
    const help = OBSTACLE[id].help;
    return help ? [`${OBSTACLE[id].label}: ${help}.`] : [];
  });
  for (const entry of answer.custom) lines.push(`In their words: "${entry}".`);
  return lines;
}

// ── 7. Telegram ───────────────────────────────────────────────────────────────
// An intention, not a connection. Whether a chat is linked is only ever
// UserProfile.telegramConnected, set by the linking flow when Telegram says so.

export const TELEGRAM_ANSWERS = ["yes", "no"] as const;
export type TelegramAnswer = (typeof TELEGRAM_ANSWERS)[number];
