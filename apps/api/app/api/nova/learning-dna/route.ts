import { NextResponse } from "next/server"
//@ts-ignore
import { loadNovaLearningDna } from "@repo/api/nova/product/learning-dna"
import { resolveNovaLearner } from "../../../../lib/nova/resolve-learner"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// GET /api/nova/learning-dna
// What Nova has concluded about how the learner studies, each conclusion
// with its support, its evidence count and whether it is changing.
// Read-only, no LLM call. The learner is always the signed-in account's own:
// the route reads nothing from the request.
// Response: NovaLearningDnaView (packages/api/src/nova/product/learning-dna.types.ts).
export async function GET() {
  try {
    const learner = await resolveNovaLearner()
    if (learner.kind === "unauthenticated") {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })
    }
    if (learner.kind !== "learner") return NextResponse.json({ status: learner.kind })

    return NextResponse.json(await loadNovaLearningDna(learner.platformChatId))
  } catch (err) {
    console.error("[nova/learning-dna]", err)
    return NextResponse.json({ error: "Failed to load Learning DNA" }, { status: 500 })
  }
}
