import { NextResponse } from "next/server"
//@ts-ignore
import { createWorkspace, listWorkspaces } from "@repo/api/nova/product/workspaces"
//@ts-ignore
import { learnerKey } from "@repo/api/nova/product/learner-key"
import { prisma } from "@repo/db/client"
import { requireWorkspaceLearner, workspaceFail } from "../../../../lib/nova/workspace-access"
import { allowAttempt, readSmallJson } from "../../../../lib/nova/extension-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// A plan is text only (files were read when it was proposed): 256 KB is far
// more than the largest plan the check allows.
const PLAN_BODY_MAX = 256 * 1024
const CREATES_PER_MINUTE = 10

// GET /api/nova/workspaces — the learner's workspaces, newest first.
// Response: WorkspacesView (packages/api/src/nova/product/workspaces.types.ts).
export async function GET() {
  try {
    const access = await requireWorkspaceLearner()
    if (access.denied) return access.denied
    const user = await prisma.messengerUser.findUnique({ where: learnerKey(access.platformChatId), select: { novaAcademicProfile: { select: { id: true } } } })
    const profileId = user?.novaAcademicProfile?.id
    if (!profileId) return NextResponse.json({ status: "ready", workspaces: [] }, { headers: { "cache-control": "no-store" } })
    return NextResponse.json(await listWorkspaces(profileId), { headers: { "cache-control": "no-store" } })
  } catch (err) {
    console.error("[nova/workspaces GET]", err)
    return workspaceFail(500, "failed", "Your workspaces didn't load. Try again.")
  }
}

// POST /api/nova/workspaces  { plan, clientKey, addTo?, confirmAnother? }
// Creates the workspace the learner approved, in one transaction, once per
// clientKey (product/workspaces.ts). No model call.
// Response: CreateWorkspaceResponse.
export async function POST(req: Request) {
  try {
    const access = await requireWorkspaceLearner()
    if (access.denied) return access.denied
    if (!allowAttempt(`workspace-create:${access.platformChatId}`, CREATES_PER_MINUTE, 60_000)) {
      return workspaceFail(429, "rate_limited", "That's a lot at once. Give it a minute.")
    }
    const read = await readSmallJson(req, PLAN_BODY_MAX)
    if (!read.ok) return workspaceFail(read.reason === "too_large" ? 413 : 400, "invalid", "That plan couldn't be read.")
    const body = (read.body ?? {}) as Record<string, unknown>
    const result = await createWorkspace(access.platformChatId, { plan: body.plan, clientKey: body.clientKey, addTo: body.addTo, confirmAnother: body.confirmAnother })
    const status = result.ok ? (result.status === "created" ? 201 : 200) : result.error === "not_found" ? 404 : result.error === "failed" ? 500 : result.error === "not_ready" ? 409 : 400
    return NextResponse.json(result, { status, headers: { "cache-control": "no-store" } })
  } catch (err) {
    console.error("[nova/workspaces POST]", err)
    return workspaceFail(500, "failed", "That didn't save, and nothing was created. Try again.")
  }
}
