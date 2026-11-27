import { NextResponse } from "next/server"
//@ts-ignore
import { setTopicStatus } from "@repo/api/nova/product/topic-status"
import { requireTaskLearner, taskFail } from "../../../../../lib/nova/task-access"
import { readSmallJson } from "../../../../../lib/nova/extension-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// POST /api/nova/topics/status  { topicId | subjectId + topicName, status: "not_started" | "in_progress" | "completed" }
// Where one of the learner's topics stands, in their own word (bug batch
// 28 Nov, item 7; product/topic-status.ts). Changes nothing else about it.
export async function POST(req: Request) {
  try {
    const access = await requireTaskLearner()
    if (access.denied) return access.denied
    const body = await readSmallJson(req, 1024)
    if (!body.ok) return taskFail(400, "invalid", "That isn't a change Nova can make.")
    const b = body.body as { topicId?: unknown; subjectId?: unknown; topicName?: unknown; status?: unknown } | null
    // By id (the map), or by subject and name (filing a session).
    const at = b && typeof b.topicId === "string" && b.topicId.length <= 40 ? { topicId: b.topicId }
      : b && typeof b.subjectId === "string" && b.subjectId.length <= 40 && typeof b.topicName === "string" && b.topicName.trim() && b.topicName.length <= 200 ? { subjectId: b.subjectId, topicName: b.topicName }
      : null
    if (!at) return taskFail(400, "invalid", "Say which topic.")
    const result = await setTopicStatus(access.profileId, at, b!.status)
    if (!result.ok) return NextResponse.json(result, { status: result.error === "not_found" ? 404 : 400 })
    return NextResponse.json(result)
  } catch (err) {
    console.error("[nova/topics/status]", err)
    return taskFail(500, "failed", "Nothing was changed. Try again.")
  }
}
