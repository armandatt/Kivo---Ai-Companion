import { NextResponse } from "next/server"
//@ts-ignore
import { loadSetup, previewSetup, saveSetup } from "@repo/api/nova/product/setup"
import { resolveNovaLearner } from "../../../../lib/nova/resolve-learner"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// The learner's study setup: subjects, what each covers, exam dates, how
// long a normal day allows and when they usually study. The learner is the
// signed-in account's; no id is read from the request.
//
// GET  /api/nova/setup                     what is on record
// POST /api/nova/setup { draft }           what saving the draft would do; writes nothing
// POST /api/nova/setup { draft, confirm }  saves it (confirm: true)
export async function GET() {
  try {
    const learner = await resolveNovaLearner()
    if (learner.kind === "unauthenticated") return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })
    if (learner.kind !== "learner") return NextResponse.json({ status: learner.kind })
    const setup = await loadSetup(learner.platformChatId)
    if (!setup) return NextResponse.json({ status: "not_connected" })
    return NextResponse.json({ status: "ready", ...setup })
  } catch (err) {
    console.error("[nova/setup]", err)
    return NextResponse.json({ error: "Failed to load setup" }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const learner = await resolveNovaLearner()
    if (learner.kind === "unauthenticated") return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 })
    if (learner.kind !== "learner") return NextResponse.json({ ok: false, error: learner.kind }, { status: 409 })

    const body = await req.json().catch(() => null) as { draft?: unknown; confirm?: unknown } | null
    if (!body || typeof body.draft !== "object" || body.draft === null) {
      return NextResponse.json({ ok: false, error: "invalid", issues: [{ field: "draft", message: "Nothing to save." }] }, { status: 400 })
    }

    if (body.confirm !== true) {
      const preview = await previewSetup(learner.platformChatId, body.draft)
      if (preview.status !== "ok") return NextResponse.json({ ok: false, error: "not_connected" }, { status: 409 })
      return NextResponse.json({ ok: true, saved: false, draft: preview.draft, changes: preview.changes, issues: preview.issues })
    }

    const result = await saveSetup(learner.platformChatId, body.draft)
    if (result.status === "not_ready") return NextResponse.json({ ok: false, error: "not_connected" }, { status: 409 })
    if (result.status === "invalid") return NextResponse.json({ ok: false, error: "invalid", issues: result.issues }, { status: 422 })
    return NextResponse.json({ ok: true, saved: true, changes: result.changes, setup: result.setup })
  } catch (err) {
    console.error("[nova/setup]", err)
    return NextResponse.json({ ok: false, error: "failed" }, { status: 500 })
  }
}
