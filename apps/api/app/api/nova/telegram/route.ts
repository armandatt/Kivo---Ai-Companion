import { NextResponse } from "next/server"
//@ts-ignore
import { resolveNoteLearner } from "@repo/api/nova/product/notes"
//@ts-ignore
import { changeTelegramPage, loadTelegramPage } from "@repo/api/nova/product/telegram-page"
//@ts-ignore
import { reminderTarget } from "@repo/api/nova/telegram/channel-store"
//@ts-ignore
import { usageViewFor } from "@repo/api/billing/accounting/summary"
import { resolveNovaLearner } from "../../../../lib/nova/resolve-learner"
import { readSmallJson } from "../../../../lib/nova/extension-access"
import { rateGate } from "../../../../lib/rate-limits"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const fail = (status: number, error: string, message: string) => NextResponse.json({ ok: false, error, message }, { status })

// The signed-in account's learner, from the session cookie only.
async function learner() {
  const l = await resolveNovaLearner()
  if (l.kind === "unauthenticated") return { denied: fail(401, "unauthenticated", "Sign in first.") }
  if (l.kind !== "learner") return { denied: fail(409, l.kind, "Telegram reminders are part of Nova.") }
  const resolved = await resolveNoteLearner(l.platformChatId)
  if (resolved.status !== "ready") return { denied: fail(409, resolved.status, "Finish setting up with Nova first.") }
  const target = await reminderTarget(resolved.profileId)
  return { userId: l.userId, profileId: resolved.profileId as string, platformChatId: l.platformChatId, timezone: (target?.timezone ?? null) as string | null }
}

// GET /api/nova/telegram: NovaTelegramPage (product/telegram-page.types.ts).
// Read-only.
export async function GET() {
  try {
    const a = await learner()
    if ("denied" in a) return a.denied
    const usage = await usageViewFor(a.userId).catch(() => null)
    const credits = usage ? { used: usage.nova.used, limit: usage.nova.limit, resetsAt: usage.nova.resetsAt, enforced: usage.enforced.nova } : null
    return NextResponse.json(await loadTelegramPage({ ...a, credits }), { headers: { "cache-control": "no-store" } })
  } catch (err) {
    console.error("[nova/telegram GET]", (err as Error)?.name ?? err)
    return fail(500, "failed", "The Telegram page didn't load. Try again.")
  }
}

// POST /api/nova/telegram: one change (TelegramPageAction), through the
// same functions the chat's buttons call.
export async function POST(req: Request) {
  try {
    const a = await learner()
    if ("denied" in a) return a.denied
    const limited = await rateGate("day.flow", { learner: a.platformChatId })
    if (limited) return limited
    const read = await readSmallJson(req, 4 * 1024)
    if (!read.ok) return fail(400, "invalid", "That isn't a change this page can make.")
    const r = await changeTelegramPage(a, read.body)
    if (!r.ok) return fail(r.error === "not_found" ? 404 : r.error === "not_connected" ? 409 : 400, r.error, r.message)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[nova/telegram POST]", (err as Error)?.name ?? err)
    return fail(500, "failed", "That didn't save. Try again.")
  }
}
