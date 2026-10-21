import { NextResponse } from "next/server"
//@ts-ignore
import { approveDraft } from "@repo/api/nova/product/builder"
import { requireWorkspaceLearner } from "../../../../../../lib/nova/workspace-access"
import { allowAttempt, readSmallJson } from "../../../../../../lib/nova/extension-access"
import { builderFail, statusFor } from "../../../../../../lib/nova/builder-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const APPROVALS_PER_MINUTE = 10

// POST /api/nova/builder/[id]/approve  { version, addTo?, confirmAnother? }
// Builds the version named, and only if it is the current one: the server's
// stored proposal, checked again, in one transaction (workspaces.ts). Twice
// builds once. No model call. Response: BuilderResponse (draft.counts set
// when something was built).
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireWorkspaceLearner()
    if (access.denied) return access.denied
    if (!allowAttempt(`builder-approve:${access.platformChatId}`, APPROVALS_PER_MINUTE, 60_000)) return builderFail(429, "rate_limited", "That's a lot at once. Give it a minute.")
    const read = await readSmallJson(req, 4096)
    if (!read.ok) return builderFail(400, "invalid", "That approval couldn't be read.")
    const result = await approveDraft(access.platformChatId, (await ctx.params).id, (read.body ?? {}) as { version?: unknown; addTo?: unknown; confirmAnother?: unknown })
    return NextResponse.json(result, { status: result.ok ? 200 : statusFor(result.error), headers: { "cache-control": "no-store" } })
  } catch (err) {
    console.error("[nova/builder/:id/approve]", err)
    return builderFail(500, "failed", "Building it didn't work, and nothing was created. Try again.")
  }
}
