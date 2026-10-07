import crypto from "node:crypto"
import { NextResponse } from "next/server"
import { prisma } from "@repo/db/client"
import { getSession } from "../../lib/auth/session"
import { getTelegramBotName } from "../../lib/telegram/bot-name"

export async function POST() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })
  }

  const token = crypto.randomBytes(16).toString("hex")
  // Good for 15 minutes; the webhook refuses it after that.
  const tokenExpiry = new Date(Date.now() + 15 * 60_000)
  const botName = await getTelegramBotName()

  await prisma.userProfile.upsert({
    where: { userId: session.userId },
    update: { telegramConnectToken: token, telegramConnectTokenExpiresAt: tokenExpiry },
    create: {
      userId: session.userId,
      telegramConnectToken: token,
      telegramConnectTokenExpiresAt: tokenExpiry,
      secondaryDomains: [],
      aspirationWords: [],
    },
  })

  return NextResponse.json({
    token,
    deeplink: `https://t.me/${botName}?start=${token}`,
  })
}
