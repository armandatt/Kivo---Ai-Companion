import { NextResponse } from "next/server"
import { metered } from "../../../../../lib/billing/metered"
//@ts-ignore
import { proposeWorkspace, usesModel } from "@repo/api/nova/product/workspace-proposal"
import { requireWorkspaceLearner, workspaceFail } from "../../../../../lib/nova/workspace-access"
import { allowAttempt, readSmallJson } from "../../../../../lib/nova/extension-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
// A plan written from a document can take a minute.
export const maxDuration = 120

// Files travel as base64 inside the JSON: 3 MB of files is about 4 MB here.
const BODY_MAX = 4_300_000
const MODEL_PROPOSALS_PER_MINUTE = 4

// POST /api/nova/workspaces/propose
//   { templateId, inputs }                       a template, as it is (no model)
//   { templateId, inputs, personalize }          a template, adapted by Nova
//   { request, files?, category? }               Create with Nova
// Returns a checked plan to show and edit; stores nothing
// (product/workspace-proposal.ts). Only bodies that call a model use the
// learner's AI allowance and the per-minute limit.
// Response: ProposeResponse.
export async function POST(req: Request) {
  try {
    const access = await requireWorkspaceLearner()
    if (access.denied) return access.denied
    const read = await readSmallJson(req, BODY_MAX)
    if (!read.ok) return workspaceFail(read.reason === "too_large" ? 413 : 400, read.reason === "too_large" ? "files" : "invalid", read.reason === "too_large" ? "Those files are too large together. Up to 3 MB." : "That request couldn't be read.")
    const body = (read.body ?? {}) as Record<string, unknown>
    if (!usesModel(body)) return NextResponse.json(await proposeWorkspace(access.platformChatId, body), { headers: { "cache-control": "no-store" } })

    if (!allowAttempt(`workspace-propose:${access.platformChatId}`, MODEL_PROPOSALS_PER_MINUTE, 60_000)) {
      return workspaceFail(429, "rate_limited", "That's a lot at once. Give it a minute.")
    }
    const run = await metered(access.platformChatId, () => proposeWorkspace(access.platformChatId, body))
    if (!run.ok) return run.response
    const result = run.value as Awaited<ReturnType<typeof proposeWorkspace>>
    const status = result.ok ? 200 : result.error === "unavailable" ? 503 : 400
    return NextResponse.json(result, { status, headers: { "cache-control": "no-store" } })
  } catch (err) {
    console.error("[nova/workspaces/propose]", err)
    return workspaceFail(500, "failed", "That didn't work. Your request is still here; try again.")
  }
}
