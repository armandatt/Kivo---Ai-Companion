import { NextResponse } from "next/server"
//@ts-ignore
import { listDeletedKnowledge, restoreKnowledge } from "@repo/api/nova/product/workspaces"
import { noteFail, requireNoteLearner } from "../../../../../lib/nova/note-access"
import { readSmallJson } from "../../../../../lib/nova/extension-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// GET  /api/nova/knowledge-map/trash               what the learner deleted from the map and can bring back
// POST /api/nova/knowledge-map/trash { restore: id } put one back
// The learner is the session's; an id is used only with their profile.
// Rules: product/knowledge-trash.ts.
export async function GET() {
  try {
    const access = await requireNoteLearner()
    if (access.denied) return access.denied
    return NextResponse.json({ ok: true, items: await listDeletedKnowledge(access.profileId) }, { headers: { "cache-control": "no-store" } })
  } catch (err) {
    console.error("[nova/knowledge-map/trash GET]", err)
    return noteFail(500, "failed", "Recently deleted didn't load. Try again.")
  }
}

export async function POST(req: Request) {
  try {
    const access = await requireNoteLearner()
    if (access.denied) return access.denied
    const read = await readSmallJson(req, 1024)
    const id = read.ok && read.body && typeof (read.body as { restore?: unknown }).restore === "string" ? (read.body as { restore: string }).restore : null
    if (!id || id.length > 64) return noteFail(400, "invalid", "That isn't something Nova can restore.")
    const result = await restoreKnowledge(access.profileId, id)
    return NextResponse.json(result, { status: result.ok ? 200 : 404, headers: { "cache-control": "no-store" } })
  } catch (err) {
    console.error("[nova/knowledge-map/trash POST]", err)
    return noteFail(500, "failed", "That didn't work. Nothing was restored. Try again.")
  }
}
