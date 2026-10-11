import { proxyAuth } from "../auth-proxy"

export async function POST(req: Request) {
  return proxyAuth(req, "/api/forgot-password", { grantSession: false })
}
