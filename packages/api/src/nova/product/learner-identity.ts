// ─── Which learner a web account is ───────────────────────────────────────────
// The one answer to "the signed-in account is which Nova learner?". The API's
// routes ask it through apps/api/lib/nova/resolve-learner.ts; nothing else
// decides it. No id from a request is ever consulted: the account comes from
// the session cookie, and the learner follows from the account.
//
//   linked to a Telegram chat   the learner is that chat's row, as it always was
//   Nova account, no chat       the learner is the account's own row
//                               ("web:<userId>"), made here on first use.
//                               Telegram is a channel they may add later; it
//                               is not what makes them a learner.
//
// Making the row is idempotent: the key is unique, so a refresh, a second tab
// or a re-login finds the row that is already there.

import { prisma } from "@repo/db/client";
import { companionOf } from "./companion";
import { learnerKey, webLearnerId, WEB_PLATFORM } from "./learner-key";

export type AccountLearner =
  | { kind: "not_nova" }
  // An account that has chosen no companion and linked no chat. It has
  // nothing to be a learner of yet.
  | { kind: "not_connected" }
  | { kind: "learner"; platformChatId: string; channel: "telegram" | "web"; onboardingDone: boolean };

const isUniqueViolation = (err: unknown) => (err as { code?: string } | null)?.code === "P2002";

export async function resolveLearnerForAccount(userId: string, name: string | null = null): Promise<AccountLearner> {
  const profile = await prisma.userProfile.findUnique({
    where:  { userId },
    select: { primaryPersona: true, telegramChatId: true },
  });
  const chatId    = profile?.telegramChatId ?? null;
  const messenger = chatId
    ? await prisma.messengerUser.findUnique({
        where:  learnerKey(chatId),
        select: { persona: true, novaAcademicProfile: { select: { onboardingComplete: true } } },
      })
    : null;

  // The one rule for which companion an account uses (shared with the web
  // app's dashboard layout).
  const companion = companionOf({
    primaryPersona:   profile?.primaryPersona,
    hasLinkedChat:    chatId !== null,
    messengerPersona: messenger ? messenger.persona : undefined,
  });
  if (companion !== "nova") return { kind: "not_nova" };

  if (chatId) {
    if (!messenger) return { kind: "not_connected" };
    return { kind: "learner", platformChatId: chatId, channel: "telegram", onboardingDone: messenger.novaAcademicProfile?.onboardingComplete === true };
  }

  // No chat. Only an account that chose Nova gets a learner of its own.
  if (profile?.primaryPersona !== "nova") return { kind: "not_connected" };

  const id   = webLearnerId(userId);
  const read = () => prisma.messengerUser.findUnique({
    where:  learnerKey(id),
    select: { novaAcademicProfile: { select: { onboardingComplete: true } } },
  });
  let row = await read();
  if (!row) {
    try {
      await prisma.messengerUser.create({
        data: { platform: WEB_PLATFORM, platformChatId: id, persona: "nova", displayName: name, aspirationWords: [], activeModules: [] },
      });
    } catch (err) {
      // Two first requests at once: the other one made it.
      if (!isUniqueViolation(err)) throw err;
    }
    row = await read();
  }
  return { kind: "learner", platformChatId: id, channel: "web", onboardingDone: row?.novaAcademicProfile?.onboardingComplete === true };
}
