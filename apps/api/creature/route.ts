import { NextResponse } from "next/server"
import { prisma } from "@repo/db/client"
import { getSession } from "../lib/auth/session"

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function getEvolutionStage(streak: number): "egg" | "hatchling" | "creature" | "beast" | "legend" {
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
    const [profile, workoutLogs] = await Promise.all([
      prisma.userProfile.findUnique({ where: { userId: session.userId } }),
      prisma.workoutLog.findMany({
        where: { userId: session.userId, completed: true },
        select: { date: true },
        orderBy: { date: "desc" },
        take: 60,
      }),
    ])

    const completedDateSet = new Set(workoutLogs.map((l) => toDateStr(l.date)))
    const today = toDateStr(new Date())
    const yesterday = toDateStr(new Date(Date.now() - 86400000))

    let currentStreak = 0
    let anchor: Date | null = null
    if (completedDateSet.has(today)) anchor = new Date(today + "T00:00:00")
    else if (completedDateSet.has(yesterday)) anchor = new Date(yesterday + "T00:00:00")

    if (anchor) {
      const check = new Date(anchor)
      while (completedDateSet.has(toDateStr(check))) {
        currentStreak++
        check.setDate(check.getDate() - 1)
      }
    }

    const stage = getEvolutionStage(currentStreak)
    const evolutionAvailable = [3, 7, 21, 50].includes(currentStreak)
    const state = currentStreak === 0 ? "resting" : currentStreak < 3 ? "quiet" : "active"

    return NextResponse.json({
      creature: {
        name: profile?.creatureName ?? "Your Creature",
        type: profile?.creatureType ?? null,
        color: profile?.creatureColor ?? null,
        stage,
        currentStreak,
        evolutionAvailable,
        state,
      },
      evolutionHistory: [],
      creatureLogs: [],
    })
  } catch (e) {
    console.error("[CREATURE ERROR]", e)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}
