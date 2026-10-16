import { NextResponse } from "next/server"
//@ts-ignore
import { applyStudyEdits, loadStudyStructure } from "@repo/api/nova/product/setup-edit"
import { requireTaskLearner, taskFail } from "../../../../lib/nova/task-access"
import { readSmallJson } from "../../../../lib/nova/extension-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const BODY_MAX_BYTES = 64_000

// GET /api/nova/subjects
// The learner's subjects and topics, with what can be removed and the
// version an edit must be made against. Response: StudyStructureView.
export async function GET() {
  try {
    const access = await requireTaskLearner()
    if (access.denied) {
      return access.status === "unauthenticated" ? access.denied : NextResponse.json({ status: access.status })
    }
    return NextResponse.json({ status: "ready", ...(await loadStudyStructure(access.profileId)) })
  } catch (err) {
    console.error("[nova/subjects]", err)
    return taskFail(500, "failed", "Couldn't load your subjects.")
  }
}

// POST /api/nova/subjects  { version, edits: StudyEdit[] }
// Applies the batch whole, or nothing. 409 when the subjects changed since
// `version` (nothing written), 400 with the issues when an edit is refused.
// Response: StudyEditResponse (product/setup-edit.types.ts).
export async function POST(req: Request) {
  try {
    const access = await requireTaskLearner()
    if (access.denied) return access.denied
    const body = await readSmallJson(req, BODY_MAX_BYTES)
    if (!body.ok) return taskFail(body.reason === "too_large" ? 413 : 400, "invalid", "That isn't a change Nova can make.")
    const result = await applyStudyEdits(access.profileId, body.body)
    if (!result.ok) return NextResponse.json(result, { status: result.error === "stale" ? 409 : 400 })
    return NextResponse.json(result)
  } catch (err) {
    console.error("[nova/subjects]", err)
    return taskFail(500, "failed", "Nothing was changed. Try again.")
  }
}
