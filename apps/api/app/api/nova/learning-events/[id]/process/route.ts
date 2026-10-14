import { NextResponse } from "next/server"
//@ts-ignore
import { getSavedResource } from "@repo/api/nova/product/learning-events"
//@ts-ignore
import { processSavedResource } from "@repo/api/nova/product/resource-processing"
import { requireWebLearner } from "../../../../../../lib/nova/extension-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// POST /api/nova/learning-events/[id]/process   (the signed-in web app)
// The learner's Retry: look at one of their saved pages again for what it
// connects to, and answer with the page as it now is. Asking twice at once
// looks once (the second finds it taken and answers "busy"). The page is
// never removed or changed by a failure here.
// Response: ResourceUpdateResponse.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireWebLearner()
    if (access.denied) return access.denied
    const { id } = await params
    const outcome  = await processSavedResource(id, "learner", { profileId: access.profileId })
    const resource = typeof id === "string" && id.length <= 64 ? await getSavedResource(access.profileId, id) : null
    if (!resource) return NextResponse.json({ ok: false, error: "not_found", message: "Nova doesn't have that page." }, { status: 404 })
    if (outcome === "skipped" && resource.processing.status === "processing") {
      return NextResponse.json({ ok: false, error: "busy", message: "Nova is already looking at this one." }, { status: 409 })
    }
    return NextResponse.json({ ok: true, resource })
  } catch (err) {
    console.error("[nova/learning-events/process]", err)
    return NextResponse.json({ ok: false, error: "failed", message: "That didn't work. Try again." }, { status: 500 })
  }
}
