import { NextResponse } from "next/server"
//@ts-ignore
import { changeTodayPlan } from "@repo/api/nova/product/plan-overrides"
import { requireTaskLearner, taskFail } from "../../../../../lib/nova/task-access"
import { readSmallJson } from "../../../../../lib/nova/extension-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// POST /api/nova/planner/today
//   { action: "skip" | "pin", topicId }            leave a topic out of today / add it
//   { action: "clear", kind: "skip" | "pin", topicId }
//   { action: "order", topicIds: [...] }            today's blocks in this order
//   { action: "clear_order" }
// Changes only the learner's own calendar day, worked out on the server, for
// their own active topics (product/plan-overrides.ts). The plan is worked out
// again on the next read. Response: PlanOverrideResponse.
export async function POST(req: Request) {
  try {
    const access = await requireTaskLearner()
    if (access.denied) return access.denied
    const body = await readSmallJson(req, 8 * 1024)
    if (!body.ok) return taskFail(400, "invalid", "That isn't a change Nova can make to today's plan.")
    const result = await changeTodayPlan(access.profileId, body.body)
    if (!result.ok) return NextResponse.json(result, { status: result.error === "not_found" ? 404 : 400 })
    return NextResponse.json(result)
  } catch (err) {
    console.error("[nova/planner/today]", err)
    return taskFail(500, "failed", "Today's plan wasn't changed. Try again.")
  }
}
