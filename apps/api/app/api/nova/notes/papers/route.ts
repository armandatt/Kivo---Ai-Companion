import { NextResponse } from "next/server"
import { metered } from "../../../../../lib/billing/metered"
//@ts-ignore
import { importPaper, PAPER_IMPORTS_PER_MINUTE } from "@repo/api/nova/product/paper-import"
//@ts-ignore
import { PAPER_BODY_MAX } from "@repo/api/nova/product/paper.types"
import { noteFail, requireNoteLearner } from "../../../../../lib/nova/note-access"
import { allowAttempt, readSmallJson } from "../../../../../lib/nova/extension-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
// Fetching a paper's text, and transcribing its PDF when asked, can take most of a minute.
export const maxDuration = 90

// POST /api/nova/notes/papers  PaperImportRequest
// Imports the paper at that link as one of the learner's notes, filed under
// the subject and topic they chose (product/paper-import.ts), through the
// ordinary createNote. A paper they already have returns that note. Only a
// request to transcribe the PDF calls a model, and only that one uses the AI
// allowance. Response: PaperImportResponse.
export async function POST(req: Request) {
  try {
    const access = await requireNoteLearner()
    if (access.denied) return access.denied
    if (!allowAttempt(`paper-import:${access.profileId}`, PAPER_IMPORTS_PER_MINUTE, 60_000)) {
      return noteFail(429, "rate_limited", "That's a lot of papers at once. Give it a minute.")
    }
    const read = await readSmallJson(req, PAPER_BODY_MAX)
    if (!read.ok) return noteFail(read.reason === "too_large" ? 413 : 400, read.reason === "too_large" ? "too_large" : "invalid", read.reason === "too_large" ? "That's too much to send at once." : "That isn't a paper Kivo can import.")
    const body = read.body as { transcribe?: unknown }
    let result: Awaited<ReturnType<typeof importPaper>>
    if (body && body.transcribe === true) {
      const run = await metered(access.platformChatId, () => importPaper(access.profileId, read.body))
      if (!run.ok) return run.response
      result = run.value as Awaited<ReturnType<typeof importPaper>>
    } else result = await importPaper(access.profileId, read.body)
    if (result.ok) return NextResponse.json(result, { headers: { "cache-control": "no-store" } })
    const status = result.error === "not_found" || result.error === "not_a_paper" ? 404 : result.error === "unavailable" || result.error === "busy" || result.error === "transcription_failed" ? 503 : result.error === "too_large" ? 413 : result.error === "failed" ? 500 : 400
    return NextResponse.json(result, { status })
  } catch (err) {
    console.error("[nova/notes/papers]", err)
    return noteFail(500, "failed", "That didn't work. Try again.")
  }
}
