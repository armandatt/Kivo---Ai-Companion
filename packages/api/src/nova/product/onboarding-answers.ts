// ─── Web onboarding: what the quiz sends, checked ─────────────────────────────
// v3 (the current page) is checkOnboardingV3, at the end of this file. v2 is
// kept below, unchanged, for a page loaded before v3 shipped: the server
// still accepts it, through the same once-only write.
//
// v2 had five steps, each kept because something read its answer:
//
//   1. audience       → learningContexts (vocabulary, templates, a context line)
//   2. first focus    → template order, the setup page's first step, a context
//                       line, and the sign-up goal seeded into Nova's goals
//   3. accountability → UserProfile.accountabilityStyle (register: wording tone)
//      style (3 q.)   → PersonalityAssessment kivo-style-v2 (wording lines)
//   4. companion name → UserProfile.creatureName (a display name only)
//
// The browser's timezone travels with it unasked (the proactive tick and
// every "today" need one). Nothing else is accepted.
//
// Pure: imports only other pure modules, so the web app can use it.

import { AUDIENCES, checkFirstFocus, type Audience, type FirstFocus } from "./first-focus";
import { validateStyleAnswers, type StyleAnswers } from "../../personality/style-items";
import {
  OBSTACLES, OBSTACLE_LABELS, TELEGRAM_ANSWERS, WORKING_ON, WORKING_ON_LABELS, checkMultiAnswer, checkWeeklyHours, withoutNotSure,
  type MultiAnswer, type ObstacleId, type TelegramAnswer, type WeeklyHours, type WorkingOnId,
} from "./onboarding-options";
import { isTone, type Tone } from "./tone";
import { REPLY_LANGUAGES, type ReplyLanguage } from "../types/understanding.types";

export const ONBOARDING_VERSION = 2;
export const DEFAULT_COMPANION_NAME = "Nova";
export const COMPANION_NAME_MAX = 30;

export interface OnboardingAnswersV2 {
  audience:            Audience;
  firstFocus:          FirstFocus;
  accountabilityStyle: "soft" | "hard";
  style:               StyleAnswers;
  // What the learner calls their companion. A display name: the companion is
  // Nova whatever it is called, and no identity is keyed by it.
  companionName:       string;
}

export type OnboardingField = "audience" | "firstFocus" | "accountabilityStyle" | "style" | "companionName";
export type OnboardingCheck =
  | { ok: true; answers: OnboardingAnswersV2 }
  | { ok: false; field: OnboardingField; message: string };

// Whitespace and control characters collapsed to single spaces.
function oneLine(text: string): string {
  return [...text].map(ch => (ch.trim() === "" || ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? " " : ch))
    .join("").split(" ").filter(Boolean).join(" ");
}

// Empty means the default; anything else is kept as typed, on one line.
export function checkCompanionName(value: unknown): { ok: true; name: string } | { ok: false; message: string } {
  if (value === undefined || value === null) return { ok: true, name: DEFAULT_COMPANION_NAME };
  if (typeof value !== "string") return { ok: false, message: "The name should be text." };
  const name = oneLine(value);
  if (!name) return { ok: true, name: DEFAULT_COMPANION_NAME };
  if ([...name].length > COMPANION_NAME_MAX) return { ok: false, message: `Keep the name to ${COMPANION_NAME_MAX} characters or fewer.` };
  return { ok: true, name };
}

export function isOnboardingV2(body: unknown): boolean {
  return !!body && typeof body === "object" && (body as { version?: unknown }).version === ONBOARDING_VERSION;
}

export function checkOnboardingV2(body: unknown): OnboardingCheck {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, field: "audience", message: "Nothing to save." };
  const raw = body as Record<string, unknown>;

  if (typeof raw.audience !== "string" || !(AUDIENCES as readonly string[]).includes(raw.audience)) {
    return { ok: false, field: "audience", message: "Choose what best describes you." };
  }
  const focus = checkFirstFocus(raw.firstFocus);
  if (!focus.ok) {
    const message = focus.reason === "detail_required" ? "Tell Nova in a few words what you'd like help with."
      : focus.reason === "detail_too_long" ? "Keep that to a sentence."
      : "Choose what you'd like help with first.";
    return { ok: false, field: "firstFocus", message };
  }
  if (raw.accountabilityStyle !== "soft" && raw.accountabilityStyle !== "hard") {
    return { ok: false, field: "accountabilityStyle", message: "Choose how Nova should respond when you fall behind." };
  }
  const style = validateStyleAnswers(raw.style);
  if (!style.ok) return { ok: false, field: "style", message: "Answer each of the questions about how you like to be helped." };
  const name = checkCompanionName(raw.companionName);
  if (!name.ok) return { ok: false, field: "companionName", message: name.message };

  return {
    ok: true,
    answers: {
      audience:            raw.audience as Audience,
      firstFocus:          focus.value,
      accountabilityStyle: raw.accountabilityStyle,
      style:               style.answers,
      companionName:       name.name,
    },
  };
}

