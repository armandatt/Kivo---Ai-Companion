import { NextResponse } from "next/server"
//@ts-ignore
import { revokeExtensionConnection } from "@repo/api/nova/product/extension-connection"
import { resolveExtensionCaller, preflight, withCors } from "../../../../../lib/nova/extension-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// POST /api/nova/extension/disconnect
// The extension gives up its own credential. From this answer on, the
// credential opens nothing.
export async function POST(req: Request) {
  return withCors(req, await handlePOST(req))
}

async function handlePOST(req: Request): Promise<NextResponse> {
  try {
    const caller = await resolveExtensionCaller(req)
    if (caller.kind === "unauthenticated") return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })
    await revokeExtensionConnection(caller.userId, caller.connectionId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[nova/extension/disconnect]", err)
    return NextResponse.json({ error: "Failed to disconnect" }, { status: 500 })
  }
}

// The extension's preflight.
export const OPTIONS = preflight
