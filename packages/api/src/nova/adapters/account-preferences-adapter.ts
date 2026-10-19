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
