import { NextResponse } from "next/server"
//@ts-ignore
import { revokeExtensionConnection } from "@repo/api/nova/product/extension-connection"
import { resolveNovaLearner } from "../../../../../../lib/nova/resolve-learner"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// DELETE /api/nova/extension/connections/[id]
// Disconnect one of the signed-in account's own browsers. Another account's
// connection id is simply not found.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const learner = await resolveNovaLearner()
    if (learner.kind === "unauthenticated") return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })
    if (learner.kind !== "learner") return NextResponse.json({ ok: false, error: learner.kind }, { status: 409 })
    const { id } = await params
    const closed = await revokeExtensionConnection(learner.userId, id)
    return closed ? NextResponse.json({ ok: true }) : NextResponse.json({ ok: false, error: "not_found" }, { status: 404 })
  } catch (err) {
    console.error("[nova/extension/connections]", err)
    return NextResponse.json({ error: "Failed to disconnect" }, { status: 500 })
  }
}
