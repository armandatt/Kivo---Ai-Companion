import crypto from "node:crypto"
import { NextResponse } from "next/server"
import { prisma } from "@repo/db/client"
import { getSession } from "../../lib/auth/session"

async function getTelegramBotName() {
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

export async function POST() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })
  }

  const token = crypto.randomBytes(16).toString("hex")
  const botName = await getTelegramBotName()

  await prisma.userProfile.upsert({
    where: { userId: session.userId },
    update: { telegramConnectToken: token },
    create: {
      userId: session.userId,
      telegramConnectToken: token,
      secondaryDomains: [],
      aspirationWords: [],
    },
  })

  return NextResponse.json({
    token,
    deeplink: `https://t.me/${botName}?start=${token}`,
  })
}
