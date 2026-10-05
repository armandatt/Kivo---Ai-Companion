import { NextResponse } from "next/server"
//@ts-ignore
import { deleteAccount } from "@repo/api/services/accountDeletion.service"
import { getSession } from "../lib/auth/session"

export async function DELETE() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })

  try {
    // Removes the account's Nova profile (and with it their notes and study
    // history) before the account, so none of it is left without an owner.
    await deleteAccount(session.userId)
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error("[DELETE ACCOUNT ERROR]", e)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}
