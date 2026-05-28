import { NextResponse } from "next/server"
import { prisma } from "@repo/db/client"
import { getSession, clearSession } from "../lib/auth/session"

export async function DELETE() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })

  try {
    await prisma.user.delete({ where: { id: session.userId } })
    await clearSession()
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error("[DELETE ACCOUNT ERROR]", e)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}
