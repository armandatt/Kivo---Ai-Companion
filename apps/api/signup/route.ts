import { authRoute } from "../lib/auth/auth-route"

// Step one of an email signup: store the attempt and email a code. No account
// exists and no session is granted until /api/signup/verify confirms the code.
export async function POST(req: Request) {
  return authRoute("signup", req)
}
