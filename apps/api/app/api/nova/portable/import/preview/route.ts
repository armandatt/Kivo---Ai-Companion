import { NextResponse } from "next/server"
//@ts-ignore
import { previewImport } from "@repo/api/portable/import"
import { noteFail, requireNoteLearner } from "../../../../../../lib/nova/note-access"
import { crossSiteUpload, portableLimit, readUpload } from "../../../../../../lib/nova/portable-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// POST /api/nova/portable/import/preview   body: the .kivo file (bytes)
// Checks the file and says what an import would make. Stores nothing.
export async function POST(req: Request) {
  try {
    const cross = crossSiteUpload(req)
    if (cross) return cross
    const access = await requireNoteLearner()
    if (access.denied) return access.denied
    const limited = await portableLimit("import-preview", access.platformChatId)
    if (limited) return limited
    const upload = await readUpload(req)
    if (!upload.ok) return upload.response
    const p = await previewImport(access.profileId, upload.bytes)
    return NextResponse.json(p, { status: p.ok ? 200 : 422, headers: { "cache-control": "no-store" } })
  } catch (err) {
    console.error("[nova/portable/import/preview]", (err as Error).name)
    return noteFail(500, "failed", "The file couldn't be checked. Nothing was changed; try again.")
  }
}
