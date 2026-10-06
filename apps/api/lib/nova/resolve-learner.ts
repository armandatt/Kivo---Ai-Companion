// Maps the signed-in web account to its Nova learner.
//
// There is one Nova per person. The web account links to a Telegram chat
// (UserProfile.telegramChatId), and that chat's MessengerUser owns all Nova
// state. The web app never creates a second learner.

import { prisma } from "@repo/db/client"
//@ts-ignore
import { companionOf } from "@repo/api/nova/product/companion"
import { getSession } from "../auth/session"

export type LearnerResolution =
  | { kind: "unauthenticated" }
  | { kind: "not_nova" }
  | { kind: "not_connected" }
  | { kind: "learner"; userId: string; name: string | null; platformChatId: string; onboardingDone: boolean }

export async function resolveNovaLearner(): Promise<LearnerResolution> {
  const session = await getSession()
  if (!session) return { kind: "unauthenticated" }
  return resolveLearnerForUser(session.userId, session.name ?? null)
}

// The same mapping for an account identified some other way than the session
// cookie (the browser extension's own credential). One rule for who is a
// Nova learner, whatever the caller proved their identity with.
export async function resolveLearnerForUser(userId: string, name: string | null): Promise<Exclude<LearnerResolution, { kind: "unauthenticated" }>> {
  const profile = await prisma.userProfile.findUnique({
    where:  { userId },
    select: { primaryPersona: true, telegramChatId: true },
  })
  const chatId    = profile?.telegramChatId ?? null
  const messenger = chatId
    ? await prisma.messengerUser.findUnique({
        where:  { platform_platformChatId: { platform: "telegram", platformChatId: chatId } },
        select: { persona: true, novaAcademicProfile: { select: { onboardingComplete: true } } },
      })
    : null

  // The one rule for which companion an account uses (shared with the web
  // app's dashboard layout).
  const companion = companionOf({
    primaryPersona:   profile?.primaryPersona,
    hasLinkedChat:    chatId !== null,
    messengerPersona: messenger ? messenger.persona : undefined,
  })
  if (companion !== "nova") return { kind: "not_nova" }
  if (!chatId || !messenger) return { kind: "not_connected" }

  return {
    kind:           "learner",
    userId,
    name,
    platformChatId: chatId,
    onboardingDone: messenger.novaAcademicProfile?.onboardingComplete === true,
  }
}
