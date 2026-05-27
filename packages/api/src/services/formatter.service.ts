const TELEGRAM_LIMIT = 4096;

export function formatMessengerText(text: string) {
  const clean = text
    .replace(/\r\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();

  if (clean.length <= TELEGRAM_LIMIT) return clean;

  return `${clean.slice(0, TELEGRAM_LIMIT - 24).trim()}\n\nI’ll stop there for now.`;
}
