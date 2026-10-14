import { NextResponse } from "next/server"
//@ts-ignore
import { removeExam, updateExam } from "@repo/api/nova/product/exams"
//@ts-ignore
import { EXAM_BODY_MAX_BYTES } from "@repo/api/nova/product/exams.types"
import { readSmallJson } from "../../../../../lib/nova/extension-access"
import { resolveNovaLearner } from "../../../../../lib/nova/resolve-learner"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string }> }

const fail = (status: number, error: string, message: string) => NextResponse.json({ ok: false, error, message }, { status })

// One exam. The id selects among the signed-in learner's own exams only:
// another learner's exam is "not found", whether it exists or not.
const NOT_FOUND = () => fail(404, "not_found", "That exam isn't on your record.")

const REFUSAL: Record<string, string> = {
  invalid:     "That isn't a change Nova can make to an exam.",
  no_title:    "An exam needs a name.",
  bad_date:    "That isn't a date Nova can read.",
  in_the_past: "That date has already passed.",
  too_far:     "That date is more than a year away.",
  duplicate:   "That subject already has an exam on that day.",
}

async function learnerOrDenied() {
  const learner = await resolveNovaLearner()
  if (learner.kind === "unauthenticated") return { denied: fail(401, "unauthenticated", "Sign in again to change your exams.") }
  if (learner.kind !== "learner") return { denied: fail(409, learner.kind, "Exam dates are part of Nova, which this account isn't using.") }
  return { platformChatId: learner.platformChatId }
}

// PATCH /api/nova/exams/:id  { title?, date? }   Response: ExamResponse
// Only `title` and `date` are read. A date is a calendar day, YYYY-MM-DD.
export async function PATCH(req: Request, { params }: Context) {
  try {
    const access = await learnerOrDenied()
    if (access.denied) return access.denied
    const read = await readSmallJson(req, EXAM_BODY_MAX_BYTES)
    if (!read.ok) {
      return read.reason === "too_large"
        ? fail(413, "too_large", "That's more than an exam's name and date. Nothing was changed.")
        : fail(422, "invalid", REFUSAL.invalid!)
    }
    const result = await updateExam(access.platformChatId, (await params).id, read.body)
    if (result.status === "saved") return NextResponse.json({ ok: true, exams: result.exams })
    if (result.status === "not_ready") return fail(409, "not_connected", "Nova isn't set up for this account yet.")
    if (result.status === "invalid") return fail(422, result.reason, REFUSAL[result.reason] ?? REFUSAL.invalid!)
    return NOT_FOUND()
  } catch (err) {
    console.error("[nova/exams/:id]", err instanceof Error ? err.name : "error")
    return fail(500, "failed", "That change wasn't saved. Nothing was changed; try again.")
  }
}

// DELETE /api/nova/exams/:id   Response: ExamResponse
export async function DELETE(_req: Request, { params }: Context) {
  try {
    const access = await learnerOrDenied()
    if (access.denied) return access.denied
    const result = await removeExam(access.platformChatId, (await params).id)
    if (result.status === "removed") return NextResponse.json({ ok: true, exams: result.exams })
    if (result.status === "not_ready") return fail(409, "not_connected", "Nova isn't set up for this account yet.")
    return NOT_FOUND()
  } catch (err) {
    console.error("[nova/exams/:id]", err instanceof Error ? err.name : "error")
    return fail(500, "failed", "The exam wasn't removed. Nothing was changed; try again.")
  }
}
