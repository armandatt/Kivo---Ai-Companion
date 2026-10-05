import { NextResponse } from "next/server"
//@ts-ignore
import { loadNovaPlanner } from "@repo/api/nova/product/planner"
import { resolveNovaLearner } from "../../../../lib/nova/resolve-learner"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// GET /api/nova/planner?minutes=60
// Nova's current plan: today's blocks, this week, upcoming exams, and the
// reasons behind it. `minutes` is the time the student says they have today;
// the Planning Engine refits the day to it. The learner is always the
// signed-in account's own: no id is read from the request.
// Response: NovaPlannerView (packages/api/src/nova/product/planner.types.ts).
export async function GET(req: Request) {
  try {
    const learner = await resolveNovaLearner()
    if (learner.kind === "unauthenticated") {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })
    }
    if (learner.kind !== "learner") return NextResponse.json({ status: learner.kind })

    const raw     = new URL(req.url).searchParams.get("minutes")
    const minutes = raw === null ? null : Number(raw)

    const view = await loadNovaPlanner(learner.platformChatId, {
      availableMinutes: minutes !== null && Number.isFinite(minutes) ? minutes : null,
    })
    return NextResponse.json(view)
  } catch (err) {
    console.error("[nova/planner]", err)
    return NextResponse.json({ error: "Failed to load planner" }, { status: 500 })
  }
}
