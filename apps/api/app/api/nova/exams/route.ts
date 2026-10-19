import { NextResponse } from "next/server"
//@ts-ignore
import { addExam, listExams } from "@repo/api/nova/product/exams"
//@ts-ignore
import { EXAM_BODY_MAX_BYTES } from "@repo/api/nova/product/exams.types"
//@ts-ignore
import { parseDeadlineType } from "@repo/api/nova/product/deadline-types"
import { readSmallJson } from "../../../../lib/nova/extension-access"
import { resolveNovaLearner } from "../../../../lib/nova/resolve-learner"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// The signed-in learner's exam dates, from today on. The learner is the
// account's own; no id is read from the request.
//
// GET /api/nova/exams   Response: NovaExamsView (product/exams.types.ts)
export async function GET() {
  try {
    const learner = await resolveNovaLearner()
    if (learner.kind === "unauthenticated") return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })
    if (learner.kind !== "learner") return NextResponse.json({ status: learner.kind })
    const exams = await listExams(learner.platformChatId)
    if (exams === null) return NextResponse.json({ status: "not_connected" })
    return NextResponse.json({ status: "ready", exams })
  } catch (err) {
    console.error("[nova/exams]", err instanceof Error ? err.name : "error")
    return NextResponse.json({ error: "Failed to load exams" }, { status: 500 })
  }
}

const fail = (status: number, error: string, message: string) => NextResponse.json({ ok: false, error, message }, { status })

const REFUSAL: Record<string, string> = {
  no_title:    "Give the date a name.",
  bad_date:    "That isn't a date Nova can read.",
  in_the_past: "That date has already passed.",
  too_far:     "That date is more than a year away.",
}

// POST /api/nova/exams  { title, date, kind?, subjectName? }
// Adds one dated deadline (an exam, assignment, project, interview,
// certification or other date), from the calendar or anywhere the learner
// confirms one. The learner's click is the confirmation. It goes through
// addExam, the one writer, which refuses a duplicate: the same subject (or,
// with none, any date) already on that day answers "exists" and adds nothing.
// Response: { ok: true, status: "added" | "exists", title, date } or a refusal.
export async function POST(req: Request) {
  try {
    const learner = await resolveNovaLearner()
    if (learner.kind === "unauthenticated") return fail(401, "unauthenticated", "Sign in again to add a date.")
    if (learner.kind !== "learner") return fail(409, learner.kind, "Dates are part of Nova, which this account isn't using.")
    const read = await readSmallJson(req, EXAM_BODY_MAX_BYTES)
    if (!read.ok) return fail(read.reason === "too_large" ? 413 : 422, read.reason === "too_large" ? "too_large" : "invalid", "That isn't a date Nova can add.")
    const body = (read.body && typeof read.body === "object" ? read.body : {}) as { title?: unknown; date?: unknown; kind?: unknown; subjectName?: unknown }
    const kind = body.kind === undefined ? "exam" : parseDeadlineType(body.kind)
    if (!kind) return fail(422, "invalid", "Choose what kind of date it is.")
    if (typeof body.title !== "string" || typeof body.date !== "string") return fail(422, "invalid", "Give the date a name and a day.")
    const subjectName = typeof body.subjectName === "string" && body.subjectName.trim() ? body.subjectName.trim().slice(0, 80) : null
    const result = await addExam(learner.platformChatId, { title: body.title, date: body.date, kind, subjectName })
    if (result.status === "not_ready") return fail(409, "not_connected", "Finish setting up with Nova first.")
    if (result.status === "invalid") return fail(422, result.reason, REFUSAL[result.reason] ?? "That date wasn't added.")
    return NextResponse.json({ ok: true, ...result }, { status: result.status === "added" ? 201 : 200 })
  } catch (err) {
    console.error("[nova/exams]", err instanceof Error ? err.name : "error")
    return fail(500, "failed", "That date wasn't added. Try again.")
  }
}
