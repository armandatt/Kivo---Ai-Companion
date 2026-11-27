import { NextResponse } from "next/server"
//@ts-ignore
import { loadNoteReading, saveNoteReading } from "@repo/api/nova/product/note-reading"
import { noteFail, requireNoteLearner } from "../../../../../lib/nova/note-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// GET /api/nova/notes/reading  → { ok, reading: { font, size } }
// PUT /api/nova/notes/reading  { font: "sans" | "serif" | "mono", size: "s" | "m" | "l" }
// How the learner reads notes, kept on their profile (bug batch 28 Nov, item 10).
export async function GET() {
  try {
    const access = await requireNoteLearner()
    if (access.denied) return access.denied
    return NextResponse.json({ ok: true, reading: await loadNoteReading(access.profileId) })
  } catch (err) {
    console.error("[nova/notes/reading]", err)
    return noteFail(500, "failed", "Couldn't load your reading setting.")
  }
}

export async function PUT(req: Request) {
  try {
    const access = await requireNoteLearner()
    if (access.denied) return access.denied
    const reading = await saveNoteReading(access.profileId, await req.json().catch(() => null))
    if (!reading) return noteFail(400, "invalid", "Choose sans, serif or mono, and S, M or L.")
    return NextResponse.json({ ok: true, reading })
  } catch (err) {
    console.error("[nova/notes/reading]", err)
    return noteFail(500, "failed", "That didn't save. Try again.")
  }
}
