import { NextResponse } from "next/server"
import { cookies } from "next/headers"

export async function POST() {
  const cookieStore = await cookies()
  const token = cookieStore.get("kevo_session")?.value
  if (!token) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })

  const apiUrl = process.env.API_URL ?? "http://localhost:3001"
  const upstream = await fetch(`${apiUrl}/api/telegram/generate-token`, {
    method:  "POST",
    headers: { Cookie: `kevo_session=${token}` },
    cache:   "no-store",
  })

  const body = await upstream.text()
  return new NextResponse(body, {
    status: upstream.status,
    headers: { "Content-Type": upstream.headers.get("content-type") ?? "application/json" },
  })
}
