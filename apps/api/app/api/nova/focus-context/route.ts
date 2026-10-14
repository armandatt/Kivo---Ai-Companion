import { NextResponse } from "next/server"
//@ts-ignore
import { loadFocusContext } from "@repo/api/nova/product/focus-context"
import { resolveNovaLearner } from "../../../../lib/nova/resolve-learner"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NAME_MAX = 120
const name = (value: string | null) => (value && value.trim() ? value.trim().slice(0, NAME_MAX) : null)

// What the learner has filed under a topic: open tasks, saved pages, the
// subject's next exam, and their note from the last session on it. Read-only.
// The learner is the signed-in account's; the query only names a topic.
//
// GET /api/nova/focus-context                    for the running session
// GET /api/nova/focus-context?subject=&topic=    for a topic about to be started
// Response: NovaFocusContextView (product/focus-context.types.ts)
export async function GET(req: Request) {
  try {
    const learner = await resolveNovaLearner()
    if (learner.kind === "unauthenticated") return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })
    if (learner.kind !== "learner") return NextResponse.json({ status: learner.kind })
    const query = new URL(req.url).searchParams
    const topic = name(query.get("topic"))
    const view  = await loadFocusContext(learner.platformChatId, topic ? { subjectName: name(query.get("subject")), topicName: topic } : null)
    return NextResponse.json(view)
  } catch (err) {
    console.error("[nova/focus-context]", err instanceof Error ? err.name : "error")
    return NextResponse.json({ error: "Failed to load" }, { status: 500 })
  }
}
