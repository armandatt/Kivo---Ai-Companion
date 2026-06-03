import { NextResponse } from "next/server"
import { prisma } from "@repo/db/client"
import { getSession } from "../lib/auth/session"

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function computeStreak(logs: Array<{ date: Date; completed: boolean }>): number {
  const completed = [
    ...new Set(logs.filter((l) => l.completed).map((l) => toDateStr(l.date))),
  ].sort((a, b) => b.localeCompare(a))

  if (!completed.length) return 0

  const today = toDateStr(new Date())
  const yesterday = toDateStr(new Date(Date.now() - 86400000))
  const anchor = completed[0] === today ? today : completed[0] === yesterday ? yesterday : null
  if (!anchor) return 0

  let streak = 0
  const base = new Date(anchor + "T00:00:00")
  for (let i = 0; i < completed.length; i++) {
    const expected = new Date(base)
    expected.setDate(expected.getDate() - i)
    if (completed[i] === toDateStr(expected)) streak++
    else break
  }
  return streak
}

function getStage(streak: number): string {
  if (streak < 3) return "egg"
  if (streak < 7) return "hatchling"
  if (streak < 21) return "creature"
  if (streak < 50) return "beast"
  return "legend"
}

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })

  try {
    const [user, profile, workoutLogs] = await Promise.all([
      prisma.user.findUnique({
        where: { id: session.userId },
        select: { name: true, email: true, image: true },
      }),
      prisma.userProfile.findUnique({
        where: { userId: session.userId },
        select: {
          onboardingComplete: true,
          primaryGoal30d: true,
          telegramConnected: true,
          telegramConnectToken: true,
          telegramChatId: true,
          primaryPersona: true,
        },
      }),
      prisma.workoutLog.findMany({
        where: { userId: session.userId },
        select: { date: true, completed: true },
        orderBy: { date: "desc" },
        take: 60,
      }),
    ])

    // primaryPersona is the source of truth — set during web onboarding quiz.
    // Fall back to messenger.persona only if primaryPersona is missing.
    let persona = profile?.primaryPersona ?? "nova"
    if (!profile?.primaryPersona && profile?.telegramChatId) {
      const messenger = await prisma.messengerUser.findFirst({
        where:  { platform: "telegram", platformChatId: profile.telegramChatId },
        select: { persona: true },
      })
      persona = messenger?.persona ?? "nova"
    }

    const streak = computeStreak(workoutLogs)
    const stage = getStage(streak)
    const evolutionAvailable = [3, 7, 21, 50].includes(streak)

    return NextResponse.json({
      user: {
        name: user?.name ?? null,
        email: user?.email ?? session.email,
        image: user?.image ?? null,
      },
      tier: "free",
      streakCount: streak,
      activeGoalCount: profile?.primaryGoal30d ? 1 : 0,
      overdueCount: 0,
      hasUnreadReviews: false,
      evolutionAvailable,
      creatureStage: stage,
      onboardingComplete: profile?.onboardingComplete ?? false,
      persona,
      platforms: {
        telegram: {
          connected: profile?.telegramConnected ?? false,
          deeplink: profile?.telegramConnectToken
            ? `https://t.me/${(process.env.TELEGRAM_BOT_USERNAME ?? process.env.BOT_USERNAME ?? "YourBotName").replace(/^@/, "")}?start=${profile.telegramConnectToken}`
            : null,
        },
        whatsapp: { connected: false },
      },
    })
  } catch (e) {
    console.error("[NAV ERROR]", e)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}
