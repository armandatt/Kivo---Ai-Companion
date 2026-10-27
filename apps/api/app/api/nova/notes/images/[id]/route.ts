//@ts-ignore
import { readNoteImage } from "@repo/api/nova/product/note-images"
import { noteFail, requireNoteLearner } from "../../../../../../lib/nova/note-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string }> }

// GET /api/nova/notes/images/:id
// An image in one of the learner's notes, to its owner only. Its bytes were
// checked as PNG, JPEG or WebP when saved; it is sent as that and nothing else.
export async function GET(_req: Request, { params }: Context) {
  try {
    const access = await requireNoteLearner()
    if (access.denied) return access.denied
    const image = await readNoteImage(access.profileId, (await params).id)
    if (!image) return noteFail(404, "not_found", "That image isn't here.")
    return new Response(new Uint8Array(image.bytes), {
      headers: {
        "content-type": image.mimeType, "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
        // An id is never reused for other bytes; only this browser keeps it.
        "cache-control": "private, max-age=86400",
      },
    })
  } catch (err) {
    console.error("[nova/notes/images GET]", err)
    return noteFail(500, "failed", "That image couldn't be loaded.")
  }
}
