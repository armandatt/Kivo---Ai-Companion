// Who may touch workspaces: the signed-in account's own Nova learner, set up
// or not (a template is one way to set up). Derived from the session cookie
// only: no id in the request names a learner.

import { NextResponse } from "next/server"
import { resolveNovaLearner } from "./resolve-learner"

export const workspaceFail = (status: number, error: string, message: string) =>
  NextResponse.json({ ok: false, error, message }, { status })

export async function requireWorkspaceLearner(): Promise<{ platformChatId: string; denied?: undefined } | { platformChatId?: undefined; denied: NextResponse }> {
  const learner = await resolveNovaLearner()
  if (learner.kind === "unauthenticated") return { denied: workspaceFail(401, "unauthenticated", "Sign in to use templates.") }
  if (learner.kind === "not_nova")        return { denied: workspaceFail(409, "not_nova", "Templates are part of Nova.") }
  if (learner.kind === "not_connected")   return { denied: workspaceFail(409, "not_connected", "Connect Nova first.") }
  return { platformChatId: learner.platformChatId }
}
