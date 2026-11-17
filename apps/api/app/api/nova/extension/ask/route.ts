import { NextResponse } from "next/server"
import { metered } from "../../../../../lib/billing/metered"
//@ts-ignore
import { answerPageQuestion, PAGE_QUESTION_BODY_MAX_BYTES, PAGE_QUESTIONS_PER_MINUTE } from "@repo/api/nova/product/page-question"
import { allowAttempt, eventFail, readSmallJson, resolveExtensionCaller, preflight, withCors } from "../../../../../lib/nova/extension-access"
//@ts-ignore
import { meterLlmUsage } from "@repo/api/services/llm-usage"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// POST /api/nova/extension/ask   { question, url, title, excerpt?, screenshot?, pageText?, pageComplete?, scope? }
// The extension's chat with Nova about the page. One model call, given the
// page's title and site, its text as the extension read it (under the
// browser's permission for that tab), the passage the user selected, and the
// screenshot they took, each when there is one. The server never fetches the
// address.
// It answers and nothing else: nothing is stored (the screenshot included: it
// is read for this one answer and dropped), and the question does not
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
    const read = await readSmallJson(req, PAGE_QUESTION_BODY_MAX_BYTES)
    if (!read.ok) {
      return read.reason === "too_large"
        ? eventFail(413, "too_large", "That's more than Nova reads at once. Select a shorter passage, or mark a smaller part of the screenshot.")
        : eventFail(400, "invalid", "That isn't a question Nova can answer.")
    }
    // The answer's own tokens, returned so the extension can measure a question against a task.
    const usage = { inputTokens: 0, outputTokens: 0, calls: 0 }
    const run = await metered(caller.platformChatId, () => meterLlmUsage((u: { inputTokens: number | null; outputTokens: number | null }) => { usage.inputTokens += u.inputTokens ?? 0; usage.outputTokens += u.outputTokens ?? 0; usage.calls++ }, () => answerPageQuestion(read.body)), { feature: "extension_ask_nova", surface: "extension" })
    if (!run.ok) return run.response
    const result = run.value as Awaited<ReturnType<typeof answerPageQuestion>>
    if (result.ok) return NextResponse.json({ ...result, usage }, { headers: { "cache-control": "no-store" } })
    return NextResponse.json({ success: false, ...result }, { status: result.error === "unavailable" ? 503 : 400 })
  } catch (err) {
    console.error("[nova/extension/ask]", err)
    return eventFail(500, "failed", "That didn't work. Try again.")
  }
}

// The extension's preflight.
export const OPTIONS = preflight
