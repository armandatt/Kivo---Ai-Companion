// The API's front door (Next.js 16 Proxy, Node runtime): every /api request
// is classified (rate-limits/endpoints.ts) and checked against its
// category's baseline policy before any route runs, with the caller named by
// the session cookie, a bearer credential (hashed), or, for a request with
// neither, a client address Kivo can trust. This layer also applies the
// incident switches: KIVO_DISABLE and KIVO_READ_ONLY (rate-limits/controls.ts).
//
// It is the first line, not the only one: routes that cost something check
// their own policies with the account behind the request (lib/rate-limits.ts),
// and every route still authenticates and authorises for itself. A request
// the baseline cannot check (the limiter's table unreachable) goes on unless
// its policy is "closed" (sign-in, OAuth).

import { NextResponse, type NextRequest } from "next/server"
//@ts-ignore
import { baselinePolicy, checkRate, classify, clientAddress, credentialSubject, httpRefusal, mcpError, refusedByReadOnly, safeSubject, type Refusal, type Who } from "@repo/api/rate-limits"
import { verifySessionToken, SESSION_COOKIE_NAME } from "./lib/auth/session"
import { OPEN_CORS } from "./lib/connect/config"
import { extensionCors } from "./lib/nova/extension-access"

const warnedUnclassified = new Set<string>()

async function callerOf(req: NextRequest): Promise<Pick<Who, "user" | "authenticated">> {
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value
  if (cookie) {
    const session = await verifySessionToken(cookie)
    const user = session?.userId ? safeSubject("user", session.userId) : null
    if (user) return { user, authenticated: true }
  }
  const auth = req.headers.get("authorization") ?? ""
  if (auth.startsWith("Bearer ") && auth.length > 20 && auth.length < 2_000) {
    return { user: credentialSubject(auth.slice(7).trim()), authenticated: true }
  }
  return { user: null, authenticated: false }
}

function refusal(req: NextRequest, category: string, r: Refusal): NextResponse {
  const path = req.nextUrl.pathname
  if (category === "mcp") {
    const m = mcpError(r)
    return NextResponse.json(m.body, { status: m.status, headers: { ...m.headers, ...OPEN_CORS } })
  }
  const h = httpRefusal(r)
  if (category === "oauth" || path.startsWith("/api/oauth/")) {
    return NextResponse.json({ error: "temporarily_unavailable", error_description: h.body.message }, { status: h.status, headers: { ...h.headers, ...OPEN_CORS } })
  }
  // The extension reads its answers cross-origin: without these it sees a network error.
  const cors = extensionCors(req)
  if (cors["Access-Control-Allow-Origin"] || cors["access-control-allow-origin"]) {
    return NextResponse.json(h.body, { status: h.status, headers: { ...h.headers, ...cors, "Access-Control-Expose-Headers": "Retry-After" } })
  }
  return NextResponse.json(h.body, { status: h.status, headers: h.headers })
}

export async function proxy(req: NextRequest) {
  if (req.method === "OPTIONS") return NextResponse.next()
  const { pathname } = req.nextUrl
  const c = classify(req.method, pathname)
  if (c.category === "exempt") return NextResponse.next()
  if (!c.explicit && !warnedUnclassified.has(`${req.method} ${pathname}`) && warnedUnclassified.size < 500) {
    warnedUnclassified.add(`${req.method} ${pathname}`)
    console.warn(JSON.stringify({ layer: "rate_limit", event: "unclassified_route", method: req.method, path: pathname.slice(0, 120) }))
  }
  if (refusedByReadOnly(c.category, req.method)) {
    return refusal(req, c.category, { allowed: false, kind: "disabled", status: 503, policy: `read_only.${c.category}`, retryAfterSeconds: 300 })
  }
  const caller = await callerOf(req)
  const policy = baselinePolicy(c.category, caller.authenticated ?? false)
  if (!policy) return NextResponse.next()
  // Addresses count only where there is no account to count: anonymous
  // requests, sign-in and OAuth. A signed-in request is the account's alone,
  // so students sharing a campus or a carrier's address never share a limit.
  const byAddress = !caller.authenticated || c.category === "auth" || c.category === "oauth"
  const decision = await checkRate(policy, { ...caller, ip: byAddress ? clientAddress(req.headers).subject : null })
  if (!decision.allowed) return refusal(req, c.category, decision)
  return NextResponse.next()
}

export const config = {
  matcher: ["/api/:path*"],
}
