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
//
// It also does the one thing that was missing: a chat linked by a Nova
// account becomes a Nova chat. Without that the webhook routes it to Rex.

import { prisma } from "@repo/db/client";
import { companionOf } from "../product/companion";

export const LINK_TOKEN_MINUTES = 15;

export const linkTokenExpiry = (now = new Date()): Date => new Date(now.getTime() + LINK_TOKEN_MINUTES * 60_000);

export type LinkResult =
  | { status: "invalid" | "expired" | "not_private" | "chat_taken" | "has_other_chat" }
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
    select: { id: true, primaryPersona: true, telegramChatId: true, telegramConnectTokenExpiresAt: true },
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
      select: { persona: true, intakeComplete: true, novaAcademicProfile: { select: { onboardingComplete: true } } },
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

  // Consume the token. Only the attempt that still finds it there links.
  const consumed = await prisma.userProfile.updateMany({
    where: { id: profile.id, telegramConnectToken: candidate },
    data:  {
      telegramChatId: chat.id, telegramConnected: true, telegramConnectedAt: now,
      telegramConnectToken: null, telegramConnectTokenExpiresAt: null, lastActivityAt: now,
    },
  });
  if (consumed.count !== 1) return { status: "invalid" };

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
};

export const NOVA_LINK_GREETING = {
  onboarded: "Connected. This chat is the quick way to reach me.\n\n/today tells you what to do now.",
  fresh:     "Connected. I'm Nova. Tell me about your studies: which year are you in, and where?",
};
