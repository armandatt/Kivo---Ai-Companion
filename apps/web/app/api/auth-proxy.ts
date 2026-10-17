import { NextResponse } from "next/server"
import { SignJWT } from "jose"
import { errorLabel } from "@repo/api/auth/error-label"
import { PROXY_CLIENT_IP_HEADER, PROXY_PROOF_HEADER } from "@repo/api/auth/proxy-headers"
import { crossSiteProblem, originOf, requestOrigin } from "@repo/api/auth/request-origin"
import { proxyProof } from "@repo/api/auth/secrets"
import { sessionSecret } from "../../lib/auth/session-secret"

const COOKIE = "kevo_session"
const MAX_AGE = 60 * 60 * 24 * 30

// Long enough for the API to wake from idle on its host, short enough to
// answer before the platform gives up on this function.
export const UPSTREAM_TIMEOUT_MS = 25_000

// What the browser is told whenever the API cannot be used, whatever the
// reason. The reason goes to the log; nothing internal goes to the page.
export const AUTH_UNAVAILABLE = "Kivo couldn't reach its sign-in service. Please try again in a minute."

type Env = Record<string, string | undefined>

export interface ProxyOptions {
  grantSession: boolean
  // For tests: the network and the environment this request sees.
  fetch?: typeof fetch
  env?: Env
}

/**
 * The API's base address (API_URL), or null when it is missing or is not an
 * http(s) URL. Outside production a missing value means the local API.
 */
export function apiBase(env: Env): string | null {
  const configured = env.API_URL?.trim()
  if (!configured) return env.NODE_ENV === "production" ? null : "http://localhost:3001"
  try {
    const url = new URL(configured)
    if (url.protocol !== "https:" && url.protocol !== "http:") return null
    return configured.replace(/\/+$/, "")
  } catch {
    return null
  }
}

// The browser's address as the hosting platform reports it. On Vercel
// x-forwarded-for is written by the platform, which discards whatever the
// browser sent. The web app must not be run where a visitor can set it.
function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
  return forwarded || req.headers.get("x-real-ip")?.trim() || ""
}

function unavailable(status: 502 | 503 | 504, reason: string) {
  console.error(`[AUTH PROXY] ${reason}`)
  return NextResponse.json({ error: AUTH_UNAVAILABLE }, { status })
}

// A reply from Kivo's API is a JSON object, and every refusal carries an
// `error` sentence written for the person. Anything else (a host's own error
// page, a platform's "application not found") means API_URL does not point at
// the API, and is not shown to the browser.
function isApiReply(status: number, data: unknown): data is Record<string, unknown> {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return false
  if (status >= 200 && status < 300) return true
  return typeof (data as { error?: unknown }).error === "string"
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
 *
 * It always answers with JSON. A missing setting, an API that cannot be
 * reached, a slow one, or a reply that is not the API's becomes a short
 * "try again" for the browser and one line in the log naming the kind of
 * failure: never the body, the address, a code or a token.
 */
export async function proxyAuth(req: Request, path: string, options: ProxyOptions) {
  const env = options.env ?? process.env
  const send = options.fetch ?? fetch

  const problem = crossSiteProblem(req.headers, [
    requestOrigin(req.headers, req.url),
    originOf(env.NEXT_PUBLIC_APP_URL),
  ])
  if (problem) {
    return NextResponse.json({ error: problem.error }, { status: problem.status })
  }

  const base = apiBase(env)
  if (!base) return unavailable(503, `API_URL is ${env.API_URL?.trim() ? "not an http(s) URL" : "not set"}.`)

  let proof: string
  try {
    proof = proxyProof()
  } catch {
    return unavailable(503, "JWT_SECRET is not set; the request cannot be vouched for.")
  }

  let upstream: Response
  try {
    upstream = await send(`${base}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [PROXY_PROOF_HEADER]: proof,
        [PROXY_CLIENT_IP_HEADER]: clientIp(req),
      },
      body: await req.text(),
      cache: "no-store",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    })
  } catch (error) {
    const label = errorLabel(error)
    return label.startsWith("TimeoutError")
      ? unavailable(504, `The API did not answer ${path} in time.`)
      : unavailable(502, `The API could not be reached for ${path} (${label}).`)
  }

  let data: unknown
  try {
    data = await upstream.json()
  } catch {
    return unavailable(502, `The API answered ${path} with ${upstream.status} and no JSON.`)
  }
  if (!isApiReply(upstream.status, data)) {
    return unavailable(502, `The API answered ${path} with ${upstream.status} in a shape that is not Kivo's; check API_URL.`)
  }

  if (!upstream.ok) {
    const retryAfter = upstream.headers.get("retry-after")
    return NextResponse.json(data, {
      status: upstream.status,
      headers: retryAfter ? { "Retry-After": retryAfter } : undefined,
    })
  }

  const response = NextResponse.json(data, { status: upstream.status })
  const user = (data as { user?: { id?: unknown; email?: unknown; name?: unknown; image?: unknown } }).user
  if (!options.grantSession || typeof user?.id !== "string") return response

  let token: string
  try {
    token = await new SignJWT({
      userId: user.id,
      email:  user.email,
      name:   user.name  ?? null,
      image:  user.image ?? null,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("30d")
      .sign(sessionSecret())
  } catch {
    return unavailable(503, "JWT_SECRET is not set; the session cannot be signed.")
  }

  response.cookies.set(COOKIE, token, {
    httpOnly: true,
    secure:   env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge:   MAX_AGE,
    path:     "/",
  })
  return response
}
