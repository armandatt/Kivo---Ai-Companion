import { NextResponse } from "next/server"
//@ts-ignore
import { removeWorkspace } from "@repo/api/nova/product/workspaces"
//@ts-ignore
import { liveWorkspace } from "@repo/api/nova/product/builder"
//@ts-ignore
import { learnerKey } from "@repo/api/nova/product/learner-key"
import { prisma } from "@repo/db/client"
import { requireWorkspaceLearner, workspaceFail } from "../../../../../lib/nova/workspace-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// GET /api/nova/workspaces/[id] — the workspace as it now is: the real
// subjects, topics, tasks, notes and dates it made, read through their
// owners. Response: WorkspaceDetailResponse (builder.types.ts).
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireWorkspaceLearner()
    if (access.denied) return access.denied
    const detail = await liveWorkspace(access.platformChatId, (await ctx.params).id)
    if (!detail) return workspaceFail(404, "not_found", "That workspace isn't one of yours.")
    return NextResponse.json({ ok: true, detail }, { headers: { "cache-control": "no-store" } })
  } catch (err) {
    console.error("[nova/workspaces GET :id]", err)
    return workspaceFail(500, "failed", "It didn't load. Try again.")
  }
}

// DELETE /api/nova/workspaces/[id] — removes the workspace's record only.
// Its subjects, topics, notes and tasks are the learner's and stay.
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireWorkspaceLearner()
    if (access.denied) return access.denied
    const { id } = await ctx.params
    const user = await prisma.messengerUser.findUnique({ where: learnerKey(access.platformChatId), select: { novaAcademicProfile: { select: { id: true } } } })
    const profileId = user?.novaAcademicProfile?.id
    if (!profileId || !await removeWorkspace(profileId, id)) return workspaceFail(404, "not_found", "That workspace isn't one of yours.")
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[nova/workspaces DELETE]", err)
    return workspaceFail(500, "failed", "That didn't work. Try again.")
  }
}
