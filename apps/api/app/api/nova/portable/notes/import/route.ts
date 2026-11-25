import { NextResponse } from "next/server"
//@ts-ignore
import { previewNoteImport, startNoteImport } from "@repo/api/portable/note-share"
import { noteFail, requireNoteLearner } from "../../../../../../lib/nova/note-access"
import { crossSiteUpload, importStorage, portableLimit, portableSlot, readUpload, uploadBytesLimit } from "../../../../../../lib/nova/portable-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

// POST /api/nova/portable/notes/import?action=preview&name=<file name>
//   body: a .kivo note or a PDF (bytes) → what an import would make. Stores nothing.
// POST /api/nova/portable/notes/import?action=import&name=…&subjectId=…&topicName=…&title=…[&copy=1]
//   → a new note, the session learner's own (portable/note-share.ts). The
//   same file again returns the note already made (or finishes a stopped
//   import); copy=1 makes another. A .kivo map is refused (wrong_package_type)
//   before anything is written. No model is called; any plan may import.
export async function POST(req: Request) {
  try {
    const cross = crossSiteUpload(req)
    if (cross) return cross
    const access = await requireNoteLearner()
    if (access.denied) return access.denied
    const q = new URL(req.url).searchParams
    const action = q.get("action") === "import" ? "import" : "preview"
    const limited = await portableLimit(action === "import" ? "import" : "import-preview", access.platformChatId)
    if (limited) return limited
    const upload = await readUpload(req)
    if (!upload.ok) return upload.response
    const heavy = await uploadBytesLimit(access.platformChatId, upload.bytes.length)
    if (heavy) return heavy
    const name = q.get("name")
    if (action === "preview") {
      const p = await previewNoteImport(access.profileId, upload.bytes, name)
      return NextResponse.json(p, { status: p.ok ? 200 : 422, headers: { "cache-control": "no-store" } })
    }
    const slot = await portableSlot("import", access.platformChatId)
    if (slot.refused) return slot.refused
    const r = await startNoteImport(access.profileId, upload.bytes, {
      fileName: name, subjectId: q.get("subjectId"), topicName: q.get("topicName"), title: q.get("title"), copy: q.get("copy") === "1",
      admit: importStorage(access),
    }).finally(slot.release)
    const status = r.ok ? (r.status === "running" ? 202 : 200) : r.reason === "storage" ? 413 : r.status === "refused" ? 422 : 500
    return NextResponse.json(r, { status, headers: { "cache-control": "no-store" } })
  } catch (err) {
    console.error("[nova/portable/notes/import]", (err as Error).name)
    return noteFail(500, "failed", "The import stopped. Nothing was lost; send the same file again and it continues where it stopped.")
  }
}
