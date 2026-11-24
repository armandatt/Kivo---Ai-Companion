import { NextResponse } from "next/server"
//@ts-ignore
import { approveDraft } from "@repo/api/nova/product/builder"
import { requireWorkspaceLearner } from "../../../../../../lib/nova/workspace-access"
import { readSmallJson } from "../../../../../../lib/nova/extension-access"
import { builderFail, statusFor } from "../../../../../../lib/nova/builder-access"
import { rateGate } from "../../../../../../lib/rate-limits"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"


// POST /api/nova/builder/[id]/approve  { version, addTo?, confirmAnother? }
// Builds the version named, and only if it is the current one: the server's
// stored proposal, checked again, in one transaction (workspaces.ts). Twice
// builds once. No model call. Response: BuilderResponse (draft.counts set
// when something was built).
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireWorkspaceLearner()
    if (access.denied) return access.denied
    const limited = await rateGate("builder.approve", { learner: access.platformChatId })
    if (limited) return limited
    const read = await readSmallJson(req, 4096)
    if (!read.ok) return builderFail(400, "invalid", "That approval couldn't be read.")
    const result = await approveDraft(access.platformChatId, (await ctx.params).id, (read.body ?? {}) as { version?: unknown; addTo?: unknown; confirmAnother?: unknown })
    return NextResponse.json(result, { status: result.ok ? 200 : statusFor(result.error), headers: { "cache-control": "no-store" } })
  } catch (err) {
    console.error("[nova/builder/:id/approve]", err)
    return builderFail(500, "failed", "Building it didn't work, and nothing was created. Try again.")
  }
}
