import { NextResponse } from "next/server"
//@ts-ignore
import { researchContext } from "@repo/api/nova/product/research-agent"
import { allowAttempt, eventFail, preflight, readSmallJson, requireExtensionLearner, withCors } from "../../../../../../lib/nova/extension-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// POST /api/nova/extension/research/context { objective }
// Before a research task: the learner's subjects, topics and notes relevant
// to it (keyword evidence from the shared workspace intelligence). No model.
export async function POST(req: Request) {
  return withCors(req, await handle(req))
}

async function handle(req: Request): Promise<NextResponse> {
  try {
    const who = await requireExtensionLearner(req)
    if (who.denied) return who.denied
    if (!allowAttempt(`research-context:${who.profileId}`, 20, 60_000)) return eventFail(429, "rate_limited", "That's a lot at once. Give it a minute.")
    const read = await readSmallJson(req, 8 * 1024)
    const objective = read.ok && read.body && typeof (read.body as { objective?: unknown }).objective === "string" ? (read.body as { objective: string }).objective.trim() : ""
    if (!objective) return eventFail(400, "invalid", "Say what you want to research.")
    const context = await researchContext(who.profileId, objective)
    return NextResponse.json({ success: true, ...context }, { headers: { "cache-control": "no-store" } })
  } catch (err) {
    console.error("[nova/extension/research/context]", err)
    return eventFail(500, "failed", "Your workspace didn't load. Try again.")
  }
}

export const OPTIONS = preflight
