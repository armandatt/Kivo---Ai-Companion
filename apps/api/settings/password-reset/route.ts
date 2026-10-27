import { NextResponse } from "next/server"
import { requestOwnPasswordReset } from "@repo/api/auth/password-reset.service"
import { errorLabel } from "@repo/api/auth/error-label"
import { getSession } from "../../lib/auth/session"

// POST /api/settings/password-reset: a reset link for the signed-in account,
// sent to the account's own address (password-reset.service.ts). Nothing in
// the request is read: the account comes from the session.
export async function POST() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })
  try {
    const result = await requestOwnPasswordReset(session.userId)
    if (result.ok) return NextResponse.json({ ok: true, email: result.email, accepted: result.accepted }, { headers: { "cache-control": "no-store" } })
    if (result.reason === "no_account") return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })
    if (result.reason === "no_password") return NextResponse.json({ ok: false, reason: "no_password", google: !!result.google }, { status: 409 })
    return NextResponse.json({ ok: false, reason: "limited", retryAfterSeconds: result.retryAfterSeconds ?? 3600 }, { status: 429, headers: { "retry-after": String(result.retryAfterSeconds ?? 3600) } })
  } catch (e) {
    // The kind of error only: never the address or the link.
    console.error(`[SETTINGS PASSWORD RESET] ${errorLabel(e)}`)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}
