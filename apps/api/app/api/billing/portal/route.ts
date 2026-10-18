import { NextResponse } from "next/server"
//@ts-ignore
import { openPortal } from "@repo/api/billing/service"
import { billingFail, jsonOnly, signedInUser, statusFor } from "../../../../lib/billing/route-helpers"

export const runtime = "nodejs"

// POST /api/billing/portal: the provider's billing portal for the signed-in
// account (cancel, change card, invoices). Returns its address.
export async function POST(req: Request) {
  const bad = jsonOnly(req)
  if (bad) return bad
  const me = await signedInUser()
  if ("denied" in me) return me.denied
  try {
    const result = await openPortal({ userId: me.userId })
    return result.ok ? NextResponse.json({ ok: true, url: result.url }) : billingFail(statusFor(result.error), result.error, result.message)
  } catch (err) {
    console.error(`[billing] portal failed: ${(err as Error).name}`)
    return billingFail(500, "failed", "Couldn't open the billing portal. Try again in a moment.")
  }
}
