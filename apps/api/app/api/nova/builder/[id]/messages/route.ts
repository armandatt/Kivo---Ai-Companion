import { NextResponse } from "next/server"
//@ts-ignore
import { postMessage } from "@repo/api/nova/product/builder"
import { requireWorkspaceLearner } from "../../../../../../lib/nova/workspace-access"
import { readSmallJson } from "../../../../../../lib/nova/extension-access"
import { builderFail, spendForTurn, startJob, statusFor } from "../../../../../../lib/nova/builder-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const BODY_MAX = 16 * 1024

// POST /api/nova/builder/[id]/messages  { text } | { resume: true }
// A message to Nova in this conversation (or, with resume, an answer to the
// last one, for a conversation begun in chat). Claims the draft's one job and
// answers at once; Nova's reply follows (poll GET). One request on the AI
// allowance; eight a minute. Response: BuilderResponse.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireWorkspaceLearner()
    if (access.denied) return access.denied
    const read = await readSmallJson(req, BODY_MAX)
    if (!read.ok) return builderFail(read.reason === "too_large" ? 413 : 400, "invalid", "That message is too long.")
    const refused = await spendForTurn(access.platformChatId)
    if (refused) return refused
    const claimed = await postMessage(access.platformChatId, (await ctx.params).id, (read.body ?? {}) as { text?: unknown; resume?: unknown })
    if (!claimed.ok) return builderFail(statusFor(claimed.error), claimed.error, claimed.message, claimed.draft ? { draft: claimed.draft } : {})
    startJob(access.platformChatId, claimed.job)
    return NextResponse.json({ ok: true, draft: claimed.draft }, { headers: { "cache-control": "no-store" } })
  } catch (err) {
    console.error("[nova/builder/:id/messages]", err)
    return builderFail(500, "failed", "That didn't send. Your message is still here; try again.")
  }
}
