import crypto from "node:crypto"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { jwtVerify } from "jose"

const SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET ?? "fallback-dev-secret-change-in-production"
)

async function getBotName(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_BOT_USERNAME ?? process.env.BOT_USERNAME
  if (configured) return configured.replace(/^@/, "")

  const botToken = process.env.TELEGRAM_BOT_TOKEN ?? process.env.BOT_TOKEN
  if (!botToken) return "kevo_companion_bot"

  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/getMe`, { cache: "no-store" })
    const data = (await res.json()) as { ok?: boolean; result?: { username?: string } }
    return data.result?.username ?? "kevo_companion_bot"
  } catch {
    return "kevo_companion_bot"
  }
}

export async function POST() {
  try {
    const store = await cookies()
    const sessionToken = store.get("kevo_session")?.value
    if (!sessionToken) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 })
    }

    const { payload } = await jwtVerify(sessionToken, SECRET)
    const userId = (payload as { userId?: string }).userId
    if (!userId) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 })
    }

    const { prisma } = await import("@repo/db/client")
    const connectToken = crypto.randomBytes(16).toString("hex")

    await prisma.userProfile.upsert({
      where:  { userId },
      update: { telegramConnectToken: connectToken },
      create: {
        userId,
        telegramConnectToken: connectToken,
        secondaryDomains: [],
        aspirationWords:  [],
      },
    })

    const botName = await getBotName()
    return NextResponse.json({
      token:    connectToken,
      deeplink: `https://t.me/${botName}?start=${connectToken}`,
    })
  } catch (err) {
    console.error("[generate-token]", err)
    return NextResponse.json({ error: "Failed to generate link" }, { status: 500 })
  }
}
