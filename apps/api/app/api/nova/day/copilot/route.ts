import { NextResponse } from "next/server"
import { metered } from "../../../../../lib/billing/metered"
//@ts-ignore
import { askCopilot, COPILOT_REQUESTS_PER_MINUTE } from "@repo/api/nova/product/day-copilot"
import { dayFail, requireDayLearner } from "../../../../../lib/nova/day-access"
import { allowAttempt, readSmallJson } from "../../../../../lib/nova/extension-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 40

// POST /api/nova/day/copilot  CopilotRequest
// Nova on Today: one model call reads the message; code applies only changes
// to today's flow, checked like the page's own, and returns anything that
// would change a task as a proposal for the learner's yes
// (product/day-copilot.ts). Response: CopilotResponse.
export async function POST(req: Request) {
  try {
    const access = await requireDayLearner()
    if (access.denied) return access.denied
    if (!allowAttempt(`day-copilot:${access.profileId}`, COPILOT_REQUESTS_PER_MINUTE, 60_000)) return dayFail(429, "rate_limited", "That's a lot at once. Give it a minute.")
    const read = await readSmallJson(req, 24 * 1024)
    if (!read.ok) return dayFail(400, "invalid", "Say what you'd like for today.")
    const run = await metered(access.platformChatId, () => askCopilot(access.profileId, access.platformChatId, read.body))
    if (!run.ok) return run.response
    const result = run.value as Awaited<ReturnType<typeof askCopilot>>
    const status = result.ok ? 200 : result.error === "stale" ? 409 : result.error === "unavailable" ? 503 : 400
    return NextResponse.json(result, { status, headers: { "cache-control": "no-store" } })
  } catch (err) {
    console.error("[nova/day/copilot]", err)
    return dayFail(500, "failed", "That didn't work. Your flow is as it was.")
  }
}
