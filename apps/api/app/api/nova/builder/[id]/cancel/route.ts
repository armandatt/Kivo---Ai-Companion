import { NextResponse } from "next/server"
//@ts-ignore
import { cancelDraft } from "@repo/api/nova/product/builder"
import { requireWorkspaceLearner } from "../../../../../../lib/nova/workspace-access"
import { builderFail, statusFor } from "../../../../../../lib/nova/builder-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// POST /api/nova/builder/[id]/cancel — stops the conversation. Nothing was
// created, and a job still running writes nothing.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireWorkspaceLearner()
    if (access.denied) return access.denied
    const result = await cancelDraft(access.platformChatId, (await ctx.params).id)
    return NextResponse.json(result, { status: result.ok ? 200 : statusFor(result.error), headers: { "cache-control": "no-store" } })
  } catch (err) {
    console.error("[nova/builder/:id/cancel]", err)
    return builderFail(500, "failed", "That didn't work. Try again.")
  }
}
