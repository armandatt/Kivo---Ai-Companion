import { NextResponse } from "next/server"
//@ts-ignore
import { draftVersions } from "@repo/api/nova/product/builder"
import { requireWorkspaceLearner } from "../../../../../../lib/nova/workspace-access"
import { builderFail } from "../../../../../../lib/nova/builder-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// GET /api/nova/builder/[id]/versions — the conversation's versions, newest
// first, each with what restoring it would do. Response: VersionsResponse.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireWorkspaceLearner()
    if (access.denied) return access.denied
    const result = await draftVersions(access.platformChatId, (await ctx.params).id)
    return NextResponse.json(result, { status: result.ok ? 200 : 404, headers: { "cache-control": "no-store" } })
  } catch (err) {
    console.error("[nova/builder/:id/versions]", err)
    return builderFail(500, "failed", "The history didn't load. Try again.")
  }
}
