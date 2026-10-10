import { NextResponse } from "next/server"
//@ts-ignore
import { loadNovaKnowledgeMap } from "@repo/api/nova/product/knowledge-map"
import { resolveNovaLearner } from "../../../../lib/nova/resolve-learner"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// GET /api/nova/knowledge-map
// The learner's subjects, topics, notes and saved pages, and the links
// between them that are on record. Read-only, no LLM call. The learner is
// always the signed-in account's own: the route reads nothing from the
// request. Response: NovaKnowledgeMapView (product/knowledge-map.types.ts).
export async function GET() {
  try {
    const learner = await resolveNovaLearner()
    if (learner.kind === "unauthenticated") {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })
    }
    if (learner.kind !== "learner") return NextResponse.json({ status: learner.kind })

    return NextResponse.json(await loadNovaKnowledgeMap(learner.platformChatId))
  } catch (err) {
    console.error("[nova/knowledge-map]", err)
    return NextResponse.json({ error: "Failed to load the map" }, { status: 500 })
  }
}
