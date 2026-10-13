import { NextResponse } from "next/server"
//@ts-ignore
import { loadGoals, saveGoals } from "@repo/api/nova/product/goals"
//@ts-ignore
import { GOALS_BODY_MAX_BYTES } from "@repo/api/nova/product/goals.types"
import { readSmallJson } from "../../../../lib/nova/extension-access"
import { resolveNovaLearner } from "../../../../lib/nova/resolve-learner"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// What the learner says they are working toward: up to three lines of their
// own. The learner is the signed-in account's; no id is read from the request.
//
// GET /api/nova/goals             what is on record. Response: NovaGoalsView
// PUT /api/nova/goals { goals }   replaces the list; [] clears it. Response: GoalsResponse
// (product/goals.types.ts)
export async function GET() {
  try {
    const learner = await resolveNovaLearner()
    if (learner.kind === "unauthenticated") return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })
    if (learner.kind !== "learner") return NextResponse.json({ status: learner.kind })
    const goals = await loadGoals(learner.platformChatId)
    if (goals === null) return NextResponse.json({ status: "not_connected" })
    return NextResponse.json({ status: "ready", goals })
  } catch (err) {
    console.error("[nova/goals]", err instanceof Error ? err.name : "error")
    return NextResponse.json({ error: "Failed to load goals" }, { status: 500 })
  }
}

const fail = (status: number, error: string, message: string) => NextResponse.json({ ok: false, error, message }, { status })

export async function PUT(req: Request) {
  try {
    const learner = await resolveNovaLearner()
    if (learner.kind === "unauthenticated") return fail(401, "unauthenticated", "Sign in again to change your goals.")
    if (learner.kind !== "learner") return fail(409, learner.kind, "Goals are part of Nova, which this account isn't using.")

    // A body over the limit is refused before it is parsed.
    const read = await readSmallJson(req, GOALS_BODY_MAX_BYTES)
    if (!read.ok) {
      return read.reason === "too_large"
        ? fail(413, "too_large", "That's more than three goals take. Nothing was changed.")
        : fail(422, "invalid", "That is not a list of goals.")
    }
    // Only `goals` is read. Anything else in the body, an id included, is ignored.
    const result = await saveGoals(learner.platformChatId, (read.body as { goals?: unknown } | null)?.goals)
    if (result.status === "not_ready") return fail(409, "not_connected", "Nova isn't set up for this account yet.")
    if (result.status === "invalid") return fail(422, result.error, result.message)
    return NextResponse.json({ ok: true, goals: result.goals })
  } catch (err) {
    console.error("[nova/goals]", err instanceof Error ? err.name : "error")
    return fail(500, "failed", "Your goals weren't saved. Try again.")
  }
}
