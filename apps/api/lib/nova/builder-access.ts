// Build with Nova on the API side: the one place a builder model job is
// paid for and started. The request takes one request from the learner's
// daily AI allowance (or, enforcing, reserves its Nova credits) before anything is claimed (a refusal is the same 429
// every surface shows), then answers at once; the job runs after the
// response, in this process, with its tokens metered as they are used. The
// page polls the draft for the job's real stage, so no request waits for a
// model, and no proxy timeout can cut one short.

import { after, NextResponse } from "next/server"
import { allowanceUsed } from "../billing/metered"
//@ts-ignore
import { entitlementForLearner } from "@repo/api/billing/entitlements"
//@ts-ignore
import { countOnly, spendAiRequest, meterTokensForLearner } from "@repo/api/billing/usage"
//@ts-ignore
import { runJob, type BuilderJob } from "@repo/api/nova/product/builder"
//@ts-ignore
import { startInteraction } from "@repo/api/services/llm-usage"
//@ts-ignore
import { adoptReservation, releaseReservation, reserveForInteraction, reserveNovaFor } from "@repo/api/billing/accounting/nova"
//@ts-ignore
import { enforcing } from "@repo/api/billing/accounting/targets"
//@ts-ignore
import { fairUse } from "@repo/api/billing/accounting/rules"
//@ts-ignore
import { hitLimit } from "@repo/api/billing/accounting/limiter"
import { randomUUID } from "crypto"
import { concurrencyGate, rateGate } from "../rate-limits"


export const builderFail = (status: number, error: string, message: string, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ ok: false, error, message, ...extra }, { status, headers: { "cache-control": "no-store" } })

// `refused`: the response to send. Otherwise allowed: `counted` says whether
// the allowance took the request (not when billing could not be read), for
// the job's usage events, and `reservationId` is the job's Nova credits when
// they are enforced (USAGE_ACCOUNTING=enforce): reserved here, before anything
// is claimed, so a learner out of credits is refused before work starts.
export type Turn = { refused: NextResponse } | { refused: null; counted: boolean; reservationId: string | null; release?: () => Promise<void> }

// Jobs running at once per account (rate-limits builder.jobs): the slot is
// taken here, kept while the job runs after the response, and given back by
// startJob when it ends or by releaseTurn when no job starts.
export async function spendForTurn(platformChatId: string): Promise<Turn> {
  const slot = await concurrencyGate("builder.jobs", { learner: platformChatId })
  if (slot.refused) return { refused: slot.refused }
  const turn = await spendForTurnWithin(platformChatId).catch(async (err: unknown) => { await slot.release(); throw err })
  if (turn.refused) { await slot.release(); return turn }
  return { ...turn, release: slot.release }
}

async function spendForTurnWithin(platformChatId: string): Promise<Turn> {
  // The account's AI rate and Build with Nova's own (rate-limits ai.account,
  // builder.turn), persistent and the same on every surface.
  const limited = await rateGate(["ai.account", "builder.turn"], { learner: platformChatId })
  if (limited) return { refused: limited }
  const credits = enforcing("nova_credits")
  if (credits) {
    // Usage accounting's fair use (USAGE_FAIR_USE novaJobsPerMinute), enforced with the credits.
    const hit = await hitLimit(`builder-turn:${platformChatId}`, fairUse().novaJobsPerMinute, 60_000)
    if (!hit.allowed) return { refused: builderFail(429, "rate_limited", "That's a lot at once. Give it a minute.", { retryAfterSeconds: hit.retryAfterSeconds }) }
  }
  let counted = false
  try {
    // Enforcing credits, the daily meter only counts (billing/usage.ts countOnly).
    const entitled = await entitlementForLearner(platformChatId)
    const ent = credits ? countOnly(entitled) : entitled
    const spend = await spendAiRequest(ent)
    if (!spend.ok) return { refused: allowanceUsed(spend.plan) }
    counted = true
  } catch (err) {
    // A fault in billing never blocks a learner.
    console.error(`[billing] builder allowance unavailable: ${(err as Error).name}`)
    return { refused: null, counted: false, reservationId: null }
  }
  if (!credits) return { refused: null, counted, reservationId: null }
  const admitted = await reserveNovaFor(platformChatId, { feature: "build_with_nova", idempotencyKey: `builder-turn:${randomUUID()}` })
  if (admitted.refused) return { refused: allowanceUsed({ plan: admitted.refused.tier === "free" ? "free" : "pro", credits: admitted.refused }) }
  return { refused: null, counted, reservationId: admitted.reservationId }
}

// A turn whose job never started (the draft was busy, closed, or the route
// failed): its reserved credits go back.
export function releaseTurn(turn: Turn | null | undefined, reason = "job_not_started"): void {
  if (turn && !turn.refused && turn.reservationId) void releaseReservation(turn.reservationId, reason)
  if (turn && !turn.refused && turn.release) void turn.release()
}

export function startJob(platformChatId: string, job: BuilderJob | null, turn: Turn | boolean): void {
  const t = typeof turn === "boolean" ? null : turn
  const counted = typeof turn === "boolean" ? turn : !turn.refused && turn.counted
  const reservationId = t && !t.refused ? t.reservationId : null
  if (!job) { releaseTurn(t); return }
  after(async () => {
    try {
      // The learner is waiting on the page for this job: interactive work,
      // one interaction named by the job.
      await startInteraction(
        { feature: "build_with_nova", surface: "web", learner: platformChatId, requestId: job.jobId, isAllowanceCounted: counted },
        async () => {
          // Usage accounting: the credits reserved for this turn (enforced),
          // or reserved now, once per job (shadow).
          if (reservationId) adoptReservation(reservationId)
          else await reserveForInteraction({ idempotencyKey: `builder:${job.jobId}` })
          return meterTokensForLearner(platformChatId, () => runJob(platformChatId, job))
        },
      )
    } catch (err) {
      console.error("[nova/builder] job crashed:", (err as Error)?.name ?? "error")
    } finally {
      if (t && !t.refused && t.release) await t.release()
    }
  })
}

const STATUS: Record<string, number> = { invalid: 400, not_found: 404, busy: 409, stale: 409, closed: 409, not_ready: 409, too_many: 409, failed: 502, unavailable: 503 }
export const statusFor = (error: string) => STATUS[error] ?? 400
