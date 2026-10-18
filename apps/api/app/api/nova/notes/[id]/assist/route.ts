import { NextResponse } from "next/server"
import { metered } from "../../../../../../lib/billing/metered"
//@ts-ignore
import { assistWithNote, NOTE_ASSISTS_PER_MINUTE } from "@repo/api/nova/product/note-assist"
import { noteFail, requireNoteLearner } from "../../../../../../lib/nova/note-access"
import { allowAttempt, readSmallJson } from "../../../../../../lib/nova/extension-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string }> }

// POST /api/nova/notes/:id/assist  { action: "summarize" | "structure" | "concepts" | "links" | "ask", question? }
// Nova's help on one of the learner's own notes: one model call, given that
// note and a few of their related notes and saved pages. Nothing is stored,
// and nothing enters the chat pipeline (product/note-assist.ts). Suggested
// links and rewrites come back as proposals for the page to show.
// Response: NoteAssistResponse.
export async function POST(req: Request, { params }: Context) {
  try {
    const access = await requireNoteLearner()
    if (access.denied) return access.denied
    // Per learner. Each request is a model call.
    if (!allowAttempt(`note-assist:${access.profileId}`, NOTE_ASSISTS_PER_MINUTE, 60_000)) {
      return noteFail(429, "rate_limited", "That's a lot at once. Give it a minute.")
    }
    const read = await readSmallJson(req, 4 * 1024)
    if (!read.ok) return noteFail(400, "invalid", "That isn't something Nova can do with a note.")
    const noteId = (await params).id
    const run = await metered(access.platformChatId, () => assistWithNote(access.profileId, noteId, read.body))
    if (!run.ok) return run.response
    const result = run.value as Awaited<ReturnType<typeof assistWithNote>>
    if (result.ok) return NextResponse.json(result, { headers: { "cache-control": "no-store" } })
    const status = result.error === "not_found" ? 404 : result.error === "unavailable" ? 503 : 400
    return NextResponse.json(result, { status })
  } catch (err) {
    console.error("[nova/notes/:id/assist]", err)
    return noteFail(500, "failed", "That didn't work. Try again.")
  }
}
