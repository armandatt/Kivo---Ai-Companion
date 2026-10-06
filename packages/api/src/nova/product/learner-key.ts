// ─── Learner key ──────────────────────────────────────────────────────────────
// How Nova names a learner. Pure, no imports.
//
// A learner is a NovaAcademicProfile on a MessengerUser row. That row is found
// by one string, which every product function takes as `platformChatId`:
//
//   "123456789"     a learner whose row is their Telegram chat
//   "web:<userId>"  a learner who has not connected Telegram: the row belongs
//                   to the web account alone
//
// It is one learner either way, with one set of state. Connecting Telegram
// re-keys the web row to the chat (nova/telegram/telegram-link.ts); nothing
// is copied and no second learner is made. A Telegram chat id is a number, so
// the two forms cannot collide.

export const WEB_PLATFORM       = "web";
export const WEB_LEARNER_PREFIX = "web:";

export const webLearnerId = (userId: string): string => `${WEB_LEARNER_PREFIX}${userId}`;

export const isWebLearnerId = (learnerId: string): boolean => learnerId.startsWith(WEB_LEARNER_PREFIX);

// The web account behind a web learner id. null for a Telegram chat id.
export const webAccountOf = (learnerId: string): string | null =>
  isWebLearnerId(learnerId) ? learnerId.slice(WEB_LEARNER_PREFIX.length) : null;

// The unique key of the learner's MessengerUser row, for a Prisma `where`.
export function learnerKey(learnerId: string): { platform_platformChatId: { platform: string; platformChatId: string } } {
  return { platform_platformChatId: { platform: isWebLearnerId(learnerId) ? WEB_PLATFORM : "telegram", platformChatId: learnerId } };
}
