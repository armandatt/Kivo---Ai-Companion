import { NextResponse } from "next/server"
//@ts-ignore
import { editDraft, getDraft, setDiscarded } from "@repo/api/nova/product/capture-drafts"
import { readSmallJson, requireWebLearner } from "../../../../../lib/nova/extension-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NO_STORE = { "cache-control": "no-store" }
const fail = (status: number, error: string, message: string) => NextResponse.json({ ok: false, error, message }, { status })
const STATUS: Record<string, number> = { invalid: 400, not_found: 404, conflict: 409, not_open: 409 }

// GET    /api/nova/drafts/[id]                one draft with its passages
// PATCH  /api/nova/drafts/[id] { version, edits }   edit, annotate, reorder, remove, rename
//        /api/nova/drafts/[id] { restore: true }    bring a discarded draft back (Undo)
// DELETE /api/nova/drafts/[id]                discard (kept, so Undo can restore it)
// The draft must be the learner's: an id alone reaches nothing.
type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const access = await requireWebLearner()
    if (access.denied) return access.denied
    const { id } = await ctx.params
    const draft = await getDraft(access.profileId, id)
    return draft ? NextResponse.json({ ok: true, draft }, { headers: NO_STORE }) : fail(404, "not_found", "That draft isn't there any more.")
  } catch (err) {
    console.error("[nova/drafts/id GET]", err)
    return fail(500, "failed", "That draft didn't load. Try again.")
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const access = await requireWebLearner()
    if (access.denied) return access.denied
    if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return fail(400, "invalid", "That isn't a change Nova can make.")
    const read = await readSmallJson(req, 256 * 1024)
    if (!read.ok) return fail(400, "invalid", "That isn't a change Nova can make.")
    const { id } = await ctx.params
    const body = read.body as Record<string, unknown> | null
    const result = body && body.restore === true ? await setDiscarded(access.profileId, id, false) : await editDraft(access.profileId, id, read.body)
    return NextResponse.json(result, { status: result.ok ? 200 : STATUS[result.error] ?? 400, headers: NO_STORE })
  } catch (err) {
    console.error("[nova/drafts/id PATCH]", err)
    return fail(500, "failed", "That didn't save. Try again.")
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const access = await requireWebLearner()
    if (access.denied) return access.denied
    const { id } = await ctx.params
    const result = await setDiscarded(access.profileId, id, true)
    return NextResponse.json(result, { status: result.ok ? 200 : STATUS[result.error] ?? 400, headers: NO_STORE })
  } catch (err) {
    console.error("[nova/drafts/id DELETE]", err)
    return fail(500, "failed", "That didn't work. Try again.")
  }
}
