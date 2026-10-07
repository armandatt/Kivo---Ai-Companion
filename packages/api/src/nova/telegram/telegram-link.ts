// ─── Linking a Telegram chat to a web account ─────────────────────────────────
// "/start <token>" from the dashboard's connect link. The token is the only
// thing that ties a chat to an account, so it is short-lived, single-use and
// refused anywhere but a private chat.
//
//   expiry        a token is good for LINK_TOKEN_MINUTES; one with no expiry
//                 on record (issued before expiry existed) is refused
//   single use    consuming it is one conditional write; of two attempts with
//                 the same token, one links and the other finds it gone
//   one account   a chat that already belongs to another account is refused
//   one learner   a Nova account that already has a learner on another chat
//                 is refused, because the learner lives with the chat
//   same learner  a Nova account that has been studying on the web without
//                 Telegram keeps that learner: its row is re-keyed to the
//                 chat. Nothing is copied and no second learner is made. A
//                 chat that already holds a learner, or a finished Rex setup,
//                 is refused rather than merged or overwritten.
//
// It also does the one thing that was missing: a chat linked by a Nova
// account becomes a Nova chat. Without that the webhook routes it to Rex.

import { prisma } from "@repo/db/client";
import { companionOf } from "../product/companion";
import { learnerKey, webLearnerId } from "../product/learner-key";

export const LINK_TOKEN_MINUTES = 15;

export const linkTokenExpiry = (now = new Date()): Date => new Date(now.getTime() + LINK_TOKEN_MINUTES * 60_000);

export type LinkResult =
  | { status: "invalid" | "expired" | "not_private" | "chat_taken" | "has_other_chat" | "chat_has_learner" | "chat_is_rex" }
  // nova: the chat is now this account's Nova chat.
  | { status: "linked"; companion: "nova"; profileId: string; onboarded: boolean }
  // rex: linked, and the existing Rex flow carries on from here.
  | { status: "linked"; companion: "rex"; profileId: string };

