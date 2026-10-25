import { NextResponse } from "next/server"
//@ts-ignore
import { confirmDeletion } from "@repo/api/nova/product/builder"
import { requireWorkspaceLearner } from "../../../../../../lib/nova/workspace-access"
import { allowAttempt, readSmallJson } from "../../../../../../lib/nova/extension-access"
import { builderFail, statusFor } from "../../../../../../lib/nova/builder-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const DELETIONS_PER_MINUTE = 6

// POST /api/nova/builder/[id]/delete-resource  { fingerprint } | { cancel: true }
// Carries out the deletion this conversation showed, only with its
// fingerprint (what it would remove, as worked out from the records), or
// drops it. A chat message never gets here. Response: BuilderResponse.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireWorkspaceLearner()
    if (access.denied) return access.denied
    if (!allowAttempt(`builder-delete:${access.platformChatId}`, DELETIONS_PER_MINUTE, 60_000)) return builderFail(429, "rate_limited", "That's a lot at once. Give it a minute.")
    const read = await readSmallJson(req, 1024)
    if (!read.ok) return builderFail(400, "invalid", "That couldn't be read.")
    const result = await confirmDeletion(access.platformChatId, (await ctx.params).id, (read.body ?? {}) as { fingerprint?: unknown; cancel?: unknown })
    return NextResponse.json(result, { status: result.ok ? 200 : statusFor(result.error), headers: { "cache-control": "no-store" } })
  } catch (err) {
    console.error("[nova/builder/:id/delete-resource]", err)
    return builderFail(500, "failed", "Deleting didn't work, and nothing was deleted. Try again.")
  }
}
