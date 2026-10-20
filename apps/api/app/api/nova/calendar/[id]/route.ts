import { NextResponse } from "next/server"
//@ts-ignore
import { deleteEvent, skipOccurrence, updateEvent } from "@repo/api/nova/product/calendar"
import { EVENT_BODY_MAX_BYTES } from "@repo/api/nova/product/calendar.types"
import { readSmallJson } from "../../../../../lib/nova/extension-access"
import { requireTaskLearner, taskFail } from "../../../../../lib/nova/task-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string }> }

const WHO = { open: "your calendar", part: "The calendar is" }

// One event. The id selects among the signed-in learner's own events only:
// another learner's event is "not found", whether it exists or not.
const NOT_FOUND = () => taskFail(404, "not_found", "That event doesn't exist.")

// PATCH /api/nova/calendar/:id  CalendarEventInput (any subset)
// Response: CalendarEventResponse.
export async function PATCH(req: Request, { params }: Context) {
  try {
    const access = await requireTaskLearner(WHO)
    if (access.denied) return access.denied
    const read = await readSmallJson(req, EVENT_BODY_MAX_BYTES)
    if (!read.ok) return taskFail(read.reason === "too_large" ? 413 : 400, read.reason === "too_large" ? "too_large" : "invalid", "That change couldn't be read.")
    const result = await updateEvent(access.profileId, (await params).id, read.body)
    if (result.ok) return NextResponse.json(result)
    return result.error === "not_found" ? NOT_FOUND() : taskFail(400, result.error, result.message)
  } catch (err) {
    console.error("[nova/calendar/:id]", err instanceof Error ? err.name : "error")
    return taskFail(500, "failed", "That change wasn't saved. Try again.")
  }
}

// DELETE /api/nova/calendar/:id
// DELETE /api/nova/calendar/:id                       the event (every occurrence)
// DELETE /api/nova/calendar/:id?occurrence=YYYY-MM-DD  one occurrence of a repeating event
export async function DELETE(req: Request, { params }: Context) {
  try {
    const access = await requireTaskLearner(WHO)
    if (access.denied) return access.denied
    const id = (await params).id
    const occurrence = new URL(req.url).searchParams.get("occurrence")
    if (occurrence !== null) {
      const result = await skipOccurrence(access.profileId, id, occurrence)
      return NextResponse.json(result, { status: result.ok ? 200 : result.error === "not_found" ? 404 : result.error === "failed" ? 409 : 400 })
    }
    return (await deleteEvent(access.profileId, id)) ? NextResponse.json({ ok: true }) : NOT_FOUND()
  } catch (err) {
    console.error("[nova/calendar/:id]", err instanceof Error ? err.name : "error")
    return taskFail(500, "failed", "The event wasn't deleted. Try again.")
  }
}
