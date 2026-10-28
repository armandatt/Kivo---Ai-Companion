import { NextResponse } from "next/server"
import { metered } from "../../../../../lib/billing/metered"
//@ts-ignore
import { proposeNewNote } from "@repo/api/nova/product/note-proposal"
//@ts-ignore
import { PROPOSAL_BODY_MAX, PROPOSAL_REQUESTS_PER_MINUTE } from "@repo/api/nova/product/note-proposal.types"
import { noteFail, requireNoteLearner } from "../../../../../lib/nova/note-access"
import { allowAttempt, readSmallJson } from "../../../../../lib/nova/extension-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
// Reading files can take most of a minute.
export const maxDuration = 90

// POST /api/nova/notes/propose  NoteProposalRequest
// Nova's editor proposing how a new note starts: a title, an outline and
// where to file it among the learner's own subjects and topics, from what
// they said and the files they gave (PDF, PNG, JPEG, WebP; checked by their
// bytes, not kept). Nothing is stored or created here; the note is made by
// POST /api/nova/notes when the learner creates it (product/note-proposal.ts).
// Response: NoteProposalResponse.
export async function POST(req: Request) {
  try {
    const access = await requireNoteLearner()
    if (access.denied) return access.denied
    if (!allowAttempt(`note-propose:${access.profileId}`, PROPOSAL_REQUESTS_PER_MINUTE, 60_000)) {
      return noteFail(429, "rate_limited", "That's a lot at once. Give it a minute.")
    }
    const read = await readSmallJson(req, PROPOSAL_BODY_MAX)
    if (!read.ok) return noteFail(read.reason === "too_large" ? 413 : 400, read.reason === "too_large" ? "too_large" : "invalid", read.reason === "too_large" ? "Files can add up to 3 MB." : "That isn't something Nova can start a note from.")
    const run = await metered(access.platformChatId, () => proposeNewNote(access.profileId, read.body))
    if (!run.ok) return run.response
    const result = run.value as Awaited<ReturnType<typeof proposeNewNote>>
    if (result.ok) return NextResponse.json(result, { headers: { "cache-control": "no-store" } })
    return NextResponse.json(result, { status: result.error === "unavailable" ? 503 : 400 })
  } catch (err) {
    console.error("[nova/notes/propose]", err)
    return noteFail(500, "failed", "That didn't work. Try again.")
  }
}
