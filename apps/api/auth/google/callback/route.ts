import { prisma } from "@repo/db/client"
import { NextResponse } from "next/server"
import { createSession, SESSION_COOKIE_NAME, SESSION_COOKIE_OPTIONS } from "../../../lib/auth/session"

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const code = searchParams.get("code")
    const error = searchParams.get("error")

    // User denied access
    if (error || !code) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/signin?error=google_denied`
      )
    }

    // ── Exchange code for tokens ──
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
        grant_type: "authorization_code",
      }),
    })

    if (!tokenRes.ok) {
      console.error("[GOOGLE CALLBACK] Token exchange failed")
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/signin?error=token_exchange`
      )
    }

    const tokens = await tokenRes.json()

    // ── Get user info from Google ──
    const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })

    if (!userInfoRes.ok) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/signin?error=userinfo_failed`
      )
    }

    const googleUser = await userInfoRes.json()
    // googleUser: { id, email, name, picture, verified_email }

    // ── Upsert user in DB ──
    let user = await prisma.user.findUnique({
      where: { email: googleUser.email },
    })

    if (!user) {
      // New user — create
      user = await prisma.user.create({
        data: {
          email: googleUser.email,
          name: googleUser.name ?? null,
          image: googleUser.picture ?? null,
          emailVerified: new Date(),
        },
      })
    } else if (!user.image && googleUser.picture) {
      // Existing user — update image if missing
      user = await prisma.user.update({
        where: { id: user.id },
        data: { image: googleUser.picture, emailVerified: new Date() },
      })
    }

    // ── Upsert Google account link ──
    await prisma.account.upsert({
      where: {
        provider_providerAccountId: {
          provider: "google",
          providerAccountId: googleUser.id,
        },
      },
      create: {
        userId: user.id,
        type: "oauth",
        provider: "google",
        providerAccountId: googleUser.id,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token ?? null,
        expires_at: tokens.expires_in
          ? Math.floor(Date.now() / 1000) + tokens.expires_in
          : null,
        token_type: tokens.token_type,
        scope: tokens.scope,
        id_token: tokens.id_token ?? null,
      },
      update: {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token ?? null,
        expires_at: tokens.expires_in
          ? Math.floor(Date.now() / 1000) + tokens.expires_in
          : null,
        id_token: tokens.id_token ?? null,
      },
    })

    const profile = await prisma.userProfile.findUnique({
      where: { userId: user.id },
      select: { onboardingComplete: true },
    })

    const token = await createSession({
      userId: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
    })

    const nextPath = profile?.onboardingComplete ? "/dashboard" : "/onboarding"
    const redirectResponse = NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}${nextPath}`
    )
    redirectResponse.cookies.set(SESSION_COOKIE_NAME, token, SESSION_COOKIE_OPTIONS)
    return redirectResponse
  } catch (error) {
    console.error("[GOOGLE CALLBACK ERROR]", error)
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/signin?error=server_error`
    )
  }
}
