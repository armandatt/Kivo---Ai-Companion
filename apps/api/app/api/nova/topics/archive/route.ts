import { NextResponse } from "next/server"
//@ts-ignore
import { archiveTopic, listArchivedTopics } from "@repo/api/nova/product/topic-archive"
import { requireTaskLearner, taskFail } from "../../../../../lib/nova/task-access"
import { readSmallJson } from "../../../../../lib/nova/extension-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// GET /api/nova/topics/archive        the learner's archived topics (ArchivedTopicsView)
export async function GET() {
  try {
    const access = await requireTaskLearner()
    if (access.denied) return access.status === "unauthenticated" ? access.denied : NextResponse.json({ status: access.status })
    return NextResponse.json({ status: "ready", topics: await listArchivedTopics(access.profileId) })
  } catch (err) {
    console.error("[nova/topics/archive]", err)
    return taskFail(500, "failed", "Couldn't load your archived topics.")
  }
}

// POST /api/nova/topics/archive  { topicId, archived: true | false }
// Archives or restores one of the learner's topics; nothing about its history
// changes (product/topic-archive.ts). Response: TopicArchiveResponse.
export async function POST(req: Request) {
  try {
    const access = await requireTaskLearner()
    if (access.denied) return access.denied
    const body = await readSmallJson(req, 2 * 1024)
    if (!body.ok) return taskFail(400, "invalid", "That isn't a change Nova can make.")
    const result = await archiveTopic(access.profileId, body.body)
    if (!result.ok) return NextResponse.json(result, { status: result.error === "not_found" ? 404 : 400 })
    return NextResponse.json(result)
  } catch (err) {
    console.error("[nova/topics/archive]", err)
    return taskFail(500, "failed", "Nothing was changed. Try again.")
  }
}
