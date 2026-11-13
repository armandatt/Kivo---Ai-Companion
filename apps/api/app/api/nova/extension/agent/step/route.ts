import { NextResponse } from "next/server"
import { withinCountedTask } from "../../../../../../lib/billing/metered"
//@ts-ignore
import { agentStep } from "@repo/api/nova/product/browser-agent"
//@ts-ignore
import { checkAgentTicket, AGENT_TASK_STEPS, AGENT_TASK_TTL_MS } from "@repo/api/nova/product/agent-ticket"
import { allowAttempt, eventFail, preflight, readSmallJson, requireExtensionLearner, withCors } from "../../../../../../lib/nova/extension-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

// POST /api/nova/extension/agent/step  { ticket, ...StepInput (browser-agent-rules.ts) }
// One decision of the side panel's agent: which tool next. One model call,
// inside a task already counted on the allowance (…/agent/start): the ticket
// names the task, and a task gets AGENT_TASK_STEPS steps at most. Its tokens
// are metered on the account. Nothing is stored: the task's state lives in
// the learner's browser, and the page text sent is read for this answer only.
const STEPS_PER_MINUTE = 30

export async function POST(req: Request) {
  return withCors(req, await handle(req))
}

async function handle(req: Request): Promise<NextResponse> {
  try {
    const who = await requireExtensionLearner(req)
    if (who.denied) return who.denied
    if (!allowAttempt(`agent-step:${who.connectionId}`, STEPS_PER_MINUTE, 60_000)) return eventFail(429, "rate_limited", "Nova is working faster than it may. Give it a minute, then resume.")
    const read = await readSmallJson(req, 96 * 1024)
    if (!read.ok) return eventFail(read.reason === "too_large" ? 413 : 400, "invalid", "That step was too large to send.")
    const ticket = checkAgentTicket((read.body as { ticket?: unknown } | null)?.ticket, who.connectionId)
    if (!ticket.ok) return eventFail(409, "task_expired", ticket.reason === "expired" ? "This task has run for too long. Ask again to start a new one." : "Start the task again.")
    if (!allowAttempt(`agent-task:${ticket.taskId}`, AGENT_TASK_STEPS, AGENT_TASK_TTL_MS)) return eventFail(429, "task_limit", "This task has used all its steps. Ask again to continue.")
    const result = await withinCountedTask(who.platformChatId, () => agentStep(read.body), { feature: "extension_agent", surface: "extension" }) as Awaited<ReturnType<typeof agentStep>>
    if (result.ok) return NextResponse.json({ success: true, thought: result.thought, plan: result.plan, expect: result.expect, action: result.action }, { headers: { "cache-control": "no-store" } })
    return NextResponse.json({ success: false, ...result }, { status: result.error === "invalid" ? 400 : 503 })
  } catch (err) {
    console.error("[nova/extension/agent/step]", err)
    return eventFail(500, "failed", "That step didn't work. Resume to try again.")
  }
}

export const OPTIONS = preflight
