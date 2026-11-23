import { NextResponse } from "next/server"
//@ts-ignore
import { saveNoteImage, NOTE_IMAGE_BODY_MAX } from "@repo/api/nova/product/note-images"
//@ts-ignore
import { admitStorage, type StorageRefusal } from "@repo/api/billing/accounting/storage"
//@ts-ignore
import { upgradeLine } from "@repo/api/billing/offer"
import { PLAN_URL } from "../../../../../lib/billing/metered"
import { noteFail, requireNoteLearner } from "../../../../../lib/nova/note-access"
import { readSmallJson } from "../../../../../lib/nova/extension-access"
import { rateGate } from "../../../../../lib/rate-limits"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// POST /api/nova/notes/images  { noteId, data (base64), clientKey, sourceUrl?, sourceTitle?, page? }
// An image (a page or region captured from a PDF) for one of the learner's
// notes, checked by its bytes; the page then puts its kivo-image: reference
// in the note through the note's own save (product/note-images.ts).
export async function POST(req: Request) {
  try {
    const access = await requireNoteLearner()
    if (access.denied) return access.denied
    const limited = await rateGate("notes.images", { learner: access.platformChatId })
    if (limited) return limited
    const read = await readSmallJson(req, NOTE_IMAGE_BODY_MAX)
    if (!read.ok) return noteFail(read.reason === "too_large" ? 413 : 400, read.reason === "too_large" ? "too_large" : "invalid", read.reason === "too_large" ? "That image is too large. Capture a smaller region." : "That image couldn't be read.")
    // Storage allowance: the upload's bytes are admitted before it is stored
    // (billing/accounting/storage.ts); refused only when enforcing, and never
    // touching what is already stored.
    const data = (read.body as { data?: unknown } | null)?.data
    // Its size on the account's hourly upload budget (rate-limits upload.bytes).
    const heavy = await rateGate("upload.bytes", { learner: access.platformChatId, weight: Math.max(1, Math.ceil((typeof data === "string" ? data.length * 3 / 4 : 0) / 1_000_000)) })
    if (heavy) return heavy
    const gate = await admitStorage({ platformChatId: access.platformChatId, profileId: access.profileId, bytes: typeof data === "string" ? Math.floor(data.length * 3 / 4) : 0 })
    if (gate.refused) return storageRefused(gate.refused)
    const result = await saveNoteImage(access.profileId, read.body).finally(() => { void gate.release() })
    if (result.ok) return NextResponse.json(result, { headers: { "cache-control": "no-store" } })
    return NextResponse.json(result, { status: result.error === "not_found" ? 404 : result.error === "too_large" ? 413 : 400 })
  } catch (err) {
    console.error("[nova/notes/images POST]", err)
    return noteFail(500, "failed", "That image didn't save. Try again.")
  }
}

// An upload the storage allowance refused: 413 naming the allowance. What is
// already stored stays readable and exportable.
function storageRefused(r: StorageRefusal) {
  const mb = (b: number) => b >= 1_000_000_000 ? `${(b / 1_000_000_000).toLocaleString("en-US", { maximumFractionDigits: 1 })} GB` : `${Math.round(b / 1_000_000)} MB`
  // Only a plan that can be bought now is named (billing/offer.ts).
  const next = upgradeLine(r.tier, "storage")
  return NextResponse.json({ ok: false, error: "storage_allowance_exhausted", code: r.code, message: `Your images use ${mb(r.usedBytes)} of ${mb(r.limitBytes)}, so new uploads are paused.${next} Everything you've stored is still here and still opens.`, usedBytes: r.usedBytes, limitBytes: r.limitBytes, tier: r.tier, planUrl: PLAN_URL }, { status: 413, headers: { "cache-control": "no-store" } })
}
