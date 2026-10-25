// ─── Account preferences adapter ──────────────────────────────────────────────
// What the learner chose in web onboarding and Settings that Nova needs: the
// daily check-in time, the timezone their browser reported, what they said
// they are learning for, and what they asked Nova to help with first. All
// live on the web account (UserProfile), which is where onboarding and
// Settings write them; this is the one place Nova reads them. Read-only,
// apart from adopting the account's timezone for a learner who has none.
//
// What they are learning for is one of their onboarding answers and is kept
// with them (UserProfile.onboardingAnswers.learningContexts). There is no
// column for it; LEARNING_CONTEXTS_KEY is the one name for where it sits.
//
// The account is found the way every other reader finds it: by the chat the
// learner linked, or by "web:<userId>" before they have linked one.

import { prisma } from "@repo/db/client";
import { currentZoneName, isValidTimezone } from "../engines/learner-calendar";
import { parseCheckinTime } from "../decision/proactive-decision";
import { normalizeLearningContexts, type LearningContext } from "../product/learning-context";
import { normalizeFirstFocus, type FirstFocus } from "../product/first-focus";
import {
  OBSTACLES, OBSTACLE_LABELS, WORKING_ON, WORKING_ON_LABELS, dailyMinutesFromWeekly, focusOfWorkingOn, readMultiAnswer, readWeeklyHours,
  type MultiAnswer, type ObstacleId, type WeeklyHours, type WorkingOnId,
} from "../product/onboarding-options";
import { isTone, toneOfAccountability, type Tone } from "../product/tone";
import { normalizeAccountability } from "../../personality/mentor-compatibility";
import { REPLY_LANGUAGES, type ReplyLanguage } from "../types/understanding.types";

export const LEARNING_CONTEXTS_KEY = "learningContexts";
// What they asked Nova to help with first (product/first-focus.ts), kept
// beside the contexts in the same onboarding answers.
export const FIRST_FOCUS_KEY = "firstFocus";

// The contexts in a stored onboarding answer. Anything unreadable is "not said".
export function learningContextsIn(onboardingAnswers: unknown): LearningContext[] {
  if (!onboardingAnswers || typeof onboardingAnswers !== "object" || Array.isArray(onboardingAnswers)) return [];
  return normalizeLearningContexts((onboardingAnswers as Record<string, unknown>)[LEARNING_CONTEXTS_KEY]) ?? [];
}

// Their first-focus answer, or null when it is missing or unreadable.
export function firstFocusIn(onboardingAnswers: unknown): FirstFocus | null {
  if (!onboardingAnswers || typeof onboardingAnswers !== "object" || Array.isArray(onboardingAnswers)) return null;
  return normalizeFirstFocus((onboardingAnswers as Record<string, unknown>)[FIRST_FOCUS_KEY]);
}

// ── The v3 answers (product/onboarding-options.ts) ────────────────────────────
// Each is kept under its own key in the same onboarding answers, and each is
// read back on its own: one that is missing or unreadable is "not said" and
// changes nothing about the others.
export const ANSWER_KEYS = {
  workingOn: "workingOn", weeklyHours: "weeklyHours", obstacles: "obstacles",
  language: "language", tone: "tone", telegram: "telegram", preferredName: "preferredName",
} as const;

const answersObject = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

export interface SignupAnswers {
  workingOn:   MultiAnswer<WorkingOnId> | null;
  weeklyHours: WeeklyHours | null;
  obstacles:   MultiAnswer<ObstacleId> | null;
  // The language they asked Nova to speak. null: not said.
  language:    ReplyLanguage | null;
  // Their chosen tone, or the one their older soft/hard answer stands for.
  tone:        Tone | null;
  // What they asked Nova to call them. null: not said.
  preferredName?: string | null;
}

export function signupAnswersIn(onboardingAnswers: unknown, accountabilityStyle: string | null = null): SignupAnswers {
  const a = answersObject(onboardingAnswers) ?? {};
  const language = REPLY_LANGUAGES.find(l => l === a[ANSWER_KEYS.language]) ?? null;
  const tone = a[ANSWER_KEYS.tone];
  return {
    workingOn:   readMultiAnswer(a[ANSWER_KEYS.workingOn], WORKING_ON, WORKING_ON_LABELS),
    weeklyHours: readWeeklyHours(a[ANSWER_KEYS.weeklyHours]),
    obstacles:   readMultiAnswer(a[ANSWER_KEYS.obstacles], OBSTACLES, OBSTACLE_LABELS),
    language,
    tone:        isTone(tone) ? tone : toneOfAccountability(normalizeAccountability(accountabilityStyle) as "soft" | "hard" | null),
    preferredName: preferredNameIn(a[ANSWER_KEYS.preferredName]),
  };
}

// A stored name, read the way it was checked: one line, not too long.
function preferredNameIn(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let out = "", gap = false;
  for (const ch of value) {
    if (ch.trim() === "" || ch.charCodeAt(0) < 32) { gap = out.length > 0; continue; }
    if (gap) out += " ";
    out += ch; gap = false;
  }
  return out && [...out].length <= 40 ? out : null;
}

// For the setup page: what they asked for first, or, after v3, the kind of
// work the first thing they said they are working on stands for.
export function setupFocusIn(onboardingAnswers: unknown): FirstFocus | null {
  const stated = firstFocusIn(onboardingAnswers);
  if (stated) return stated;
  const id = focusOfWorkingOn(signupAnswersIn(onboardingAnswers).workingOn);
  return id ? { id, detail: null } : null;
}

