// ─── Completing web onboarding, once ──────────────────────────────────────────
// The onboarding route's one write. It stores the answers only while the
// account has not finished onboarding, as one conditional write, so a
// refresh, a retry or a second tab cannot write them twice: of two requests
// at once, exactly one completes it, and the other is told it is done.

import { prisma } from "@repo/db/client";
import { matchMentor, type MentorMatch } from "../../personality/mentor-compatibility";
import { buildOnboardingSchedulePayload } from "../../services/mentorIntake.service";
import { goalFromFirstFocus } from "./first-focus";
import { ONBOARDING_VERSION, type OnboardingAnswersV2 } from "./onboarding-answers";

export type CompletionOutcome = "completed" | "already_complete";

export async function completeOnboardingOnce(userId: string, profileData: Record<string, unknown>): Promise<CompletionOutcome> {
  const existing = await prisma.userProfile.findUnique({ where: { userId }, select: { onboardingComplete: true } });
  if (existing?.onboardingComplete) return "already_complete";
  if (existing) {
    const written = await prisma.userProfile.updateMany({ where: { userId, onboardingComplete: false }, data: profileData });
    return written.count === 1 ? "completed" : "already_complete";
  }
  try {
    await prisma.userProfile.create({ data: { userId, secondaryDomains: [], ...profileData } as never });
    return "completed";
  } catch (error) {
    // Another request made the profile first: it completed onboarding.
    if ((error as { code?: string } | null)?.code === "P2002") return "already_complete";
    throw error;
  }
}

const PERSONA_DESCRIPTIONS: Record<string, string> = {
  REX:  "No excuses. Just results.",
  NOVA: "Steady. Structured. Always here.",
  ZEN:  "Slow down. Go further.",
};

// The v2 answers as profile columns. Only what something reads is written:
// see onboarding-answers.ts for each answer's use.
export function profileFromAnswers(answers: OnboardingAnswersV2, timezone: string | undefined) {
  const match: MentorMatch = matchMentor({ domain: "study", accountabilityStyle: answers.accountabilityStyle });
  const personaName = match.mentorId.toUpperCase();
  const goal = goalFromFirstFocus(answers.firstFocus, answers.audience);
  const profileData = {
    primaryPersona:      match.mentorId,
    tone:                answers.accountabilityStyle,
    toneModifier:        match.toneModifier,
    energyPattern:       null,
    corePain:            null,
    primaryGoal30d:      goal,
    goalCategory:        "study",
    accountabilityStyle: answers.accountabilityStyle,
    aspirationWords:     [] as string[],
    personaName,
    personaDescription:  PERSONA_DESCRIPTIONS[personaName] ?? PERSONA_DESCRIPTIONS.NOVA!,
    creatureType:        null,
    creatureColor:       null,
    creatureName:        answers.companionName,
    timezone:            timezone ?? null,
    mentorDomain:        "study",
    onboardingComplete:  true,
    // The canonical answers Nova reads (account-preferences-adapter.ts). The
    // preference answers are not here: they are an assessment row.
    onboardingAnswers:   {
      version:          ONBOARDING_VERSION,
      learningContexts: [answers.audience],
      firstFocus:       answers.firstFocus,
    },
    ...buildOnboardingSchedulePayload({ energyPattern: null, preferredCheckInTime: null }),
  };
  return { profileData, match };
}
