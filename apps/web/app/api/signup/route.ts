import { NextResponse } from "next/server"
import { SignJWT } from "jose"

const SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET ?? "fallback-dev-secret-change-in-production"
)
const COOKIE = "kevo_session"
const MAX_AGE = 60 * 60 * 24 * 30

function apiUrl(path: string) {
  return `${process.env.API_URL ?? "http://localhost:3001"}${path}`
}

async function mintToken(payload: Record<string, unknown>): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(SECRET)
}

export async function POST(req: Request) {
  const upstream = await fetch(apiUrl("/api/signup"), {
    method: "POST",
    headers: { "Content-Type": req.headers.get("content-type") ?? "application/json" },
    body: await req.text(),
    cache: "no-store",
  })

  const data = await upstream.json()

  if (!upstream.ok) {
    return NextResponse.json(data, { status: upstream.status })
  }

  const token = await mintToken({
    userId: data.user.id,
    email:  data.user.email,
    name:   data.user.name  ?? null,
    image:  data.user.image ?? null,
  })

  const response = NextResponse.json(data)
  response.cookies.set(COOKIE, token, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge:   MAX_AGE,
    path:     "/",
  })
  return response
}
