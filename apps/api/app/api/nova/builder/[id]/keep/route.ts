import { NextResponse } from "next/server"
//@ts-ignore
import { keepResource } from "@repo/api/nova/product/builder"
import { requireWorkspaceLearner } from "../../../../../../lib/nova/workspace-access"
import { builderFail, statusFor } from "../../../../../../lib/nova/builder-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// POST /api/nova/builder/[id]/keep — the learner sets the shown deletion
// aside. Nothing changes.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireWorkspaceLearner()
    if (access.denied) return access.denied
    const result = await keepResource(access.platformChatId, (await ctx.params).id)
    return NextResponse.json(result, { status: result.ok ? 200 : statusFor(result.error), headers: { "cache-control": "no-store" } })
  } catch (err) {
    console.error("[nova/builder/:id/keep]", err)
    return builderFail(500, "failed", "That didn't work. Try again.")
  }
}
