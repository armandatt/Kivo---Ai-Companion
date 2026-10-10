import { NextResponse } from "next/server"
//@ts-ignore
import { deleteTask, updateTask } from "@repo/api/nova/product/tasks"
import { requireTaskLearner, taskFail } from "../../../../../lib/nova/task-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string }> }

// One task. The id selects among the signed-in learner's own tasks only:
// another learner's task is "not found", whether it exists or not.
const NOT_FOUND = () => taskFail(404, "not_found", "That task doesn't exist.")

// PATCH /api/nova/tasks/:id  { title?, status?, priority?, subjectId?, topicName?, dueDay? }
// Moving a card on the board is this, with a status. Response: TaskResponse.
export async function PATCH(req: Request, { params }: Context) {
  try {
    const access = await requireTaskLearner()
    if (access.denied) return access.denied
    const result = await updateTask(access.profileId, (await params).id, await req.json().catch(() => null))
    if (result.ok) return NextResponse.json(result)
    return result.error === "not_found" ? NOT_FOUND() : taskFail(400, result.error, result.message)
  } catch (err) {
    console.error("[nova/tasks/:id]", err)
    return taskFail(500, "failed", "That change wasn't saved. Try again.")
  }
}

// DELETE /api/nova/tasks/:id
export async function DELETE(_req: Request, { params }: Context) {
  try {
    const access = await requireTaskLearner()
    if (access.denied) return access.denied
    return (await deleteTask(access.profileId, (await params).id)) ? NextResponse.json({ ok: true }) : NOT_FOUND()
  } catch (err) {
    console.error("[nova/tasks/:id]", err)
    return taskFail(500, "failed", "The task wasn't deleted. Try again.")
  }
}
