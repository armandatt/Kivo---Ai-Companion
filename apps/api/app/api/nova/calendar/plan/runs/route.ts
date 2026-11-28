import { NextResponse } from "next/server"
//@ts-ignore
import { applyPlanRun, clearAutoBlocks, loadPlanSettings, recentRuns, savePlanSettings, undoPlanRun, unscheduleBlock } from "@repo/api/nova/product/plan-runs"
//@ts-ignore
import { loadChannel } from "@repo/api/nova/telegram/channel-store"
import { readSmallJson } from "../../../../../../lib/nova/extension-access"
import { requireTaskLearner, taskFail } from "../../../../../../lib/nova/task-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const WHO = { open: "your calendar", part: "The calendar is" }

// GET /api/nova/calendar/plan/runs: the learner's planning settings and their
// last five plan runs (product/plan-runs.ts).
export async function GET() {
  try {
    const access = await requireTaskLearner(WHO)
    if (access.denied) return access.denied
    const [settings, runs] = await Promise.all([loadPlanSettings(access.profileId), recentRuns(access.profileId)])
    return NextResponse.json({ ok: true, settings, runs }, { headers: { "cache-control": "no-store" } })
  } catch (err) {
    console.error("[nova/calendar/plan/runs GET]", err instanceof Error ? err.name : "error")
    return taskFail(500, "failed", "Couldn't load your plans.")
  }
}

// POST /api/nova/calendar/plan/runs
//   { action: "apply", scope, blocks: [{ taskId, startAt, endAt }], unplaced }
//   { action: "undo", runId }
//   { action: "clear", range: "week" | "ahead", preview?: boolean }
//   { action: "unschedule", eventId }
//   { action: "settings", settings }
export async function POST(req: Request) {
  try {
    const access = await requireTaskLearner(WHO)
    if (access.denied) return access.denied
    // Limits: the proxy's write baseline for /api/nova (rate-limits/endpoints.ts).
    const read = await readSmallJson(req, 32 * 1024)
    if (!read.ok) return taskFail(400, "invalid", "That isn't a change this page can make.")
    const b = (read.body ?? {}) as Record<string, unknown>
    const p = access.profileId
    let r: { ok: boolean; error?: string; message?: string } & Record<string, unknown>
    if (b.action === "apply") {
      const ch = await loadChannel(p).catch(() => null)
      r = await applyPlanRun(p, { scope: b.scope, blocks: b.blocks, unplaced: b.unplaced, remind: !!ch?.planNotifications })
    } else if (b.action === "undo" && typeof b.runId === "string") r = await undoPlanRun(p, b.runId)
    else if (b.action === "clear") r = await clearAutoBlocks(p, b.range, b.preview === true)
    else if (b.action === "unschedule" && typeof b.eventId === "string") r = await unscheduleBlock(p, b.eventId)
    else if (b.action === "settings") r = { ok: true, settings: await savePlanSettings(p, b.settings) }
    else return taskFail(400, "invalid", "That isn't a change this page can make.")
    const status = r.ok ? 200 : r.error === "not_found" ? 404 : 400
    return NextResponse.json(r, { status })
  } catch (err) {
    console.error("[nova/calendar/plan/runs POST]", err instanceof Error ? err.name : "error")
    return taskFail(500, "failed", "That didn't save. Try again.")
  }
}
