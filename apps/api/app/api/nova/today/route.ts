import { NextResponse } from "next/server"
//@ts-ignore
import { loadNovaToday } from "@repo/api/nova/product/today"
import { resolveNovaLearner } from "../../../../lib/nova/resolve-learner"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// GET /api/nova/today?minutes=40&subject=Data%20Structures
// The Home page's answer to "what should I do right now?".
// Response: NovaTodayView (packages/api/src/nova/product/today.types.ts).
export async function GET(req: Request) {
  try {
    const learner = await resolveNovaLearner()
    if (learner.kind === "unauthenticated") {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })
    }
    if (learner.kind !== "learner") return NextResponse.json({ status: learner.kind })

    const params  = new URL(req.url).searchParams
    const raw     = params.get("minutes")
    const minutes = raw === null ? null : Number(raw)

    const view = await loadNovaToday(learner.platformChatId, {
      availableMinutes: minutes !== null && Number.isFinite(minutes) ? minutes : null,
      learnerName:      learner.name,
      // The subject chosen for today, checked against the learner's own.
      focusSubject:     params.get("subject"),
    })
    return NextResponse.json(view)
  } catch (err) {
    console.error("[nova/today]", err)
    return NextResponse.json({ error: "Failed to load today" }, { status: 500 })
  }
}
