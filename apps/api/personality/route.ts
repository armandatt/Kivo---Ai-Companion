import { NextResponse } from "next/server"
import { getSession } from "../lib/auth/session"
import { SIGNAL_ITEMS, SIGNAL_SCALE, SIGNAL_VERSION } from "@repo/api/personality/signal-items"
import { STYLE_QUESTIONS, STYLE_VERSION } from "@repo/api/personality/style-items"
import { getLatestSignal, getStatedStyle, reassess, restateStyle } from "@repo/api/personality/personality.service"

// How this user asked to be helped (the v2 preference questions, with their
// current choices), plus the older four statements and whether they were
// answered. Scores and raw v1 answers are never returned.
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })

  try {
    const [signal, style] = await Promise.all([getLatestSignal(session.userId), getStatedStyle(session.userId)])
    return NextResponse.json({
      version: SIGNAL_VERSION,
      items: SIGNAL_ITEMS.map(({ id, text }) => ({ id, text })),
      scale: SIGNAL_SCALE,
      completed: signal !== null,
      style: {
        version: STYLE_VERSION,
        questions: STYLE_QUESTIONS.map(q => ({ id: q.id, question: q.question, options: q.options.map(({ value, label, hint }) => ({ value, label, hint })) })),
        // The learner's own choices; null when they have not answered these.
        choices: style?.choices ?? null,
      },
    })
  } catch (error) {
    console.error("[PERSONALITY GET ERROR]", error)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}

// { style: { explanation, feedback, pacing } } replaces the stated preferences
// (a new assessment row; the newest is the one used).
// { answers: { s1..s4 } } re-runs the older statements: stores a new
// assessment and what the engine would recommend now; the assigned mentor is
// not changed.
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
    const fields = body && typeof body === "object" ? body as { answers?: unknown; style?: unknown } : {}
    if (fields.style !== undefined) {
      const result = await restateStyle(session.userId, fields.style)
      if (!result.ok) return NextResponse.json({ error: "Invalid answers", details: result.errors }, { status: 400 })
      return NextResponse.json({ ok: true, version: STYLE_VERSION, choices: result.style.choices })
    }
    const result = await reassess(session.userId, fields.answers)
    if (!result.ok) {
      return NextResponse.json({ error: "Invalid answers", details: result.errors }, { status: 400 })
    }
    return NextResponse.json({ ok: true, version: SIGNAL_VERSION, mentor: result.assignedMentor })
  } catch (error) {
    console.error("[PERSONALITY POST ERROR]", error)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}
