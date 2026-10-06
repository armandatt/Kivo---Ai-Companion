import { NextResponse } from "next/server"
//@ts-ignore
import { loadNovaSession, runNovaSessionCommand } from "@repo/api/nova/product/session"
//@ts-ignore
import { parseSessionCommand } from "@repo/api/nova/product/session-view"
import { resolveNovaLearner } from "../../../../lib/nova/resolve-learner"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const fail = (status: number, error: string, message: string) =>
  NextResponse.json({ ok: false, error, message }, { status })

async function resolveOnboardedLearner() {
  const learner = await resolveNovaLearner()
  if (learner.kind === "unauthenticated") return { error: fail(401, "unauthenticated", "Sign in to study with Nova.") }
  if (learner.kind === "not_nova")        return { error: fail(409, "not_nova", "This account is not set up with Nova.") }
  if (learner.kind === "not_connected")   return { error: fail(409, "not_connected", "Choose Nova in setup first.") }
  if (!learner.onboardingDone)            return { error: fail(409, "onboarding_incomplete", "Finish setting up with Nova first.") }
  return { learner }
}

// GET /api/nova/session
// The running study session, or null. Response: NovaSessionResponse.
export async function GET() {
  const { learner, error } = await resolveOnboardedLearner()
  if (error) return error
  try {
    const session = await loadNovaSession(learner.platformChatId)
    return NextResponse.json({ ok: true, session, ended: null })
  } catch (err) {
    console.error("[nova/session]", err)
    return fail(500, "failed", "Could not load your session.")
  }
}

// POST /api/nova/session
//   { action: "start", topicName, subjectName?, plannedMinutes? }
//   { action: "pause" | "resume" | "end" }
// The buttons on Home and the focus screen. Explicit commands: they open,
// pause and close the same NovaStudySession a chat turn does, without an LLM
// call. Request / response: NovaSessionCommand / NovaSessionResponse.
export async function POST(req: Request) {
  const { learner, error } = await resolveOnboardedLearner()
  if (error) return error

  const command = parseSessionCommand(await req.json().catch(() => null))
  if (!command) return fail(400, "invalid", "That is not a session command.")

  try {
    const result = await runNovaSessionCommand(learner.platformChatId, command)
    if (result.ok) return NextResponse.json(result)
    return NextResponse.json(result, { status: result.error === "failed" ? 500 : 409 })
  } catch (err) {
    console.error("[nova/session]", err)
    return fail(500, "failed", "Something went wrong. Try again.")
  }
}
