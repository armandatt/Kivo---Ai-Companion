import { NextResponse } from "next/server"
//@ts-ignore
import { handleNovaTurn } from "@repo/api/nova/entry"
//@ts-ignore
import { checkRateLimit } from "@repo/api/services/rateLimit.service"
import { resolveNovaLearner } from "../../../../lib/nova/resolve-learner"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_TEXT_LENGTH = 2000

// One turn at a time per learner, the same rule the Telegram webhook applies.
// In-process, like that one: correct for a single API instance.
const inFlight = new Map<string, number>()
const LOCK_TTL_MS = 45_000

// POST /api/nova/message  { text }
// A message to Nova from the web app: natural language, or a slash command
// such as "/study Deadlocks". It runs the same turn Telegram runs, for the
// same learner, and returns the reply instead of sending it to Telegram.
// Request / response: NovaMessageRequest / NovaMessageResponse.
export async function POST(req: Request) {
  const fail = (status: number, error: string, message: string) =>
    NextResponse.json({ ok: false, error, message }, { status })

  const learner = await resolveNovaLearner()
  if (learner.kind === "unauthenticated") return fail(401, "unauthenticated", "Sign in to talk to Nova.")
  if (learner.kind === "not_nova")        return fail(409, "not_nova", "This account is not set up with Nova.")
  if (learner.kind === "not_connected")   return fail(409, "not_connected", "Connect Telegram to start with Nova.")

  const body = await req.json().catch(() => null) as { text?: unknown } | null
  const text = typeof body?.text === "string" ? body.text.trim().slice(0, MAX_TEXT_LENGTH) : ""
  if (!text) return fail(400, "empty", "Say something first.")

  const limit = await checkRateLimit(learner.platformChatId)
  if (!limit.allowed) return fail(429, "rate_limited", "You've reached the message limit for now. Try again shortly.")

  const since = inFlight.get(learner.platformChatId)
  if (since !== undefined && Date.now() - since < LOCK_TTL_MS) {
    return fail(429, "rate_limited", "Nova is still working on your last message.")
  }
  inFlight.set(learner.platformChatId, Date.now())

  try {
    const turn = await handleNovaTurn({
      platformChatId:   learner.platformChatId,
      text,
      onboardingDone:   learner.onboardingDone,
      surface:          "web",
      awaitPersistence: true,   // the page re-reads state right after the reply
    })
    if (!turn.ok) return fail(502, "failed", turn.reply)
    return NextResponse.json({ ok: true, reply: turn.reply, intervention: turn.intervention })
  } catch (err) {
    console.error("[nova/message]", err)
    return fail(500, "failed", "Something went wrong on Nova's end. Try again in a moment.")
  } finally {
    inFlight.delete(learner.platformChatId)
  }
}
