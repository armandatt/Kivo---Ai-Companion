import { proxyAuth } from "../auth-proxy"

// Starting a signup only sends a verification code. The session is granted by
// /api/signup/verify, once the code has been confirmed.
export async function POST(req: Request) {
  return proxyAuth(req, "/api/signup", { grantSession: false })
}
