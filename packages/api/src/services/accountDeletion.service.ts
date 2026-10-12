// Deleting a web account.
//
// The web account (User, UserProfile) and the Nova learner are linked only by
// a chat id: UserProfile.telegramChatId names the MessengerUser, with no
// foreign key between them. Deleting the User therefore cascades through the
// web account and stops there, which used to leave the learner's Nova
// profile behind, and with it everything they had studied and written.
//
// This removes the Nova academic profile linked to the account before the
// account itself. Its cascade takes subjects, topics, exams, sessions,
// cognitive state, Learning DNA, proactive messages and notes.
//
// A Nova learner's chat goes with the account. The chat's own row
// (MessengerUser) is where the conversation, the facts and circumstances
// Nova kept, its patterns and its pending consolidation jobs all hang, by
// cascade; with the row gone, so are they, and the chat is an unconnected
// one again. That happens only when the row is this learner's alone:
//
//   - no other web account names the same chat, and
//   - the row is a Nova chat.
//
// A chat another account also names is left exactly as it is: only this
// account, and its tie to the chat, are removed. A chat that is not Nova's
// is not touched here beyond what was already done (its Nova study profile,
// if it somehow has one): that row is another companion's.
//
// One transaction: the account and everything of the learner's go together
// or not at all. Deleting an account that is already gone is not an error.
// Nothing about what is deleted is logged.

import { prisma } from "@repo/db/client";

export interface AccountDeletionResult {
  // false: there was no such account (it had already been deleted).
  deleted:            boolean;
  novaProfileRemoved: boolean;
  // Set when the Nova profile was left in place on purpose.
  novaProfileKept:    "no_linked_chat" | "no_nova_profile" | "chat_shared_with_another_account" | null;
}

export async function deleteAccount(userId: string): Promise<AccountDeletionResult> {
  return prisma.$transaction(async tx => {
    // Already deleted (a second press, a retry after a lost reply): done.
    const account = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!account) return { deleted: false, novaProfileRemoved: false, novaProfileKept: null };

    const profile = await tx.userProfile.findUnique({ where: { userId }, select: { telegramChatId: true } });
    const chatId  = profile?.telegramChatId ?? null;

    let removed = false;
    let kept: AccountDeletionResult["novaProfileKept"] = null;

    if (!chatId) {
      kept = "no_linked_chat";
    } else if ((await tx.userProfile.count({ where: { telegramChatId: chatId, userId: { not: userId } } })) > 0) {
      // telegramChatId is not unique. If another web account points at the
      // same chat, the learner is not this account's alone to delete.
      kept = "chat_shared_with_another_account";
    } else {
      const result = await tx.novaAcademicProfile.deleteMany({
        where: { user: { platform: "telegram", platformChatId: chatId } },
      });
      removed = result.count > 0;
      if (!removed) kept = "no_nova_profile";

      // The chat's own row, when it is a Nova chat: the conversation and
      // everything else Nova kept about the learner go with it by cascade.
      await tx.messengerUser.deleteMany({ where: { platform: "telegram", platformChatId: chatId, persona: "nova" } });
    }

    // A Nova learner who never connected Telegram lives on a row that belongs
    // to this account alone ("web:<userId>", nova/product/learner-key.ts).
    // It goes with the account, and its cascade takes everything Nova kept.
    const own = await tx.messengerUser.deleteMany({ where: { platform: "web", platformChatId: `web:${userId}` } });
    if (own.count > 0) { removed = true; kept = null; }

    await tx.user.delete({ where: { id: userId } });
    return { deleted: true, novaProfileRemoved: removed, novaProfileKept: kept };
  });
}
