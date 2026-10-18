import { proxyAuth } from "../auth-proxy"

// Room for the API to wake from idle; see UPSTREAM_TIMEOUT_MS in auth-proxy.ts.
export const maxDuration = 60

// Starting a signup only sends a verification code. The session is granted by
// /api/signup/verify, once the code has been confirmed.
export async function POST(req: Request) {
  return proxyAuth(req, "/api/signup", { grantSession: false })
}
