import { NextResponse } from "next/server"
import { clearSessionCookie } from "../session-cookie"

function apiUrl(path: string) {
  return `${process.env.API_URL ?? "http://localhost:3001"}${path}`
}

export async function POST() {
  const upstream = await fetch(apiUrl("/api/logout"), {
    method: "POST",
    cache: "no-store",
  })

  const body = await upstream.text()
  const response = new NextResponse(body, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "application/json",
    },
  })

  clearSessionCookie(response)

  return response
}
