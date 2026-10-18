import { NextResponse } from "next/server"
//@ts-ignore
import { loadMapLayout, resetMapLayout, saveMapLayout } from "@repo/api/nova/product/map-layout"
//@ts-ignore
import { MAP_LAYOUT_BODY_MAX_BYTES } from "@repo/api/nova/product/map-layout.types"
import { resolveNovaLearner } from "../../../../../lib/nova/resolve-learner"
import { readSmallJson } from "../../../../../lib/nova/extension-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Where the signed-in learner put the cards on their Knowledge Map. The
// learner is always the session's own: no id in the URL, query or body names
// one. Positions only; moving a card changes nothing else.
// Contracts: packages/api/src/nova/product/map-layout.types.ts.

const fail = (status: number, error: string, message: string) => NextResponse.json({ ok: false, error, message }, { status })

async function learner() {
  const found = await resolveNovaLearner()
  if (found.kind === "unauthenticated") return { denied: fail(401, "unauthenticated", "Sign in to Nova first.") }
  if (found.kind !== "learner") return { denied: fail(409, found.kind, "This is part of Nova.") }
  return { platformChatId: found.platformChatId as string }
}

const statusOf = (result: { ok: boolean; error?: string }) =>
  result.ok ? 200 : result.error === "invalid" ? 400 : result.error === "too_large" ? 413 : result.error === "failed" ? 500 : 409

// GET: { ok, positions: [{ node, x, y }] }
export async function GET() {
  try {
    const who = await learner()
    if (who.denied) return who.denied
    const result = await loadMapLayout(who.platformChatId)
    return NextResponse.json(result, { status: statusOf(result) })
  } catch (err) {
    console.error("[nova/knowledge-map/layout]", err)
    return fail(500, "failed", "Couldn't load where your cards are.")
  }
}

// PUT { positions: [{ node, x, y }] }: stores those positions, for items on
// the learner's own map only. Answers { ok, saved, skipped }.
export async function PUT(req: Request) {
  try {
    const who = await learner()
    if (who.denied) return who.denied
    if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
      return fail(400, "invalid", "That isn't a layout.")
    }
    const read = await readSmallJson(req, MAP_LAYOUT_BODY_MAX_BYTES)
    if (!read.ok) return read.reason === "too_large" ? fail(413, "too_large", "That layout is too large to save.") : fail(400, "invalid", "That isn't a layout.")
    const result = await saveMapLayout(who.platformChatId, read.body)
    return NextResponse.json(result, { status: statusOf(result) })
  } catch (err) {
    console.error("[nova/knowledge-map/layout]", err)
    return fail(500, "failed", "Your layout didn't save. Try again.")
  }
}

// DELETE: removes the learner's saved positions, and nothing else. The map
// then draws every card where its own layout puts it.
export async function DELETE() {
  try {
    const who = await learner()
    if (who.denied) return who.denied
    const result = await resetMapLayout(who.platformChatId)
    return NextResponse.json(result, { status: statusOf(result) })
  } catch (err) {
    console.error("[nova/knowledge-map/layout]", err)
    return fail(500, "failed", "The layout wasn't reset. Try again.")
  }
}
