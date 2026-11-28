import { after, NextResponse } from "next/server"
//@ts-ignore
import { importStatus, resumeImport } from "@repo/api/portable/import"
import { noteFail, requireNoteLearner } from "../../../../../../lib/nova/note-access"
import { importStorage, portableLimit, portableSlot } from "../../../../../../lib/nova/portable-access"
//@ts-ignore
import { crossSiteProblem } from "@repo/api/auth/request-origin"
import { connectOrigin } from "../../../../../../lib/connect/config"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

// GET /api/nova/portable/import/:id  where the session learner's import
// stands (portable/import.ts importStatus): running (stalled when its run
// stopped), complete with the map's ids, or failed with why. Read-only.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireNoteLearner()
    if (access.denied) return access.denied
    const { id } = await ctx.params
    if (typeof id !== "string" || id.length > 40) return noteFail(400, "invalid", "That import doesn't exist.")
    const r = await importStatus(access.profileId, id)
    return NextResponse.json(r, { status: r.ok ? 200 : 404, headers: { "cache-control": "no-store" } })
  } catch (err) {
    console.error("[nova/portable/import/:id GET]", (err as Error).name)
    return noteFail(500, "failed", "Couldn't read the import. Try again.")
  }
}

// POST /api/nova/portable/import/:id  {}   continue a stopped import (the
// session learner's own job only; another account's id is "not found"). A
// map with images or files whose notes aren't finished needs its file again
// (file_needed, 409): send it to POST /api/nova/portable/import.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const cross = crossSiteProblem(req.headers, [connectOrigin(), process.env.NEXT_PUBLIC_APP_URL ?? null])
    if (cross) return noteFail(cross.status, "forbidden", cross.error)
    const access = await requireNoteLearner()
    if (access.denied) return access.denied
    const limited = await portableLimit("import", access.platformChatId)
    if (limited) return limited
    const { id } = await ctx.params
    if (typeof id !== "string" || id.length > 40) return noteFail(400, "invalid", "That import doesn't exist.")
    // The job's own slot: a second tab resuming the same job shares it.
    const slot = await portableSlot("import", access.platformChatId, `job:${id}`)
    if (slot.refused) return slot.refused
    let background = false
    const r = await resumeImport(access.profileId, id, {
      admit: importStorage(access),
      background: (work: () => Promise<unknown>) => { background = true; after(async () => { try { await work() } finally { await slot.release() } }) },
    }).finally(() => { if (!background) void slot.release() })
    const status = r.ok ? (r.status === "running" ? 202 : 200) : r.reason === "file_needed" ? 409 : r.reason === "storage" ? 413 : r.status === "refused" ? 404 : 500
    return NextResponse.json(r, { status, headers: { "cache-control": "no-store" } })
  } catch (err) {
    console.error("[nova/portable/import/:id]", (err as Error).name)
    return noteFail(500, "failed", "The import stopped. Nothing was lost; try again.")
  }
}
