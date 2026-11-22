import { NextResponse } from "next/server"
import { metered } from "../../../../../../lib/billing/metered"
//@ts-ignore
import { agentContext } from "@repo/api/nova/product/browser-agent"
//@ts-ignore
import { issueAgentTicket, AGENT_TASK_STEPS } from "@repo/api/nova/product/agent-ticket"
//@ts-ignore
import { clientTaskKey, reserveBrowserTask } from "@repo/api/billing/accounting/browser"
import { allowAttempt, eventFail, preflight, readSmallJson, requireExtensionLearner, withCors } from "../../../../../../lib/nova/extension-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// POST /api/nova/extension/agent/start { objective, pageTitle? }
// Starts one task of the side panel's agent: counted once on the learner's AI
// allowance (one task, one request, however many steps; agent-ticket.ts),
// answered with the task's ticket and the learner's subjects, topics and
// notes relevant to it (keyword evidence from the shared workspace
// intelligence). No model call here.
export async function POST(req: Request) {
  return withCors(req, await handle(req))
}

async function handle(req: Request): Promise<NextResponse> {
  try {
    const who = await requireExtensionLearner(req)
    if (who.denied) return who.denied
    if (!allowAttempt(`agent-start:${who.profileId}`, 20, 60_000)) return eventFail(429, "rate_limited", "That's a lot at once. Give it a minute.")
    const read = await readSmallJson(req, 8 * 1024)
    const objective = read.ok && read.body && typeof (read.body as { objective?: unknown }).objective === "string" ? (read.body as { objective: string }).objective.trim() : ""
    if (!objective) return eventFail(400, "invalid", "Say what Nova should do.")
    const rawTitle = read.ok ? (read.body as { pageTitle?: unknown } | null)?.pageTitle : undefined
    const pageTitle = typeof rawTitle === "string" ? rawTitle.slice(0, 200) : ""
    const run = await metered(who.platformChatId, () => agentContext(who.profileId, objective, pageTitle), { feature: "extension_agent", surface: "extension" })
    if (!run.ok) return run.response
    const context = run.value as Awaited<ReturnType<typeof agentContext>>
    // Usage accounting (shadow): one browser task reserved for this start; a
    // retried start with the same clientKey gets its first task back
    // (billing/accounting/browser.ts). Today's daily allowance above still decides.
    let issued = issueAgentTicket(who.connectionId)
    const clientKey = clientTaskKey(read.ok ? (read.body as { clientKey?: unknown } | null)?.clientKey : undefined)
    const task = await reserveBrowserTask({ platformChatId: who.platformChatId, taskId: issued.taskId, clientKey })
    if (task?.duplicate && task.taskId !== issued.taskId) issued = issueAgentTicket(who.connectionId, Date.now(), task.taskId)
    const { ticket, expiresAt } = issued
    return NextResponse.json({ success: true, ticket, expiresAt, maxSteps: AGENT_TASK_STEPS, ...context }, { headers: { "cache-control": "no-store" } })
  } catch (err) {
    console.error("[nova/extension/agent/start]", err)
    return eventFail(500, "failed", "Your workspace didn't load. Try again.")
  }
}

export const OPTIONS = preflight