const accountOf = (learnerId: string): { userId: string } | { telegramChatId: string } =>
  learnerId.startsWith("web:") ? { userId: learnerId.slice(4) } : { telegramChatId: learnerId };

export interface AccountPreferences {
  // Minutes after local midnight. null: no usable time was chosen.
  checkinMinute: number | null;
  // "HH:MM", for showing back to the learner. null with checkinMinute.
  checkinTime:   string | null;
  // A real IANA zone, or null.
  timezone:      string | null;
  // What they said they are learning for. Empty: they have not said.
  learningContexts: LearningContext[];
}

const NONE: AccountPreferences = { checkinMinute: null, checkinTime: null, timezone: null, learningContexts: [] };

const two = (n: number) => String(n).padStart(2, "0");

export async function loadAccountPreferences(platformChatId: string): Promise<AccountPreferences> {
  const account = await prisma.userProfile.findFirst({
    where:  accountOf(platformChatId),
    select: { preferredCheckInTime: true, timezone: true, onboardingAnswers: true },
  }).catch(() => null);
  if (!account) return NONE;
  const minute = parseCheckinTime(account.preferredCheckInTime);
  const zone   = account.timezone && isValidTimezone(account.timezone) ? currentZoneName(account.timezone) : null;
  return {
    checkinMinute: minute,
    checkinTime:   minute === null ? null : `${two(Math.floor(minute / 60))}:${two(minute % 60)}`,
    timezone:      zone,
    learningContexts: learningContextsIn(account.onboardingAnswers),
  };
}

// Only what they said they are learning for, for callers that need nothing else.
export async function loadLearningContexts(platformChatId: string): Promise<LearningContext[]> {
  const account = await prisma.userProfile.findFirst({
    where:  accountOf(platformChatId),
    select: { onboardingAnswers: true },
  }).catch(() => null);
  return account ? learningContextsIn(account.onboardingAnswers) : [];
}

// Only what they asked Nova to help with first. null: not said.
export async function loadFirstFocus(platformChatId: string): Promise<FirstFocus | null> {
  const account = await prisma.userProfile.findFirst({
    where:  accountOf(platformChatId),
    select: { onboardingAnswers: true },
  }).catch(() => null);
  return account ? firstFocusIn(account.onboardingAnswers) : null;
}

// The same, for the setup page's templates and first step (setupFocusIn).
export async function loadSetupFocus(platformChatId: string): Promise<FirstFocus | null> {
  try {
    const account = await prisma.userProfile.findFirst({ where: accountOf(platformChatId), select: { onboardingAnswers: true } });
    return account ? setupFocusIn(account.onboardingAnswers) : null;
  } catch {
    return null;
  }
}

// Every v3 answer. Never throws: unreadable, the learner has said nothing.
export async function loadSignupAnswers(platformChatId: string): Promise<SignupAnswers> {
  let account: { onboardingAnswers: unknown; accountabilityStyle: string | null } | null = null;
  try {
    account = await prisma.userProfile.findFirst({
      where:  accountOf(platformChatId),
      select: { onboardingAnswers: true, accountabilityStyle: true },
    });
  } catch {
    account = null;
  }
  return signupAnswersIn(account?.onboardingAnswers ?? null, account?.accountabilityStyle ?? null);
}

// Only how Nova speaks to them: the language and tone they chose.
export async function loadVoicePreferences(platformChatId: string): Promise<{ language: ReplyLanguage | null; tone: Tone | null }> {
  const { language, tone } = await loadSignupAnswers(platformChatId);
  return { language, tone };
}

// The usual day a brand-new Nova profile starts with: the weekly time they
// gave at sign-up spread over the week (onboarding-options.ts). For the
// `create` half of the upserts that make the profile, and for nothing else,
// as with the sign-up goal: a profile that exists keeps what it has.
export async function seedDailyMinutesFromSignup(platformChatId: string): Promise<number | null> {
  return dailyMinutesFromWeekly((await loadSignupAnswers(platformChatId)).weeklyHours);
}

// The two columns a usual day is kept in, for a profile being made. Nothing
// stated: neither is given, and the profile says "not said".
export function dailyColumns(minutes: number | null): { dailyStudyMinutes?: number; preferredStudyHoursPerDay?: number } {
  if (minutes === null) return {};
  return { dailyStudyMinutes: minutes, preferredStudyHoursPerDay: Math.round((minutes / 60) * 100) / 100 };
}

// The learner's timezone. Nova's own record first; if it has none, the zone
// their browser reported when they signed up, which is then kept on the study
// profile so every reader of their days agrees. null: nobody has told Nova,
// and it will not guess (so it will not message them first).
export async function ensureLearnerTimezone(
  profile:        { id: string; timezone: string | null },
  platformChatId: string,
  account?:       AccountPreferences,
): Promise<string | null> {
  if (profile.timezone && isValidTimezone(profile.timezone)) return profile.timezone;
  const zone = (account ?? await loadAccountPreferences(platformChatId)).timezone;
  if (!zone) return null;
  // Only while still unset (or unusable): a zone the learner's device has
  // since reported is never replaced by this.
  await prisma.novaAcademicProfile.updateMany({
    where: { id: profile.id, OR: [{ timezone: null }, { timezone: profile.timezone }] },
    data:  { timezone: zone },
  });
  const stored = await prisma.novaAcademicProfile.findUnique({ where: { id: profile.id }, select: { timezone: true } });
  return stored?.timezone && isValidTimezone(stored.timezone) ? stored.timezone : zone;
}
