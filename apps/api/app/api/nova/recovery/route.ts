import { NextResponse } from "next/server"
//@ts-ignore
import { actOnRecovery, getRecovery } from "@repo/api/nova/product/recovery"
import { requireTaskLearner, taskFail } from "../../../../lib/nova/task-access"
import { readSmallJson } from "../../../../lib/nova/extension-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// An accept or undo names at most RECOVERY_MOVES_MAX moves of ~100 bytes.
const BODY_MAX_BYTES = 48_000

// GET /api/nova/recovery
// Where the learner is after missed days, and the proposal waiting for them.
// Reading writes nothing. The learner is the signed-in account's own.
// Response: NovaRecoveryView (product/recovery.types.ts).
export async function GET() {
  try {
    const access = await requireTaskLearner()
    if (access.denied) {
      return access.status === "unauthenticated" ? access.denied : NextResponse.json({ status: access.status })
    }
    return NextResponse.json(await getRecovery(access.profileId))
  } catch (err) {
    console.error("[nova/recovery]", err)
    return taskFail(500, "failed", "Couldn't work out how things stand.")
  }
}

// POST /api/nova/recovery
//   { action: "accept", proposalId, moves }   applies the proposal, if the record still gives that id
//   { action: "undo", moves }                 puts back what an accept moved
// Response: RecoveryActionResponse. 409 when the record changed (nothing written).
export async function POST(req: Request) {
  try {
    const access = await requireTaskLearner()
    if (access.denied) return access.denied
    const body = await readSmallJson(req, BODY_MAX_BYTES)
    if (!body.ok) return taskFail(body.reason === "too_large" ? 413 : 400, "invalid", "That isn't a change Nova can make.")
    const result = await actOnRecovery(access.profileId, body.body)
    if (!result.ok) {
      const status = result.error === "changed" ? 409 : result.error === "refused" ? 422 : 400
      return NextResponse.json(result, { status })
    }
    return NextResponse.json(result)
  } catch (err) {
    console.error("[nova/recovery]", err)
    return taskFail(500, "failed", "Nothing was changed. Try again.")
  }
}
