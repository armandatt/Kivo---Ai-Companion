import { NextResponse } from "next/server"
//@ts-ignore
import { resumeImport } from "@repo/api/portable/import"
import { noteFail, requireNoteLearner } from "../../../../../../lib/nova/note-access"
import { importStorage, portableLimit, portableSlot } from "../../../../../../lib/nova/portable-access"
//@ts-ignore
import { crossSiteProblem } from "@repo/api/auth/request-origin"
import { connectOrigin } from "../../../../../../lib/connect/config"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

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
    const r = await resumeImport(access.profileId, id, { admit: importStorage(access) }).finally(slot.release)
    const status = r.ok ? (r.status === "running" ? 202 : 200) : r.reason === "file_needed" ? 409 : r.reason === "storage" ? 413 : r.status === "refused" ? 404 : 500
    return NextResponse.json(r, { status, headers: { "cache-control": "no-store" } })
  } catch (err) {
    console.error("[nova/portable/import/:id]", (err as Error).name)
    return noteFail(500, "failed", "The import stopped. Nothing was lost; try again.")
  }
}
