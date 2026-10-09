import { NextResponse } from "next/server"
//@ts-ignore
import { loadSavedResources, recordLearningEvent, resolveEventLearner } from "@repo/api/nova/product/learning-events"
//@ts-ignore
import { EVENT_BODY_MAX_BYTES } from "@repo/api/nova/product/learning-events.types"
import { eventFail, readSmallJson, requireWebLearner, resolveExtensionCaller, preflight, withCors } from "../../../../lib/nova/extension-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Learning events: what a learner explicitly did with a page in their
// browser. Deterministic, no LLM call. An event is kept as the learner's
// record and goes nowhere else: not to mastery, sessions, Learning DNA,
// memory or the chat pipeline.

// POST /api/nova/learning-events  (the browser extension)
// Request: LearningEventInput. Response: LearningEventResponse.
// Whose event it is comes from the extension's credential. `source` is set
// here, from the kind of credential, not from the body.
export async function POST(req: Request) {
  return withCors(req, await handlePOST(req))
}

async function handlePOST(req: Request): Promise<NextResponse> {
  try {
    const caller = await resolveExtensionCaller(req)
    if (caller.kind === "unauthenticated") return eventFail(401, "unauthenticated", "Connect Nova again.")
    if (caller.kind !== "learner") {
      return caller.kind === "not_nova"
        ? eventFail(409, "not_nova", "This account doesn't use Nova.")
        : eventFail(409, "not_connected", "Finish connecting Nova on the web first.")
    }

    const read = await readSmallJson(req, EVENT_BODY_MAX_BYTES)
    if (!read.ok) {
      return read.reason === "too_large"
        ? eventFail(413, "too_large", "That's more than Nova keeps about a page.")
        : eventFail(400, "invalid", "That isn't something Nova can save.")
    }

    const learner = await resolveEventLearner(caller.platformChatId)
    if (learner.status !== "ready") return eventFail(409, learner.status, "Finish setting up with Nova first.")

    const result = await recordLearningEvent(learner.profileId, read.body, { source: "browser_extension" })
    if (result.success) return NextResponse.json(result, { status: result.duplicate || result.action === "already_saved" ? 200 : 201 })
    return NextResponse.json(result, { status: result.error === "rate_limited" ? 429 : 400 })
  } catch (err) {
    console.error("[nova/learning-events]", err)
    return eventFail(500, "failed", "That didn't save. Try again.")
  }
}

// GET /api/nova/learning-events?subjectId=&topic=  (the signed-in web app)
// The pages the learner saved, newest first.
// Response: NovaSavedResourcesView.
export async function GET(req: Request) {
  try {
    const access = await requireWebLearner()
    if (access.denied) {
      if (access.status !== "unauthenticated") return NextResponse.json({ status: access.status })
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })
    }
    const params = new URL(req.url).searchParams
    return NextResponse.json(await loadSavedResources(access.platformChatId, { subjectId: params.get("subjectId"), topic: params.get("topic") }))
  } catch (err) {
    console.error("[nova/learning-events]", err)
    return NextResponse.json({ error: "Failed to load" }, { status: 500 })
  }
}

// The extension's preflight.
export const OPTIONS = preflight
