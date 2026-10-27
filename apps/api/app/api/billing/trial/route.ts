import { NextResponse } from "next/server"
//@ts-ignore
import { startTrial } from "@repo/api/billing/service"
import { billingFail, jsonOnly, signedInUser, statusFor } from "../../../../lib/billing/route-helpers"

export const runtime = "nodejs"

// POST /api/billing/trial: starts Kio's free trial for the signed-in
// account, once. Starting it again returns the same trial.
export async function POST(req: Request) {
  const bad = jsonOnly(req)
  if (bad) return bad
  const me = await signedInUser()
  if ("denied" in me) return me.denied
  try {
    const result = await startTrial(me.userId)
    return result.ok ? NextResponse.json(result) : billingFail(statusFor(result.error), result.error, result.message)
  } catch (err) {
    console.error(`[billing] trial failed: ${(err as Error).name}`)
    return billingFail(500, "failed", "Couldn't start your trial. Try again in a moment.")
  }
}
