const botUsername = process.env.NEXT_PUBLIC_BOT_USERNAME

export const TELEGRAM_BOT_URL = botUsername
  ? `https://t.me/${botUsername}`
  : "https://t.me"
