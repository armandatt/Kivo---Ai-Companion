import { NextResponse } from "next/server"
//@ts-ignore
import { mergeDraft } from "@repo/api/nova/product/capture-drafts"
import { readSmallJson, requireWebLearner } from "../../../../../../lib/nova/extension-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const STATUS: Record<string, number> = { invalid: 400, empty: 400, unknown_subject: 400, too_long: 400, not_found: 404, note_not_found: 404, conflict: 409, not_open: 409 }

// POST /api/nova/drafts/[id]/merge
//   { target: { kind: "new", title, subjectId?, topicName? } | { kind: "existing", noteId }, version, day, preview? }
// preview: what would be added and where; nothing is written. Without it the
// draft goes into the note through the notes module's own guarded writes and
// is marked merged. Sent twice, it answers with the note it made.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireWebLearner()
    if (access.denied) return access.denied
    if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return NextResponse.json({ ok: false, error: "invalid", message: "Choose a note, or create a new one." }, { status: 400 })
    const read = await readSmallJson(req, 8 * 1024)
    if (!read.ok) return NextResponse.json({ ok: false, error: "invalid", message: "Choose a note, or create a new one." }, { status: 400 })
    const { id } = await ctx.params
    const result = await mergeDraft(access.profileId, id, read.body)
    return NextResponse.json(result, { status: result.ok ? 200 : STATUS[result.error] ?? 400, headers: { "cache-control": "no-store" } })
  } catch (err) {
    console.error("[nova/drafts/merge]", err)
    return NextResponse.json({ ok: false, error: "failed", message: "That didn't work. Nothing was changed. Try again." }, { status: 500 })
  }
}
