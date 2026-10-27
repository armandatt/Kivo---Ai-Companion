import { NextResponse } from "next/server"
//@ts-ignore
import { saveNoteImage, NOTE_IMAGE_BODY_MAX, NOTE_IMAGE_REQUESTS_PER_MINUTE } from "@repo/api/nova/product/note-images"
import { noteFail, requireNoteLearner } from "../../../../../lib/nova/note-access"
import { allowAttempt, readSmallJson } from "../../../../../lib/nova/extension-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// POST /api/nova/notes/images  { noteId, data (base64), clientKey, sourceUrl?, sourceTitle?, page? }
// An image (a page or region captured from a PDF) for one of the learner's
// notes, checked by its bytes; the page then puts its kivo-image: reference
// in the note through the note's own save (product/note-images.ts).
export async function POST(req: Request) {
  try {
    const access = await requireNoteLearner()
    if (access.denied) return access.denied
    if (!allowAttempt(`note-image:${access.profileId}`, NOTE_IMAGE_REQUESTS_PER_MINUTE, 60_000)) {
      return noteFail(429, "rate_limited", "That's a lot at once. Give it a minute.")
    }
    const read = await readSmallJson(req, NOTE_IMAGE_BODY_MAX)
    if (!read.ok) return noteFail(read.reason === "too_large" ? 413 : 400, read.reason === "too_large" ? "too_large" : "invalid", read.reason === "too_large" ? "That image is too large. Capture a smaller region." : "That image couldn't be read.")
    const result = await saveNoteImage(access.profileId, read.body)
    if (result.ok) return NextResponse.json(result, { headers: { "cache-control": "no-store" } })
    return NextResponse.json(result, { status: result.error === "not_found" ? 404 : result.error === "too_large" ? 413 : 400 })
  } catch (err) {
    console.error("[nova/notes/images POST]", err)
    return noteFail(500, "failed", "That image didn't save. Try again.")
  }
}
