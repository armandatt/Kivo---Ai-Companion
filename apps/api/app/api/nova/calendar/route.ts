import { NextResponse } from "next/server"
//@ts-ignore
import { createEvent, loadCalendar } from "@repo/api/nova/product/calendar"
import { EVENT_BODY_MAX_BYTES } from "@repo/api/nova/product/calendar.types"
import { readSmallJson } from "../../../../lib/nova/extension-access"
import { requireTaskLearner, taskFail } from "../../../../lib/nova/task-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const WHO = { open: "your calendar", part: "The calendar is" }

// GET /api/nova/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD
// The signed-in learner's events overlapping the range, tasks due in it and
// deadlines dated in it (at most 62 days). The learner is the account's own;
// only the range is read from the request. Response: NovaCalendarView.
export async function GET(req: Request) {
  try {
    const access = await requireTaskLearner(WHO)
    if (access.denied) {
      return access.status === "unauthenticated" ? access.denied : NextResponse.json({ status: access.status })
    }
    const url = new URL(req.url)
    const result = await loadCalendar(access.profileId, url.searchParams.get("from"), url.searchParams.get("to"))
    if (!result.ok) return taskFail(400, result.error, result.message)
    return NextResponse.json(result.view)
  } catch (err) {
    console.error("[nova/calendar]", err instanceof Error ? err.name : "error")
    return taskFail(500, "failed", "Couldn't load your calendar.")
  }
}

// POST /api/nova/calendar  CalendarEventInput
// Creates one event. With a clientKey, a repeat returns the event it made.
// Response: CalendarEventResponse (201 created, 200 already made).
export async function POST(req: Request) {
  try {
    const access = await requireTaskLearner(WHO)
    if (access.denied) return access.denied
    const read = await readSmallJson(req, EVENT_BODY_MAX_BYTES)
    if (!read.ok) return taskFail(read.reason === "too_large" ? 413 : 400, read.reason === "too_large" ? "too_large" : "invalid", "That event couldn't be read.")
    const result = await createEvent(access.profileId, read.body)
    if (!result.ok) return taskFail(400, result.error, result.message)
    return NextResponse.json(result, { status: result.created ? 201 : 200 })
  } catch (err) {
    console.error("[nova/calendar]", err instanceof Error ? err.name : "error")
    return taskFail(500, "failed", "The event wasn't saved. Try again.")
  }
}
