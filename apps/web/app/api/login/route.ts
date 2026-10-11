import { proxyAuth } from "../auth-proxy"

export async function POST(req: Request) {
  return proxyAuth(req, "/api/login", { grantSession: true })
}
