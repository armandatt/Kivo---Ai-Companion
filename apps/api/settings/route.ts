import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@repo/db/client"
import { getSession } from "../lib/auth/session"

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })

  try {
    const [user, profile, googleAccount] = await Promise.all([
      prisma.user.findUnique({
        where: { id: session.userId },
        select: { email: true, name: true },
      }),
      prisma.userProfile.findUnique({
        where: { userId: session.userId },
        select: {
          primaryPersona: true,
          preferredCheckInTime: true,
          accountabilityStyle: true,
          timezone: true,
          telegramConnected: true,
          telegramChatId: true,
        },
      }),
      prisma.account.findFirst({
        where: { userId: session.userId, provider: "google" },
        select: { id: true },
      }),
    ])

    return NextResponse.json({
      email: user?.email ?? "",
      name: user?.name ?? "",
      isGoogleOAuth: !!googleAccount,
      persona: profile?.primaryPersona ?? null,
      checkInTime: profile?.preferredCheckInTime ?? null,
      accountabilityStyle: profile?.accountabilityStyle ?? null,
      timezone: profile?.timezone ?? null,
      tier: "free",
      platforms: {
        telegram: {
          connected: profile?.telegramConnected ?? false,
          handle: profile?.telegramChatId ?? null,
          broken: false,
        },
        whatsapp: { connected: false, handle: null, broken: false },
      },
    })
  } catch (e) {
    console.error("[SETTINGS GET ERROR]", e)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })

  try {
    const body = await req.json()
    const { persona, checkInTime, accountabilityStyle, timezone, name } = body

    const profileUpdates: Record<string, unknown> = {}
    if (persona !== undefined) profileUpdates.primaryPersona = String(persona)
    if (checkInTime !== undefined) profileUpdates.preferredCheckInTime = String(checkInTime)
    if (accountabilityStyle !== undefined) profileUpdates.accountabilityStyle = String(accountabilityStyle)
    if (timezone !== undefined) profileUpdates.timezone = String(timezone)

    if (Object.keys(profileUpdates).length > 0) {
      await prisma.userProfile.upsert({
        where: { userId: session.userId },
        update: profileUpdates,
        create: { userId: session.userId, secondaryDomains: [], aspirationWords: [], ...profileUpdates },
      })
    }

    if (name !== undefined && typeof name === "string" && name.trim()) {
      await prisma.user.update({
        where: { id: session.userId },
        data: { name: name.trim() },
      })
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error("[SETTINGS PATCH ERROR]", e)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}
