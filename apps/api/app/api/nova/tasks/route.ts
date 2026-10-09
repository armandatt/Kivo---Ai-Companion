import { NextResponse } from "next/server"
//@ts-ignore
import { createTask, listTasks } from "@repo/api/nova/product/tasks"
import { requireTaskLearner, taskFail } from "../../../../lib/nova/task-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// GET /api/nova/tasks
// The learner's own tasks: every open one, and the most recently finished.
// The learner is the signed-in account's own; the route reads nothing from
// the request. Response: NovaTasksView (product/tasks.types.ts).
export async function GET() {
  try {
    const access = await requireTaskLearner()
    if (access.denied) {
      // A page asks this to find out who it is drawing for.
      return access.status === "unauthenticated" ? access.denied : NextResponse.json({ status: access.status })
    }
    return NextResponse.json(await listTasks(access.profileId))
  } catch (err) {
    console.error("[nova/tasks]", err)
    return taskFail(500, "failed", "Couldn't load your tasks.")
  }
}

// POST /api/nova/tasks  { title, status?, priority?, subjectId?, topicName?, dueDay?, clientKey? }
// Creates one task. With a clientKey, a repeat of the same request returns
// the task it already made. Response: TaskResponse.
export async function POST(req: Request) {
  try {
    const access = await requireTaskLearner()
    if (access.denied) return access.denied
    const result = await createTask(access.profileId, await req.json().catch(() => null))
    if (!result.ok) return taskFail(result.error === "too_many" ? 409 : 400, result.error, result.message)
    return NextResponse.json(result, { status: result.created ? 201 : 200 })
  } catch (err) {
    console.error("[nova/tasks]", err)
    return taskFail(500, "failed", "The task wasn't saved. Try again.")
  }
}
