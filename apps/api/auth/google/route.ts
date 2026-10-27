import { NextResponse } from "next/server"
import { randomUrlToken } from "@repo/api/auth/secrets"
import { consentFromToken, consentToken } from "@repo/api/auth/legal"
import {
  appUrl,
  googleAuthorizationUrl,
  googleConfig,
  movedTo,
  OAUTH_COOKIE_NAME,
  OAUTH_COOKIE_OPTIONS,
} from "../../lib/auth/google-oidc"

export async function GET(req: Request) {
  const config = googleConfig()

  if (!config) {
    return NextResponse.redirect(`${appUrl()}/signin?error=google_config`)
  }

  // The state cookie is set on the host the browser is on, and only the
  // callback's host can read it back. Started anywhere else (thekio.in
  // when Google returns to the vercel.app address), the first attempt always
  // came back "expired" and the second, now on the callback's host, worked.
  // So the browser is first sent to start on the callback's host, once.
  const moved = movedTo(req, config.redirectUri)
  if (moved) return NextResponse.redirect(moved)

  // state ties the callback to this browser; nonce ties the ID token to this
  // attempt. Both come back and are compared in the callback.
  const state = randomUrlToken()
  const nonce = randomUrlToken()

  const response = NextResponse.redirect(
    googleAuthorizationUrl(config.clientId, config.redirectUri, state, nonce)
  )
  // The sign-up page sends the versions the learner agreed to (?consent=);
  // only current ones are kept. The callback needs them to create an account.
  const consent = consentFromToken(new URL(req.url).searchParams.get("consent"))
  response.cookies.set(OAUTH_COOKIE_NAME, `${state}.${nonce}${consent ? `.${consentToken(consent)}` : ""}`, OAUTH_COOKIE_OPTIONS)
  return response
}

