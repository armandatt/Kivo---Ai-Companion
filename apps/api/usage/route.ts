import { NextResponse } from "next/server"
import { prisma } from "@repo/db/client"
import { getSession } from "../lib/auth/session"

const LIMITS: Record<string, number> = { free: 50, pro: 300, elite: 1000 }

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })

  try {
    const profile = await prisma.userProfile.findUnique({
      where: { userId: session.userId },
      select: { telegramChatId: true },
    })

    let messagesUsedToday = 0
    const tier = "free"

    if (profile?.telegramChatId) {
      const startOfDay = new Date()
      startOfDay.setHours(0, 0, 0, 0)

      const messenger = await prisma.messengerUser.findUnique({
        where: {
          platform_platformChatId: { platform: "telegram", platformChatId: profile.telegramChatId },
        },
        select: { id: true },
      })

      if (messenger) {
        messagesUsedToday = await prisma.companionMessage.count({
          where: {
            userId: messenger.id,
            role: "user",
            createdAt: { gte: startOfDay },
          },
        })
      }
    }

    return NextResponse.json({
      messagesUsedToday,
      messagesLimit: LIMITS[tier] ?? 50,
      tier,
    })
  } catch (e) {
    console.error("[USAGE GET ERROR]", e)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}
