import { cookies } from "next/headers"
import { NextResponse } from "next/server"

function apiUrl(path: string) {
  return `${process.env.API_URL ?? "http://localhost:3001"}${path}`
}

export async function POST(req: Request) {
  const cookieStore = await cookies()
  const token = cookieStore.get("kevo_session")?.value

  const upstream = await fetch(apiUrl("/api/onboarding"), {
    method: "POST",
    headers: {
      "Content-Type": req.headers.get("content-type") ?? "application/json",
      ...(token ? { Cookie: `kevo_session=${token}` } : {}),
    },
    body: await req.text(),
    cache: "no-store",
  })

  const body = await upstream.text()
  return new NextResponse(body, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "application/json",
    },
  })
}
