import { NextResponse } from "next/server"
import { prisma } from "@repo/db/client"
//@ts-ignore
import { telegramBotUrl } from "@repo/api/nova/product/telegram-connection"
import { getSession } from "../../lib/auth/session"
import { getTelegramBotName } from "../../lib/telegram/bot-name"

export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })
  }

  const profile = await prisma.userProfile.findUnique({
    where: { userId: session.userId },
    select: { telegramConnected: true },
  })

  // Where the bot is, for "Open Telegram", once there is a chat to open.
  // Response: TelegramConnection (packages/api/src/nova/product/telegram-connection.ts).
  const connected = profile?.telegramConnected ?? false
  const botUrl    = connected ? telegramBotUrl(await getTelegramBotName()) : null
  return NextResponse.json({ connected, botUrl })
}
