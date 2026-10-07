import { NextResponse } from "next/server"
//@ts-ignore
import { loadNovaCreature } from "@repo/api/nova/product/creature"
import { resolveNovaLearner } from "../../../../lib/nova/resolve-learner"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// GET /api/nova/creature
// The numbers behind the Creature page for a Nova learner: the streak Home
// shows, the active days Progress shows, and the level and world health
// worked out from them. Read-only, no LLM call. The learner is always the
// signed-in account's own: the route reads nothing from the request.
// Response: NovaCreatureView (packages/api/src/nova/product/creature.types.ts).
export async function GET() {
  try {
    const learner = await resolveNovaLearner()
    if (learner.kind === "unauthenticated") {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })
    }
    if (learner.kind !== "learner") return NextResponse.json({ status: learner.kind })

    return NextResponse.json(await loadNovaCreature(learner.platformChatId))
  } catch (err) {
    console.error("[nova/creature]", err)
    return NextResponse.json({ error: "Failed to load creature" }, { status: 500 })
  }
}
