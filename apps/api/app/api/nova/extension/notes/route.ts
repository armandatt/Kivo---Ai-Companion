import { NextResponse } from "next/server"
//@ts-ignore
import { resolveEventLearner } from "@repo/api/nova/product/learning-events"
//@ts-ignore
import { listNoteChoices, noteChoicePreview, saveSelectionToNote } from "@repo/api/nova/product/note-append"
//@ts-ignore
import { EVENT_BODY_MAX_BYTES } from "@repo/api/nova/product/learning-events.types"
import { allowAttempt, eventFail, readSmallJson, resolveExtensionCaller, preflight, withCors } from "../../../../../lib/nova/extension-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// The extension's Save selection, into a note.
// GET  /api/nova/extension/notes?q=&subjectId=&topic=&skip=   notes to choose from
// GET  /api/nova/extension/notes?preview=<noteId>             one note, to be sure
// POST /api/nova/extension/notes   a selection_saved event, plus noteId or newNote
// The learner is the credential's own; a note id is used only with their profile.
// Rules: product/note-append.ts.
async function learnerOf(req: Request): Promise<{ profileId: string; connectionId: string } | NextResponse> {
  const caller = await resolveExtensionCaller(req)
  if (caller.kind === "unauthenticated") return eventFail(401, "unauthenticated", "Connect Nova again.")
  if (caller.kind !== "learner") return eventFail(409, caller.kind, "Finish connecting Nova on the web first.")
  const learner = await resolveEventLearner(caller.platformChatId)
  if (learner.status !== "ready") return eventFail(409, learner.status, "Finish the short setup on Nova first.")
  return { profileId: learner.profileId, connectionId: caller.connectionId }
}

export async function GET(req: Request) {
  return withCors(req, await handleGET(req))
}

async function handleGET(req: Request): Promise<NextResponse> {
  try {
    const who = await learnerOf(req)
    if (who instanceof NextResponse) return who
    if (!allowAttempt(`ext-notes:${who.connectionId}`, 120, 60_000)) return eventFail(429, "rate_limited", "That's a lot at once. Give it a minute.")
    const at = new URL(req.url).searchParams
    const preview = at.get("preview")
    if (preview) {
      const note = await noteChoicePreview(who.profileId, preview)
      return note ? NextResponse.json({ success: true, note }, { headers: { "cache-control": "no-store" } }) : eventFail(404, "not_found", "That note isn't there any more.")
    }
    const view = await listNoteChoices(who.profileId, { query: at.get("q"), subjectId: at.get("subjectId"), topicName: at.get("topic"), skip: Number(at.get("skip")) })
    return NextResponse.json({ success: true, ...view }, { headers: { "cache-control": "no-store" } })
  } catch (err) {
    console.error("[nova/extension/notes GET]", err)
    return eventFail(500, "failed", "That didn't work. Try again.")
  }
}

export async function POST(req: Request) {
  return withCors(req, await handlePOST(req))
}

async function handlePOST(req: Request): Promise<NextResponse> {
  try {
    const who = await learnerOf(req)
    if (who instanceof NextResponse) return who
    const read = await readSmallJson(req, EVENT_BODY_MAX_BYTES)
    if (!read.ok) return eventFail(read.reason === "too_large" ? 413 : 400, read.reason === "too_large" ? "too_large" : "invalid", read.reason === "too_large" ? "That's more than Nova keeps at once. Select a shorter passage." : "That isn't something Nova can save.")
    const result = await saveSelectionToNote(who.profileId, read.body, { source: "browser_extension" })
    if (result.success) return NextResponse.json(result, { headers: { "cache-control": "no-store" } })
    const status = result.error === "not_found" ? 404 : result.error === "rate_limited" ? 429 : result.error === "conflict" ? 409 : 400
    return NextResponse.json(result, { status })
  } catch (err) {
    console.error("[nova/extension/notes POST]", err)
    return eventFail(500, "failed", "That didn't work. Nothing was added. Try again.")
  }
}

export const OPTIONS = preflight
