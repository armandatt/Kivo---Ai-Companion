import { NextResponse } from "next/server"
//@ts-ignore
import { acceptDraft, changeDayFlow, loadDayFlow, setDayView, startFocus, undoDayFlow } from "@repo/api/nova/product/day-flow"
import { dayFail, requireDayLearner } from "../../../../lib/nova/day-access"
import { allowAttempt, readSmallJson } from "../../../../lib/nova/extension-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// GET /api/nova/day: today's flow (NovaDayView). Reading writes nothing; with
// no flow saved, Nova's draft is worked out and shown apart.
export async function GET() {
  try {
    const access = await requireDayLearner()
    if (access.denied) return access.denied
    return NextResponse.json(await loadDayFlow(access.profileId, access.platformChatId), { headers: { "cache-control": "no-store" } })
  } catch (err) {
    console.error("[nova/day GET]", err)
    return dayFail(500, "failed", "Today's flow didn't load. Try again.")
  }
}

// POST /api/nova/day: one change to today's flow, made against the version
// the page has (product/day-flow.ts).
//   { action: "ops", version, ops: FlowOp[] }     change the flow
//   { action: "accept", version, draftId }        take Nova's draft
//   { action: "undo", version }                   back one change
//   { action: "view", version, view }             list or schedule
//   { action: "start", version, itemId, minutes } a focus session on an item (minutes 0: no time limit)
// Response: DayFlowResponse (409 stale with the flow as it now stands).
export async function POST(req: Request) {
  try {
    const access = await requireDayLearner()
    if (access.denied) return access.denied
    if (!allowAttempt(`day-flow:${access.profileId}`, 60, 60_000)) return dayFail(429, "rate_limited", "That's a lot of changes at once. Give it a moment.")
    const read = await readSmallJson(req, 16 * 1024)
    if (!read.ok) return dayFail(400, "invalid", "That isn't a change Today can make.")
    const body = read.body as Record<string, unknown>
    const base = { profileId: access.profileId, platformChatId: access.platformChatId, version: body?.version }
    const result =
      body?.action === "ops" ? await changeDayFlow({ ...base, ops: body.ops, by: "learner" })
      : body?.action === "accept" ? await acceptDraft({ ...base, draftId: body.draftId })
      : body?.action === "undo" ? await undoDayFlow(base)
      : body?.action === "view" ? await setDayView({ ...base, view: body.view })
      : body?.action === "start" ? await startFocus({ ...base, itemId: body.itemId, minutes: body.minutes })
      : null
    if (!result) return dayFail(400, "invalid", "That isn't a change Today can make.")
    const status = result.ok ? 200 : result.error === "stale" ? 409 : result.error === "not_found" ? 404 : result.error === "failed" ? 500 : 400
    return NextResponse.json(result, { status, headers: { "cache-control": "no-store" } })
  } catch (err) {
    console.error("[nova/day POST]", err)
    return dayFail(500, "failed", "That didn't save. Your flow is as it was.")
  }
}
