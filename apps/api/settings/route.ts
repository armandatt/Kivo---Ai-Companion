import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@repo/db/client"
import { getSession } from "../lib/auth/session"
//@ts-ignore
import { parseCheckinTime } from "@repo/api/nova/decision/proactive-decision"
//@ts-ignore
import { normalizeAccountability } from "@repo/api/personality/mentor-compatibility"
//@ts-ignore
import { currentZoneName, isValidTimezone } from "@repo/api/nova/engines/learner-calendar"

const COMPANIONS = new Set(["nova", "rex", "zen"])

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
          browserNotifications: true,
          emailDigest: true,
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
      browserNotifications: profile?.browserNotifications ?? true,
      emailDigest: profile?.emailDigest ?? true,
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
    // A session can outlive its account (the cookie lasts thirty days). There
    // is nothing to save settings on, and trying would fail on the database.
    const account = await prisma.user.findUnique({ where: { id: session.userId }, select: { id: true } })
    if (!account) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })

    const body = await req.json()
    const { persona, checkInTime, accountabilityStyle, timezone, name } = body

    const profileUpdates: Record<string, unknown> = {}
    // The companion is one of the ones that exist. It decides which learner
    // the account is, so nothing else may be written here.
    if (persona !== undefined) {
      const chosen = String(persona).trim().toLowerCase()
      if (!COMPANIONS.has(chosen)) return NextResponse.json({ error: "Unknown companion" }, { status: 400 })
      profileUpdates.primaryPersona = chosen
    }
    // A check-in time is "HH:MM", or nothing (null or "" clears it). Anything
    // else is refused: the scheduler would silently ignore it.
    if (checkInTime !== undefined) {
      if (checkInTime === null || checkInTime === "") profileUpdates.preferredCheckInTime = null
      else {
        const minute = parseCheckinTime(String(checkInTime))
        if (minute === null) return NextResponse.json({ error: "Check-in time must be HH:MM" }, { status: 400 })
        profileUpdates.preferredCheckInTime = `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`
      }
    }
    // Stored the way onboarding stores it: "soft" (Gentle Nudges) or "hard" (No Mercy).
    if (accountabilityStyle !== undefined) profileUpdates.accountabilityStyle = normalizeAccountability(String(accountabilityStyle)) ?? String(accountabilityStyle)
    // A real timezone, or nothing. Anything else is refused: the scheduler
    // would read it as "no timezone" and lose the one already on record.
    if (timezone !== undefined) {
      if (timezone === null || timezone === "") profileUpdates.timezone = null
      else if (typeof timezone === "string" && timezone.length <= 64 && isValidTimezone(timezone)) profileUpdates.timezone = currentZoneName(timezone)
      else return NextResponse.json({ error: "Unknown timezone" }, { status: 400 })
    }

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
