import { NextResponse } from "next/server"
//@ts-ignore
import { deleteCollection, renameCollection } from "@repo/api/nova/product/resource-collections"
import { readSmallJson, requireWebLearner } from "../../../../../../lib/nova/extension-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string }> }

// PATCH  /api/nova/saved/collections/:id { name }   rename
// DELETE /api/nova/saved/collections/:id            delete; its pages stay saved, in no collection
// Only the learner's own; anyone else's id is not found.
export async function PATCH(req: Request, { params }: Context) {
  try {
    const access = await requireWebLearner()
    if (access.denied) return access.denied
    if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return NextResponse.json({ ok: false, error: "invalid", message: "That isn't a name." }, { status: 400 })
    const read = await readSmallJson(req, 1024)
    if (!read.ok) return NextResponse.json({ ok: false, error: "invalid", message: "That isn't a name." }, { status: 400 })
    const result = await renameCollection(access.profileId, (await params).id, read.body)
    return NextResponse.json(result, { status: result.ok ? 200 : result.error === "not_found" ? 404 : result.error === "exists" ? 409 : 400 })
  } catch (err) {
    console.error("[nova/saved/collections/:id]", err)
    return NextResponse.json({ ok: false, error: "failed", message: "That didn't save. Try again." }, { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: Context) {
  try {
    const access = await requireWebLearner()
    if (access.denied) return access.denied
    const result = await deleteCollection(access.profileId, (await params).id)
    return NextResponse.json(result, { status: result.ok ? 200 : 404 })
  } catch (err) {
    console.error("[nova/saved/collections/:id]", err)
    return NextResponse.json({ ok: false, error: "failed", message: "That didn't work. Try again." }, { status: 500 })
  }
}
