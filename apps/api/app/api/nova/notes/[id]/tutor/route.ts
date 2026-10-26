import { NextResponse } from "next/server"
import { metered } from "../../../../../../lib/billing/metered"
//@ts-ignore
import { tutorOnNote, TUTOR_REQUESTS_PER_MINUTE } from "@repo/api/nova/product/note-tutor"
//@ts-ignore
import { TUTOR_BODY_MAX } from "@repo/api/nova/product/note-tutor.types"
import { noteFail, requireNoteLearner } from "../../../../../../lib/nova/note-access"
import { allowAttempt, readSmallJson } from "../../../../../../lib/nova/extension-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string }> }

// POST /api/nova/notes/:id/tutor  TutorRequest
// Nova tutoring the learner from one of their own notes: one model call,
// given that note (and, for some modes, a few related notes and saved
// pages). The conversation travels with the request; nothing is stored, and
// nothing enters the chat pipeline (product/note-tutor.ts).
// Response: TutorResponse.
export async function POST(req: Request, { params }: Context) {
  try {
    const access = await requireNoteLearner()
    if (access.denied) return access.denied
    // Per learner. Each request is a model call.
    if (!allowAttempt(`note-tutor:${access.profileId}`, TUTOR_REQUESTS_PER_MINUTE, 60_000)) {
      return noteFail(429, "rate_limited", "That's a lot at once. Give it a minute.")
    }
    const read = await readSmallJson(req, TUTOR_BODY_MAX)
    if (!read.ok) return noteFail(read.reason === "too_large" ? 413 : 400, read.reason === "too_large" ? "too_long" : "invalid", read.reason === "too_large" ? "That's too much to send at once. Select a shorter passage." : "That isn't something Nova can do with a note.")
    const noteId = (await params).id
    const run = await metered(access.platformChatId, () => tutorOnNote(access.profileId, noteId, read.body))
    if (!run.ok) return run.response
    const result = run.value as Awaited<ReturnType<typeof tutorOnNote>>
    if (result.ok) return NextResponse.json(result, { headers: { "cache-control": "no-store" } })
    const status = result.error === "not_found" ? 404 : result.error === "unavailable" ? 503 : 400
    return NextResponse.json(result, { status })
  } catch (err) {
    console.error("[nova/notes/:id/tutor]", err)
    return noteFail(500, "failed", "That didn't work. Try again.")
  }
}
