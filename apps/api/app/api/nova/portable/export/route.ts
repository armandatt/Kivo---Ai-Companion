import { NextResponse } from "next/server"
//@ts-ignore
import { exportMap, previewExport } from "@repo/api/portable/export"
import { noteFail, requireNoteLearner } from "../../../../../lib/nova/note-access"
import { readSmallJson } from "../../../../../lib/nova/extension-access"
import { portableLimit } from "../../../../../lib/nova/portable-access"
//@ts-ignore
import { crossSiteProblem } from "@repo/api/auth/request-origin"
import { connectOrigin } from "../../../../../lib/connect/config"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// POST /api/nova/portable/export
//   { action: "preview", rootSubjectId }      what the map holds, which notes can be ticked
//   { action: "export", rootSubjectId, noteIds, includeLinks, title?, description?, license?, credit?, source? }
//        → the .kivo file. Reads only the session learner's own records; writes nothing.
export async function POST(req: Request) {
  try {
    const cross = crossSiteProblem(req.headers, [connectOrigin(), process.env.NEXT_PUBLIC_APP_URL ?? null])
    if (cross) return noteFail(cross.status, "forbidden", cross.error)
    const access = await requireNoteLearner()
    if (access.denied) return access.denied
    const read = await readSmallJson(req, 64 * 1024)
    const body = read.ok && read.body && typeof read.body === "object" ? read.body as Record<string, unknown> : null
    if (!body) return noteFail(400, "invalid", "That isn't an export Kivo can make.")
    if (body.action === "preview") {
      const p = await previewExport(access.profileId, body.rootSubjectId)
      return NextResponse.json(p, { status: p.ok ? 200 : p.error === "not_found" ? 404 : 400, headers: { "cache-control": "no-store" } })
    }
    if (body.action !== "export") return noteFail(400, "invalid", "That isn't an export Kivo can make.")
    const limited = await portableLimit("export", access.platformChatId)
    if (limited) return limited
    const out = await exportMap(access.profileId, body)
    if (!out.ok) return NextResponse.json(out, { status: out.error === "not_found" ? 404 : out.error === "too_large" ? 413 : out.error === "invalid" ? 400 : 500, headers: { "cache-control": "no-store" } })
    return new NextResponse(Buffer.from(out.bytes), {
      status: 200,
      headers: {
        "content-type": "application/vnd.kivo.map+zip",
        "content-disposition": `attachment; filename="${out.filename}"`,
        "cache-control": "no-store",
        "x-kivo-package-id": out.manifest.packageId,
      },
    })
  } catch (err) {
    console.error("[nova/portable/export]", (err as Error).name)
    return noteFail(500, "failed", "The file couldn't be made. Nothing was changed; try again.")
  }
}
