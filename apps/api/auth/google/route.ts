import { NextResponse } from "next/server"
import { randomUrlToken } from "@repo/api/auth/secrets"
import {
  appUrl,
  googleAuthorizationUrl,
  googleConfig,
  OAUTH_COOKIE_NAME,
  OAUTH_COOKIE_OPTIONS,
} from "../../lib/auth/google-oidc"

export async function GET() {
  const config = googleConfig()

  if (!config) {
    return NextResponse.redirect(`${appUrl()}/signin?error=google_config`)
  }

  // state ties the callback to this browser; nonce ties the ID token to this
  // attempt. Both come back and are compared in the callback.
  const state = randomUrlToken()
  const nonce = randomUrlToken()

  const response = NextResponse.redirect(
    googleAuthorizationUrl(config.clientId, config.redirectUri, state, nonce)
  )
  response.cookies.set(OAUTH_COOKIE_NAME, `${state}.${nonce}`, OAUTH_COOKIE_OPTIONS)
  return response
}
