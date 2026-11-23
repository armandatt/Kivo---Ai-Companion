import { NextResponse } from "next/server"
import { metered, PLAN_URL } from "../../../../../../lib/billing/metered"
//@ts-ignore
import { upgradeLine } from "@repo/api/billing/offer"
//@ts-ignore
import { agentContext } from "@repo/api/nova/product/browser-agent"
//@ts-ignore
import { issueAgentTicket, AGENT_TASK_STEPS } from "@repo/api/nova/product/agent-ticket"
//@ts-ignore
import { admitBrowserTask, clientTaskKey, refundBrowserTask, reserveBrowserTask, type TaskRefusal } from "@repo/api/billing/accounting/browser"
//@ts-ignore
import { enforcing } from "@repo/api/billing/accounting/targets"
//@ts-ignore
import { startInteraction } from "@repo/api/services/llm-usage"
import { eventFail, preflight, readSmallJson, requireExtensionLearner, withCors } from "../../../../../../lib/nova/extension-access"
import { concurrencyGate, rateGate } from "../../../../../../lib/rate-limits"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// POST /api/nova/extension/agent/start { objective, pageTitle?, clientKey? }
// Starts one task of the side panel's agent: counted once, however many steps
// (agent-ticket.ts): on the month's browser tasks when they are enforced
// (billing/accounting/browser.ts), else on the daily AI allowance as before,
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
    const limited = await rateGate("agent.start", { learner: who.platformChatId })
    if (limited) return limited
    const read = await readSmallJson(req, 8 * 1024)
    const objective = read.ok && read.body && typeof (read.body as { objective?: unknown }).objective === "string" ? (read.body as { objective: string }).objective.trim() : ""
    if (!objective) return eventFail(400, "invalid", "Say what Nova should do.")
    const rawTitle = read.ok ? (read.body as { pageTitle?: unknown } | null)?.pageTitle : undefined
    const pageTitle = typeof rawTitle === "string" ? rawTitle.slice(0, 200) : ""
    const clientKey = clientTaskKey(read.ok ? (read.body as { clientKey?: unknown } | null)?.clientKey : undefined)
    let issued = issueAgentTicket(who.connectionId)
    // Task starts and tasks running at once, per account (agent.tasks). The
    // slot is the task's; its steps renew it, and it is given back if the
    // start fails below.
    const startLimited = await rateGate("agent.tasks", { learner: who.platformChatId })
    if (startLimited) return startLimited
    const slot = await concurrencyGate("agent.tasks", { learner: who.platformChatId }, issued.taskId)
    if (slot.refused) return slot.refused
    let started = false
    try {
      if (enforcing("browser_tasks")) {
        // Browser tasks are their own allowance: one task reserved here, before
        // any step runs, and nothing taken from Nova credits. The account's AI
        // rate still applies (metered applies it on the other path).
        const aiLimited = await rateGate("ai.account", { learner: who.platformChatId })
        if (aiLimited) return aiLimited
        const admitted = await admitBrowserTask({ platformChatId: who.platformChatId, taskId: issued.taskId, clientKey })
        if (admitted.refused) return taskRefused(admitted.refused)
        const task = admitted.task
        if (task?.duplicate && task.taskId !== issued.taskId) issued = issueAgentTicket(who.connectionId, Date.now(), task.taskId)
        let context: Awaited<ReturnType<typeof agentContext>>
        try {
          context = await startInteraction({ feature: "extension_agent", surface: "extension", learner: who.platformChatId, requestId: issued.taskId }, () => agentContext(who.profileId, objective, pageTitle))
        } catch (err) {
          // Kivo failed before the task began: the task goes back.
          if (task && !task.duplicate) await refundBrowserTask(task.reservationId, "kivo_failed_before_start")
          throw err
        }
        started = !task?.duplicate
        return NextResponse.json({ success: true, ticket: issued.ticket, expiresAt: issued.expiresAt, maxSteps: AGENT_TASK_STEPS, ...context }, { headers: { "cache-control": "no-store" } })
      }

      // Not enforcing: one request on the daily AI allowance, as before, and the
      // task recorded in shadow.
      const run = await metered(who.platformChatId, () => agentContext(who.profileId, objective, pageTitle), { feature: "extension_agent", surface: "extension" })
      if (!run.ok) return run.response
      const context = run.value as Awaited<ReturnType<typeof agentContext>>
      const task = await reserveBrowserTask({ platformChatId: who.platformChatId, taskId: issued.taskId, clientKey })
      if (task?.duplicate && task.taskId !== issued.taskId) issued = issueAgentTicket(who.connectionId, Date.now(), task.taskId)
      started = !task?.duplicate
      const { ticket, expiresAt } = issued
      return NextResponse.json({ success: true, ticket, expiresAt, maxSteps: AGENT_TASK_STEPS, ...context }, { headers: { "cache-control": "no-store" } })
    } finally {
      // A retried start is the task already running (it holds its own slot),
      // and a start that failed is no task: either way this slot goes back.
      if (!started) await slot.release()
    }
  } catch (err) {
    console.error("[nova/extension/agent/start]", err)
    return eventFail(500, "failed", "Your workspace didn't load. Try again.")
  }
}

// A start the allowance refused: 429 with the exhausted allowance named.
function taskRefused(r: TaskRefusal): NextResponse {
  if (r.code === "browser_allowance_exhausted") {
    const on = r.resetsAt ? new Date(r.resetsAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" }) : null
    // Only a plan that can be bought now is named (billing/offer.ts).
    const next = upgradeLine(r.tier, "browser")
    return NextResponse.json({ success: false, error: "browser_allowance_exhausted", code: r.code, message: `You've used this month's ${r.limit} browser tasks.${on ? ` They renew on ${on}.` : ""}${next} A task that has already started always finishes.`, used: r.used, limit: r.limit, resetsAt: r.resetsAt, tier: r.tier, planUrl: PLAN_URL }, { status: 429, headers: { "cache-control": "no-store" } })
  }
  if (r.code === "browser_too_many_open") {
    return NextResponse.json({ success: false, error: "rate_limited", code: r.code, message: `Nova is already running ${r.limit} tasks for you. Let one finish, then ask again.` }, { status: 429, headers: { "cache-control": "no-store" } })
  }
  return NextResponse.json({ success: false, error: "rate_limited", code: r.code, message: "That's a lot of tasks at once. Give it a few minutes.", retryAfterSeconds: r.retryAfterSeconds }, { status: 429, headers: { "cache-control": "no-store", "retry-after": String(r.retryAfterSeconds) } })
}

export const OPTIONS = preflight
