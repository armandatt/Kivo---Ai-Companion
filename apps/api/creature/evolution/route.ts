import { NextResponse } from "next/server"
import { prisma } from "@repo/db/client"
import { getSession } from "../../lib/auth/session"

const STAGE_NAMES = ["egg", "hatchling", "creature", "beast", "legend"] as const

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })

  try {
    const [evolutions, profile] = await Promise.all([
      prisma.creatureEvolution.findMany({
        where: { userId: session.userId },
        orderBy: { evolvedAt: "asc" },
        select: { id: true, stage: true, evolvedAt: true, companionMessage: true },
      }),
      prisma.userProfile.findUnique({
        where: { userId: session.userId },
        select: { creatureName: true, createdAt: true },
      }),
    ])

    let records = evolutions

    // Seed stage-1 record for users with a creature but no history yet
    if (records.length === 0 && profile?.creatureName) {
      const seed = await prisma.creatureEvolution.create({
        data: {
          userId: session.userId,
          stage: 1,
          evolvedAt: profile.createdAt,
          companionMessage: `${profile.creatureName} begins.`,
        },
        select: { id: true, stage: true, evolvedAt: true, companionMessage: true },
      })
      records = [seed]
    }

    const formatted = records.map((e) => ({
      id: e.id,
      stage: e.stage,
      stageName: STAGE_NAMES[Math.min(e.stage - 1, STAGE_NAMES.length - 1)],
      evolvedAt: e.evolvedAt.toISOString(),
      companionMessage: e.companionMessage ?? null,
    }))

    return NextResponse.json({ evolutions: formatted })
  } catch (e) {
    console.error("[EVOLUTION ERROR]", e)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}
