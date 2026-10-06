import { NextResponse } from "next/server"
//@ts-ignore
import { TOKEN_IDLE_DAYS, redeemPairingCode } from "@repo/api/nova/product/extension-connection"
import { allowAttempt, readSmallJson, preflight, withCors } from "../../../../../lib/nova/extension-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const WRONG = "That code didn't work. Codes last ten minutes and work once; get a new one from Nova."

// POST /api/nova/extension/connect  { code, label? }
// The extension redeems the code the learner typed for a credential of its
// own. This is the one extension route with no credential, so attempts are
// limited per address, and every failure gets the same answer: a wrong,
// expired and already-used code are indistinguishable.
// Response: ExtensionConnectResponse (learning-events.types.ts).
export async function POST(req: Request) {
  return withCors(req, await handlePOST(req))
}

async function handlePOST(req: Request): Promise<NextResponse> {
  try {
    const from = (req.headers.get("x-forwarded-for") ?? "").split(",")[0]!.trim() || "local"
    if (!allowAttempt(`connect:${from}`, 10, 60_000)) {
      return NextResponse.json({ ok: false, error: "rate_limited", message: "Too many tries. Wait a minute and try again." }, { status: 429 })
    }
    const read = await readSmallJson(req, 1024)
    const body = read.ok && read.body && typeof read.body === "object" ? read.body as { code?: unknown; label?: unknown } : {}
    const result = await redeemPairingCode(body.code, body.label)
    if (!result.ok) return NextResponse.json({ ok: false, error: "invalid_code", message: WRONG }, { status: 400 })
    return NextResponse.json({ ok: true, token: result.token, idleDays: TOKEN_IDLE_DAYS }, { headers: { "cache-control": "no-store" } })
  } catch (err) {
    console.error("[nova/extension/connect]", err)
    return NextResponse.json({ ok: false, error: "failed", message: "Couldn't connect. Try again." }, { status: 500 })
  }
}

// The extension's preflight.
export const OPTIONS = preflight
