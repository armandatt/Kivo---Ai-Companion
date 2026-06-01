import { NextResponse } from "next/server"
import { prisma } from "@repo/db/client"
import { getSession } from "../../lib/auth/session"

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })

  try {
    const reviews = await prisma.weeklyReview.findMany({
      where: { userId: session.userId },
      orderBy: { weekStartDate: "desc" },
      select: {
        id: true,
        weekStartDate: true,
        summaryText: true,
        sessionsCompleted: true,
        sessionsPlanned: true,
        avgEnergyScore: true,
        topWins: true,
        focusForNextWeek: true,
        goalPaceStatus: true,
        createdAt: true,
      },
    })

    const formatted = reviews.map((r) => {
      const start = new Date(r.weekStartDate)
      const end = new Date(start)
      end.setDate(start.getDate() + 6)
      const weekLabel = `${start.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${end.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`

      return {
        id: r.id,
        weekLabel,
        weekStartDate: r.weekStartDate.toISOString(),
        summary: (r.summaryText.split("\n")[0] ?? r.summaryText).slice(0, 120),
        fullContent: r.summaryText,
        sessionsCompleted: r.sessionsCompleted,
        sessionsPlanned: r.sessionsPlanned,
        avgEnergyScore: r.avgEnergyScore,
        topWins: r.topWins,
        focusForNextWeek: r.focusForNextWeek,
        goalPaceStatus: r.goalPaceStatus,
        createdAt: r.createdAt.toISOString(),
      }
    })

    return NextResponse.json({ reviews: formatted })
  } catch (e) {
    console.error("[WEEKLY REVIEWS ERROR]", e)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}
