// The bot's username, for links into its chat. From configuration when set,
// otherwise asked of Telegram. "YourBotName" means it could not be found.
export async function getTelegramBotName(): Promise<string> {
  const configuredName = process.env.TELEGRAM_BOT_USERNAME ?? process.env.BOT_USERNAME
  if (configuredName) return configuredName.replace(/^@/, "")

  const botToken = process.env.TELEGRAM_BOT_TOKEN ?? process.env.BOT_TOKEN
  if (!botToken) return "YourBotName"

  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/getMe`, {
      cache: "no-store",
    })
    const data = (await res.json()) as { ok?: boolean; result?: { username?: string } }
    return data.result?.username ?? "YourBotName"
  } catch {
    return "YourBotName"
  }
}
