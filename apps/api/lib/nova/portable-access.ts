// Shared guards for the .kivo export and import routes (packages/api/src/portable).
// The learner comes from the session cookie (requireNoteLearner), never from the
// request. Uploads are raw bytes, so the JSON-only crossSiteProblem check does
// not apply; the same rules are applied here instead:
//   - the content type is one a cross-site HTML form cannot send;
//   - an Origin header, when present, must be Kivo's own;
//   - Sec-Fetch-Site must not name another site.
// Each action is rate-limited per learner in Postgres (billing limiter).

import { NextResponse } from "next/server"
//@ts-ignore
import { hitLimit } from "@repo/api/billing/accounting/limiter"
import { noteFail } from "./note-access"
import { connectOrigin } from "../connect/config"

export const UPLOAD_MAX_BYTES = 10_000_000
const UPLOAD_TYPES = new Set(["application/vnd.kivo.map+zip", "application/octet-stream", "application/zip"])

export const PORTABLE_LIMITS = {
  "export":         { limit: 10, windowMs: 60_000 },
  "import-preview": { limit: 20, windowMs: 60_000 },
  "import":         { limit: 6,  windowMs: 60_000 },
} as const

export function crossSiteUpload(req: Request): NextResponse | null {
  const type = (req.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase()
  if (!UPLOAD_TYPES.has(type)) return noteFail(415, "invalid", "Send the .kivo file itself.")
  const origin = req.headers.get("origin")
  const allowed = [connectOrigin(), process.env.NEXT_PUBLIC_APP_URL ?? null].filter(Boolean)
  if (origin !== null && !allowed.includes(origin)) return noteFail(403, "forbidden", "This request did not come from Kivo.")
  const site = req.headers.get("sec-fetch-site")
  if (site !== null && site !== "same-origin" && site !== "none") return noteFail(403, "forbidden", "This request did not come from Kivo.")
  return null
}

export async function readUpload(req: Request): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; response: NextResponse }> {
  const declared = Number(req.headers.get("content-length") ?? "0")
  if (declared > UPLOAD_MAX_BYTES) return { ok: false, response: noteFail(413, "too_large", "That file is too large for a Kivo map (10 MB at most).") }
  const buf = new Uint8Array(await req.arrayBuffer())
  if (buf.length === 0) return { ok: false, response: noteFail(400, "invalid", "The file was empty.") }
  if (buf.length > UPLOAD_MAX_BYTES) return { ok: false, response: noteFail(413, "too_large", "That file is too large for a Kivo map (10 MB at most).") }
  return { ok: true, bytes: buf }
}

export async function portableLimit(action: keyof typeof PORTABLE_LIMITS, platformChatId: string): Promise<NextResponse | null> {
  const { limit, windowMs } = PORTABLE_LIMITS[action]
  try {
    const hit = await hitLimit(`portable-${action}:${platformChatId}`, limit, windowMs)
    if (!hit.allowed) return NextResponse.json({ ok: false, error: "rate_limited", message: "That's a lot of maps at once. Wait a minute and try again." }, { status: 429, headers: { "retry-after": String(hit.retryAfterSeconds ?? 60) } })
  } catch (err) {
    console.error(`[portable] limiter unavailable: ${(err as Error).name}`)
  }
  return null
}
