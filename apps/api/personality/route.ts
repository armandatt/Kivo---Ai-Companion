import { NextResponse } from "next/server"
import { getSession } from "../lib/auth/session"
import { SIGNAL_ITEMS, SIGNAL_SCALE, SIGNAL_VERSION } from "@repo/api/personality/signal-items"
import { getLatestSignal, reassess } from "@repo/api/personality/personality.service"

// The four personality-signal statements, plus whether this user has answered
// them. Scores and raw answers are never returned.
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })

  try {
    const signal = await getLatestSignal(session.userId)
    return NextResponse.json({
      version: SIGNAL_VERSION,
      items: SIGNAL_ITEMS.map(({ id, text }) => ({ id, text })),
      scale: SIGNAL_SCALE,
      completed: signal !== null,
    })
  } catch (error) {
    console.error("[PERSONALITY GET ERROR]", error)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}

// Re-run the statements. Stores a new assessment and what the engine would
// recommend now; the user's assigned mentor is not changed.
export async function POST(req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  try {
    const answers = body && typeof body === "object" ? (body as { answers?: unknown }).answers : undefined
    const result = await reassess(session.userId, answers)
    if (!result.ok) {
      return NextResponse.json({ error: "Invalid answers", details: result.errors }, { status: 400 })
    }
    return NextResponse.json({ ok: true, version: SIGNAL_VERSION, mentor: result.assignedMentor })
  } catch (error) {
    console.error("[PERSONALITY POST ERROR]", error)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}
