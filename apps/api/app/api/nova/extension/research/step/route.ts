import { NextResponse } from "next/server"
import { metered } from "../../../../../../lib/billing/metered"
//@ts-ignore
import { researchStep } from "@repo/api/nova/product/research-agent"
import { allowAttempt, eventFail, preflight, readSmallJson, requireExtensionLearner, withCors } from "../../../../../../lib/nova/extension-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

// POST /api/nova/extension/research/step  StepInput (product/research-agent-rules.ts)
// One decision of the extension's research agent: which tool next. One model
// call, counted on the learner's AI allowance. Nothing is stored: the task's
// state lives in the learner's browser, and the page text sent is read for
// this answer only.
const STEPS_PER_MINUTE = 30

export async function POST(req: Request) {
  return withCors(req, await handle(req))
}

async function handle(req: Request): Promise<NextResponse> {
  try {
    const who = await requireExtensionLearner(req)
    if (who.denied) return who.denied
    if (!allowAttempt(`research-step:${who.connectionId}`, STEPS_PER_MINUTE, 60_000)) return eventFail(429, "rate_limited", "Kivo is researching faster than it may. Give it a minute, then resume.")
    const read = await readSmallJson(req, 64 * 1024)
    if (!read.ok) return eventFail(read.reason === "too_large" ? 413 : 400, "invalid", "That step was too large to send.")
    const run = await metered(who.platformChatId, () => researchStep(read.body), { feature: "extension_research", surface: "extension" })
    if (!run.ok) return run.response
    const result = run.value as Awaited<ReturnType<typeof researchStep>>
    if (result.ok) return NextResponse.json({ success: true, thought: result.thought, action: result.action }, { headers: { "cache-control": "no-store" } })
    return NextResponse.json({ success: false, ...result }, { status: result.error === "invalid" ? 400 : 503 })
  } catch (err) {
    console.error("[nova/extension/research/step]", err)
    return eventFail(500, "failed", "That step didn't work. Resume to try again.")
  }
}

export const OPTIONS = preflight
