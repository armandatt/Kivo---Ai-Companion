import { NextResponse } from "next/server"
import { SignJWT } from "jose"
import { PROXY_CLIENT_IP_HEADER, PROXY_PROOF_HEADER } from "@repo/api/auth/proxy-headers"
import { crossSiteProblem, originOf, requestOrigin } from "@repo/api/auth/request-origin"
import { proxyProof } from "@repo/api/auth/secrets"
import { sessionSecret } from "@/lib/auth/session-secret"

const COOKIE = "kevo_session"
const MAX_AGE = 60 * 60 * 24 * 30

function apiUrl(path: string) {
  return `${process.env.API_URL ?? "http://localhost:3001"}${path}`
}

// The browser's address as the hosting platform reports it. On Vercel
// x-forwarded-for is written by the platform, which discards whatever the
// browser sent. The web app must not be run where a visitor can set it.
function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
  return forwarded || req.headers.get("x-real-ip")?.trim() || ""
}

/**
 * Sends an auth request on to the API and returns its JSON reply. Every auth
 * POST from the browser comes through here, so this is where a request from
 * another site is turned away, and where the API is told, with a proof only
 * this app can make, which browser address to count the request against.
 *
 * With `grantSession`, a successful reply also sets the session cookie. The
 * JWT is signed here on the web app, which avoids forwarding Set-Cookie from
 * the API: that is unreliable in Node.js 18+ (undici drops set-cookie from
 * headers.get() for security reasons).
 */
export async function proxyAuth(req: Request, path: string, options: { grantSession: boolean }) {
  const problem = crossSiteProblem(req.headers, [
    requestOrigin(req.headers, req.url),
    originOf(process.env.NEXT_PUBLIC_APP_URL),
  ])
  if (problem) {
    return NextResponse.json({ error: problem.error }, { status: problem.status })
  }

  const upstream = await fetch(apiUrl(path), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [PROXY_PROOF_HEADER]: proxyProof(),
      [PROXY_CLIENT_IP_HEADER]: clientIp(req),
    },
    body: await req.text(),
    cache: "no-store",
  })

  const data = await upstream.json()

  if (!upstream.ok) {
    const retryAfter = upstream.headers.get("retry-after")
    return NextResponse.json(data, {
      status: upstream.status,
      headers: retryAfter ? { "Retry-After": retryAfter } : undefined,
    })
  }

  const response = NextResponse.json(data, { status: upstream.status })
  if (!options.grantSession || !data?.user?.id) return response

  const token = await new SignJWT({
    userId: data.user.id,
    email:  data.user.email,
    name:   data.user.name  ?? null,
    image:  data.user.image ?? null,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(sessionSecret())

  response.cookies.set(COOKIE, token, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge:   MAX_AGE,
    path:     "/",
  })
  return response
}
