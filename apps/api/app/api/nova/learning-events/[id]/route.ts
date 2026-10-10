import { NextResponse } from "next/server"
//@ts-ignore
import { getLearningResource, removeSavedResource } from "@repo/api/nova/product/learning-events"
import { requireWebLearner } from "../../../../../lib/nova/extension-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// One of the signed-in learner's own events. The id is looked up together
// with the learner's profile: someone else's id is "not found", the same as
// an id that never existed.

// GET /api/nova/learning-events/[id]
// Response: LearningResourceResponse.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireWebLearner()
    if (access.denied) return access.denied
    const { id } = await params
    const result = await getLearningResource(access.profileId, id)
    return NextResponse.json(result, { status: result.ok ? 200 : 404 })
  } catch (err) {
    console.error("[nova/learning-events]", err)
    return NextResponse.json({ ok: false, error: "failed", message: "Couldn't load that page." }, { status: 500 })
  }
}

// DELETE /api/nova/learning-events/[id]
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireWebLearner()
    if (access.denied) return access.denied
    const { id } = await params
    const removed = await removeSavedResource(access.profileId, id)
    return removed ? NextResponse.json({ ok: true }) : NextResponse.json({ ok: false, error: "not_found", message: "Nova doesn't have that page." }, { status: 404 })
  } catch (err) {
    console.error("[nova/learning-events]", err)
    return NextResponse.json({ ok: false, error: "failed", message: "That didn't work. Try again." }, { status: 500 })
  }
}
