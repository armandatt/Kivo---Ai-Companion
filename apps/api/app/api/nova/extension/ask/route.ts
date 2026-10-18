import { NextResponse } from "next/server"
import { metered } from "../../../../../lib/billing/metered"
//@ts-ignore
import { answerPageQuestion, PAGE_QUESTIONS_PER_MINUTE } from "@repo/api/nova/product/page-question"
//@ts-ignore
import { EVENT_BODY_MAX_BYTES } from "@repo/api/nova/product/learning-events.types"
import { allowAttempt, eventFail, readSmallJson, resolveExtensionCaller, preflight, withCors } from "../../../../../lib/nova/extension-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// POST /api/nova/extension/ask   { question, url, title, excerpt? }
// The extension's "Ask Nova about this page". One model call, given the
// page's title and site and the passage the learner selected, if any. Nova
// has not read the page and the server does not fetch it.
// It answers and nothing else: nothing is stored, and the question does not
// enter the chat pipeline (see product/page-question.ts).
// The learner is the credential's own. Response: PageAnswer.
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
    // Per connected browser. Each question is a model call.
    if (!allowAttempt(`ask:${caller.connectionId}`, PAGE_QUESTIONS_PER_MINUTE, 60_000)) {
      return eventFail(429, "rate_limited", "That's a lot of questions at once. Give it a minute.")
    }
    const read = await readSmallJson(req, EVENT_BODY_MAX_BYTES)
    if (!read.ok) {
      return read.reason === "too_large"
        ? eventFail(413, "too_large", "That's more than Nova reads at once. Select a shorter passage.")
        : eventFail(400, "invalid", "That isn't a question Nova can answer.")
    }
    const run = await metered(caller.platformChatId, () => answerPageQuestion(read.body))
    if (!run.ok) return run.response
    const result = run.value as Awaited<ReturnType<typeof answerPageQuestion>>
    if (result.ok) return NextResponse.json(result, { headers: { "cache-control": "no-store" } })
    return NextResponse.json({ success: false, ...result }, { status: result.error === "unavailable" ? 503 : 400 })
  } catch (err) {
    console.error("[nova/extension/ask]", err)
    return eventFail(500, "failed", "That didn't work. Try again.")
  }
}

// The extension's preflight.
export const OPTIONS = preflight
