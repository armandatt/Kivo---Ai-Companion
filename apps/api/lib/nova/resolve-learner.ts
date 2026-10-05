// Maps the signed-in web account to its Nova learner.
//
// There is one Nova per person. The web account links to a Telegram chat
// (UserProfile.telegramChatId), and that chat's MessengerUser owns all Nova
// state. The web app never creates a second learner.

import { prisma } from "@repo/db/client"
import { getSession } from "../auth/session"

export type LearnerResolution =
  | { kind: "unauthenticated" }
  | { kind: "not_nova" }
  | { kind: "not_connected" }
  | { kind: "learner"; userId: string; name: string | null; platformChatId: string; onboardingDone: boolean }

export async function resolveNovaLearner(): Promise<LearnerResolution> {
  const session = await getSession()
  if (!session) return { kind: "unauthenticated" }

  const profile = await prisma.userProfile.findUnique({
    where:  { userId: session.userId },
    select: { primaryPersona: true, telegramChatId: true },
  })
  if (!profile?.telegramChatId) {
    // Without a linked chat the only signal is the persona chosen on the web.
    return profile?.primaryPersona && profile.primaryPersona !== "nova"
      ? { kind: "not_nova" }
      : { kind: "not_connected" }
  }

  const messenger = await prisma.messengerUser.findUnique({
    where:  { platform_platformChatId: { platform: "telegram", platformChatId: profile.telegramChatId } },
    select: { persona: true, novaAcademicProfile: { select: { onboardingComplete: true } } },
  })
  // The Telegram webhook routes on MessengerUser.persona; the web follows it.
  if (!messenger) return { kind: "not_connected" }
  if (messenger.persona !== "nova") return { kind: "not_nova" }

  return {
    kind:           "learner",
    userId:         session.userId,
    name:           session.name ?? null,
    platformChatId: profile.telegramChatId,
    onboardingDone: messenger.novaAcademicProfile?.onboardingComplete === true,
  }
}
