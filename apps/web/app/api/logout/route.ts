import { NextResponse } from "next/server"
import { clearSessionCookie } from "../session-cookie"

function apiUrl(path: string) {
  return `${process.env.API_URL ?? "http://localhost:3001"}${path}`
}

export async function POST() {
  try {
    await fetch(apiUrl("/api/logout"), {
      method: "POST",
      cache: "no-store",
    })
  } catch {
    // The browser session is local to the web app, so clear it even if the API is unavailable.
  }

  const response = NextResponse.json({ success: true })
  clearSessionCookie(response)

  return response
}
