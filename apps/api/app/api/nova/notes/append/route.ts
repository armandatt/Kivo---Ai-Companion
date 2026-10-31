import { NextResponse } from "next/server"
//@ts-ignore
import { listNoteChoices, saveSelectionToNote } from "@repo/api/nova/product/note-append"
//@ts-ignore
import { EVENT_BODY_MAX_BYTES } from "@repo/api/nova/product/learning-events.types"
import { noteFail, requireNoteLearner } from "../../../../../lib/nova/note-access"
import { readSmallJson } from "../../../../../lib/nova/extension-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// The web's saved pages: a saved passage, into one of the learner's notes.
// GET  /api/nova/notes/append?q=&skip=   notes to choose from
// POST /api/nova/notes/append            a selection_saved event, plus noteId
// The same rules as the extension's (product/note-append.ts).
export async function GET(req: Request) {
  try {
    const access = await requireNoteLearner()
    if (access.denied) return access.denied
    const at = new URL(req.url).searchParams
    const view = await listNoteChoices(access.profileId, { query: at.get("q"), skip: Number(at.get("skip")) })
    return NextResponse.json({ ok: true, ...view }, { headers: { "cache-control": "no-store" } })
  } catch (err) {
    console.error("[nova/notes/append GET]", err)
    return noteFail(500, "failed", "That didn't work. Try again.")
  }
}

export async function POST(req: Request) {
  try {
    const access = await requireNoteLearner()
    if (access.denied) return access.denied
    const read = await readSmallJson(req, EVENT_BODY_MAX_BYTES)
    if (!read.ok) return noteFail(400, "invalid", "That isn't something Nova can add to a note.")
    const result = await saveSelectionToNote(access.profileId, read.body, { source: "web" })
    const status = result.success ? 200 : result.error === "not_found" ? 404 : result.error === "rate_limited" ? 429 : result.error === "conflict" ? 409 : 400
    return NextResponse.json(result, { status, headers: { "cache-control": "no-store" } })
  } catch (err) {
    console.error("[nova/notes/append POST]", err)
    return noteFail(500, "failed", "That didn't work. Nothing was added. Try again.")
  }
}
