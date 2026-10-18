import { NextResponse } from "next/server"
//@ts-ignore
import { startCheckout } from "@repo/api/billing/service"
import { billingFail, clientIp, jsonOnly, signedInUser, statusFor } from "../../../../lib/billing/route-helpers"

export const runtime = "nodejs"

// POST /api/billing/checkout { plan }: a checkout for one of Kivo's plans,
// for the signed-in account. The plan is a key; its product and price are
// the server's. Returns the provider's checkout address to go to.
export async function POST(req: Request) {
  const bad = jsonOnly(req)
  if (bad) return bad
  const me = await signedInUser()
  if ("denied" in me) return me.denied
  const body = await req.json().catch(() => null) as { plan?: unknown } | null
  try {
    const result = await startCheckout({ userId: me.userId, plan: body?.plan, ip: clientIp(req) })
    return result.ok ? NextResponse.json({ ok: true, url: result.url }) : billingFail(statusFor(result.error), result.error, result.message)
  } catch (err) {
    console.error(`[billing] checkout failed: ${(err as Error).name}`)
    return billingFail(500, "failed", "Couldn't open checkout. Try again in a moment.")
  }
}
