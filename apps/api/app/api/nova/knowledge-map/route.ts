import { NextResponse } from "next/server"
//@ts-ignore
import { loadNovaKnowledgeMap } from "@repo/api/nova/product/knowledge-map"
import { resolveNovaLearner } from "../../../../lib/nova/resolve-learner"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// GET /api/nova/knowledge-map?workspace=<id>|all
// A workspace's subjects, topics, tasks, notes and saved pages (by default
// the one the learner worked on last; "all" for everything), and the links
// between them that are on record. Read-only, no LLM call. The learner is
// always the signed-in account's own; a workspace id is used only among
// their own. Response: NovaKnowledgeMapView (product/knowledge-map.types.ts).
export async function GET(req: Request) {
  try {
    const learner = await resolveNovaLearner()
    if (learner.kind === "unauthenticated") {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })
    }
    if (learner.kind !== "learner") return NextResponse.json({ status: learner.kind })

    const workspace = new URL(req.url).searchParams.get("workspace")
    return NextResponse.json(await loadNovaKnowledgeMap(learner.platformChatId, { workspace: workspace && workspace.length <= 64 ? workspace : null }))
  } catch (err) {
    console.error("[nova/knowledge-map]", err)
    return NextResponse.json({ error: "Failed to load the map" }, { status: 500 })
  }
}
