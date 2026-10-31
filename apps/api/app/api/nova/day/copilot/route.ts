import { NextResponse } from "next/server"
import { metered } from "../../../../../lib/billing/metered"
//@ts-ignore
import { askCopilot, COPILOT_BODY_MAX, COPILOT_REQUESTS_PER_MINUTE } from "@repo/api/nova/product/day-copilot"
import { dayFail, requireDayLearner } from "../../../../../lib/nova/day-access"
import { allowAttempt, readSmallJson } from "../../../../../lib/nova/extension-access"
import { answerLive } from "../../../../../lib/nova/stream-answer"
//@ts-ignore
import { COPILOT_LIVE_KEYS } from "@repo/api/nova/product/reply-stream"
//@ts-ignore
import { liveGenerate } from "@repo/api/nova/product/reply-live"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

// POST /api/nova/day/copilot  CopilotRequest
// Nova on Today: one model call reads the message; code asks, or returns a
// proposal (checked like the page's own changes, written nowhere) that is
// applied only on the learner's yes (POST /api/nova/day { action: "approve" }),
// and anything that would change a task as a proposal for the task routes
// (product/day-copilot.ts). Response: CopilotResponse.
export async function POST(req: Request) {
  try {
    const access = await requireDayLearner()
    if (access.denied) return access.denied
    if (!allowAttempt(`day-copilot:${access.profileId}`, COPILOT_REQUESTS_PER_MINUTE, 60_000)) return dayFail(429, "rate_limited", "That's a lot at once. Give it a minute.")
    const read = await readSmallJson(req, COPILOT_BODY_MAX)
    if (!read.ok) return dayFail(read.reason === "too_large" ? 413 : 400, "invalid", read.reason === "too_large" ? "That's too much to send at once. Attach a smaller file." : "Say what you'd like for today.")
    return await answerLive(req, async onLive => {
      const run = await metered(access.platformChatId, () => onLive ? askCopilot(access.profileId, access.platformChatId, read.body, liveGenerate(onLive, COPILOT_LIVE_KEYS)) : askCopilot(access.profileId, access.platformChatId, read.body))
      if (!run.ok) return run.response
      const result = run.value as Awaited<ReturnType<typeof askCopilot>>
      const status = result.ok ? 200 : result.error === "stale" ? 409 : result.error === "unavailable" ? 503 : 400
      return NextResponse.json(result, { status, headers: { "cache-control": "no-store" } })
    }, () => dayFail(500, "failed", "That didn't work. Your flow is as it was."))
  } catch (err) {
    console.error("[nova/day/copilot]", err)
    return dayFail(500, "failed", "That didn't work. Your flow is as it was.")
  }
}
