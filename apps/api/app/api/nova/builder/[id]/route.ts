import { NextResponse } from "next/server"
//@ts-ignore
import { deleteDraft, editDraftChanges, editDraftPlan, getDraft } from "@repo/api/nova/product/builder"
import { requireWorkspaceLearner } from "../../../../../lib/nova/workspace-access"
import { allowAttempt, readSmallJson } from "../../../../../lib/nova/extension-access"
import { builderFail, statusFor } from "../../../../../lib/nova/builder-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// A plan is text only; the check allows far less than this.
const PLAN_BODY_MAX = 256 * 1024
const EDITS_PER_MINUTE = 60

// GET /api/nova/builder/[id] — the conversation, the proposal and the job's
// real stage. The page polls this while a job runs. Response: BuilderResponse.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireWorkspaceLearner()
    if (access.denied) return access.denied
    const draft = await getDraft(access.platformChatId, (await ctx.params).id)
    if (!draft) return builderFail(404, "not_found", "That conversation isn't one of yours.")
    return NextResponse.json({ ok: true, draft }, { headers: { "cache-control": "no-store" } })
  } catch (err) {
    console.error("[nova/builder/:id GET]", err)
    return builderFail(500, "failed", "It didn't load. Try again.")
  }
}

// PATCH /api/nova/builder/[id]  { plan, baseVersion } or { keep, baseVersion }
// The learner's own edit of the proposal (a plan), or of proposed changes to
// something of theirs (keep: the ids of the changes that stay): checked on
// the server, saved only against the version it was made from, and a new
// version. No model call.
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireWorkspaceLearner()
    if (access.denied) return access.denied
    if (!allowAttempt(`builder-edit:${access.platformChatId}`, EDITS_PER_MINUTE, 60_000)) return builderFail(429, "rate_limited", "That's a lot of edits at once. Give it a moment.")
    const read = await readSmallJson(req, PLAN_BODY_MAX)
    if (!read.ok) return builderFail(read.reason === "too_large" ? 413 : 400, "invalid", "That proposal couldn't be read.")
    const body = (read.body ?? {}) as { plan?: unknown; keep?: unknown; baseVersion?: unknown }
    const id = (await ctx.params).id
    const result = body.keep !== undefined ? await editDraftChanges(access.platformChatId, id, body) : await editDraftPlan(access.platformChatId, id, body)
    return NextResponse.json(result, { status: result.ok ? 200 : statusFor(result.error), headers: { "cache-control": "no-store" } })
  } catch (err) {
    console.error("[nova/builder/:id PATCH]", err)
    return builderFail(500, "failed", "Your edit wasn't saved. It's still on the page; try again.")
  }
}

// DELETE /api/nova/builder/[id] — removes the conversation only. What it
// built or changed stays the learner's, in Knowledge, the Map and the Planner.
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireWorkspaceLearner()
    if (access.denied) return access.denied
    const result = await deleteDraft(access.platformChatId, (await ctx.params).id)
    if (!result.ok) return builderFail(result.error === "busy" ? 409 : 404, result.error, result.message)
    return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } })
  } catch (err) {
    console.error("[nova/builder/:id DELETE]", err)
    return builderFail(500, "failed", "That conversation wasn't deleted. Try again.")
  }
}
