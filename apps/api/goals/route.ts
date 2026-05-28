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

    const goals = []
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
        status: "active" as const,
        createdAt: profile.createdAt.toISOString(),
      })
    }

    return NextResponse.json({
      goals,
      archive: [],
      aspirationWords: profile.aspirationWords,
      tier: "free",
    })
  } catch (e) {
    console.error("[GOALS ERROR]", e)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}
