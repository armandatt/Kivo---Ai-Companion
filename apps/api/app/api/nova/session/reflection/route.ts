import { NextResponse } from "next/server"
//@ts-ignore
import { saveReflection } from "@repo/api/nova/product/session"
//@ts-ignore
import { REFLECTION_BODY_MAX_BYTES } from "@repo/api/nova/product/focus-context.types"
import { readSmallJson } from "../../../../../lib/nova/extension-access"
import { resolveNovaLearner } from "../../../../../lib/nova/resolve-learner"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const fail = (status: number, error: string, message: string) => NextResponse.json({ ok: false, error, message }, { status })

// The optional note after a session. It is kept on that session, once, and
// changes nothing the session already recorded. The session is one of the
// signed-in learner's own; another learner's is "not found".
//
// POST /api/nova/session/reflection { sessionId, did?, blocked?, next? }
// Response: ReflectionResponse (product/focus-context.types.ts)
export async function POST(req: Request) {
  try {
    const learner = await resolveNovaLearner()
    if (learner.kind === "unauthenticated") return fail(401, "unauthenticated", "Sign in again to save your note.")
    if (learner.kind !== "learner") return fail(409, learner.kind, "Session notes are part of Nova, which this account isn't using.")
    const read = await readSmallJson(req, REFLECTION_BODY_MAX_BYTES)
    if (!read.ok) {
      return read.reason === "too_large"
        ? fail(413, "too_large", "That's longer than a session note. Nothing was saved.")
        : fail(422, "invalid", "That isn't a note Nova can keep.")
    }
    const body   = (read.body ?? {}) as Record<string, unknown>
    const result = await saveReflection(learner.platformChatId, body.sessionId, body)
    if (result.ok) return NextResponse.json(result)
    return NextResponse.json(result, { status: result.error === "not_found" ? 404 : result.error === "not_connected" ? 409 : 422 })
  } catch (err) {
    console.error("[nova/session/reflection]", err instanceof Error ? err.name : "error")
    return fail(500, "failed", "Your note wasn't saved. Try again.")
  }
}
