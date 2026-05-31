import { SignJWT, jwtVerify } from "jose"
import { cookies } from "next/headers"
import type { JWTPayload } from "jose"

const SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET ?? "fallback-dev-secret-change-in-production"
)

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
    .sign(SECRET)
}

export async function getSession(): Promise<SessionPayload | null> {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get(SESSION_COOKIE_NAME)?.value
    if (!token) return null

    const { payload } = await jwtVerify(token, SECRET)
    return payload as unknown as SessionPayload
  } catch {
    return null
  }
}
