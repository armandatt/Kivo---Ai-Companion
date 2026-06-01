import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@repo/db/client"
import { getSession } from "../../lib/auth/session"

export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })

  try {
    const body = await req.json()
    const { browserNotifications, emailDigest } = body

    const updates: Record<string, boolean> = {}
    if (typeof browserNotifications === "boolean") updates.browserNotifications = browserNotifications
    if (typeof emailDigest === "boolean") updates.emailDigest = emailDigest

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No valid fields" }, { status: 400 })
    }

    await prisma.userProfile.upsert({
      where: { userId: session.userId },
      update: updates,
      create: { userId: session.userId, secondaryDomains: [], aspirationWords: [], ...updates },
    })

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error("[NOTIFICATIONS PATCH ERROR]", e)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}
