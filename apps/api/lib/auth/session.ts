import { SignJWT, jwtVerify } from "jose"
import { cookies } from "next/headers"
import type { JWTPayload } from "jose"

// Read when a session is signed or checked, not when this file loads. In
// production a missing JWT_SECRET is an error: with a known default anyone
// could sign a session for any account.
function sessionSecret() {
  const secret = process.env.JWT_SECRET
  if (!secret && process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET is not set")
  }
  return new TextEncoder().encode(secret ?? "fallback-dev-secret-change-in-production")
}

export interface SessionPayload extends JWTPayload {
  userId: string
  email: string
  name?: string | null
  image?: string | null
}

export const SESSION_COOKIE_NAME = "kevo_session"
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: COOKIE_MAX_AGE,
  path: "/",
}

// Returns the signed JWT — callers set the cookie on the response directly
export async function createSession(payload: SessionPayload): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(sessionSecret())
}

export async function getSession(): Promise<SessionPayload | null> {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get(SESSION_COOKIE_NAME)?.value
    if (!token) return null

    const { payload } = await jwtVerify(token, sessionSecret())
    return payload as unknown as SessionPayload
  } catch {
    return null
  }
}
