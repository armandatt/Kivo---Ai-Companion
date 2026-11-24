// Runs one AI request for a learner inside their plan's daily allowance
// (packages/api/src/billing). Refused once the day's allowance is used, with
// the same 429 every surface understands; the tokens its model calls use go
// on the account's meter. A fault in billing itself never blocks a learner:
// the work runs, and the fault is logged. `use` names the feature (and the
// surface, the web unless said) on the usage event of every model call
// inside it.

import { NextResponse } from "next/server"
//@ts-ignore
import { entitlementForLearner } from "@repo/api/billing/entitlements"
//@ts-ignore
import { upgradeLine } from "@repo/api/billing/offer"
//@ts-ignore
import { recordTokens, withAiAllowance } from "@repo/api/billing/usage"
//@ts-ignore
import { meterLlmUsage, startInteraction, type UsageFeature, type UsageSurface } from "@repo/api/services/llm-usage"
import { aiAdmission } from "../rate-limits"

export interface MeteredUse { feature: UsageFeature; surface?: UsageSurface }

// A refused AI request: 429 with `error: "allowance_used"` (what every page
// already reads) and, when the month's Nova credits refused it, `code` naming
// the exhausted allowance, the tier and when it renews.
type Refusal = { plan: "free" | "pro"; credits?: { code: string; tier: "free" | "plus" | "pro"; used: number; limit: number; resetsAt: string | null } }

// Where a page sends someone who wants to see their plan and allowances.
export const PLAN_URL = "/settings/billing"

const renewal = (iso: string | null) => iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" }) : null

export function allowanceUsed(refusal: Refusal | "free" | "pro") {
  const r: Refusal = typeof refusal === "string" ? { plan: refusal } : refusal
  if (r.credits) {
    const on = renewal(r.credits.resetsAt)
    // Only a plan that can be bought now is named (billing/offer.ts).
    const next = upgradeLine(r.credits.tier, "nova")
    const message = `You've used this month's ${r.credits.limit.toLocaleString("en-US")} Nova credits.${on ? ` They renew on ${on}.` : " They renew next month."}${next} Everything you made is still here.`
    return NextResponse.json({ ok: false, success: false, error: "allowance_used", code: r.credits.code, message, plan: r.plan, tier: r.credits.tier, used: r.credits.used, limit: r.credits.limit, resetsAt: r.credits.resetsAt, planUrl: PLAN_URL }, { status: 429 })
  }
  const message = r.plan === "free"
    ? `You've used today's Nova allowance on Free. It resets tomorrow.${upgradeLine("free", "nova").replace(/ a month\.$/, " Nova credits a month.")}`
    : "You've used today's Nova allowance. It resets tomorrow."
  return NextResponse.json({ ok: false, success: false, error: "allowance_used", message, plan: r.plan, planUrl: PLAN_URL }, { status: 429 })
}

// Before the allowance: the account-wide AI rate and at-once limit
// (rate-limits ai.account, the same on every surface), held until the work
// ends. A rate refusal is a temporary 429 `rate_limited`, never
// `allowance_used`, and is decided before anything is reserved.
export async function metered<T>(platformChatId: string, work: () => Promise<T>, use: MeteredUse): Promise<{ ok: true; value: T } | { ok: false; response: NextResponse }> {
  const admission = await aiAdmission(platformChatId)
  if (admission.refused) return { ok: false, response: admission.refused }
  try {
    return await meteredWithin(platformChatId, work, use)
  } finally {
    await admission.release()
  }
}

async function meteredWithin<T>(platformChatId: string, work: () => Promise<T>, use: MeteredUse): Promise<{ ok: true; value: T } | { ok: false; response: NextResponse }> {
  const entry = { feature: use.feature, surface: use.surface ?? "web", learner: platformChatId }
  let ent: Awaited<ReturnType<typeof entitlementForLearner>>
  try {
    ent = await entitlementForLearner(platformChatId)
  } catch (err) {
    console.error(`[billing] entitlement unavailable: ${(err as Error).name}`)
    return { ok: true, value: await startInteraction({ ...entry, isAllowanceCounted: false }, work) }
  }
  const result = await withAiAllowance(ent, work, new Date(), entry)
  return result.ok ? { ok: true, value: result.value } : { ok: false, response: allowanceUsed(result.spend) }
}

// Work inside a task already counted (the browser agent: one task, one
// request, however many steps; packages/api/src/nova/product/agent-ticket.ts).
// Not counted again on the allowance, but every token its model calls use
// still goes on the account's meter and the usage events, under `use`.
// `taskId` names the task on every step's usage event (requestId), so usage
// accounting adds the step's cost to that task (billing/accounting/browser.ts).
export async function withinCountedTask<T>(platformChatId: string, work: () => Promise<T>, use: MeteredUse, taskId: string | null = null): Promise<T> {
  const entry = { feature: use.feature, surface: use.surface ?? "web", learner: platformChatId, isAllowanceCounted: false, requestId: taskId }
  let usageKey: string | null = null
  try { usageKey = (await entitlementForLearner(platformChatId)).usageKey } catch (err) { console.error(`[billing] entitlement unavailable: ${(err as Error).name}`) }
  if (!usageKey) return startInteraction(entry, work)
  const key = usageKey
  const pending: Array<Promise<unknown>> = []
  const value = await meterLlmUsage((usage: Parameters<typeof recordTokens>[1]) => { pending.push(recordTokens(key, usage).catch(() => undefined)) }, () => startInteraction({ ...entry, usageKey: key }, work))
  await Promise.all(pending)
  return value
}
