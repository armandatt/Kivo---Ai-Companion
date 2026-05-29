import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

const PROTECTED_ROUTES = ["/dashboard", "/onboarding", "/settings"]

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
    "/dashboard/:path*",
    "/onboarding/:path*",
    "/settings/:path*",
  ],
}
