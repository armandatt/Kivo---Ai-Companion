// What every billing route shares: the signed-in account (from the session
// cookie, never from the request), a JSON-only rule for changes, and one
// shape for refusals.

import { NextResponse } from "next/server"
import { getSession } from "../auth/session"

export const billingFail = (status: number, error: string, message: string) =>
  NextResponse.json({ ok: false, error, message }, { status, headers: { "cache-control": "no-store" } })

export async function signedInUser(): Promise<{ userId: string } | { denied: NextResponse }> {
  const session = await getSession()
  if (!session?.userId) return { denied: billingFail(401, "unauthenticated", "Sign in to manage your plan.") }
  return { userId: session.userId }
}

// A change to billing must come as JSON from Kivo's own pages: a form on
// another site cannot send that without the browser asking first.
export function jsonOnly(req: Request): NextResponse | null {
  const type = req.headers.get("content-type") ?? ""
  return type.toLowerCase().startsWith("application/json") ? null : billingFail(415, "unsupported", "Send this as JSON.")
}

export const clientIp = (req: Request) =>
  req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip")?.trim() || null

export const statusFor = (error: string) =>
  error === "invalid_plan" ? 400
  : error === "plan_unavailable" || error === "not_eligible" || error === "already_subscribed" || error === "no_subscription" ? 409
  : error === "not_configured" ? 503
  : 502
