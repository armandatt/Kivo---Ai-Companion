import { NextResponse } from "next/server"
//@ts-ignore
import { deleteMap, previewMapDeletion } from "@repo/api/nova/product/workspaces"
import { noteFail, requireNoteLearner } from "../../../../../lib/nova/note-access"
import { readSmallJson } from "../../../../../lib/nova/extension-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// POST /api/nova/knowledge-map/delete
//   { action: "preview", workspaceId | subjectId }               what would go
//   { action: "delete",  workspaceId | subjectId, fingerprint }  exactly that, or nothing
// A whole map in one go, instead of card by card. The learner is the session's;
// ids are used only with their profile. Rules: product/workspaces.ts.
export async function POST(req: Request) {
  try {
    const access = await requireNoteLearner()
    if (access.denied) return access.denied
    const read = await readSmallJson(req, 2048)
    const body = read.ok && read.body && typeof read.body === "object" ? read.body as Record<string, unknown> : null
    const target = typeof body?.workspaceId === "string" ? { workspaceId: body.workspaceId } : typeof body?.subjectId === "string" ? { subjectId: body.subjectId } : null
    if (!body || !target) return noteFail(400, "invalid", "That isn't something Nova can delete.")
    if (body.action === "preview") {
      const scope = await previewMapDeletion(access.platformChatId, access.profileId, target)
      return scope
        ? NextResponse.json({ ok: true, scope }, { headers: { "cache-control": "no-store" } })
        : noteFail(404, "not_found", "That isn't in your Kivo any more.")
    }
    if (body.action !== "delete" || typeof body.fingerprint !== "string") return noteFail(400, "invalid", "That isn't something Nova can delete.")
    const result = await deleteMap(access.platformChatId, access.profileId, target, body.fingerprint)
    return NextResponse.json(result, { status: result.ok ? 200 : result.error === "not_found" ? 404 : 409, headers: { "cache-control": "no-store" } })
  } catch (err) {
    console.error("[nova/knowledge-map/delete]", err)
    return noteFail(500, "failed", "That didn't work. Nothing was deleted. Try again.")
  }
}
