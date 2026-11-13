import { NextResponse } from "next/server"
//@ts-ignore
import { placeDraftItem, setDraftItemPlacement } from "@repo/api/nova/product/capture-drafts"
import { readSmallJson, requireWebLearner } from "../../../../../../lib/nova/extension-access"
import { PLACE_STATUS, readPlaceBody } from "../../../../../../lib/nova/place-body"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// POST /api/nova/drafts/[id]/place { itemId }                       Kivo's placement for a passage (once)
// PUT  /api/nova/drafts/[id]/place { itemId, subjectId|null, topicId|null }   the learner's own choice
// The same service as the extension's (product/knowledge-placement.ts).
type Ctx = { params: Promise<{ id: string }> }
const fail = (status: number, error: string, message: string) => NextResponse.json({ ok: false, error, message }, { status })

async function handle(req: Request, ctx: Ctx, choose: boolean) {
  try {
    const access = await requireWebLearner()
    if (access.denied) return access.denied
    if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return fail(400, "invalid", "That isn't a change Nova can make.")
    const read = await readSmallJson(req, 4 * 1024)
    const body = read.ok ? readPlaceBody(read.body) : null
    if (!body) return fail(400, "invalid", "That isn't a change Nova can make.")
    const { id } = await ctx.params
    const result = choose
      ? await setDraftItemPlacement(access.profileId, id, body.itemId, { subjectId: body.subjectId, topicId: body.topicId, topicName: body.topicName })
      : await placeDraftItem(access.profileId, id, body.itemId, { surface: "web" })
    return NextResponse.json(result, { status: result.ok ? 200 : PLACE_STATUS[result.error] ?? 400, headers: { "cache-control": "no-store" } })
  } catch (err) {
    console.error("[nova/drafts/id/place]", err)
    return fail(500, "failed", "Kivo couldn't place that just now.")
  }
}

export const POST = (req: Request, ctx: Ctx) => handle(req, ctx, false)
export const PUT = (req: Request, ctx: Ctx) => handle(req, ctx, true)
