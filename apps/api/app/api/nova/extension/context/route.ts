import { NextResponse } from "next/server"
//@ts-ignore
import { loadExtensionContext } from "@repo/api/nova/product/learning-events"
import { resolveExtensionCaller, preflight, withCors } from "../../../../../lib/nova/extension-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// GET /api/nova/extension/context
// What the extension's popup needs to offer a save: the learner's own
// subjects and the topic names under them. The learner is the credential's
// own; the request selects nothing.
// Response: ExtensionContext (learning-events.types.ts).
export async function GET(req: Request) {
  return withCors(req, await handleGET(req))
}

async function handleGET(req: Request): Promise<NextResponse> {
  try {
    const caller = await resolveExtensionCaller(req)
    if (caller.kind === "unauthenticated") return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })
    if (caller.kind !== "learner") return NextResponse.json({ status: caller.kind })
    return NextResponse.json(await loadExtensionContext(caller.platformChatId, caller.name), { headers: { "cache-control": "no-store" } })
  } catch (err) {
    console.error("[nova/extension/context]", err)
    return NextResponse.json({ error: "Failed to load" }, { status: 500 })
  }
}

// The extension's preflight.
export const OPTIONS = preflight
