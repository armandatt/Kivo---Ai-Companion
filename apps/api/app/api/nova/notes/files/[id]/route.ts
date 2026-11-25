//@ts-ignore
import { readNoteAttachment } from "@repo/api/nova/product/note-attachments"
//@ts-ignore
import { attachmentHeader } from "@repo/api/portable/export"
import { noteFail, requireNoteLearner } from "../../../../../../lib/nova/note-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string }> }

// GET /api/nova/notes/files/:id
// A file kept with one of the learner's notes (an imported PDF), to its owner
// only, byte for byte, always as a download: it is never shown inside Kivo's
// own pages, so nothing in it can run there.
export async function GET(_req: Request, { params }: Context) {
  try {
    const access = await requireNoteLearner()
    if (access.denied) return access.denied
    const file = await readNoteAttachment(access.profileId, (await params).id)
    if (!file) return noteFail(404, "not_found", "That file isn't here.")
    return new Response(new Uint8Array(file.bytes), {
      headers: {
        "content-type": file.mimeType, "x-content-type-options": "nosniff",
        "content-disposition": attachmentHeader(file.fileName),
        "content-security-policy": "default-src 'none'; sandbox",
        "cache-control": "private, max-age=86400",
      },
    })
  } catch (err) {
    console.error("[nova/notes/files GET]", (err as Error).name)
    return noteFail(500, "failed", "That file couldn't be loaded.")
  }
}
