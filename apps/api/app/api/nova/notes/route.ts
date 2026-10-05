import { NextResponse } from "next/server"
//@ts-ignore
import { createNote, listNotes } from "@repo/api/nova/product/notes"
import { noteFail, requireNoteLearner } from "../../../../lib/nova/note-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// The learner's own notes. Deterministic: no LLM call, and note text goes to
// the notes table and nowhere else. It is never passed to /api/nova/message,
// the Understanding Brain or consolidation.

// GET /api/nova/notes?q=&subjectId=&topic=
// The learner's notes, most recently updated first, without their full text.
// Response: NovaNotesView (packages/api/src/nova/product/notes.types.ts).
export async function GET(req: Request) {
  try {
    const access = await requireNoteLearner()
    if (access.denied) {
      // The page branches on these, the same way Home and Planner do.
      if (access.status !== "unauthenticated") return NextResponse.json({ status: access.status })
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })
    }
    const params = new URL(req.url).searchParams
    return NextResponse.json(await listNotes(access.profileId, {
      q:         params.get("q"),
      subjectId: params.get("subjectId"),
      topic:     params.get("topic"),
    }))
  } catch (err) {
    console.error("[nova/notes]", err)
    return NextResponse.json({ error: "Failed to load notes" }, { status: 500 })
  }
}

// POST /api/nova/notes  { title, body, subjectId?, topicName? }
// Request: NoteInput. Response: NoteResponse.
export async function POST(req: Request) {
  try {
    const access = await requireNoteLearner()
    if (access.denied) return access.denied

    const result = await createNote(access.profileId, await req.json().catch(() => null))
    if (!result.ok) return noteFail(400, result.error, result.message)
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    console.error("[nova/notes]", err)
    return noteFail(500, "failed", "The note didn't save. Try again.")
  }
}
