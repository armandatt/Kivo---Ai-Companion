import { NextResponse } from "next/server"
//@ts-ignore
import { addHighlight, listHighlights, HIGHLIGHT_REQUESTS_PER_MINUTE } from "@repo/api/nova/product/pdf-highlights"
import { noteFail, requireNoteLearner } from "../../../../../lib/nova/note-access"
import { allowAttempt, readSmallJson } from "../../../../../lib/nova/extension-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// GET /api/nova/notes/highlights?url=<the document's address>
// The learner's own highlights on that PDF (product/pdf-highlights.ts).
export async function GET(req: Request) {
  try {
    const access = await requireNoteLearner()
    if (access.denied) return access.denied
    const highlights = await listHighlights(access.profileId, new URL(req.url).searchParams.get("url"))
    if (!highlights) return noteFail(400, "invalid", "That isn't a document's address.")
    return NextResponse.json({ ok: true, highlights }, { headers: { "cache-control": "no-store" } })
  } catch (err) {
    console.error("[nova/notes/highlights GET]", err)
    return noteFail(500, "failed", "Your highlights couldn't be loaded.")
  }
}

// POST /api/nova/notes/highlights  { docUrl, page, rects, text, color, clientKey }
// One highlight, made once per clientKey however often it is sent.
export async function POST(req: Request) {
  try {
    const access = await requireNoteLearner()
    if (access.denied) return access.denied
    if (!allowAttempt(`note-highlight:${access.profileId}`, HIGHLIGHT_REQUESTS_PER_MINUTE, 60_000)) {
      return noteFail(429, "rate_limited", "That's a lot at once. Give it a minute.")
    }
    const read = await readSmallJson(req, 64_000)
    if (!read.ok) return noteFail(read.reason === "too_large" ? 413 : 400, "invalid", "That highlight couldn't be saved.")
    const result = await addHighlight(access.profileId, read.body)
    if (result.ok) return NextResponse.json(result, { headers: { "cache-control": "no-store" } })
    return NextResponse.json(result, { status: result.error === "too_many" ? 409 : 400 })
  } catch (err) {
    console.error("[nova/notes/highlights POST]", err)
    return noteFail(500, "failed", "That highlight didn't save. Try again.")
  }
}
