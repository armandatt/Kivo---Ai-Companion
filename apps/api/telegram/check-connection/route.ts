import { NextResponse } from "next/server"
import { prisma } from "@repo/db/client"
import { getSession } from "../../lib/auth/session"

export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })
  }

  const profile = await prisma.userProfile.findUnique({
    where: { userId: session.userId },
    select: { telegramConnected: true },
  })

  return NextResponse.json({ connected: profile?.telegramConnected ?? false })
}
