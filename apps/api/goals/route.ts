import { NextResponse } from "next/server"
import { prisma } from "@repo/db/client"
import { getSession } from "../lib/auth/session"

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })

  const userId = session.userId

  try {
    const profile = await prisma.userProfile.findUnique({ where: { userId } })

    if (!profile) {
      return NextResponse.json({ goals: [], archive: [], aspirationWords: [], tier: "free" })
    }

    const goals: Array<{
      id: string
      title: string
      category: string | null
      daysTotal: number | null
      daysRemaining: number | null
      status: string
      createdAt: string
      source: "web" | "telegram"
    }> = []

    // Web onboarding goal
    if (profile.primaryGoal30d) {
      const daysTotal = 30
      const daysElapsed = Math.floor((Date.now() - new Date(profile.createdAt).getTime()) / 86400000)
      const daysRemaining = Math.max(0, daysTotal - daysElapsed)
      goals.push({
        id: profile.id,
        title: profile.primaryGoal30d,
        category: profile.goalCategory,
        daysTotal,
        daysRemaining,
        status: "active",
        createdAt: profile.createdAt.toISOString(),
        source: "web",
      })
    }

    // Telegram conversation goals
    let archive: Array<{ id: string; title: string; status: string; createdAt: string }> = []

    if (profile.telegramChatId) {
      const messenger = await prisma.messengerUser.findUnique({
        where: {
          platform_platformChatId: {
            platform: "telegram",
            platformChatId: profile.telegramChatId,
          },
        },
        select: {
          goals: {
            orderBy: { createdAt: "desc" },
            select: { id: true, title: true, status: true, createdAt: true },
          },
        },
      })

      if (messenger) {
        for (const g of messenger.goals) {
          if (g.status === "active" || g.status === "paused") {
            goals.push({
              id: g.id,
              title: g.title,
              category: null,
              daysTotal: null,
              daysRemaining: null,
              status: g.status,
              createdAt: g.createdAt.toISOString(),
              source: "telegram",
            })
          } else {
            archive.push({
              id: g.id,
              title: g.title,
              status: g.status,
              createdAt: g.createdAt.toISOString(),
            })
          }
        }
      }
    }

    return NextResponse.json({
      goals,
      archive,
      aspirationWords: profile.aspirationWords,
      tier: "free",
    })
  } catch (e) {
    console.error("[GOALS ERROR]", e)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}
