import { NextResponse } from "next/server"
import { metered } from "../../../../../../lib/billing/metered"
//@ts-ignore
import { proposeEdit, EDIT_REQUESTS_PER_MINUTE } from "@repo/api/nova/product/note-edit"
//@ts-ignore
import { EDIT_BODY_MAX } from "@repo/api/nova/product/note-edit.types"
import { noteFail, requireNoteLearner } from "../../../../../../lib/nova/note-access"
import { allowAttempt, readSmallJson } from "../../../../../../lib/nova/extension-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string }> }

// POST /api/nova/notes/:id/edit  EditRequest
// Nova's editor proposing changes to one of the learner's notes: one model
// call, given that note. Nothing is stored or changed here; the page applies
// the changes the learner approves through the note's own save
// (product/note-edit.ts). Response: EditResponse.
export async function POST(req: Request, { params }: Context) {
  try {
    const access = await requireNoteLearner()
    if (access.denied) return access.denied
    // Per learner. Each request is a model call.
    if (!allowAttempt(`note-edit:${access.profileId}`, EDIT_REQUESTS_PER_MINUTE, 60_000)) {
      return noteFail(429, "rate_limited", "That's a lot at once. Give it a minute.")
    }
    const read = await readSmallJson(req, EDIT_BODY_MAX)
    if (!read.ok) return noteFail(read.reason === "too_large" ? 413 : 400, read.reason === "too_large" ? "too_long" : "invalid", read.reason === "too_large" ? "That's too much to send at once." : "That isn't an edit Nova can make.")
    const noteId = (await params).id
    const run = await metered(access.platformChatId, () => proposeEdit(access.profileId, noteId, read.body))
    if (!run.ok) return run.response
    const result = run.value as Awaited<ReturnType<typeof proposeEdit>>
    if (result.ok) return NextResponse.json(result, { headers: { "cache-control": "no-store" } })
    const status = result.error === "not_found" ? 404 : result.error === "unavailable" ? 503 : 400
    return NextResponse.json(result, { status })
  } catch (err) {
    console.error("[nova/notes/:id/edit]", err)
    return noteFail(500, "failed", "That didn't work. Try again.")
  }
}
