import { NextResponse } from "next/server"
import { resolveNovaLearner } from "../../../../lib/nova/resolve-learner"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// GET /api/nova/companion
// Which companion the signed-in account uses: { companion: "nova" | "rex" }.
// The dashboard asks only when its own server-side lookup could not answer.
export async function GET() {
  try {
    const learner = await resolveNovaLearner()
    if (learner.kind === "unauthenticated") {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })
    }
    return NextResponse.json({ companion: learner.kind === "not_nova" ? "rex" : "nova" })
  } catch (err) {
    console.error("[nova/companion]", err)
    return NextResponse.json({ error: "Failed to resolve companion" }, { status: 500 })
  }
}
