import { NextResponse } from "next/server"
//@ts-ignore
import { createPairingCode } from "@repo/api/nova/product/extension-connection"
import { resolveNovaLearner } from "../../../../../lib/nova/resolve-learner"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// POST /api/nova/extension/pair
// The signed-in learner asks for a one-time code to type into the browser
// extension. The code lasts ten minutes, works once, and replaces any
// earlier unused one. The account is the session's own: the body is not read.
// Response: PairingCodeResponse (learning-events.types.ts).
export async function POST() {
  try {
    const learner = await resolveNovaLearner()
    if (learner.kind === "unauthenticated") {
      return NextResponse.json({ ok: false, error: "unauthenticated", message: "Sign in to Nova first." }, { status: 401 })
    }
    if (learner.kind === "not_nova") {
      return NextResponse.json({ ok: false, error: "not_nova", message: "The browser extension is part of Nova." }, { status: 409 })
    }
    if (learner.kind !== "learner") {
      return NextResponse.json({ ok: false, error: "not_connected", message: "Connect Nova first." }, { status: 409 })
    }
    const { code, expiresAt } = await createPairingCode(learner.userId)
    return NextResponse.json({ ok: true, code, expiresAt: expiresAt.toISOString() }, { headers: { "cache-control": "no-store" } })
  } catch (err) {
    console.error("[nova/extension/pair]", err)
    return NextResponse.json({ ok: false, error: "failed", message: "Couldn't make a code. Try again." }, { status: 500 })
  }
}
