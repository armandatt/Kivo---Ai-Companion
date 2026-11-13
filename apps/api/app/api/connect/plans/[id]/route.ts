// A change plan an assistant previewed, for the learner to review and approve
// on Kivo (/connect/approve?plan=<id>). Only the account it was made for can
// see or approve it; approving lets execute_knowledge_changes run it once.
import { NextResponse } from "next/server"
//@ts-ignore
import { approvePendingPlan, pendingPlan } from "@repo/api/connect/audit"
import { fail, sameSiteProblem, sessionUser } from "../../../../../lib/connect/web-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: Request, { params }: Ctx) {
  const user = await sessionUser()
  if (!user) return fail(401, "unauthenticated", "Sign in to Kivo first.")
  const plan = await pendingPlan(user.userId, (await params).id)
  if (!plan) return fail(404, "not_found", "There is no such plan for this account.")
  return NextResponse.json({ ok: true, plan: { ...plan, expired: new Date(plan.expiresAt) < new Date() } })
}

export async function POST(req: Request, { params }: Ctx) {
  const bad = sameSiteProblem(req)
  if (bad) return bad
  const user = await sessionUser()
  if (!user) return fail(401, "unauthenticated", "Sign in to Kivo first.")
  const result = await approvePendingPlan(user.userId, (await params).id)
  if (result === "not_found") return fail(404, "not_found", "There is no such plan for this account.")
  if (result === "expired") return fail(410, "expired", "This plan has expired. Ask your assistant to preview the changes again.")
  console.log(JSON.stringify({ layer: "kivo_connect", event: "plan_approved" }))
  return NextResponse.json({ ok: true })
}
