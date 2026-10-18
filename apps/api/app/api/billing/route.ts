import { NextResponse } from "next/server"
//@ts-ignore
import { billingView } from "@repo/api/billing/service"
import { billingFail, signedInUser } from "../../../lib/billing/route-helpers"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// GET /api/billing: the signed-in account's plan, trial, subscription and
// today's AI use. Read from the database; nothing the browser says counts.
export async function GET() {
  const me = await signedInUser()
  if ("denied" in me) return me.denied
  try {
    return NextResponse.json({ ok: true, ...(await billingView(me.userId)) }, { headers: { "cache-control": "no-store" } })
  } catch (err) {
    console.error(`[billing] view failed: ${(err as Error).name}`)
    return billingFail(500, "failed", "Couldn't load your plan. Try again in a moment.")
  }
}
