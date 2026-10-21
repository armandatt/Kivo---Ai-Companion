import { NextResponse } from "next/server"
//@ts-ignore
import { removeWorkspace } from "@repo/api/nova/product/workspaces"
//@ts-ignore
import { learnerKey } from "@repo/api/nova/product/learner-key"
import { prisma } from "@repo/db/client"
import { requireWorkspaceLearner, workspaceFail } from "../../../../../lib/nova/workspace-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

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
