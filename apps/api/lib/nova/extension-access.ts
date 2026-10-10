// Who a request from the browser extension is, and what a request may carry.
//
// The extension never holds the web session. It proves itself with its own
// credential (Authorization: Bearer nvx_…), which
// packages/api/src/nova/product/extension-connection.ts issued when the
// learner paired the browser and which opens these routes only. The learner
// is derived from that credential: no id in the URL, query or body is read.

import { NextResponse } from "next/server"
//@ts-ignore
import { authenticateExtensionToken } from "@repo/api/nova/product/extension-connection"
//@ts-ignore
import { resolveEventLearner } from "@repo/api/nova/product/learning-events"
import { resolveLearnerForUser, resolveNovaLearner } from "./resolve-learner"

export const eventFail = (status: number, error: string, message: string) =>
  NextResponse.json({ success: false, error, message }, { status })

function bearer(req: Request): string | null {
  const header = req.headers.get("authorization") ?? ""
  return header.startsWith("Bearer ") ? header.slice(7).trim() : null
}

export type ExtensionCaller =
  | { kind: "unauthenticated" }
  | { kind: "not_nova" | "not_connected"; userId: string; connectionId: string }
  | { kind: "learner"; userId: string; connectionId: string; name: string | null; platformChatId: string }

export async function resolveExtensionCaller(req: Request): Promise<ExtensionCaller> {
  const token = bearer(req)
  const auth  = token ? await authenticateExtensionToken(token) : null
  if (!auth) return { kind: "unauthenticated" }
  const learner = await resolveLearnerForUser(auth.userId, auth.name)
  if (learner.kind !== "learner") return { kind: learner.kind, userId: auth.userId, connectionId: auth.connectionId }
  return { kind: "learner", userId: auth.userId, connectionId: auth.connectionId, name: learner.name, platformChatId: learner.platformChatId }
}

// The signed-in web account's own Nova profile, or the response to send.
export async function requireWebLearner(): Promise<
  { profileId: string; platformChatId: string; denied?: undefined; status?: undefined } |
  { denied: NextResponse; status: "unauthenticated" | "not_nova" | "not_connected" | "onboarding_incomplete"; profileId?: undefined; platformChatId?: undefined }
> {
  const learner = await resolveNovaLearner()
  if (learner.kind === "unauthenticated") return { status: "unauthenticated", denied: eventFail(401, "unauthenticated", "Sign in to Nova first.") }
  if (learner.kind !== "learner") return { status: learner.kind, denied: eventFail(409, learner.kind, learner.kind === "not_nova" ? "This is part of Nova." : "Connect Nova first.") }
  const resolved = await resolveEventLearner(learner.platformChatId)
  if (resolved.status !== "ready") return { status: resolved.status, denied: eventFail(409, resolved.status, "Finish setting up with Nova first.") }
  return { profileId: resolved.profileId, platformChatId: learner.platformChatId }
}

// A JSON body no larger than `maxBytes`. "too_large" is decided before the
// body is parsed; a declared length over the limit is refused unread.
export async function readSmallJson(req: Request, maxBytes: number): Promise<{ ok: true; body: unknown } | { ok: false; reason: "too_large" | "invalid" }> {
  const declared = Number(req.headers.get("content-length") ?? "0")
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, reason: "too_large" }
  const text = await req.text().catch(() => null)
  if (text === null) return { ok: false, reason: "invalid" }
  if (Buffer.byteLength(text, "utf8") > maxBytes) return { ok: false, reason: "too_large" }
  try { return { ok: true, body: JSON.parse(text) } } catch { return { ok: false, reason: "invalid" } }
}

// A small per-key limiter for the one route that takes no credential. The
// API runs as a single always-on instance (see RENDER_DEPLOYMENT.md), so a
// process-level map is the same answer every request gets.
const attempts = new Map<string, number[]>()
export function allowAttempt(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const recent = (attempts.get(key) ?? []).filter(t => now - t < windowMs)
  if (recent.length >= limit) { attempts.set(key, recent); return false }
  recent.push(now)
  attempts.set(key, recent)
  if (attempts.size > 5000) for (const [k, v] of attempts) if (v.every(t => now - t >= windowMs)) attempts.delete(k)
  return true
}

// ── Cross-origin answers for the extension ────────────────────────────────────
// The extension asks for no access to any website, Nova's included, so its
// requests are ordinary cross-origin ones and need these headers. They are
// given to extension origins only, and cookies are not allowed with them: an
// extension is answered for its bearer credential (or a one-time code), never
// for the session cookie, so a web page gains nothing from these headers.

const EXTENSION_ORIGINS = ["chrome-extension://"]

export const fromExtensionOrigin = (req: Request) => {
  const origin = req.headers.get("origin") ?? ""
  return EXTENSION_ORIGINS.some(prefix => origin.startsWith(prefix))
}

export function extensionCors(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? ""
  if (!fromExtensionOrigin(req) || origin.length > 100) return {}
  return {
    "access-control-allow-origin":  origin,
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-max-age":       "600",
    "vary":                         "origin",
  }
}

export function withCors(req: Request, res: NextResponse): NextResponse {
  for (const [name, value] of Object.entries(extensionCors(req))) res.headers.set(name, value)
  return res
}

export const preflight = (req: Request) => new NextResponse(null, { status: 204, headers: extensionCors(req) })
