import { NextResponse } from "next/server"
import { checkSourceFrame } from "@repo/api/nova/product/source-frame"
import { publicAppUrl } from "@repo/api/auth/auth-deps"
import { noteFail, requireNoteLearner } from "../../../../../lib/nova/note-access"
import { allowAttempt, readSmallJson } from "../../../../../lib/nova/extension-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 20

// The most checks one learner can ask for in a minute: each is one request
// to the source, for its headers only.
const CHECKS_PER_MINUTE = 20

// POST /api/nova/notes/source-frame  { url }
// Whether the source at that link lets Notes show it in a frame
// (product/source-frame.ts): its headers are read, nothing of its body, and
// nothing is stored. Response: { verdict, url, host }.
export async function POST(req: Request) {
  try {
    const access = await requireNoteLearner()
    if (access.denied) return access.denied
    if (!allowAttempt(`source-frame:${access.profileId}`, CHECKS_PER_MINUTE, 60_000)) {
      return noteFail(429, "rate_limited", "Give it a minute and try again.")
    }
    const read = await readSmallJson(req, 4 * 1024)
    const url = read.ok && read.body && typeof (read.body as { url?: unknown }).url === "string" ? (read.body as { url: string }).url.trim() : ""
    if (!url.startsWith("https://") || url.length > 2048) return noteFail(400, "invalid", "Only https:// sources can be shown here.")
    const result = await checkSourceFrame(url, publicAppUrl())
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } })
  } catch (err) {
    console.error("[nova/notes/source-frame]", err instanceof Error ? err.name : "error")
    return noteFail(500, "failed", "That didn't work. Try again.")
  }
}
