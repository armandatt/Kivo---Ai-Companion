// Build with Nova on the API side: the one place a builder model job is
// paid for and started. The request takes one request from the learner's
// daily AI allowance before anything is claimed (a refusal is the same 429
// every surface shows), then answers at once; the job runs after the
// response, in this process, with its tokens metered as they are used. The
// page polls the draft for the job's real stage, so no request waits for a
// model, and no proxy timeout can cut one short.

import { after, NextResponse } from "next/server"
import { allowanceUsed } from "../billing/metered"
//@ts-ignore
import { entitlementForLearner } from "@repo/api/billing/entitlements"
//@ts-ignore
import { spendAiRequest, meterTokensForLearner } from "@repo/api/billing/usage"
//@ts-ignore
import { runJob, type BuilderJob } from "@repo/api/nova/product/builder"
//@ts-ignore
import { startInteraction } from "@repo/api/services/llm-usage"
import { allowAttempt } from "./extension-access"

export const TURNS_PER_MINUTE = 8

export const builderFail = (status: number, error: string, message: string, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ ok: false, error, message, ...extra }, { status, headers: { "cache-control": "no-store" } })

// `refused`: the response to send. Otherwise allowed, and `counted` says
// whether the allowance took the request (not when billing could not be
// read), for the job's usage events.
export async function spendForTurn(platformChatId: string): Promise<{ refused: NextResponse } | { refused: null; counted: boolean }> {
  if (!allowAttempt(`builder-turn:${platformChatId}`, TURNS_PER_MINUTE, 60_000)) {
    return { refused: builderFail(429, "rate_limited", "That's a lot at once. Give it a minute.") }
  }
  try {
    const ent = await entitlementForLearner(platformChatId)
    const spend = await spendAiRequest(ent)
    return spend.ok ? { refused: null, counted: true } : { refused: allowanceUsed(spend.plan) }
  } catch (err) {
    // A fault in billing never blocks a learner.
    console.error(`[billing] builder allowance unavailable: ${(err as Error).name}`)
    return { refused: null, counted: false }
  }
}

export function startJob(platformChatId: string, job: BuilderJob | null, counted: boolean): void {
  if (!job) return
  after(async () => {
    try {
      // The learner is waiting on the page for this job: interactive work,
      // one interaction named by the job.
      await startInteraction(
        { feature: "build_with_nova", surface: "web", learner: platformChatId, requestId: job.jobId, isAllowanceCounted: counted },
        () => meterTokensForLearner(platformChatId, () => runJob(platformChatId, job)),
      )
    } catch (err) {
      console.error("[nova/builder] job crashed:", (err as Error)?.name ?? "error")
    }
  })
}

const STATUS: Record<string, number> = { invalid: 400, not_found: 404, busy: 409, stale: 409, closed: 409, not_ready: 409, too_many: 409, failed: 502, unavailable: 503 }
export const statusFor = (error: string) => STATUS[error] ?? 400
