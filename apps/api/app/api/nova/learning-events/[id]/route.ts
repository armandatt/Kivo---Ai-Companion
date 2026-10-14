import { NextResponse } from "next/server"
//@ts-ignore
import { fileSavedResource, getLearningResource, removeSavedResource } from "@repo/api/nova/product/learning-events"
import { readSmallJson, requireWebLearner } from "../../../../../lib/nova/extension-access"

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

// PATCH /api/nova/learning-events/[id]
// Where a saved page is filed, changed by the learner:
//   { subjectId, topicName? }   file it there (often a place Nova suggested)
//   { keep: true }              keep a link Nova made
//   { undo: true }              undo a link Nova made
//   { dismiss: { subjectId, topicName } }   take one suggestion off the list
// Response: ResourceUpdateResponse. It files a page and nothing else: no
// topic is created and nothing is recorded about what the learner knows.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireWebLearner()
    if (access.denied) return access.denied
    if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
      return NextResponse.json({ ok: false, error: "invalid", message: "That isn't something Nova can do." }, { status: 400 })
    }
    const read = await readSmallJson(req, 1024)
    const body = read.ok && read.body && typeof read.body === "object" && !Array.isArray(read.body) ? read.body as Record<string, unknown> : null
    if (!body) return NextResponse.json({ ok: false, error: "invalid", message: "That isn't something Nova can do." }, { status: 400 })
    const { id } = await params
    const change = body.keep === true ? { kind: "keep" as const }
      : body.undo === true ? { kind: "undo" as const }
      : body.dismiss && typeof body.dismiss === "object" ? { kind: "dismiss" as const, subjectId: (body.dismiss as Record<string, unknown>).subjectId, topicName: (body.dismiss as Record<string, unknown>).topicName }
      : { kind: "file" as const, subjectId: body.subjectId, topicName: body.topicName }
    const result = await fileSavedResource(access.profileId, id, change)
    return NextResponse.json(result, { status: result.ok ? 200 : result.error === "not_found" ? 404 : 400 })
  } catch (err) {
    console.error("[nova/learning-events]", err)
    return NextResponse.json({ ok: false, error: "failed", message: "That didn't work. Try again." }, { status: 500 })
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
