import { NextResponse } from "next/server"
import { prisma } from "@repo/db/client"
import { getSession } from "../lib/auth/session"

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function computeStreak(logs: Array<{ date: Date; completed: boolean }>) {
  if (!logs.length) return { current: 0, best: 0, broken: false }

  const completedDates = [...new Set(
    logs.filter((l) => l.completed).map((l) => toDateStr(l.date))
  )].sort((a, b) => b.localeCompare(a))

  if (!completedDates.length) return { current: 0, best: 0, broken: false }

  const today = toDateStr(new Date())
  const yesterday = toDateStr(new Date(Date.now() - 86400000))
  const mostRecent = completedDates[0]

  if (mostRecent !== today && mostRecent !== yesterday) {
    return { current: 0, best: completedDates.length, broken: true }
  }

  let current = 0
  for (let i = 0; i < completedDates.length; i++) {
    const expected = new Date(mostRecent)
    expected.setDate(expected.getDate() - i)
    if (completedDates[i] === toDateStr(expected)) {
      current++
    } else {
      break
    }
  }

  return { current, best: Math.max(current, completedDates.length), broken: false }
}

function moodFromLog(entry: { moodTag: string | null; morningScore: number | null }): string {
  if (entry.moodTag) return entry.moodTag
  const score = entry.morningScore
  if (score === null) return "no_data"
  if (score >= 8) return "motivated"
  if (score >= 6) return "neutral"
  if (score >= 4) return "calm"
  return "stressed"
}

export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })
  }

  const userId = session.userId
  const sixtyDaysAgo = new Date(Date.now() - 60 * 86400000)
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000)

  try {
    const [user, profile, energyLogs, workoutLogs] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, name: true, email: true, image: true },
      }),
      prisma.userProfile.findUnique({ where: { userId } }),
      prisma.energyLog.findMany({
        where: { userId, date: { gte: sevenDaysAgo } },
        orderBy: { date: "desc" },
        take: 7,
        select: { date: true, moodTag: true, morningScore: true },
      }),
      prisma.workoutLog.findMany({
        where: { userId, date: { gte: sixtyDaysAgo } },
        orderBy: { date: "desc" },
        select: { date: true, completed: true },
      }),
    ])

    if (!user) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const streak = computeStreak(workoutLogs)

    const moodMap = new Map(energyLogs.map((l) => [toDateStr(l.date), moodFromLog(l)]))
    const mood = Array.from({ length: 7 }, (_, i) => {
      const d = new Date()
      d.setDate(d.getDate() - (6 - i))
      const dateStr = toDateStr(d)
      return { date: dateStr, mood: moodMap.get(dateStr) ?? "no_data" }
    })

    // Bridge to MessengerUser for Telegram-sourced data
    let deadlines: Array<{ id: string; title: string; dueAt: string }> = []
    let lastMessage: { text: string; timestamp: string } | null = null

    if (profile?.telegramChatId) {
      const messenger = await prisma.messengerUser.findUnique({
        where: {
          platform_platformChatId: {
            platform: "telegram",
            platformChatId: profile.telegramChatId,
          },
        },
        select: {
          deadlines: {
            where: { status: "active", dueAt: { gte: new Date() } },
            orderBy: { dueAt: "asc" },
            take: 5,
            select: { id: true, title: true, dueAt: true },
          },
          messages: {
            where: { role: "assistant" },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { text: true, createdAt: true },
          },
        },
      })

      if (messenger) {
        deadlines = messenger.deadlines.map((d) => ({
          id: d.id,
          title: d.title,
          dueAt: d.dueAt.toISOString(),
        }))
        if (messenger.messages[0]) {
          lastMessage = {
            text: messenger.messages[0].text,
            timestamp: messenger.messages[0].createdAt.toISOString(),
          }
        }
      }
    }

    return NextResponse.json({
      user: { name: user.name, email: user.email, image: user.image },
      profile: profile
        ? {
            creatureName: profile.creatureName,
            creatureType: profile.creatureType,
            creatureColor: profile.creatureColor,
            primaryPersona: profile.primaryPersona,
            personaName: profile.personaName,
            primaryGoal30d: profile.primaryGoal30d,
            goalCategory: profile.goalCategory,
            aspirationWords: profile.aspirationWords,
            onboardingComplete: profile.onboardingComplete,
            preferredCheckInTime: profile.preferredCheckInTime,
          }
        : null,
      streak,
      mood,
      plan: null,
      deadlines,
      lastMessage,
      telegramConnected: profile?.telegramConnected ?? false,
    })
  } catch (e) {
    console.error("[DASHBOARD ERROR]", e)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}
