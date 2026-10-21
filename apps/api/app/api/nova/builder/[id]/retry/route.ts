import { NextResponse } from "next/server"
//@ts-ignore
import { retryDraft } from "@repo/api/nova/product/builder"
import { requireWorkspaceLearner } from "../../../../../../lib/nova/workspace-access"
import { builderFail, spendForTurn, startJob, statusFor } from "../../../../../../lib/nova/builder-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// POST /api/nova/builder/[id]/retry — the step that failed, again: Nova's
// answer or the proposal it was writing. One request on the AI allowance.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireWorkspaceLearner()
    if (access.denied) return access.denied
    const refused = await spendForTurn(access.platformChatId)
    if (refused) return refused
    const claimed = await retryDraft(access.platformChatId, (await ctx.params).id)
    if (!claimed.ok) return builderFail(statusFor(claimed.error), claimed.error, claimed.message, claimed.draft ? { draft: claimed.draft } : {})
    startJob(access.platformChatId, claimed.job)
    return NextResponse.json({ ok: true, draft: claimed.draft }, { headers: { "cache-control": "no-store" } })
  } catch (err) {
    console.error("[nova/builder/:id/retry]", err)
    return builderFail(500, "failed", "That didn't work. Try again.")
  }
}
