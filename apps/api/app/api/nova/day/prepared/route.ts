import { NextResponse } from "next/server"
//@ts-ignore
import { closePreparedPlan, loadPreparedPlan } from "@repo/api/nova/product/prepared-plan"
import { dayFail, requireDayLearner } from "../../../../../lib/nova/day-access"
import { rateGate } from "../../../../../lib/rate-limits"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

// GET /api/nova/day/prepared[?now=1]  → { ok, prepared: PreparedPlanView | null }
// ?now=1: the learner pressed Propose a plan; prepare it now, whatever the time.
// The plan Nova prepared for today (item 12, 28 Nov; product/prepared-plan.ts).
// Prepared at check-in; if it was not, prepared now on opening (past their
// check-in time) with one model call, at most once a day. Never applied
// here: taking it is the copilot's approve with this pending change.
export async function GET(req: Request) {
  try {
    const access = await requireDayLearner()
    if (access.denied) return access.denied
    const limited = await rateGate("day.copilot", { learner: access.platformChatId })
    if (limited) return limited
    // At most one model call per learner per day (one row per day), so reading it is not metered.
    const force = new URL(req.url).searchParams.get("now") === "1"
    const prepared = await loadPreparedPlan(access.profileId, access.platformChatId, { prepareIfMissing: true, force })
    return NextResponse.json({ ok: true, prepared }, { headers: { "cache-control": "no-store" } })
  } catch (err) {
    console.error("[nova/day/prepared]", err)
    return dayFail(500, "failed", "Nova's prepared plan didn't load.")
  }
}

// POST /api/nova/day/prepared  { day, status: "taken" | "dismissed" }
export async function POST(req: Request) {
  try {
    const access = await requireDayLearner()
    if (access.denied) return access.denied
    const b = await req.json().catch(() => null) as { day?: unknown; status?: unknown } | null
    if (!b || typeof b.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.day) || (b.status !== "taken" && b.status !== "dismissed")) return dayFail(400, "invalid", "That isn't a change Nova can make.")
    return NextResponse.json({ ok: await closePreparedPlan(access.profileId, b.day, b.status) })
  } catch (err) {
    console.error("[nova/day/prepared]", err)
    return dayFail(500, "failed", "That didn't save.")
  }
}