export async function linkTelegramChat(
  token: string,
  chat:  { id: string; type: string | null },
  now = new Date(),
): Promise<LinkResult> {
  if (chat.type !== "private") return { status: "not_private" };
  const candidate = token.trim();
  if (candidate.length < 16 || candidate.length > 128) return { status: "invalid" };

  const profile = await prisma.userProfile.findUnique({
    where:  { telegramConnectToken: candidate },
    select: { id: true, userId: true, primaryPersona: true, telegramChatId: true, telegramConnectTokenExpiresAt: true },
  });
  if (!profile) return { status: "invalid" };
  if (!profile.telegramConnectTokenExpiresAt || profile.telegramConnectTokenExpiresAt <= now) {
    await prisma.userProfile.updateMany({
      where: { id: profile.id, telegramConnectToken: candidate },
      data:  { telegramConnectToken: null, telegramConnectTokenExpiresAt: null },
    });
    return { status: "expired" };
  }

  // The chat already belongs to someone else's account.
  const owner = await prisma.userProfile.findFirst({
    where:  { telegramChatId: chat.id, id: { not: profile.id } },
    select: { id: true },
  });
  if (owner) return { status: "chat_taken" };

  const [messenger, previous] = await Promise.all([
    prisma.messengerUser.findUnique({
      where:  { platform_platformChatId: { platform: "telegram", platformChatId: chat.id } },
      select: { id: true, persona: true, intakeComplete: true, displayName: true, username: true, novaAcademicProfile: { select: { onboardingComplete: true } } },
    }),
    profile.telegramChatId && profile.telegramChatId !== chat.id
      ? prisma.messengerUser.findUnique({
          where:  { platform_platformChatId: { platform: "telegram", platformChatId: profile.telegramChatId } },
          select: { novaAcademicProfile: { select: { id: true } } },
        })
      : Promise.resolve(null),
  ]);
  // Moving to a new chat would leave the learner behind on the old one.
  if (previous?.novaAcademicProfile) return { status: "has_other_chat" };

  // Which companion the web account chose (the rule the dashboard uses).
  const chosen = companionOf({ primaryPersona: profile.primaryPersona, hasLinkedChat: false, messengerPersona: undefined });
  // A chat that already finished Rex's intake stays a Rex chat.
  const novaChat = messenger?.persona === "nova" || (chosen === "nova" && !(messenger?.intakeComplete && messenger.persona !== "nova"));

  const linked = {
    telegramChatId: chat.id, telegramConnected: true, telegramConnectedAt: now,
    telegramConnectToken: null, telegramConnectTokenExpiresAt: null, lastActivityAt: now,
  };

  // ── A learner who started on the web ───────────────────────────────────────
  // Their row is keyed by the account. Connecting Telegram makes the chat its
  // key, so every session, topic, exam and fact they already have is what
  // Telegram sees.
  const web = chosen === "nova"
    ? await prisma.messengerUser.findUnique({
        where:  learnerKey(webLearnerId(profile.userId)),
        select: { id: true, novaAcademicProfile: { select: { onboardingComplete: true } } },
      })
    : null;
  if (web) {
    const chatIsRex = messenger !== null && messenger.intakeComplete && messenger.persona !== "nova";
    if (messenger?.novaAcademicProfile) {
      // Two study records cannot become one. With nothing on the web side
      // yet, the chat's learner is simply this account's (below).
      if (web.novaAcademicProfile) return { status: "chat_has_learner" };
    } else if (chatIsRex) {
      // Linking would hand the account to Rex and hide what they did with Nova.
      if (web.novaAcademicProfile) return { status: "chat_is_rex" };
    } else {
      const moved = await prisma.$transaction(async tx => {
        // Consume the token. Only the attempt that still finds it there links.
        const consumed = await tx.userProfile.updateMany({ where: { id: profile.id, telegramConnectToken: candidate }, data: linked });
        if (consumed.count !== 1) return false;
        // The chat's own row, if the bot has seen the chat, is an empty
        // placeholder (no learner, no finished Rex setup). It is set aside,
        // not deleted, and the learner's row takes its place.
        if (messenger) {
          await tx.messengerUser.update({
            where: { id: messenger.id },
            data:  { platform: "telegram_replaced", platformChatId: `${chat.id}:${messenger.id}` },
          });
        }
        await tx.messengerUser.update({
          where: { id: web.id },
          data:  {
            platform: "telegram", platformChatId: chat.id, persona: "nova",
            ...(messenger?.displayName ? { displayName: messenger.displayName } : {}),
            ...(messenger?.username ? { username: messenger.username } : {}),
          },
        });
        return true;
      });
      if (!moved) return { status: "invalid" };
      return { status: "linked", companion: "nova", profileId: profile.id, onboarded: web.novaAcademicProfile?.onboardingComplete === true };
    }
  }

  // Consume the token. Only the attempt that still finds it there links.
  const consumed = await prisma.userProfile.updateMany({
    where: { id: profile.id, telegramConnectToken: candidate },
    data:  linked,
  });
  if (consumed.count !== 1) return { status: "invalid" };
  // The account's own (empty) row is no longer its learner: the chat's is.
  if (web && !web.novaAcademicProfile) {
    await prisma.messengerUser.deleteMany({ where: { id: web.id, novaAcademicProfile: null } }).catch(() => {});
  }

  if (!novaChat) return { status: "linked", companion: "rex", profileId: profile.id };

  await prisma.messengerUser.upsert({
    where:  { platform_platformChatId: { platform: "telegram", platformChatId: chat.id } },
    update: { persona: "nova" },
    create: { platform: "telegram", platformChatId: chat.id, persona: "nova", aspirationWords: [], activeModules: [] },
  });
  return {
    status: "linked", companion: "nova", profileId: profile.id,
    onboarded: messenger?.novaAcademicProfile?.onboardingComplete === true,
  };
}

export const LINK_MESSAGES: Record<Exclude<LinkResult["status"], "linked">, string> = {
  invalid:        "That link isn't valid any more. Go back to your dashboard and make a new one.",
  expired:        "That link has expired. Go back to your dashboard and make a new one.",
  not_private:    "Open a private chat with me to connect. I don't work in groups.",
  chat_taken:     "This chat is already connected to another account.",
  has_other_chat: "Your account is already connected to a different Telegram chat, and your study record lives there.",
  chat_has_learner: "This Telegram chat already has its own study record with Nova, and so does your account. I can't join the two. Connect a different Telegram account.",
  chat_is_rex:    "This Telegram chat is set up with Rex. Connect Nova from a different Telegram account so neither loses its history.",
};

// Said only when the update that linked the chat cannot be handed to Nova
// (an unsigned update in production). Every other link is greeted from the
// learner's record by the Telegram turn.
export const NOVA_LINKED_PLAIN = "Connected. Send me a message and we'll pick it up from there.";
