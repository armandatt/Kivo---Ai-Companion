// Runs one AI request for a learner inside their plan's daily allowance
// (packages/api/src/billing). Refused once the day's allowance is used, with
// the same 429 every surface understands; the tokens its model calls use go
// on the account's meter. A fault in billing itself never blocks a learner:
// the work runs, and the fault is logged.

import { NextResponse } from "next/server"
//@ts-ignore
import { entitlementForLearner } from "@repo/api/billing/entitlements"
//@ts-ignore
import { withAiAllowance } from "@repo/api/billing/usage"

export function allowanceUsed(plan: "free" | "pro") {
  const message = plan === "free"
    ? "You've used today's Nova allowance on Free. It resets tomorrow, or try Pro for much more."
    : "You've used today's Nova allowance. It resets tomorrow."
  return NextResponse.json({ ok: false, success: false, error: "allowance_used", message, plan }, { status: 429 })
}

export async function metered<T>(platformChatId: string, work: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; response: NextResponse }> {
  let ent: Awaited<ReturnType<typeof entitlementForLearner>>
  try {
    ent = await entitlementForLearner(platformChatId)
  } catch (err) {
    console.error(`[billing] entitlement unavailable: ${(err as Error).name}`)
    return { ok: true, value: await work() }
  }
  const result = await withAiAllowance(ent, work)
  return result.ok ? { ok: true, value: result.value } : { ok: false, response: allowanceUsed(result.spend.plan) }
}
