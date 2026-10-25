import { NextResponse } from "next/server"
//@ts-ignore
import { draftVersions } from "@repo/api/nova/product/builder"
import { requireWorkspaceLearner } from "../../../../../../lib/nova/workspace-access"
import { builderFail, statusFor } from "../../../../../../lib/nova/builder-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// GET /api/nova/builder/[id]/versions — every version this conversation
// kept, newest first: proposals (Nova's, the learner's, restored) and the
// records as built.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireWorkspaceLearner()
    if (access.denied) return access.denied
    const result = await draftVersions(access.platformChatId, (await ctx.params).id)
    return NextResponse.json(result, { status: result.ok ? 200 : statusFor(result.error), headers: { "cache-control": "no-store" } })
  } catch (err) {
    console.error("[nova/builder/:id/versions]", err)
    return builderFail(500, "failed", "The history didn't load. Try again.")
  }
}
