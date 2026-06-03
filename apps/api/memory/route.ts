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

    if (!profile?.telegramChatId) {
      return NextResponse.json({ memories: [], telegramConnected: false, personaName: null })
    }

    const messenger = await prisma.messengerUser.findFirst({
      where:  { platform: "telegram", platformChatId: profile.telegramChatId },
      select: {
        memories: {
          where:   { archivedAt: null },
          orderBy: { createdAt: "desc" },
          take:    60,
          select:  { id: true, type: true, key: true, value: true, confidence: true, createdAt: true },
        },
      },
    })

    if (!messenger) {
      return NextResponse.json({ memories: [], telegramConnected: false, personaName: null })
    }

    return NextResponse.json({
      memories: messenger.memories.map((m) => ({
        id:         m.id,
        type:       m.type,
        key:        m.key,
        value:      m.value,
        confidence: m.confidence,
        createdAt:  m.createdAt.toISOString(),
      })),
      telegramConnected: true,
      personaName:       profile.personaName,
    })
  } catch (e) {
    console.error("[MEMORY ERROR]", e)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}
