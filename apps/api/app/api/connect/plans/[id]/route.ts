// A change plan an assistant previewed, for the learner to review on Kivo
// (/connect/approve?plan=<id>). Only the account it was made for can see,
// approve or decline it. Approving applies it at once when the plan's
// changes are kept (approveAndApply, plans.ts), through the same checks as
// the assistant's execute: recomputed against the records as they are now,
// run once. Declining is recorded and the plan can never run.
import { NextResponse } from "next/server"
//@ts-ignore
import { declinePendingPlan, pendingPlan, priorResult } from "@repo/api/connect/audit"
//@ts-ignore
import { approveAndApply } from "@repo/api/connect/plans"
//@ts-ignore
import { profileForAccount } from "@repo/api/connect/learner"
import { fail, sameSiteProblem, sessionUser } from "../../../../../lib/connect/web-access"
import { connectOrigin } from "../../../../../lib/connect/config"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ id: string }> }

const counts = (r: unknown) => (r && typeof r === "object" && "counts" in r ? (r as { counts: unknown; status?: string }) : null)

export async function GET(_req: Request, { params }: Ctx) {
  const user = await sessionUser()
  if (!user) return fail(401, "unauthenticated", "Sign in to Kivo first.")
  const id = (await params).id
  const plan = await pendingPlan(user.userId, id)
  if (!plan) return fail(404, "not_found", "There is no such plan for this account.")
  const prior = await priorResult(user.userId, `plan:${id}`)
  const result = counts(prior?.result)
  return NextResponse.json({
    ok: true,
    plan: {
      planId: plan.planId, summary: plan.summary, items: plan.items ?? null, expiresAt: plan.expiresAt, client: plan.client,
      approvedAt: plan.approvedAt, declinedAt: plan.declinedAt ?? null,
      appliesOnApproval: Array.isArray(plan.changes) && plan.changes.length > 0,
      applied: result ? { status: result.status ?? null, counts: result.counts } : null,
      expired: new Date(plan.expiresAt) < new Date(),
    },
  }, { headers: { "cache-control": "no-store" } })
}

export async function POST(req: Request, { params }: Ctx) {
  const bad = sameSiteProblem(req)
  if (bad) return bad
  const user = await sessionUser()
  if (!user) return fail(401, "unauthenticated", "Sign in to Kivo first.")
  const id = (await params).id
  const body = await req.json().catch(() => ({})) as { action?: unknown }
  const started = Date.now()

  if (body.action === "decline") {
    const r = await declinePendingPlan(user.userId, id)
    if (r === "not_found") return fail(404, "not_found", "There is no such plan for this account.")
    if (r === "already_approved") return fail(409, "already_approved", "This plan was already approved.")
    console.log(JSON.stringify({ layer: "kivo_connect", event: "plan_declined", ms: Date.now() - started }))
    return NextResponse.json({ ok: true, status: "declined" })
  }

  const profileId = await profileForAccount(user.userId)
  if (!profileId) return fail(403, "not_ready", "Finish setting up Kivo first.")
  const r = await approveAndApply({ userId: user.userId, profileId, origin: connectOrigin() }, id)
  console.log(JSON.stringify({ layer: "kivo_connect", event: "plan_approved", status: r.status, ms: Date.now() - started }))
  switch (r.status) {
    case "applied":   { const c = counts(r.report); return NextResponse.json({ ok: true, status: "applied", result: c ? { status: c.status ?? null, counts: c.counts } : null }) }
    case "approved":  return NextResponse.json({ ok: true, status: "approved" })
    case "not_found": return fail(404, "not_found", r.message)
    case "expired":   return fail(410, "expired", r.message)
    case "declined":  return fail(409, "declined", r.message)
    case "changed":   return fail(409, "changed", r.message)
    default:          return fail(500, "failed", r.message)
  }
}
