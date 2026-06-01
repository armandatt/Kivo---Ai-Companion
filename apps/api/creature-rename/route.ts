import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@repo/db/client"
import { getSession } from "../lib/auth/session"

export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const name = typeof body.name === "string" ? body.name.trim() : ""
  if (!name || name.length > 50) {
    return NextResponse.json({ error: "Invalid name" }, { status: 400 })
  }

  await prisma.userProfile.upsert({
    where: { userId: session.userId },
    update: { creatureName: name },
    create: { userId: session.userId, creatureName: name, secondaryDomains: [], aspirationWords: [] },
  })

  return NextResponse.json({ ok: true })
}
