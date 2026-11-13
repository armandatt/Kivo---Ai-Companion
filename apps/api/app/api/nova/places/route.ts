import { NextResponse } from "next/server"
//@ts-ignore
import { workspacePlaces } from "@repo/api/nova/product/knowledge-placement"
import { requireWebLearner } from "../../../../lib/nova/extension-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// GET /api/nova/places: the learner's subjects and topics with ids and paths,
// for the Drafts page's "File under" picker.
export async function GET() {
  try {
    const access = await requireWebLearner()
    if (access.denied) return access.denied
    const { version, places } = await workspacePlaces(access.profileId)
    return NextResponse.json({
      ok: true, version,
      places: places.map((p: { subjectId: string; subjectName: string; subjectPath: string[]; topicId: string | null; topicName: string | null; topicPath: string[] }) =>
        ({ subjectId: p.subjectId, subjectName: p.subjectName, topicId: p.topicId, topicName: p.topicName, path: [...p.subjectPath, ...p.topicPath] })),
    }, { headers: { "cache-control": "no-store" } })
  } catch (err) {
    console.error("[nova/places]", err)
    return NextResponse.json({ ok: false, error: "failed", message: "Your subjects didn't load. Try again." }, { status: 500 })
  }
}
