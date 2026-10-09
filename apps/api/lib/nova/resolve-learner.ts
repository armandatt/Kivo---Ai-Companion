// Maps the signed-in web account to its Nova learner.
//
// There is one Nova per person. The rule lives in
// packages/api/src/nova/product/learner-identity.ts: an account linked to a
// Telegram chat is that chat's learner; a Nova account with no chat has a
// learner of its own. This file only supplies the account, from the session
// cookie. No id from the request is read.

//@ts-ignore
import { resolveLearnerForAccount } from "@repo/api/nova/product/learner-identity"
import { getSession } from "../auth/session"

export type LearnerResolution =
  | { kind: "unauthenticated" }
  | { kind: "not_nova" }
  | { kind: "not_connected" }
  | { kind: "learner"; userId: string; name: string | null; platformChatId: string; channel: "telegram" | "web"; onboardingDone: boolean }

export async function resolveNovaLearner(): Promise<LearnerResolution> {
  const session = await getSession()
  if (!session) return { kind: "unauthenticated" }
  return resolveLearnerForUser(session.userId, session.name ?? null)
}

// The same mapping for an account identified some other way than the session
// cookie (the browser extension's own credential). One rule for who is a
// Nova learner, whatever the caller proved their identity with: the same
// function, so a learner with no Telegram chat is a learner here too.
export async function resolveLearnerForUser(userId: string, name: string | null): Promise<Exclude<LearnerResolution, { kind: "unauthenticated" }>> {
  const learner = await resolveLearnerForAccount(userId, name)
  if (learner.kind !== "learner") return { kind: learner.kind }
  return {
    kind:           "learner",
    userId,
    name,
    platformChatId: learner.platformChatId,
    channel:        learner.channel,
    onboardingDone: learner.onboardingDone,
  }
}
