import { NextResponse } from "next/server"
//@ts-ignore
import { loadSavedResources, recordLearningEvent, resolveEventLearner } from "@repo/api/nova/product/learning-events"
//@ts-ignore
import { EVENT_BODY_MAX_BYTES } from "@repo/api/nova/product/learning-events.types"
import { eventFail, fromExtensionOrigin, readSmallJson, requireWebLearner, resolveExtensionCaller, preflight, withCors } from "../../../../lib/nova/extension-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Learning events: what a learner explicitly did with a page in their
// browser. Deterministic, no LLM call. An event is kept as the learner's
// record and goes nowhere else: not to mastery, sessions, Learning DNA,
// memory or the chat pipeline.

// POST /api/nova/learning-events
// Request: LearningEventInput. Response: LearningEventResponse.
// Two callers, one way of saving:
//   the browser extension, with its own credential (Authorization: Bearer);
//   the signed-in web app's "Save a link" box, with the session cookie.
// Whose event it is comes from that credential, and so does `source`: neither
// is read from the body. A request that carries a bearer credential is the
// extension's and is never answered for a cookie.
export async function POST(req: Request) {
  return withCors(req, req.headers.has("authorization") ? await handlePOST(req) : await handleWebSave(req))
}

const answer = (result: Awaited<ReturnType<typeof recordLearningEvent>>) =>
  result.success
    ? NextResponse.json(result, { status: result.duplicate || result.action === "already_saved" ? 200 : 201 })
    : NextResponse.json(result, { status: result.error === "rate_limited" ? 429 : 400 })

// The web app saving a link the learner pasted, or one the bookmarklet
// brought. It saves and nothing else: studying a page starts from Saved.
// The session cookie is SameSite=Lax, and the body has to be declared as
// JSON, which no other site's form can send; an extension is told to use
// its own credential.
async function handleWebSave(req: Request): Promise<NextResponse> {
  try {
    if (fromExtensionOrigin(req)) return eventFail(401, "unauthenticated", "Connect Nova again.")
    if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
      return eventFail(400, "invalid", "That isn't something Nova can save.")
    }
    const access = await requireWebLearner()
    if (access.denied) return access.denied

    const read = await readSmallJson(req, EVENT_BODY_MAX_BYTES)
    if (!read.ok) {
      return read.reason === "too_large"
        ? eventFail(413, "too_large", "That's more than Nova keeps about a page.")
        : eventFail(400, "invalid", "That isn't something Nova can save.")
    }
    if ((read.body as { eventType?: unknown } | null)?.eventType !== "resource_saved") {
      return eventFail(400, "invalid", "Nova can only save a page from here.")
    }
    return answer(await recordLearningEvent(access.profileId, read.body, { source: "web" }))
  } catch (err) {
    console.error("[nova/learning-events]", err)
    return eventFail(500, "failed", "That didn't save. Try again.")
  }
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

    return answer(await recordLearningEvent(learner.profileId, read.body, { source: "browser_extension" }))
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
