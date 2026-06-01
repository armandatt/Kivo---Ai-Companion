import { NextResponse } from "next/server"
import { prisma } from "@repo/db/client"
import { getSession } from "../lib/auth/session"

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })

  const today = new Date()
  const dayOfWeek = today.getDay() === 0 ? 6 : today.getDay() - 1
  const monday = new Date(today)
  monday.setDate(today.getDate() - dayOfWeek)
  monday.setHours(0, 0, 0, 0)

  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    return {
      date: toDateStr(d),
      tasks: [] as Array<{ id: string; title: string; status: string }>,
    }
  })

  try {
    const profile = await prisma.userProfile.findUnique({
      where: { userId: session.userId },
      select: { telegramChatId: true },
    })

    if (!profile?.telegramChatId) {
      return NextResponse.json({ weekDays, deadlines: [], hasPlan: false, planContent: null })
    }

    const messenger = await prisma.messengerUser.findUnique({
      where: {
        platform_platformChatId: {
          platform: "telegram",
          platformChatId: profile.telegramChatId,
        },
      },
      select: {
        plans: {
          where: { status: "active" },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true, content: true, createdAt: true },
        },
        deadlines: {
          where: { status: "active", dueAt: { gte: monday } },
          orderBy: { dueAt: "asc" },
          take: 10,
          select: { id: true, title: true, dueAt: true },
        },
      },
    })

    const activePlan = messenger?.plans[0] ?? null
    const deadlines = (messenger?.deadlines ?? []).map((d) => ({
      id: d.id,
      title: d.title,
      dueAt: d.dueAt.toISOString(),
    }))

    return NextResponse.json({
      weekDays,
      deadlines,
      hasPlan: !!activePlan,
      planContent: activePlan?.content ?? null,
      planId: activePlan?.id ?? null,
    })
  } catch (e) {
    console.error("[PLANNER ERROR]", e)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}
