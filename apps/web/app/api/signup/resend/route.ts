import { proxyAuth } from "../../auth-proxy"

// Room for the API to wake from idle; see UPSTREAM_TIMEOUT_MS in auth-proxy.ts.
export const maxDuration = 60

export async function POST(req: Request) {
  return proxyAuth(req, "/api/signup/resend", { grantSession: false })
}
