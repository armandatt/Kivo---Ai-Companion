import { NextResponse } from "next/server"
//@ts-ignore
import { resolveEventLearner } from "@repo/api/nova/product/learning-events"
//@ts-ignore
import { captureToDraft, currentDraft, CAPTURES_PER_MINUTE } from "@repo/api/nova/product/capture-drafts"
import { allowAttempt, eventFail, readSmallJson, resolveExtensionCaller, preflight, withCors } from "../../../../../lib/nova/extension-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// The extension's Capture: a passage (or the page) into the learner's current
// draft, at once, with nothing to choose. Organising happens later, in Kivo.
// GET  /api/nova/extension/captures    the draft a capture would join, and how many are open
// POST /api/nova/extension/captures    { key, url, title, text?, context?, newDraft? }
// The learner is the credential's own. Rules: product/capture-drafts.ts.
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
    const now = await currentDraft(who.profileId)
    return NextResponse.json({ success: true, current: now.current, open: now.open }, { headers: { "cache-control": "no-store" } })
  } catch (err) {
    console.error("[nova/extension/captures GET]", err)
    return eventFail(500, "failed", "That didn't load. Try again.")
  }
}

export async function POST(req: Request) {
  return withCors(req, await handlePOST(req))
}

async function handlePOST(req: Request): Promise<NextResponse> {
  try {
    const who = await learnerOf(req)
    if (who instanceof NextResponse) return who
    if (!allowAttempt(`capture:${who.profileId}`, CAPTURES_PER_MINUTE, 60_000)) return eventFail(429, "rate_limited", "That's a lot at once. Give it a minute.")
    const read = await readSmallJson(req, 48 * 1024)
    if (!read.ok) return eventFail(read.reason === "too_large" ? 413 : 400, read.reason === "too_large" ? "too_long" : "invalid", read.reason === "too_large" ? "That's more than a draft keeps at once. Select a shorter passage." : "That isn't something Nova can keep.")
    const result = await captureToDraft(who.profileId, read.body)
    if (result.ok) return NextResponse.json({ success: true, ...result }, { headers: { "cache-control": "no-store" } })
    return NextResponse.json({ success: false, ...result }, { status: result.error === "busy" ? 409 : 400 })
  } catch (err) {
    console.error("[nova/extension/captures POST]", err)
    return eventFail(500, "failed", "That didn't save. Try again.")
  }
}

export const OPTIONS = preflight
