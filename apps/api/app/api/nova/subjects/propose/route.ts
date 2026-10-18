import { NextResponse } from "next/server"
import { metered } from "../../../../../lib/billing/metered"
//@ts-ignore
import { proposeStudyEdits } from "@repo/api/nova/product/study-proposal"
//@ts-ignore
import { loadLearningContexts } from "@repo/api/nova/adapters/account-preferences-adapter"
import { noteFail, requireNoteLearner } from "../../../../../lib/nova/note-access"
import { allowAttempt, readSmallJson } from "../../../../../lib/nova/extension-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const PROPOSALS_PER_MINUTE = 4

// POST /api/nova/subjects/propose  { request }
// Nova proposes changes to the learner's subjects and topics from their own
// words: one model call, every change checked against their real structure,
// nothing stored or applied (product/study-proposal.ts). Approval is the
// ordinary POST /api/nova/subjects with the version returned here.
// Response: StudyProposalResponse.
export async function POST(req: Request) {
  try {
    const access = await requireNoteLearner()
    if (access.denied) return access.denied
    if (!allowAttempt(`study-proposal:${access.profileId}`, PROPOSALS_PER_MINUTE, 60_000)) {
      return noteFail(429, "rate_limited", "That's a lot at once. Give it a minute.")
    }
    const read = await readSmallJson(req, 4 * 1024)
    if (!read.ok) return noteFail(400, "invalid", "Say what you want to change.")
    const contexts = await loadLearningContexts(access.platformChatId).catch(() => [])
    const run = await metered(access.platformChatId, () => proposeStudyEdits(access.profileId, read.body, contexts))
    if (!run.ok) return run.response
    const result = run.value as Awaited<ReturnType<typeof proposeStudyEdits>>
    if (result.ok) return NextResponse.json(result, { headers: { "cache-control": "no-store" } })
    return NextResponse.json(result, { status: result.error === "unavailable" ? 503 : 400 })
  } catch (err) {
    console.error("[nova/subjects/propose]", err)
    return noteFail(500, "failed", "That didn't work. Try again.")
  }
}
