import { NextResponse } from "next/server"
//@ts-ignore
import { draftVersion } from "@repo/api/nova/product/builder"
import { requireWorkspaceLearner } from "../../../../../../../lib/nova/workspace-access"
import { builderFail, statusFor } from "../../../../../../../lib/nova/builder-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// GET /api/nova/builder/[id]/versions/[versionId] — one version, to look at.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string; versionId: string }> }) {
  try {
    const access = await requireWorkspaceLearner()
    if (access.denied) return access.denied
    const { id, versionId } = await ctx.params
    const result = await draftVersion(access.platformChatId, id, versionId)
    return NextResponse.json(result, { status: result.ok ? 200 : statusFor(result.error), headers: { "cache-control": "no-store" } })
  } catch (err) {
    console.error("[nova/builder/:id/versions/:versionId]", err)
    return builderFail(500, "failed", "That version didn't load. Try again.")
  }
}
