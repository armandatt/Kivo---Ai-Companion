import { NextResponse } from "next/server"
import { metered } from "../../../../../lib/billing/metered"
//@ts-ignore
import { transcribeForNote, IMPORTS_PER_MINUTE, IMPORT_BODY_MAX } from "@repo/api/nova/product/note-import"
import { noteFail, requireNoteLearner } from "../../../../../lib/nova/note-access"
import { allowAttempt, readSmallJson } from "../../../../../lib/nova/extension-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
// Reading a long PDF can take most of a minute.
export const maxDuration = 90

// POST /api/nova/notes/import  { file: { name, data (base64) } }
// Nova's transcription of one PDF or image (PNG, JPEG, WebP; up to 3 MB and
// 20 pages), for the learner to review and save as a note. The file is
// checked by its bytes, read by the one LLM client, and not kept; nothing is
// stored (product/note-import.ts). Text and Markdown files are read in the
// browser and never come here.
// Response: NoteImportResponse.
export async function POST(req: Request) {
  try {
    const access = await requireNoteLearner()
    if (access.denied) return access.denied
    const read = await readSmallJson(req, IMPORT_BODY_MAX)
    if (!read.ok) return noteFail(read.reason === "too_large" ? 413 : 400, read.reason === "too_large" ? "too_large" : "invalid", read.reason === "too_large" ? "That file is too large. Up to 3 MB." : "That file couldn't be read.")
    if (!allowAttempt(`note-import:${access.profileId}`, IMPORTS_PER_MINUTE, 60_000)) {
      return noteFail(429, "rate_limited", "That's a lot of files at once. Give it a minute.")
    }
    const run = await metered(access.platformChatId, () => transcribeForNote(read.body))
    if (!run.ok) return run.response
    const result = run.value as Awaited<ReturnType<typeof transcribeForNote>>
    if (result.ok) return NextResponse.json(result, { headers: { "cache-control": "no-store" } })
    const status = result.error === "unavailable" ? 503 : result.error === "too_large" ? 413 : 400
    return NextResponse.json(result, { status })
  } catch (err) {
    console.error("[nova/notes/import]", err)
    return noteFail(500, "failed", "That didn't work. Try again.")
  }
}
