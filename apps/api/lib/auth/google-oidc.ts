import { createRemoteJWKSet, jwtVerify } from "jose"
import type { JWTPayload } from "jose"

// Google's OpenID Connect endpoints. The ID token is verified by jose against
// Google's published keys; nothing here implements any cryptography itself.
const AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"]
const GOOGLE_KEYS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"))

// Holds the state and nonce of one sign-in attempt between the redirect to
// Google and the callback. Scoped to the two Google routes.
export const OAUTH_COOKIE_NAME = "kevo_oauth"
export const OAUTH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: 10 * 60,
  path: "/api/auth/google",
}

export function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/+$/, "")
}

export function googleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const redirectUri = process.env.GOOGLE_REDIRECT_URI
  if (!clientId || !clientSecret || !redirectUri) return null
  return { clientId, clientSecret, redirectUri }
}

// Where to start instead, or null to start here. The browser's host is the
// one the web app's rewrite forwards; without it nothing is moved.
export function movedTo(req: Request, redirectUri: string): string | null {
  const url = new URL(req.url)
  if (url.searchParams.has("moved")) return null
  const browserHost = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim().toLowerCase()
  let callback: URL
  try { callback = new URL(redirectUri) } catch { return null }
  if (!browserHost || browserHost === callback.host.toLowerCase()) return null
  // The sign-up page's agreement (auth/legal.ts) travels with the move.
  const consent = url.searchParams.get("consent")
  return `${callback.origin}/api/auth/google?moved=1${consent ? `&consent=${encodeURIComponent(consent)}` : ""}`
}

export function googleAuthorizationUrl(clientId: string, redirectUri: string, state: string, nonce: string) {
  const url = new URL(AUTHORIZATION_ENDPOINT)
  url.searchParams.set("client_id", clientId)
  url.searchParams.set("redirect_uri", redirectUri)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("scope", "openid email profile")
  url.searchParams.set("state", state)
  url.searchParams.set("nonce", nonce)
  url.searchParams.set("prompt", "select_account")
  return url
}

/** Exchanges the authorization code for an ID token. Null when Google refuses. */
export async function exchangeCodeForIdToken(
  code: string,
  config: { clientId: string; clientSecret: string; redirectUri: string }
): Promise<string | null> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
    }),
    cache: "no-store",
  })
  if (!res.ok) return null

  const tokens = (await res.json()) as { id_token?: unknown }
  return typeof tokens.id_token === "string" ? tokens.id_token : null
}

/**
 * Verifies the ID token's signature, issuer, audience and expiry. Throws when
 * any of them fails. The nonce and email claims are checked by the caller.
 */
export async function verifyGoogleIdToken(idToken: string, clientId: string): Promise<JWTPayload> {
  const { payload } = await jwtVerify(idToken, GOOGLE_KEYS, {
    issuer: GOOGLE_ISSUERS,
    audience: clientId,
    algorithms: ["RS256"],
  })
  return payload
}
