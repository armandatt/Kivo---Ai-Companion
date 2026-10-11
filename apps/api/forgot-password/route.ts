import { authRoute } from "../lib/auth/auth-route"

// The same reply whether or not the address has an account.
export async function POST(req: Request) {
  return authRoute("forgot-password", req)
}