// ─── v3 ───────────────────────────────────────────────────────────────────────
// Nine answers, each with a reader (onboarding-options.ts has the lists):
//
//   0. nickname     → onboardingAnswers.nickname (optional): what Nova calls
//                     them, wherever it speaks (account-preferences-adapter.ts)
//   1. audience     → onboardingAnswers.learningContexts: vocabulary, the
//                     order of templates and options, one context line
//   2. working on   → onboardingAnswers.workingOn: the setup page's templates
//                     and first step, one line in Nova's student context
//   3. weekly hours → onboardingAnswers.weeklyHours: the usual day a new Nova
//                     profile starts with (NovaAcademicProfile.dailyStudyMinutes,
//                     the planner's limit), one context line
//   4. obstacles    → onboardingAnswers.obstacles: a support section in Nova's
//                     context, for the kinds of message it fits
//   5. language     → onboardingAnswers.language: the language Nova speaks
//                     when the message itself does not say (interaction/language.ts)
//   6. tone         → onboardingAnswers.tone (+ accountabilityStyle kept in
//                     step): the register line (decision/register.ts)
//   7. telegram     → onboardingAnswers.telegram: whether the finish screen
//                     offers the linking flow. Never a connection.
//   8. creature     → UserProfile.creatureName: the creature's display name.
//                     Nova stays Nova.
//
// No creature colour, appearance, check-in time or personality questions.

export const ONBOARDING_V3 = 3;
// What Nova calls them, if they say (optional). Kept as typed, on one line.
export const NICKNAME_MAX = 40;
export function checkNickname(value: unknown): { ok: true; nickname: string | null } | { ok: false; message: string } {
  if (value === undefined || value === null) return { ok: true, nickname: null };
  if (typeof value !== "string") return { ok: false, message: "The name should be text." };
  const name = oneLine(value);
  if (!name) return { ok: true, nickname: null };
  if ([...name].length > NICKNAME_MAX) return { ok: false, message: `Keep it to ${NICKNAME_MAX} characters or fewer.` };
  if (name.includes("://") || name.includes("www.")) return { ok: false, message: "That looks like a link, not a name." };
  return { ok: true, nickname: name };
}
export const DEFAULT_CREATURE_NAME = "Kivo";
export const CREATURE_NAME_MAX = 30;

// Empty means the default; anything else is kept as typed, on one line.
export function checkCreatureName(value: unknown): { ok: true; name: string } | { ok: false; message: string } {
  if (value === undefined || value === null) return { ok: true, name: DEFAULT_CREATURE_NAME };
  if (typeof value !== "string") return { ok: false, message: "The name should be text." };
  const name = oneLine(value);
  if (!name) return { ok: true, name: DEFAULT_CREATURE_NAME };
  if ([...name].length > CREATURE_NAME_MAX) return { ok: false, message: `Keep the name to ${CREATURE_NAME_MAX} characters or fewer.` };
  return { ok: true, name };
}

export interface OnboardingAnswersV3 {
  // What Nova calls them; null: their account name.
  nickname:     string | null;
  audience:     Audience;
  workingOn:    MultiAnswer<WorkingOnId>;
  weeklyHours:  WeeklyHours;
  obstacles:    MultiAnswer<ObstacleId>;
  language:     ReplyLanguage;
  tone:         Tone;
  telegram:     TelegramAnswer;
  creatureName: string;
}

// In the order asked, so the page can send the learner back to the first
// answer that needs fixing.
export const V3_FIELDS = ["nickname", "audience", "workingOn", "weeklyHours", "obstacles", "language", "tone", "telegram", "creatureName"] as const;
export type OnboardingFieldV3 = (typeof V3_FIELDS)[number];

export type OnboardingCheckV3 =
  | { ok: true; answers: OnboardingAnswersV3 }
  | { ok: false; field: OnboardingFieldV3; message: string };

export function isOnboardingV3(body: unknown): boolean {
  return !!body && typeof body === "object" && (body as { version?: unknown }).version === ONBOARDING_V3;
}

const MULTI_MESSAGE = { empty: "Choose at least one, or add your own.", unknown: "Choose from the list, or add your own.", bad_entry: "Check the ones you added: each should be one short line." };

export function checkOnboardingV3(body: unknown): OnboardingCheckV3 {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, field: "audience", message: "Nothing to save." };
  const raw = body as Record<string, unknown>;

  const nickname = checkNickname(raw.nickname);
  if (!nickname.ok) return { ok: false, field: "nickname", message: nickname.message };
  if (typeof raw.audience !== "string" || !(AUDIENCES as readonly string[]).includes(raw.audience)) {
    return { ok: false, field: "audience", message: "Choose what you currently do." };
  }
  const workingOn = checkMultiAnswer(raw.workingOn, WORKING_ON, WORKING_ON_LABELS, { required: true });
  if (!workingOn.ok) return { ok: false, field: "workingOn", message: MULTI_MESSAGE[workingOn.reason] };
  const weekly = checkWeeklyHours(raw.weeklyHours);
  if (!weekly.ok) return { ok: false, field: "weeklyHours", message: weekly.message };
  const obstacles = checkMultiAnswer(raw.obstacles, OBSTACLES, OBSTACLE_LABELS, { required: true });
  if (!obstacles.ok) return { ok: false, field: "obstacles", message: MULTI_MESSAGE[obstacles.reason] };
  const language = REPLY_LANGUAGES.find(l => l === raw.language);
  if (!language) return { ok: false, field: "language", message: "Choose the language Nova should speak." };
  if (!isTone(raw.tone)) return { ok: false, field: "tone", message: "Choose how Nova should talk to you." };
  const telegram = TELEGRAM_ANSWERS.find(t => t === raw.telegram);
  if (!telegram) return { ok: false, field: "telegram", message: "Say whether you use Telegram." };
  const name = checkCreatureName(raw.creatureName);
  if (!name.ok) return { ok: false, field: "creatureName", message: name.message };

  return {
    ok: true,
    answers: {
      nickname:     nickname.nickname,
      audience:     raw.audience as Audience,
      workingOn:    workingOn.value,
      weeklyHours:  weekly.value,
      obstacles:    withoutNotSure(obstacles.value),
      language,
      tone:         raw.tone,
      telegram,
      creatureName: name.name,
    },
  };
}
