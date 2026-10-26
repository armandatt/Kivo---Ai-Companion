import { NextResponse } from "next/server"
//@ts-ignore
import { previewPaper, PAPER_PREVIEWS_PER_MINUTE } from "@repo/api/nova/product/paper-import"
import { noteFail, requireNoteLearner } from "../../../../../../lib/nova/note-access"
import { allowAttempt, readSmallJson } from "../../../../../../lib/nova/extension-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

// POST /api/nova/notes/papers/preview  { url }
// What importing the paper at that link would bring in: its details from the
// source's own API and how much of its text is openly available
// (product/paper-import.ts, product/paper-fetch.ts). Nothing is stored and no
// model is called. Response: PaperPreviewResponse.
export async function POST(req: Request) {
  try {
    const access = await requireNoteLearner()
    if (access.denied) return access.denied
    // Per learner: each preview asks the source's API.
    if (!allowAttempt(`paper-preview:${access.profileId}`, PAPER_PREVIEWS_PER_MINUTE, 60_000)) {
      return noteFail(429, "rate_limited", "That's a lot of papers at once. Give it a minute.")
    }
    const read = await readSmallJson(req, 8 * 1024)
    if (!read.ok) return noteFail(400, "invalid", "Paste a link to a paper.")
    const result = await previewPaper(access.profileId, read.body)
    if (result.ok) return NextResponse.json(result, { headers: { "cache-control": "no-store" } })
    const status = result.error === "not_found" || result.error === "not_a_paper" ? 404 : result.error === "unavailable" || result.error === "busy" ? 503 : result.error === "failed" ? 500 : 400
    return NextResponse.json(result, { status })
  } catch (err) {
    console.error("[nova/notes/papers/preview]", err)
    return noteFail(500, "failed", "That didn't work. Try again.")
  }
}
