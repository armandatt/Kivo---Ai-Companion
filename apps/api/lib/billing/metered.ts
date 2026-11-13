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
import { recordTokens, withAiAllowance } from "@repo/api/billing/usage"
//@ts-ignore
import { meterLlmUsage, startInteraction, type UsageFeature, type UsageSurface } from "@repo/api/services/llm-usage"

export interface MeteredUse { feature: UsageFeature; surface?: UsageSurface }

export function allowanceUsed(plan: "free" | "pro") {
  const message = plan === "free"
    ? "You've used today's Nova allowance on Free. It resets tomorrow, or try Pro for much more."
    : "You've used today's Nova allowance. It resets tomorrow."
  return NextResponse.json({ ok: false, success: false, error: "allowance_used", message, plan }, { status: 429 })
}

export async function metered<T>(platformChatId: string, work: () => Promise<T>, use: MeteredUse): Promise<{ ok: true; value: T } | { ok: false; response: NextResponse }> {
  const entry = { feature: use.feature, surface: use.surface ?? "web", learner: platformChatId }
  let ent: Awaited<ReturnType<typeof entitlementForLearner>>
  try {
    ent = await entitlementForLearner(platformChatId)
  } catch (err) {
    console.error(`[billing] entitlement unavailable: ${(err as Error).name}`)
    return { ok: true, value: await startInteraction({ ...entry, isAllowanceCounted: false }, work) }
  }
  const result = await withAiAllowance(ent, work, new Date(), entry)
  return result.ok ? { ok: true, value: result.value } : { ok: false, response: allowanceUsed(result.spend.plan) }
}

// Work inside a task already counted (the browser agent: one task, one
// request, however many steps; packages/api/src/nova/product/agent-ticket.ts).
// Not counted again on the allowance, but every token its model calls use
// still goes on the account's meter and the usage events, under `use`.
export async function withinCountedTask<T>(platformChatId: string, work: () => Promise<T>, use: MeteredUse): Promise<T> {
  const entry = { feature: use.feature, surface: use.surface ?? "web", learner: platformChatId, isAllowanceCounted: false }
  let usageKey: string | null = null
  try { usageKey = (await entitlementForLearner(platformChatId)).usageKey } catch (err) { console.error(`[billing] entitlement unavailable: ${(err as Error).name}`) }
  if (!usageKey) return startInteraction(entry, work)
  const key = usageKey
  const pending: Array<Promise<unknown>> = []
  const value = await meterLlmUsage((usage: Parameters<typeof recordTokens>[1]) => { pending.push(recordTokens(key, usage).catch(() => undefined)) }, () => startInteraction({ ...entry, usageKey: key }, work))
  await Promise.all(pending)
  return value
}
