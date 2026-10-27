import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { errorLabel } from "@repo/api/auth/error-label"
import { readGoogleClaims, resolveGoogleSignIn } from "@repo/api/auth/google-signin.service"
import { safeEqual } from "@repo/api/auth/secrets"
import { consentFromToken } from "@repo/api/auth/legal"
import { createSession, SESSION_COOKIE_NAME, SESSION_COOKIE_OPTIONS } from "../../../lib/auth/session"
import {
  appUrl,
  exchangeCodeForIdToken,
  googleConfig,
  OAUTH_COOKIE_NAME,
  OAUTH_COOKIE_OPTIONS,
  verifyGoogleIdToken,
} from "../../../lib/auth/google-oidc"

// Every way out of the callback ends this sign-in attempt, so every response
// clears the state cookie.
function finish(path: string) {
  const response = NextResponse.redirect(`${appUrl()}${path}`)
  response.cookies.set(OAUTH_COOKIE_NAME, "", { ...OAUTH_COOKIE_OPTIONS, maxAge: 0 })
  return response
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const code = searchParams.get("code")
    const state = searchParams.get("state")

    // User denied access
    if (searchParams.get("error") || !code) {
      return finish("/signin?error=google_denied")
    }

    const config = googleConfig()
    if (!config) return finish("/signin?error=google_config")

    // The state must be the one this browser was sent to Google with.
    const cookieStore = await cookies()
    const [expectedState, expectedNonce, agreed] = (cookieStore.get(OAUTH_COOKIE_NAME)?.value ?? "").split(".")
    if (!state || !expectedState || !expectedNonce || !safeEqual(state, expectedState)) {
      return finish("/signin?error=google_state")
    }

    const idToken = await exchangeCodeForIdToken(code, config)
    if (!idToken) {
      console.error("[GOOGLE CALLBACK] Token exchange failed")
      return finish("/signin?error=token_exchange")
    }

    let payload
    try {
      payload = await verifyGoogleIdToken(idToken, config.clientId)
    } catch {
      console.error("[GOOGLE CALLBACK] ID token failed verification")
      return finish("/signin?error=google_token")
    }

    const claims = readGoogleClaims(payload, expectedNonce)
    if (!claims.ok) return finish("/signin?error=google_token")

    const result = await resolveGoogleSignIn(claims.identity, { consent: consentFromToken(agreed) })
    if (!result.ok) {
      const error = {
        password_reset_required: "google_link",
        email_not_authoritative: "google_manual",
        email_unverified: "google_unverified",
        consent_required: "google_consent",
      }[result.reason]
      // A new account needs the agreement, which is given on the sign-up page.
      return finish(result.reason === "consent_required" ? "/signup?error=google_consent" : `/signin?error=${error}`)
    }

    const { user } = result
    const token = await createSession({
      userId: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
    })

    const response = finish("/home")
    response.cookies.set(SESSION_COOKIE_NAME, token, SESSION_COOKIE_OPTIONS)
    return response
  } catch (error) {
    // The kind of error only: the error itself can quote an email address.
    console.error(`[GOOGLE CALLBACK ERROR] ${errorLabel(error)}`)
    return finish("/signin?error=server_error")
  }
}
