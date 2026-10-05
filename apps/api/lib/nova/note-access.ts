// Who may touch notes: the signed-in account's own Nova learner, and nobody
// named by the request. Shared by the two notes routes.

import { NextResponse } from "next/server"
//@ts-ignore
import { resolveNoteLearner } from "@repo/api/nova/product/notes"
import { resolveNovaLearner } from "./resolve-learner"

export const noteFail = (status: number, error: string, message: string) =>
  NextResponse.json({ ok: false, error, message }, { status })

// The learner's profile id, or the response to send instead. The profile is
// derived from the session cookie only: no id in the URL, query or body is
// consulted.
export async function requireNoteLearner(): Promise<
  { profileId: string; status?: undefined; denied?: undefined } |
  { profileId?: undefined; status: "not_nova" | "not_connected" | "onboarding_incomplete" | "unauthenticated"; denied: NextResponse }
> {
  const learner = await resolveNovaLearner()
  if (learner.kind === "unauthenticated") return { status: "unauthenticated", denied: noteFail(401, "unauthenticated", "Sign in to open your notes.") }
  if (learner.kind === "not_nova")        return { status: "not_nova", denied: noteFail(409, "not_nova", "Notes are part of Nova.") }
  if (learner.kind === "not_connected")   return { status: "not_connected", denied: noteFail(409, "not_connected", "Connect Nova first.") }

  const resolved = await resolveNoteLearner(learner.platformChatId)
  if (resolved.status !== "ready") {
    return { status: resolved.status, denied: noteFail(409, resolved.status, "Finish setting up with Nova first.") }
  }
  return { profileId: resolved.profileId }
}
