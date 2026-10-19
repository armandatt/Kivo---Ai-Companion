// ─── Web onboarding (v2): what the quiz sends, checked ────────────────────────
// Five steps, each kept because something reads its answer:
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
