import { NextResponse } from "next/server"
//@ts-ignore
import { listExams } from "@repo/api/nova/product/exams"
import { resolveNovaLearner } from "../../../../lib/nova/resolve-learner"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// The signed-in learner's exam dates, from today on. The learner is the
// account's own; no id is read from the request.
//
// GET /api/nova/exams   Response: NovaExamsView (product/exams.types.ts)
export async function GET() {
  try {
    const learner = await resolveNovaLearner()
    if (learner.kind === "unauthenticated") return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })
    if (learner.kind !== "learner") return NextResponse.json({ status: learner.kind })
    const exams = await listExams(learner.platformChatId)
    if (exams === null) return NextResponse.json({ status: "not_connected" })
    return NextResponse.json({ status: "ready", exams })
  } catch (err) {
    console.error("[nova/exams]", err instanceof Error ? err.name : "error")
    return NextResponse.json({ error: "Failed to load exams" }, { status: 500 })
  }
}
