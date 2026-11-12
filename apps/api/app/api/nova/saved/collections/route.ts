import { NextResponse } from "next/server"
//@ts-ignore
import { createCollection, listCollections } from "@repo/api/nova/product/resource-collections"
import { readSmallJson, requireWebLearner } from "../../../../../lib/nova/extension-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// GET  /api/nova/saved/collections            the learner's collections, with counts
// POST /api/nova/saved/collections { name }   make one (the same name again returns it)
// Response: CollectionResponse.
export async function GET() {
  try {
    const access = await requireWebLearner()
    if (access.denied) return access.denied
    return NextResponse.json({ ok: true, collections: await listCollections(access.profileId) }, { headers: { "cache-control": "no-store" } })
  } catch (err) {
    console.error("[nova/saved/collections]", err)
    return NextResponse.json({ ok: false, error: "failed", message: "That didn't load. Try again." }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const access = await requireWebLearner()
    if (access.denied) return access.denied
    if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return NextResponse.json({ ok: false, error: "invalid", message: "That isn't a collection." }, { status: 400 })
    const read = await readSmallJson(req, 1024)
    if (!read.ok) return NextResponse.json({ ok: false, error: "invalid", message: "That isn't a collection." }, { status: 400 })
    const result = await createCollection(access.profileId, read.body)
    return NextResponse.json(result, { status: result.ok ? 200 : result.error === "too_many" ? 409 : 400 })
  } catch (err) {
    console.error("[nova/saved/collections]", err)
    return NextResponse.json({ ok: false, error: "failed", message: "That didn't save. Try again." }, { status: 500 })
  }
}
