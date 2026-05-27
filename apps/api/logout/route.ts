import { NextResponse } from "next/server"
import { clearSession } from "../lib/auth/session"

export async function POST() {
  try {
    await clearSession()
    return NextResponse.json({ message: "Logged out" })
  } catch (error) {
    console.error("[LOGOUT ERROR]", error)
    return NextResponse.json(
      { error: "Something went wrong" },
      { status: 500 }
    )
  }
}
