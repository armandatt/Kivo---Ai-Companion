import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

const PROTECTED_ROUTES = [
  "/home", "/coach", "/journey", "/progress", "/goals", "/creature", "/settings",
  "/planner", "/focus", "/knowledge", "/map", "/notes", "/saved", "/learning-dna", "/guide",
  "/onboarding",
]

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl
  const token = request.cookies.get("kevo_session")?.value

  const isProtected = PROTECTED_ROUTES.some((route) =>
    pathname.startsWith(route)
  )
  if (isProtected && !token) {
    const loginUrl = new URL("/signin", request.url)
    // The query comes too: /focus?study=<id> from the extension must still
    // name its page after sign-in. The sign-in page accepts only a path here.
    loginUrl.searchParams.set("from", pathname + search)
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
    "/planner/:path*",
    "/focus/:path*",
    "/knowledge/:path*",
    "/map/:path*",
    "/notes/:path*",
    "/saved/:path*",
    "/learning-dna/:path*",
    "/guide/:path*",
  ],
}
