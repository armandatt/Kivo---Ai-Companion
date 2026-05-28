import { NextResponse } from "next/server"
import { prisma } from "@repo/db/client"
import { getSession } from "../lib/auth/session"

function toDateStr(d: Date): string {
  return d.toISOString().split("T")[0]
}

function computeCurrentStreak(sortedDesc: string[]): number {
  if (!sortedDesc.length) return 0
  const today = toDateStr(new Date())
  const yesterday = toDateStr(new Date(Date.now() - 86400000))
  const most = sortedDesc[0]
  if (most !== today && most !== yesterday) return 0
  let count = 0
  for (let i = 0; i < sortedDesc.length; i++) {
    const expected = new Date(most + "T00:00:00")
    expected.setDate(expected.getDate() - i)
    if (sortedDesc[i] === toDateStr(expected)) count++
    else break
  }
  return count
}

function computeLongestStreak(sortedAsc: string[]): number {
  if (!sortedAsc.length) return 0
  let longest = 1, current = 1
  for (let i = 1; i < sortedAsc.length; i++) {
    const prev = new Date(sortedAsc[i - 1] + "T00:00:00")
    const curr = new Date(sortedAsc[i] + "T00:00:00")
    if (Math.round((curr.getTime() - prev.getTime()) / 86400000) === 1) {
      current++
      if (current > longest) longest = current
    } else {
      current = 1
    }
  }
  return longest
}

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })

  try {
    const now = new Date()
    const ninetyStart = new Date(now)
    ninetyStart.setDate(now.getDate() - 89)
    ninetyStart.setHours(0, 0, 0, 0)
    const thirtyStart = new Date(now)
    thirtyStart.setDate(now.getDate() - 29)
    thirtyStart.setHours(0, 0, 0, 0)

    const [workoutLogs90, energyLogs90, energyLogs30, allCompleted] = await Promise.all([
      prisma.workoutLog.findMany({
        where: { userId: session.userId, date: { gte: ninetyStart } },
        select: { date: true, completed: true, intensityScore: true },
        orderBy: { date: "asc" },
      }),
      prisma.energyLog.findMany({
        where: { userId: session.userId, date: { gte: ninetyStart } },
        select: { date: true, morningScore: true },
        orderBy: { date: "asc" },
      }),
      prisma.energyLog.findMany({
        where: { userId: session.userId, date: { gte: thirtyStart } },
        select: { date: true, morningScore: true, preSessionScore: true, moodTag: true },
        orderBy: { date: "asc" },
      }),
      prisma.workoutLog.findMany({
        where: { userId: session.userId, completed: true },
        select: { date: true },
        orderBy: { date: "asc" },
      }),
    ])

    const workoutMap = new Map<string, { completed: boolean; intensity: number | null }>()
    for (const l of workoutLogs90) {
      workoutMap.set(toDateStr(l.date), { completed: l.completed, intensity: l.intensityScore ?? null })
    }

    const energyMap90 = new Map<string, number | null>()
    for (const l of energyLogs90) {
      energyMap90.set(toDateStr(l.date), l.morningScore ?? null)
    }

    const heatmapDays = Array.from({ length: 90 }, (_, i) => {
      const d = new Date(ninetyStart)
      d.setDate(ninetyStart.getDate() + i)
      const dateStr = toDateStr(d)
      const workout = workoutMap.get(dateStr)

      let level: "high" | "medium" | "low" | "skip" | "none"
      if (!workout) {
        const e = energyMap90.get(dateStr)
        level = e !== null && e !== undefined ? "low" : "none"
      } else if (!workout.completed) {
        level = "skip"
      } else {
        const int = workout.intensity
        level = int !== null && int >= 8 ? "high" : int !== null && int >= 5 ? "medium" : "low"
      }

      return { date: dateStr, level }
    })

    const allDates = [...new Set(allCompleted.map((l) => toDateStr(l.date)))].sort()
    const currentStreak = computeCurrentStreak([...allDates].reverse())
    const longestStreak = computeLongestStreak(allDates)
    const totalDays = allDates.length

    const moodMap30 = new Map<string, { score: number | null; moodTag: string | null }>()
    for (const l of energyLogs30) {
      moodMap30.set(toDateStr(l.date), {
        score: l.morningScore ?? l.preSessionScore ?? null,
        moodTag: l.moodTag ?? null,
      })
    }

    const moodPoints = Array.from({ length: 30 }, (_, i) => {
      const d = new Date(thirtyStart)
      d.setDate(thirtyStart.getDate() + i)
      const dateStr = toDateStr(d)
      const e = moodMap30.get(dateStr)
      return { date: dateStr, score: e?.score ?? null, moodTag: e?.moodTag ?? null }
    })

    const recentScores = moodPoints
      .slice(-7)
      .map((p) => p.score)
      .filter((s): s is number => s !== null)

    let moodInsight = "Keep logging your energy to unlock mood insights."
    if (recentScores.length >= 3) {
      const avg = recentScores.reduce((a, b) => a + b, 0) / recentScores.length
      if (avg >= 7.5) moodInsight = "Your energy this week is running high — good momentum."
      else if (avg <= 3.5) moodInsight = "Energy's been lower recently. Rest might be the move."
      else moodInsight = "Energy is steady. Consistency over intensity."
    }

    return NextResponse.json({
      heatmap: { days: heatmapDays, currentStreak, longestStreak, totalDays },
      moodTrend: { points: moodPoints, insight: moodInsight },
      focusSessions: [],
      weeklyReviews: [],
      tier: "free",
    })
  } catch (e) {
    console.error("[INSIGHTS ERROR]", e)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}
