import { NextResponse } from "next/server"
//@ts-ignore
import { restoreVersion } from "@repo/api/nova/product/builder"
import { requireWorkspaceLearner } from "../../../../../../lib/nova/workspace-access"
import { allowAttempt, readSmallJson } from "../../../../../../lib/nova/extension-access"
import { builderFail, statusFor } from "../../../../../../lib/nova/builder-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const RESTORES_PER_MINUTE = 10

// POST /api/nova/builder/[id]/restore  { versionId, baseVersion }
// Makes a new version from an earlier one; no version is ever removed. A
// proposal not built yet becomes the proposal again; something built (or
// deleted) gets the changes that would bring it back, proposed for approval.
// Only on the version the learner was looking at. No model call.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireWorkspaceLearner()
    if (access.denied) return access.denied
    if (!allowAttempt(`builder-restore:${access.platformChatId}`, RESTORES_PER_MINUTE, 60_000)) return builderFail(429, "rate_limited", "That's a lot at once. Give it a minute.")
    const read = await readSmallJson(req, 2048)
    if (!read.ok) return builderFail(400, "invalid", "That couldn't be read.")
    const result = await restoreVersion(access.platformChatId, (await ctx.params).id, (read.body ?? {}) as { versionId?: unknown; baseVersion?: unknown })
    return NextResponse.json(result, { status: result.ok ? 200 : statusFor(result.error), headers: { "cache-control": "no-store" } })
  } catch (err) {
    console.error("[nova/builder/:id/restore]", err)
    return builderFail(500, "failed", "Restoring didn't work, and nothing changed. Try again.")
  }
}
