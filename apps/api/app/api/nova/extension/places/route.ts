import { NextResponse } from "next/server"
//@ts-ignore
import { workspacePlaces } from "@repo/api/nova/product/knowledge-placement"
import { eventFail, preflight, requireExtensionLearner, withCors } from "../../../../../lib/nova/extension-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// GET /api/nova/extension/places
// The learner's subjects and topics, with ids and paths, for the extension's
// searchable "File under" picker. Names only: no notes, no progress.
export async function GET(req: Request) {
  return withCors(req, await handle(req))
}

async function handle(req: Request): Promise<NextResponse> {
  try {
    const who = await requireExtensionLearner(req)
    if (who.denied) return who.denied
    const { version, places } = await workspacePlaces(who.profileId)
    return NextResponse.json({
      success: true, version,
      places: places.map((p: { subjectId: string; subjectName: string; subjectPath: string[]; topicId: string | null; topicName: string | null; topicPath: string[] }) =>
        ({ subjectId: p.subjectId, subjectName: p.subjectName, topicId: p.topicId, topicName: p.topicName, path: [...p.subjectPath, ...p.topicPath] })),
    }, { headers: { "cache-control": "no-store" } })
  } catch (err) {
    console.error("[nova/extension/places]", err)
    return eventFail(500, "failed", "Your subjects didn't load. Try again.")
  }
}

export const OPTIONS = preflight
