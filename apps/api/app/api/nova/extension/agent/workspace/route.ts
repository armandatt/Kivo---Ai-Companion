import { NextResponse } from "next/server"
//@ts-ignore
import { agentReadNote, agentWorkspaceSearch } from "@repo/api/nova/product/browser-agent"
//@ts-ignore
import { checkAgentTicket } from "@repo/api/nova/product/agent-ticket"
import { allowAttempt, eventFail, preflight, readSmallJson, requireExtensionLearner, withCors } from "../../../../../../lib/nova/extension-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// POST /api/nova/extension/agent/workspace
//   { ticket, op: "search", query } | { ticket, op: "note", id }
// The agent reading the learner's own workspace mid-task: their notes, saved
// pages, subjects and topics (search), or one note (by an id search gave).
// Read-only, no model, the credential's learner only, inside a started task.
export async function POST(req: Request) {
  return withCors(req, await handle(req))
}

async function handle(req: Request): Promise<NextResponse> {
  try {
    const who = await requireExtensionLearner(req)
    if (who.denied) return who.denied
    if (!allowAttempt(`agent-workspace:${who.profileId}`, 30, 60_000)) return eventFail(429, "rate_limited", "That's a lot at once. Give it a minute.")
    const read = await readSmallJson(req, 4 * 1024)
    const body = (read.ok ? read.body : null) as { ticket?: unknown; op?: unknown; query?: unknown; id?: unknown } | null
    if (!checkAgentTicket(body?.ticket, who.connectionId).ok) return eventFail(409, "task_expired", "Start the task again.")
    if (body?.op === "search" && typeof body.query === "string" && body.query.trim()) {
      const result = await agentWorkspaceSearch({ profileId: who.profileId, platformChatId: who.platformChatId }, body.query)
      return NextResponse.json({ success: true, ...result }, { headers: { "cache-control": "no-store" } })
    }
    if (body?.op === "note" && typeof body.id === "string" && body.id.length <= 64) {
      const result = await agentReadNote(who.profileId, body.id)
      if (!result) return eventFail(404, "not_found", "That note isn't in your Kivo.")
      return NextResponse.json({ success: true, ...result }, { headers: { "cache-control": "no-store" } })
    }
    return eventFail(400, "invalid", "Nova asked for something it can't read.")
  } catch (err) {
    console.error("[nova/extension/agent/workspace]", err)
    return eventFail(500, "failed", "Your workspace didn't load. Try again.")
  }
}

export const OPTIONS = preflight
