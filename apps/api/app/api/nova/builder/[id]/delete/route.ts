import { NextResponse } from "next/server"
//@ts-ignore
import { confirmDeletion } from "@repo/api/nova/product/builder"
import { requireWorkspaceLearner } from "../../../../../../lib/nova/workspace-access"
import { builderFail, statusFor } from "../../../../../../lib/nova/builder-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// POST /api/nova/builder/[id]/delete — the learner confirms the deletion the
// conversation showed them ({ fingerprint }). Exactly what was shown is
// deleted, or nothing and the new scope is shown.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireWorkspaceLearner()
    if (access.denied) return access.denied
    const body = await req.json().catch(() => ({}))
    const result = await confirmDeletion(access.platformChatId, (await ctx.params).id, { fingerprint: body?.fingerprint })
    return NextResponse.json(result, { status: result.ok ? 200 : statusFor(result.error), headers: { "cache-control": "no-store" } })
  } catch (err) {
    console.error("[nova/builder/:id/delete]", err)
    return builderFail(500, "failed", "That didn't work, and nothing was deleted. Try again.")
  }
}
