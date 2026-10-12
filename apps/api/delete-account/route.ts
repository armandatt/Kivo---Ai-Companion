import { NextResponse } from "next/server"
//@ts-ignore
import { deleteAccount } from "@repo/api/services/accountDeletion.service"
import { errorLabel } from "@repo/api/auth/error-label"
import { getSession, SESSION_COOKIE_NAME } from "../lib/auth/session"

export async function DELETE() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })

  try {
    // Removes everything Nova kept for the account (study history, notes, and
    // for a learner's own Telegram chat the conversation and what was learned
    // from it) with the account, in one transaction. A second request for an
    // account already gone succeeds the same way.
    await deleteAccount(session.userId)
    // Signed out only now that the deletion has gone through. If it failed,
    // the session stays, so the account can still be reached to try again.
    const response = NextResponse.json({ ok: true })
    response.cookies.delete(SESSION_COOKIE_NAME)
    return response
  } catch (e) {
    // The kind of error only: the error itself can quote what was being deleted.
    console.error(`[DELETE ACCOUNT ERROR] ${errorLabel(e)}`)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}
