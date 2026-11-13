// The consent page (/connect/authorize on the web app) asks here.
// GET  ?<the assistant's OAuth parameters>  → who is asking and for what
// POST { params, approve }                 → where to send the browser next
// The learner is the session's; the code is bound to their account.

import { NextResponse } from "next/server"
//@ts-ignore
import { checkAuthorize, decide, scopeDescriptions } from "@repo/api/connect/authorize"
import { connectOrigin, mcpUrl } from "../../../../lib/connect/config"
import { fail, sameSiteProblem, sessionUser } from "../../../../lib/connect/web-access"
import { readSmallJson } from "../../../../lib/nova/extension-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const PARAMS = ["response_type", "client_id", "redirect_uri", "scope", "state", "code_challenge", "code_challenge_method", "resource"] as const
const pick = (get: (k: string) => unknown) => Object.fromEntries(PARAMS.map(k => [k, get(k) ?? undefined]))

export async function GET(req: Request) {
  const user = await sessionUser()
  if (!user) return fail(401, "unauthenticated", "Sign in to Kivo first.")
  const q = new URL(req.url).searchParams
  const check = await checkAuthorize(pick(k => q.get(k)), mcpUrl(), connectOrigin())
  if (!check.ok) return NextResponse.json("show" in check ? { ok: false, show: check.show } : { ok: false, redirect: check.redirect, message: check.description })
  return NextResponse.json({ ok: true, client: check.client.name, scopes: scopeDescriptions(check.scopes), redirectHost: new URL(check.redirectUri).host, account: user.name })
}

export async function POST(req: Request) {
  const bad = sameSiteProblem(req)
  if (bad) return bad
  const user = await sessionUser()
  if (!user) return fail(401, "unauthenticated", "Sign in to Kivo first.")
  const body = await readSmallJson(req, 8_000)
  if (!body.ok || typeof body.body !== "object" || body.body === null) return fail(400, "invalid", "That is not an answer.")
  const { params, approve } = body.body as { params?: Record<string, unknown>; approve?: unknown }
  const check = await checkAuthorize(pick(k => params?.[k]), mcpUrl(), connectOrigin())
  if (!check.ok) return NextResponse.json("show" in check ? { ok: false, show: check.show } : { ok: true, redirect: check.redirect })
  const redirect = await decide(user.userId, check, approve === true, connectOrigin())
  console.log(JSON.stringify({ layer: "kivo_connect", event: approve === true ? "authorized" : "denied", client: check.client.name, scopes: check.scopes.length }))
  return NextResponse.json({ ok: true, redirect })
}
