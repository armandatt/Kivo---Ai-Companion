import { NextResponse } from "next/server"
//@ts-ignore
import { planCalendar } from "@repo/api/nova/product/calendar-planner"
import { readSmallJson } from "../../../../../lib/nova/extension-access"
import { requireTaskLearner, taskFail } from "../../../../../lib/nova/task-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const WHO = { open: "your calendar", part: "The calendar is" }

// POST /api/nova/calendar/plan  { taskIds?: string[], settings?: { dayStart, dayEnd, focusPerDay, bufferMinutes } }
// What needs time, which blocks were missed, when each task could happen,
// and each coming day's load (product/calendar-planner.ts). Reads only: a
// proposal becomes a block only when the page creates it (POST /api/nova/calendar).
export async function POST(req: Request) {
  try {
    const access = await requireTaskLearner(WHO)
    if (access.denied) return access.denied
    const read = await readSmallJson(req, 8 * 1024)
    const body = read.ok && read.body && typeof read.body === "object" ? read.body as Record<string, unknown> : {}
    const r = await planCalendar(access.profileId, { taskIds: body.taskIds, settings: body.settings })
    return NextResponse.json(r, { status: r.ok ? 200 : r.error === "invalid" ? 400 : 500, headers: { "cache-control": "no-store" } })
  } catch (err) {
    console.error("[nova/calendar/plan]", err instanceof Error ? err.name : "error")
    return taskFail(500, "failed", "Couldn't plan your calendar.")
  }
}
