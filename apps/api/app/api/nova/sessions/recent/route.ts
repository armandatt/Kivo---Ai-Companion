import { NextResponse } from "next/server"
//@ts-ignore
import { recentSessions } from "@repo/api/nova/product/focus-history"
import { requireWebLearner } from "../../../../../lib/nova/extension-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// GET /api/nova/sessions/recent   the learner's latest finished focus sessions
// (Quick Focus and topic sessions), for Progress. Read only.
export async function GET() {
  try {
    const access = await requireWebLearner()
    if (access.denied) return access.denied
    return NextResponse.json({ ok: true, sessions: await recentSessions(access.profileId) }, { headers: { "cache-control": "no-store" } })
  } catch (err) {
    console.error("[nova/sessions/recent]", err)
    return NextResponse.json({ ok: false, error: "failed", message: "Your sessions didn't load." }, { status: 500 })
  }
}
