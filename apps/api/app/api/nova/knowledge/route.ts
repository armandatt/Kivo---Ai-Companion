import { NextResponse } from "next/server"
//@ts-ignore
import { loadNovaKnowledge } from "@repo/api/nova/product/knowledge"
import { resolveNovaLearner } from "../../../../lib/nova/resolve-learner"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// GET /api/nova/knowledge
// What Nova has on record about each of the learner's topics: current level,
// review state, what is due, and the finished sessions behind it. Read-only.
// The learner is always the signed-in account's own: nothing in the request
// selects whose knowledge is returned.
// Response: NovaKnowledgeView (packages/api/src/nova/product/knowledge.types.ts).
export async function GET() {
  try {
    const learner = await resolveNovaLearner()
    if (learner.kind === "unauthenticated") {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })
    }
    if (learner.kind !== "learner") return NextResponse.json({ status: learner.kind })

    return NextResponse.json(await loadNovaKnowledge(learner.platformChatId))
  } catch (err) {
    console.error("[nova/knowledge]", err)
    return NextResponse.json({ error: "Failed to load knowledge" }, { status: 500 })
  }
}
