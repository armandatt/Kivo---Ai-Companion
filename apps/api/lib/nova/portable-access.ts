// Shared guards for the .kivo export and import routes (packages/api/src/portable).
// The learner comes from the session cookie (requireNoteLearner), never from the
// request. Uploads are raw bytes, so the JSON-only crossSiteProblem check does
// not apply; the same rules are applied here instead:
//   - the content type is one a cross-site HTML form cannot send;
//   - an Origin header, when present, must be Kivo's own;
//   - Sec-Fetch-Site must not name another site.
// Each action is rate-limited per account and at once (rate-limits policies
// portable.export, portable.import-preview, portable.import), and uploads
// count their size (upload.bytes).

import { NextResponse } from "next/server"
import { noteFail } from "./note-access"
import { connectOrigin } from "../connect/config"
import { concurrencyGate, rateGate } from "../rate-limits"
//@ts-ignore
import { admitStorage } from "@repo/api/billing/accounting/storage"
//@ts-ignore
import { upgradeLine } from "@repo/api/billing/offer"
import { PLAN_URL } from "../billing/metered"

// A .kivo map or note with its images and files (kivo-archive ARCHIVE_LIMITS);
// a PDF on its own is 10 MB at most (note-files NOTE_FILE_BYTES_MAX).
export const UPLOAD_MAX_BYTES = 50_000_000
// Types a cross-site HTML form cannot send.
const UPLOAD_TYPES = new Set(["application/vnd.kivo.map+zip", "application/vnd.kivo.note+zip", "application/pdf", "application/octet-stream", "application/zip"])

const POLICY = { "export": "portable.export", "import-preview": "portable.import-preview", "import": "portable.import" } as const
export type PortableAction = keyof typeof POLICY

export function crossSiteUpload(req: Request): NextResponse | null {
  const type = (req.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase()
  if (!UPLOAD_TYPES.has(type)) return noteFail(415, "invalid", "Send the .kivo or PDF file itself.")
  const origin = req.headers.get("origin")
  const allowed = [connectOrigin(), process.env.NEXT_PUBLIC_APP_URL ?? null].filter(Boolean)
  if (origin !== null && !allowed.includes(origin)) return noteFail(403, "forbidden", "This request did not come from Kivo.")
  const site = req.headers.get("sec-fetch-site")
  if (site !== null && site !== "same-origin" && site !== "none") return noteFail(403, "forbidden", "This request did not come from Kivo.")
  return null
}

export async function readUpload(req: Request): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; response: NextResponse }> {
  const declared = Number(req.headers.get("content-length") ?? "0")
  if (declared > UPLOAD_MAX_BYTES) return { ok: false, response: noteFail(413, "too_large", "That file is too large (50 MB at most).") }
  const buf = new Uint8Array(await req.arrayBuffer())
  if (buf.length === 0) return { ok: false, response: noteFail(400, "invalid", "The file was empty.") }
  if (buf.length > UPLOAD_MAX_BYTES) return { ok: false, response: noteFail(413, "too_large", "That file is too large (50 MB at most).") }
  return { ok: true, bytes: buf }
}

export async function portableLimit(action: PortableAction, platformChatId: string): Promise<NextResponse | null> {
  return rateGate(POLICY[action], { learner: platformChatId })
}

/** One export or import at a time per account, and a few for everyone. Run `release` in finally. */
export async function portableSlot(action: "export" | "import", platformChatId: string, holder?: string) {
  return concurrencyGate(POLICY[action], { learner: platformChatId }, holder)
}

/** An upload's size on the account's hourly upload budget (upload.bytes), in megabytes. */
export async function uploadBytesLimit(platformChatId: string, bytes: number): Promise<NextResponse | null> {
  return rateGate("upload.bytes", { learner: platformChatId, weight: Math.max(1, Math.ceil(bytes / 1_000_000)) })
}

/**
 * An import's storage admission: the bytes of every image and file it will
 * store, reserved on the learner's storage allowance before anything is
 * written (billing/accounting/storage.ts). Refused: the message to show.
 */
export function importStorage(access: { platformChatId: string; profileId: string }) {
  return async (bytes: number): Promise<{ refused: string | null; release: () => Promise<void> }> => {
    const gate = await admitStorage({ platformChatId: access.platformChatId, profileId: access.profileId, bytes })
    if (!gate.refused) return { refused: null, release: gate.release }
    const r = gate.refused as { tier: string; usedBytes: number; limitBytes: number }
    const mb = (b: number) => b >= 1_000_000_000 ? `${(b / 1_000_000_000).toLocaleString("en-US", { maximumFractionDigits: 1 })} GB` : `${Math.max(1, Math.round(b / 1_000_000))} MB`
    return { refused: `This file's images and files need ${mb(bytes)}; you're using ${mb(r.usedBytes)} of ${mb(r.limitBytes)}. Nothing was imported.${upgradeLine(r.tier, "storage")} Plans: ${PLAN_URL}`, release: async () => undefined }
  }
}
