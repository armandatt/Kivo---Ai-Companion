import { NextResponse } from "next/server"
//@ts-ignore
import { removeHighlight } from "@repo/api/nova/product/pdf-highlights"
import { noteFail, requireNoteLearner } from "../../../../../../lib/nova/note-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string }> }

// DELETE /api/nova/notes/highlights/:id
// Removes one of the learner's own highlights; the document is untouched.
export async function DELETE(_req: Request, { params }: Context) {
  try {
    const access = await requireNoteLearner()
    if (access.denied) return access.denied
    const { removed } = await removeHighlight(access.profileId, (await params).id)
    return NextResponse.json({ ok: true, removed }, { headers: { "cache-control": "no-store" } })
  } catch (err) {
    console.error("[nova/notes/highlights DELETE]", err)
    return noteFail(500, "failed", "That highlight wasn't removed. Try again.")
  }
}
