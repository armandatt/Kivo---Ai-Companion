import { NextResponse } from "next/server"
//@ts-ignore
import { attachmentHeader, exportNoteKivo, exportNotePdf } from "@repo/api/portable/note-share"
import { noteFail, requireNoteLearner } from "../../../../../../lib/nova/note-access"
import { readSmallJson } from "../../../../../../lib/nova/extension-access"
import { portableLimit, portableSlot } from "../../../../../../lib/nova/portable-access"
//@ts-ignore
import { crossSiteProblem } from "@repo/api/auth/request-origin"
import { connectOrigin } from "../../../../../../lib/connect/config"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

// POST /api/nova/portable/notes/export
//   { noteId, format: "kivo", credit?, license? } → the note as a .kivo file
//   { noteId, format: "pdf", credit? }            → the note as a PDF
// Reads only the session learner's own note, its images and files; writes nothing.
export async function POST(req: Request) {
  try {
    const cross = crossSiteProblem(req.headers, [connectOrigin(), process.env.NEXT_PUBLIC_APP_URL ?? null])
    if (cross) return noteFail(cross.status, "forbidden", cross.error)
    const access = await requireNoteLearner()
    if (access.denied) return access.denied
    const read = await readSmallJson(req, 8 * 1024)
    const body = read.ok && read.body && typeof read.body === "object" ? read.body as Record<string, unknown> : null
    if (!body || (body.format !== "kivo" && body.format !== "pdf")) return noteFail(400, "invalid", "Choose .kivo or PDF.")
    const limited = await portableLimit("export", access.platformChatId)
    if (limited) return limited
    const slot = await portableSlot("export", access.platformChatId)
    if (slot.refused) return slot.refused
    const out = await (body.format === "pdf" ? exportNotePdf(access.profileId, body) : exportNoteKivo(access.profileId, body)).finally(slot.release)
    if (!out.ok) return NextResponse.json(out, { status: out.error === "not_found" ? 404 : out.error === "invalid" ? 400 : 500, headers: { "cache-control": "no-store" } })
    return new NextResponse(Buffer.from(out.bytes), {
      status: 200,
      headers: {
        "content-type": body.format === "pdf" ? "application/pdf" : "application/vnd.kivo.note+zip",
        "content-disposition": attachmentHeader(out.filename),
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    })
  } catch (err) {
    console.error("[nova/portable/notes/export]", (err as Error).name)
    return noteFail(500, "failed", "The file couldn't be made. Nothing was changed; try again.")
  }
}
