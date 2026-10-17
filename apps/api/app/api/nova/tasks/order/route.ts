import { NextResponse } from "next/server"
//@ts-ignore
import { reorderTasks } from "@repo/api/nova/product/tasks"
import { requireTaskLearner, taskFail } from "../../../../../lib/nova/task-access"
import { readSmallJson } from "../../../../../lib/nova/extension-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// POST /api/nova/tasks/order  { status: "todo" | "in_progress", ids: [...] }
// The learner's own order for one column of their board. Every id must be
// theirs and still in that column, or nothing is written (409).
// Response: { ok: true, tasks: NovaTasksReady } | TaskResponse error.
export async function POST(req: Request) {
  try {
    const access = await requireTaskLearner()
    if (access.denied) return access.denied
    const body = await readSmallJson(req, 16 * 1024)
    if (!body.ok) return taskFail(400, "invalid", "That isn't an order Nova can use.")
    const result = await reorderTasks(access.profileId, body.body)
    if (!result.ok) return NextResponse.json(result, { status: result.error === "changed" ? 409 : 400 })
    return NextResponse.json(result)
  } catch (err) {
    console.error("[nova/tasks/order]", err)
    return taskFail(500, "failed", "The order wasn't saved. Try again.")
  }
}
