import { NextResponse } from "next/server"
//@ts-ignore
import { deleteNote, getNote, updateNote } from "@repo/api/nova/product/notes"
import { noteFail, requireNoteLearner } from "../../../../../lib/nova/note-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string }> }

// One note. The id selects among the signed-in learner's own notes only:
// another learner's note is "not found", whether it exists or not.
const NOT_FOUND = () => noteFail(404, "not_found", "That note doesn't exist.")

// GET /api/nova/notes/:id   Response: NoteResponse.
export async function GET(_req: Request, { params }: Context) {
  try {
    const access = await requireNoteLearner()
    if (access.denied) return access.denied
    const note = await getNote(access.profileId, (await params).id)
    return note ? NextResponse.json({ ok: true, note }) : NOT_FOUND()
  } catch (err) {
    console.error("[nova/notes/:id]", err)
    return noteFail(500, "failed", "Couldn't load that note.")
  }
}

// PATCH /api/nova/notes/:id  { title?, body?, subjectId?, topicName? }
// Only those four fields can change. Response: NoteResponse.
export async function PATCH(req: Request, { params }: Context) {
  try {
    const access = await requireNoteLearner()
    if (access.denied) return access.denied
    const result = await updateNote(access.profileId, (await params).id, await req.json().catch(() => null))
    if (result.ok) return NextResponse.json(result)
    return result.error === "not_found" ? NOT_FOUND() : noteFail(400, result.error, result.message)
  } catch (err) {
    console.error("[nova/notes/:id]", err)
    return noteFail(500, "failed", "The note didn't save. Try again.")
  }
}

// DELETE /api/nova/notes/:id   Response: NoteDeleteResponse.
export async function DELETE(_req: Request, { params }: Context) {
  try {
    const access = await requireNoteLearner()
    if (access.denied) return access.denied
    return (await deleteNote(access.profileId, (await params).id)) ? NextResponse.json({ ok: true }) : NOT_FOUND()
  } catch (err) {
    console.error("[nova/notes/:id]", err)
    return noteFail(500, "failed", "The note wasn't deleted. Try again.")
  }
}
