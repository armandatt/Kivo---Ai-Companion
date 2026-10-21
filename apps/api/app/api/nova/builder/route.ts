import { NextResponse } from "next/server"
//@ts-ignore
import { listDrafts, startDraft } from "@repo/api/nova/product/builder"
import { requireWorkspaceLearner } from "../../../../lib/nova/workspace-access"
import { readSmallJson } from "../../../../lib/nova/extension-access"
import { builderFail, spendForTurn, startJob, statusFor } from "../../../../lib/nova/builder-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const BODY_MAX = 16 * 1024

// GET /api/nova/builder — the learner's conversations with Nova about a
// workspace, newest first. Response: DraftListView (builder.types.ts).
export async function GET() {
  try {
    const access = await requireWorkspaceLearner()
    if (access.denied) return access.denied
    return NextResponse.json(await listDrafts(access.platformChatId), { headers: { "cache-control": "no-store" } })
  } catch (err) {
    console.error("[nova/builder GET]", err)
    return builderFail(500, "failed", "Your conversations didn't load. Try again.")
  }
}

// POST /api/nova/builder  { clientKey, text?, targetWorkspaceId? }
// Starts a conversation, once per clientKey. With an opening message, Nova
// answers it after this returns (one request on the AI allowance). Nothing
// but the conversation is stored. Response: BuilderResponse.
export async function POST(req: Request) {
  try {
    const access = await requireWorkspaceLearner()
    if (access.denied) return access.denied
    const read = await readSmallJson(req, BODY_MAX)
    if (!read.ok) return builderFail(read.reason === "too_large" ? 413 : 400, "invalid", "That message is too long.")
    const body = (read.body ?? {}) as { clientKey: unknown; text?: unknown; targetWorkspaceId?: unknown }
    const talking = typeof body.text === "string" && body.text.trim() !== ""
    if (talking) {
      const refused = await spendForTurn(access.platformChatId)
      if (refused) return refused
    }
    const started = await startDraft(access.platformChatId, body)
    if (!started.ok) return builderFail(statusFor(started.error), started.error, started.message)
    startJob(access.platformChatId, started.job)
    return NextResponse.json({ ok: true, draft: started.draft }, { headers: { "cache-control": "no-store" } })
  } catch (err) {
    console.error("[nova/builder POST]", err)
    return builderFail(500, "failed", "That didn't start. Your message is still here; try again.")
  }
}
