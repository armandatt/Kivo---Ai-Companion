import { authRoute } from "../../lib/auth/auth-route"

export async function POST(req: Request) {
  return authRoute("signup-resend", req)
}
