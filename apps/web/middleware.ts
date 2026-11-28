import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { PROXY_CLIENT_IP_HEADER, PROXY_PROOF_HEADER } from "@repo/api/auth/proxy-headers"

const PROTECTED_ROUTES = [
  "/home", "/coach", "/journey", "/progress", "/goals", "/creature", "/settings", "/profile",
  "/planner", "/calendar", "/focus", "/knowledge", "/map", "/notes", "/saved", "/learning-dna", "/guide",
  "/build", "/templates", "/connect", "/assistants", "/telegram",
  "/onboarding",
]

// ── API requests: tell the API which browser is asking ───────────────────────
// Every /api call the web app does not answer itself is rewritten to the API
// (next.config.js), which then sees Vercel's address, not the browser's. The
// browser's address (x-forwarded-for, written by Vercel, which discards what
// the browser sent) goes with the proof the auth proxy already uses, so the
// API's rate limits can count per address (packages/api/src/rate-limits/
// identity.ts). Without JWT_SECRET nothing is added and the API treats the
// request as from an unknown address. Whatever the browser sent in these
// headers is removed first.
let proofCache: { secret: string; proof: string } | null = null

export async function apiProof(env: Record<string, string | undefined> = process.env): Promise<string | null> {
  const secret = env.JWT_SECRET || (env.NODE_ENV === "production" ? null : "fallback-dev-secret-change-in-production")
  if (!secret) return null
  if (proofCache?.secret === secret) return proofCache.proof
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode("kivo-auth-proxy-v1")))
  const proof = Array.from(mac, b => b.toString(16).padStart(2, "0")).join("")
  proofCache = { secret, proof }
  return proof
}

export async function withClientAddress(request: NextRequest): Promise<Headers> {
  const headers = new Headers(request.headers)
  headers.delete(PROXY_PROOF_HEADER)
  headers.delete(PROXY_CLIENT_IP_HEADER)
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim() || ""
  const proof = ip && ip.length <= 64 ? await apiProof() : null
  if (proof) {
    headers.set(PROXY_PROOF_HEADER, proof)
    headers.set(PROXY_CLIENT_IP_HEADER, ip)
  }
  return headers
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl
  if (pathname.startsWith("/api/")) {
    return NextResponse.next({ request: { headers: await withClientAddress(request) } })
  }
  const token = request.cookies.get("kevo_session")?.value

  const isProtected = PROTECTED_ROUTES.some((route) =>
    pathname.startsWith(route)
  )
  if (isProtected && !token) {
    const loginUrl = new URL("/signin", request.url)
    // The query comes too: /focus?study=<id> from the extension must still
    // name its page after sign-in. The sign-in page accepts only a path here.
    loginUrl.searchParams.set("from", pathname + search)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    "/api/:path*",
    "/home/:path*",
    "/coach/:path*",
    "/journey/:path*",
    "/progress/:path*",
    "/goals/:path*",
    "/creature/:path*",
    "/settings/:path*",
    "/profile/:path*",
    "/onboarding/:path*",
    "/planner/:path*",
    "/connect/:path*",
    "/calendar/:path*",
    "/focus/:path*",
    "/knowledge/:path*",
    "/map/:path*",
    "/notes/:path*",
    "/saved/:path*",
    "/learning-dna/:path*",
    "/guide/:path*",
    "/build/:path*",
    "/templates/:path*",
    "/assistants/:path*",
    "/telegram/:path*",
  ],
}
