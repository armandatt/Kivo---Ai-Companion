// The signed-in learner's own requests about Kivo Connect (the consent page,
// connected assistants, approving a plan): the session cookie, and a POST
// only from Kivo's own pages. Never answered cross-origin.

import { NextResponse } from "next/server"
//@ts-ignore
import { crossSiteProblem } from "@repo/api/auth/request-origin"
import { getSession } from "../auth/session"
import { connectOrigin } from "./config"

export const fail = (status: number, error: string, message: string) => NextResponse.json({ ok: false, error, message }, { status, headers: { "cache-control": "no-store" } })

export async function sessionUser(): Promise<{ userId: string; name: string | null } | null> {
  const s = await getSession()
  return s ? { userId: s.userId, name: s.name ?? null } : null
}

export function sameSiteProblem(req: Request): NextResponse | null {
  const problem = crossSiteProblem(req.headers, [connectOrigin()])
  return problem ? fail(problem.status, "cross_site", problem.error) : null
}
