import { authRoute } from "../../lib/auth/auth-route"

// Step two of an email signup: the code is checked against the caller's own
// attempt, the account is created, and only then is a session granted.
export async function POST(req: Request) {
  return authRoute("signup-verify", req)
}
