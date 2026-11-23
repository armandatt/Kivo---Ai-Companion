import { NextResponse } from "next/server"
//@ts-ignore
import { classifyIntent } from "@repo/api/nova/product/browser-intent"
//@ts-ignore
import { startInteraction } from "@repo/api/services/llm-usage"
import { eventFail, preflight, readSmallJson, requireExtensionLearner, withCors } from "../../../../../lib/nova/extension-access"
import { rateGate } from "../../../../../lib/rate-limits"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// POST /api/nova/extension/intent  { request, pageTitle, site, hasSelection, hasScreenshot, lastAnswer, surface }
// What a request typed into the extension is: a question answered from the
// page in one call (…/ask), a task for the browser agent (…/agent/start), or
// research. One small-model call (product/browser-intent.ts). It is part of
// the request that follows, which is the one the allowance counts (as with
// filing a capture), so it is not counted itself; its tokens are recorded
// under extension_intent. Nothing is stored.

export async function POST(req: Request) {
  return withCors(req, await handle(req))
}

async function handle(req: Request): Promise<NextResponse> {
  try {
    const who = await requireExtensionLearner(req)
    if (who.denied) return who.denied
    const limited = await rateGate(["ai.account", "extension.intent"], { learner: who.platformChatId })
    if (limited) return limited
    const read = await readSmallJson(req, 8 * 1024)
    if (!read.ok) return eventFail(400, "invalid", "That request couldn't be read.")
    const result = await startInteraction({ feature: "extension_intent", surface: "extension", learner: who.platformChatId, isAllowanceCounted: false }, () => classifyIntent(read.body)) as Awaited<ReturnType<typeof classifyIntent>>
    if (!result.ok) return NextResponse.json({ success: false, ...result }, { status: 400 })
    return NextResponse.json({ success: true, ...result }, { headers: { "cache-control": "no-store" } })
  } catch (err) {
    console.error("[nova/extension/intent]", err)
    return eventFail(500, "failed", "That didn't work. Try again.")
  }
}

export const OPTIONS = preflight
