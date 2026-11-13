import { NextResponse } from "next/server"
//@ts-ignore
import { placeDraftItem, setDraftItemPlacement } from "@repo/api/nova/product/capture-drafts"
import { allowAttempt, eventFail, preflight, readSmallJson, requireExtensionLearner, withCors } from "../../../../../../lib/nova/extension-access"
import { PLACE_STATUS, readPlaceBody } from "../../../../../../lib/nova/place-body"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Where a captured passage belongs in the learner's workspace.
// POST /api/nova/extension/captures/place  { draftId, itemId }
//      Kivo's placement, asked once after the capture is saved (the capture
//      never waits for it): filed with high or medium confidence, or only a
//      suggestion. A passage the learner placed themselves is answered as is.
// PUT  /api/nova/extension/captures/place  { draftId, itemId, subjectId|null, topicId|null }
//      The learner's own choice (or "nowhere"), kept as theirs.
// Rules: product/knowledge-placement.ts. The draft must be the learner's.
const PLACES_PER_MINUTE = 40

async function handle(req: Request, choose: boolean): Promise<NextResponse> {
  try {
    const who = await requireExtensionLearner(req)
    if (who.denied) return who.denied
    if (!allowAttempt(`place:${who.profileId}`, PLACES_PER_MINUTE, 60_000)) return eventFail(429, "rate_limited", "That's a lot at once. Give it a minute.")
    const read = await readSmallJson(req, 4 * 1024)
    const body = read.ok ? readPlaceBody(read.body) : null
    if (!body || !body.draftId) return eventFail(400, "invalid", "That isn't a passage Nova can place.")
    const result = choose
      ? await setDraftItemPlacement(who.profileId, body.draftId, body.itemId, { subjectId: body.subjectId, topicId: body.topicId, topicName: body.topicName })
      : await placeDraftItem(who.profileId, body.draftId, body.itemId, { surface: "extension" })
    if (!result.ok) return NextResponse.json({ success: false, ...result }, { status: PLACE_STATUS[result.error] ?? 400 })
    const { draft: _draft, ...answer } = result
    return NextResponse.json({ success: true, ...answer }, { headers: { "cache-control": "no-store" } })
  } catch (err) {
    console.error("[nova/extension/captures/place]", err)
    return eventFail(500, "failed", "Kivo couldn't place that just now. It is in your draft.")
  }
}

export async function POST(req: Request) { return withCors(req, await handle(req, false)) }
export async function PUT(req: Request) { return withCors(req, await handle(req, true)) }
export const OPTIONS = preflight
