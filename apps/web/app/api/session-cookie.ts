import { NextResponse } from "next/server"

const SESSION_COOKIE_NAME = "kevo_session"
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30

export function applySessionCookie(response: NextResponse, setCookie: string | null) {
  const token = setCookie?.match(/(?:^|,\s*)kevo_session=([^;]+)/)?.[1]
  if (!token) return

  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE,
    path: "/",
  })
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.delete(SESSION_COOKIE_NAME)
}
