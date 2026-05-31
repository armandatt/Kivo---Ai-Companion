import { NextResponse } from "next/server"
import { applySessionCookie } from "../session-cookie"

function apiUrl(path: string) {
  return `${process.env.API_URL ?? "http://localhost:3001"}${path}`
}

export async function POST(req: Request) {
  const upstream = await fetch(apiUrl("/api/signup"), {
    method: "POST",
    headers: { "Content-Type": req.headers.get("content-type") ?? "application/json" },
    body: await req.text(),
    cache: "no-store",
  })

  const body = await upstream.text()
  const response = new NextResponse(body, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "application/json",
    },
  })

  applySessionCookie(response, upstream.headers.get("set-cookie"))

  return response
}
