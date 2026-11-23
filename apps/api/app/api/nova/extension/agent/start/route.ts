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
import { allowAttempt, eventFail, preflight, readSmallJson, requireExtensionLearner, withCors } from "../../../../../../lib/nova/extension-access"

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
    if (!allowAttempt(`agent-start:${who.profileId}`, 20, 60_000)) return eventFail(429, "rate_limited", "That's a lot at once. Give it a minute.")
    const read = await readSmallJson(req, 8 * 1024)
    const objective = read.ok && read.body && typeof (read.body as { objective?: unknown }).objective === "string" ? (read.body as { objective: string }).objective.trim() : ""
    if (!objective) return eventFail(400, "invalid", "Say what Nova should do.")
    const rawTitle = read.ok ? (read.body as { pageTitle?: unknown } | null)?.pageTitle : undefined
    const pageTitle = typeof rawTitle === "string" ? rawTitle.slice(0, 200) : ""
    const clientKey = clientTaskKey(read.ok ? (read.body as { clientKey?: unknown } | null)?.clientKey : undefined)
    let issued = issueAgentTicket(who.connectionId)

    if (enforcing("browser_tasks")) {
      // Browser tasks are their own allowance: one task reserved here, before
      // any step runs, and nothing taken from Nova credits.
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
      return NextResponse.json({ success: true, ticket: issued.ticket, expiresAt: issued.expiresAt, maxSteps: AGENT_TASK_STEPS, ...context }, { headers: { "cache-control": "no-store" } })
    }

    // Not enforcing: one request on the daily AI allowance, as before, and the
    // task recorded in shadow.
    const run = await metered(who.platformChatId, () => agentContext(who.profileId, objective, pageTitle), { feature: "extension_agent", surface: "extension" })
    if (!run.ok) return run.response
    const context = run.value as Awaited<ReturnType<typeof agentContext>>
    const task = await reserveBrowserTask({ platformChatId: who.platformChatId, taskId: issued.taskId, clientKey })
    if (task?.duplicate && task.taskId !== issued.taskId) issued = issueAgentTicket(who.connectionId, Date.now(), task.taskId)
    const { ticket, expiresAt } = issued
    return NextResponse.json({ success: true, ticket, expiresAt, maxSteps: AGENT_TASK_STEPS, ...context }, { headers: { "cache-control": "no-store" } })
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
