// Who may touch today's flow: the signed-in account's own Nova learner, and
// nobody named by the request. Shared by the Today routes.

import { NextResponse } from "next/server"
//@ts-ignore
import { resolveNoteLearner } from "@repo/api/nova/product/notes"
import { resolveNovaLearner } from "./resolve-learner"

export const dayFail = (status: number, error: string, message: string) =>
  NextResponse.json({ ok: false, error, message }, { status })

// The learner's profile and key from the session cookie only. (The notes
// module's resolver is the one place a learner's profile is looked up for a
// page that needs setup finished.)
export async function requireDayLearner(): Promise<
  { profileId: string; platformChatId: string; denied?: undefined } |
  { profileId?: undefined; denied: NextResponse }
> {
  const learner = await resolveNovaLearner()
  if (learner.kind === "unauthenticated") return { denied: dayFail(401, "unauthenticated", "Sign in to open Today.") }
  if (learner.kind === "not_nova")        return { denied: dayFail(409, "not_nova", "Today's flow is part of Nova.") }
  if (learner.kind === "not_connected")   return { denied: dayFail(409, "not_connected", "Connect Nova first.") }
  const resolved = await resolveNoteLearner(learner.platformChatId)
  if (resolved.status !== "ready") return { denied: dayFail(409, resolved.status, "Finish setting up with Nova first.") }
  return { profileId: resolved.profileId, platformChatId: learner.platformChatId }
}
