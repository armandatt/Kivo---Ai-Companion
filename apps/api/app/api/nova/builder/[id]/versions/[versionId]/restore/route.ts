import { NextResponse } from "next/server"
//@ts-ignore
import { restoreVersion } from "@repo/api/nova/product/builder"
import { requireWorkspaceLearner } from "../../../../../../../../lib/nova/workspace-access"
import { builderFail, statusFor } from "../../../../../../../../lib/nova/builder-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// POST /api/nova/builder/[id]/versions/[versionId]/restore { baseVersion }
// — a new version from an old one; every other version stays. Something
// already built is brought back by proposed changes, approved as usual.
export async function POST(req: Request, ctx: { params: Promise<{ id: string; versionId: string }> }) {
  try {
    const access = await requireWorkspaceLearner()
    if (access.denied) return access.denied
    const { id, versionId } = await ctx.params
    const body = await req.json().catch(() => ({}))
    const result = await restoreVersion(access.platformChatId, id, { versionId, baseVersion: body?.baseVersion })
    return NextResponse.json(result, { status: result.ok ? 200 : statusFor(result.error), headers: { "cache-control": "no-store" } })
  } catch (err) {
    console.error("[nova/builder/:id/versions/:versionId/restore]", err)
    return builderFail(500, "failed", "Restoring didn't work, and nothing changed. Try again.")
  }
}
