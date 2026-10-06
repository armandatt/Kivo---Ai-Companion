import { NextResponse } from "next/server"
//@ts-ignore
import { loadNovaProgress } from "@repo/api/nova/product/progress"
import { resolveNovaLearner } from "../../../../lib/nova/resolve-learner"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// GET /api/nova/progress
// "Have I actually changed?": counted sessions, topic growth, consistency and
// the moments that mark them, all from what is already on record. Read-only,
// no LLM call. The learner is always the signed-in account's own: the route
// reads nothing from the request, so no parameter can select whose progress
// is returned.
// Response: NovaProgressView (packages/api/src/nova/product/progress.types.ts).
export async function GET() {
  try {
    const learner = await resolveNovaLearner()
    if (learner.kind === "unauthenticated") {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })
    }
    if (learner.kind !== "learner") return NextResponse.json({ status: learner.kind })

    return NextResponse.json(await loadNovaProgress(learner.platformChatId))
  } catch (err) {
    console.error("[nova/progress]", err)
    return NextResponse.json({ error: "Failed to load progress" }, { status: 500 })
  }
}
