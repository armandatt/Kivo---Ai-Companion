import { NextResponse } from "next/server"
import { handleAuthRequest, type AuthRoute } from "@repo/api/auth/http"
import { createSession, SESSION_COOKIE_NAME, SESSION_COOKIE_OPTIONS } from "./session"

// The Next side of an auth POST. The checks, limits and rules are in
// packages/api/src/auth/http.ts; this turns its result into a response and,
// when the request ended with someone signed in, grants the session.
export async function authRoute(route: AuthRoute, req: Request) {
  const result = await handleAuthRequest(route, req)
  const response = NextResponse.json(result.body, { status: result.status, headers: result.headers })

  if (result.sessionUser) {
    const { id, email, name, image } = result.sessionUser
    const token = await createSession({ userId: id, email, name, image })
    response.cookies.set(SESSION_COOKIE_NAME, token, SESSION_COOKIE_OPTIONS)
  }
  return response
}
