import { NextResponse } from "next/server"
//@ts-ignore
import { listExtensionConnections } from "@repo/api/nova/product/extension-connection"
import { resolveNovaLearner } from "../../../../../lib/nova/resolve-learner"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// GET /api/nova/extension/connections
// The browsers connected to the signed-in account. No credential or hash is
// ever returned.
export async function GET() {
  try {
    const learner = await resolveNovaLearner()
    if (learner.kind === "unauthenticated") return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })
    if (learner.kind !== "learner") return NextResponse.json({ status: learner.kind })
    return NextResponse.json({ status: "ready", connections: await listExtensionConnections(learner.userId) })
  } catch (err) {
    console.error("[nova/extension/connections]", err)
    return NextResponse.json({ error: "Failed to load" }, { status: 500 })
  }
}
