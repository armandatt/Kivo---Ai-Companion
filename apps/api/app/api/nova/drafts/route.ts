import { NextResponse } from "next/server"
//@ts-ignore
import { captureToDraft, currentDraft, listDrafts, CAPTURES_PER_MINUTE } from "@repo/api/nova/product/capture-drafts"
import { allowAttempt, readSmallJson, requireWebLearner } from "../../../../lib/nova/extension-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NO_STORE = { "cache-control": "no-store" }
const fail = (status: number, error: string, message: string) => NextResponse.json({ ok: false, error, message }, { status })

// GET  /api/nova/drafts    the learner's open drafts (newest first), the one a
//                          capture would join now, and how many are open
// POST /api/nova/drafts    a capture from the web app ("Keep in drafts"):
//                          { key?, url?, title?, text?, note?, newDraft? }
// Rules: product/capture-drafts.ts and capture-draft-rules.ts.
export async function GET() {
  try {
    const access = await requireWebLearner()
    if (access.denied) return access.denied
    const [drafts, now] = await Promise.all([listDrafts(access.profileId), currentDraft(access.profileId)])
    return NextResponse.json({ ok: true, drafts, current: now.current, open: now.open }, { headers: NO_STORE })
  } catch (err) {
    console.error("[nova/drafts GET]", err)
    return fail(500, "failed", "Your drafts didn't load. Try again.")
  }
}

export async function POST(req: Request) {
  try {
    const access = await requireWebLearner()
    if (access.denied) return access.denied
    if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return fail(400, "invalid", "That isn't something Nova can keep.")
    if (!allowAttempt(`capture:${access.profileId}`, CAPTURES_PER_MINUTE, 60_000)) return fail(429, "rate_limited", "That's a lot at once. Give it a minute.")
    const read = await readSmallJson(req, 48 * 1024)
    if (!read.ok) return fail(read.reason === "too_large" ? 413 : 400, read.reason === "too_large" ? "too_long" : "invalid", read.reason === "too_large" ? "That's more than a draft keeps at once." : "That isn't something Nova can keep.")
    const result = await captureToDraft(access.profileId, read.body)
    return NextResponse.json(result, { status: result.ok ? 200 : result.error === "busy" ? 409 : 400, headers: NO_STORE })
  } catch (err) {
    console.error("[nova/drafts POST]", err)
    return fail(500, "failed", "That didn't save. Try again.")
  }
}
