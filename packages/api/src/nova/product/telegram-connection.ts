// ─── Telegram, as the web app shows it ────────────────────────────────────────
// Telegram is a channel a learner may add. This file says only how the web
// app describes that channel: connected or not, and where the bot is. It
// decides nothing about who a learner is (product/learner-identity.ts) or how
// a chat is linked (telegram/telegram-link.ts). No imports, so the web app can
// use its types.

export interface TelegramConnection {
  connected: boolean;
  // The bot's chat, for "Open Telegram". null when the bot's name is not
  // known to the server, so the page shows no link it cannot stand behind.
  botUrl:    string | null;
}

// Telegram usernames: 5 to 32 letters, digits or underscores.
const NAME_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_";
const isBotName = (name: string) => name.length >= 5 && name.length <= 32 && [...name].every(c => NAME_CHARS.includes(c));

export function telegramBotUrl(username: string | null | undefined): string | null {
  const raw  = (username ?? "").trim();
  const name = raw.startsWith("@") ? raw.slice(1) : raw;
  return isBotName(name) && name !== "YourBotName" ? `https://t.me/${name}` : null;
}
