import { NextResponse } from "next/server"
//@ts-ignore
import { recordLearnerTimezone } from "@repo/api/nova/product/learning-dna"
import { resolveNovaLearner } from "../../../../lib/nova/resolve-learner"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// PUT /api/nova/timezone  { timezone: "Asia/Kolkata" }
// The learner's device reports its timezone. It is stored only while the
// learner has none, and only on the signed-in account's own learner: the
// body's `timezone` is the single field read.
// Response: TimezoneResponse (learning-dna.types.ts).
export async function PUT(req: Request) {
  try {
    const learner = await resolveNovaLearner()
    if (learner.kind === "unauthenticated") {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })
    }
    if (learner.kind !== "learner") return NextResponse.json({ ok: false, error: learner.kind }, { status: 409 })

    const body = await req.json().catch(() => null) as { timezone?: unknown } | null
    const result = await recordLearnerTimezone(learner.platformChatId, body?.timezone)
    return NextResponse.json(result, { status: result.ok ? 200 : result.error === "invalid_timezone" ? 400 : 409 })
  } catch (err) {
    console.error("[nova/timezone]", err)
    return NextResponse.json({ error: "Failed to save timezone" }, { status: 500 })
  }
}
