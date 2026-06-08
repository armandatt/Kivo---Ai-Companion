import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

const PROTECTED_ROUTES = [
  "/home", "/coach", "/journey", "/progress", "/goals", "/creature", "/settings",
  "/onboarding",
]

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const token = request.cookies.get("kevo_session")?.value

  const isProtected = PROTECTED_ROUTES.some((route) =>
    pathname.startsWith(route)
  )
  if (isProtected && !token) {
    const loginUrl = new URL("/signin", request.url)
    loginUrl.searchParams.set("from", pathname)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    "/home/:path*",
    "/coach/:path*",
    "/journey/:path*",
    "/progress/:path*",
    "/goals/:path*",
    "/creature/:path*",
    "/settings/:path*",
    "/onboarding/:path*",
  ],
}
