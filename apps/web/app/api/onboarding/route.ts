import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { errorLabel } from "@repo/api/auth/error-label"
import { AUTH_UNAVAILABLE, apiBase, UPSTREAM_TIMEOUT_MS } from "../auth-proxy"

// The first page after signup. Like the auth proxy, it always answers with
// JSON: a missing API_URL or an API that cannot be reached is logged by kind
// and the browser is asked to try again.
function unavailable(reason: string) {
  console.error(`[ONBOARDING PROXY] ${reason}`)
  return NextResponse.json({ error: AUTH_UNAVAILABLE }, { status: 502 })
}

export async function POST(req: Request) {
  const cookieStore = await cookies()
  const token = cookieStore.get("kevo_session")?.value

  const base = apiBase(process.env)
  if (!base) return unavailable("API_URL is not set or is not an http(s) URL.")

  let upstream: Response
  try {
    upstream = await fetch(`${base}/api/onboarding`, {
      method: "POST",
      headers: {
        "Content-Type": req.headers.get("content-type") ?? "application/json",
        ...(token ? { Cookie: `kevo_session=${token}` } : {}),
      },
      body: await req.text(),
      cache: "no-store",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    })
  } catch (error) {
    return unavailable(`The API could not be reached (${errorLabel(error)}).`)
  }

  const body = await upstream.text()
  return new NextResponse(body, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "application/json",
    },
  })
}
