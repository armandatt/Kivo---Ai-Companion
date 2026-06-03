import { NextResponse } from "next/server"
import { prisma } from "@repo/db/client"
import { getSession } from "../lib/auth/session"

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })

  try {
    const profile = await prisma.userProfile.findUnique({
      where:  { userId: session.userId },
      select: { telegramChatId: true, personaName: true },
    })

    const thirtyAgo = new Date()
    thirtyAgo.setDate(thirtyAgo.getDate() - 29)
    thirtyAgo.setHours(0, 0, 0, 0)

    if (!profile?.telegramChatId) {
      return NextResponse.json({
        sessions:       [],
        totalMinutes:   0,
        completedCount: 0,
        telegramConnected: false,
        personaName:    null,
      })
    }

    const messenger = await prisma.messengerUser.findFirst({
      where:  { platform: "telegram", platformChatId: profile.telegramChatId },
      select: {
        focusSessions: {
          where:   { startedAt: { gte: thirtyAgo } },
          orderBy: { startedAt: "desc" },
          select:  { id: true, durationMin: true, status: true, startedAt: true, completedAt: true },
        },
      },
    })

    if (!messenger) {
      return NextResponse.json({
        sessions:       [],
        totalMinutes:   0,
        completedCount: 0,
        telegramConnected: false,
        personaName:    null,
      })
    }

    const sessions = messenger.focusSessions.map((s) => ({
      id:          s.id,
      durationMin: s.durationMin,
      status:      s.status,
      startedAt:   s.startedAt.toISOString(),
      completedAt: s.completedAt?.toISOString() ?? null,
    }))

    const completed     = sessions.filter((s) => s.status === "completed")
    const totalMinutes  = completed.reduce((sum, s) => sum + s.durationMin, 0)

    return NextResponse.json({
      sessions,
      totalMinutes,
      completedCount:    completed.length,
      telegramConnected: true,
      personaName:       profile.personaName,
    })
  } catch (e) {
    console.error("[FOCUS ERROR]", e)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}
