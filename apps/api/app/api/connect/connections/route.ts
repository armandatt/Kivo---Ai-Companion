// GET    → the assistants connected to the signed-in account
// DELETE { id } → disconnect one (its tokens stop working at once)
import { NextResponse } from "next/server"
//@ts-ignore
import { listConnections, revokeConnection } from "@repo/api/connect/oauth"
import { fail, sameSiteProblem, sessionUser } from "../../../../lib/connect/web-access"
import { readSmallJson } from "../../../../lib/nova/extension-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const user = await sessionUser()
  if (!user) return fail(401, "unauthenticated", "Sign in to Kivo first.")
  return NextResponse.json({ ok: true, connections: await listConnections(user.userId) })
}

export async function DELETE(req: Request) {
  const bad = sameSiteProblem(req)
  if (bad) return bad
  const user = await sessionUser()
  if (!user) return fail(401, "unauthenticated", "Sign in to Kivo first.")
  const body = await readSmallJson(req, 2_000)
  const id = body.ok ? (body.body as { id?: unknown })?.id : null
  if (typeof id !== "string") return fail(400, "invalid", "Say which connection.")
  return (await revokeConnection(user.userId, id)) ? NextResponse.json({ ok: true, connections: await listConnections(user.userId) }) : fail(404, "not_found", "That connection is not one of yours, or was already ended.")
}
