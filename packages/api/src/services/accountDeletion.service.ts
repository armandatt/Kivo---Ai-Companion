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
// It deliberately does not delete the MessengerUser. That row is the
// Telegram identity, shared with Rex, and what happens to it when a web
// account is deleted is a wider identity decision this does not make.

import { prisma } from "@repo/db/client";

export interface AccountDeletionResult {
  deleted:            boolean;
  novaProfileRemoved: boolean;
  // Set when the Nova profile was left in place on purpose.
  novaProfileKept:    "no_linked_chat" | "no_nova_profile" | "chat_shared_with_another_account" | null;
}

export async function deleteAccount(userId: string): Promise<AccountDeletionResult> {
  return prisma.$transaction(async tx => {
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
    }

    await tx.user.delete({ where: { id: userId } });
    return { deleted: true, novaProfileRemoved: removed, novaProfileKept: kept };
  });
}
