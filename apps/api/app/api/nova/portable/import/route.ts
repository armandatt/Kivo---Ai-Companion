import { NextResponse } from "next/server"
//@ts-ignore
import { listImports, startImport } from "@repo/api/portable/import"
import { noteFail, requireNoteLearner } from "../../../../../lib/nova/note-access"
import { crossSiteUpload, importStorage, portableLimit, portableSlot, readUpload, uploadBytesLimit } from "../../../../../lib/nova/portable-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

// GET  /api/nova/portable/import   the learner's imports, newest first
// POST /api/nova/portable/import[?copy=1]   body: the .kivo map (bytes) →
// imports it as the session learner's own copy (portable/import.ts). The
// same file again returns the import already made (or finishes a stopped
// one); ?copy=1 makes another, independent copy. Storage for its images and
// files is reserved before anything is written. A .kivo note is refused
// (wrong_package_type) before anything is written.
export async function GET() {
  try {
    const access = await requireNoteLearner()
    if (access.denied) return access.denied
    return NextResponse.json({ ok: true, imports: await listImports(access.profileId) }, { headers: { "cache-control": "no-store" } })
  } catch (err) {
    console.error("[nova/portable/import GET]", (err as Error).name)
    return noteFail(500, "failed", "Your imports couldn't be loaded.")
  }
}

export async function POST(req: Request) {
  try {
    const cross = crossSiteUpload(req)
    if (cross) return cross
    const access = await requireNoteLearner()
    if (access.denied) return access.denied
    const limited = await portableLimit("import", access.platformChatId)
    if (limited) return limited
    const upload = await readUpload(req)
    if (!upload.ok) return upload.response
    const heavy = await uploadBytesLimit(access.platformChatId, upload.bytes.length)
    if (heavy) return heavy
    const slot = await portableSlot("import", access.platformChatId)
    if (slot.refused) return slot.refused
    const copy = new URL(req.url).searchParams.get("copy") === "1"
    const r = await startImport(access.profileId, upload.bytes, { admit: importStorage(access), copy }).finally(slot.release)
    const status = r.ok ? (r.status === "running" ? 202 : 200) : r.reason === "storage" ? 413 : r.status === "refused" ? 422 : 500
    return NextResponse.json(r, { status, headers: { "cache-control": "no-store" } })
  } catch (err) {
    console.error("[nova/portable/import POST]", (err as Error).name)
    return noteFail(500, "failed", "The import stopped. Nothing was lost; try again and it continues where it stopped.")
  }
}
