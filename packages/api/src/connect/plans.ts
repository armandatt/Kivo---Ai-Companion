// ─── Kivo Connect: preview, approve, execute ──────────────────────────────────
// A bulk, structural or destructive change is never made in one call. The
// server enforces it, not the assistant's instructions:
//   1. preview_knowledge_changes checks the changes against the learner's
//      records, writes nothing, and returns a plan id: an HMAC (server
//      secret) over the account, the exact changes, the structure version,
//      the version of every note they touch, and an expiry.
//   2. A human approves it: on Kivo (/connect/approve?plan=<id>, signed-in
//      learner only), or in the assistant's own confirmation prompt when the
//      client supports MCP elicitation. Approving on Kivo applies the plan
//      there and then when the plan carries no note text (approveAndApply),
//      so the learner never has to go back and say "go ahead"; the assistant
//      reads the outcome with check_approval. Declining is recorded and the
//      plan can never run.
//   3. execute_knowledge_changes is given the id and the same changes. The id
//      is recomputed from the records as they are now: other changes, or
//      anything changed in between, give another id and nothing runs
//      ("changed": preview again). A plan runs once.

import { createHmac, timingSafeEqual } from "node:crypto";
import { serverSecret } from "../auth/secrets";
import { approvalNeeded, applyChanges, previewChanges, stateOf, type ApprovalItem, type Change, type ChangeReport } from "./changes";
import { approvePendingPlan, finishKeyed, markPlanApplied, pendingPlan, priorResult, recordKeyed, storePendingPlan } from "./audit";

export const PLAN_MINUTES = 30;

// The same changes always read the same, whatever order their keys arrive
// in (Postgres JSONB reorders keys; a client may too). Undefined is absent.
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v as object).filter(k => (v as Record<string, unknown>)[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
}

export function planIdOf(userId: string, structureVersion: string, notes: Array<{ id: string; updatedAt: string }>, changes: Change[], expiresAt: string): string {
  const noteState = [...notes].sort((a, b) => a.id.localeCompare(b.id)).map(n => `${n.id}@${n.updatedAt}`).join(",");
  return createHmac("sha256", serverSecret())
    .update(`kivo-connect-plan:v1:${userId}:${structureVersion}:${noteState}:${expiresAt}:${canonical(changes)}`)
    .digest("hex").slice(0, 32);
}

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export interface PlanPreview {
  planId: string | null;
  expiresAt: string | null;
  approvalRequired: boolean;
  approvalReasons: string[];
  approveUrl: string | null;
  summary: string[];
  items: ApprovalItem[];
  report: ChangeReport;
}

// A plan whose changes carry note text is not kept on the server (the audit
// table holds no content): the assistant sends the changes again to run it.
const holdsText = (changes: Change[]) => changes.some(c => c.op === "create_note" || c.op === "append_to_note" || c.op === "insert_into_note" || c.op === "replace_note_body" || c.op === "edit_note_text");

export async function preview(ctx: { userId: string; grantId: string; profileId: string; clientName: string; origin: string }, changes: Change[], now = new Date()): Promise<PlanPreview> {
  const { report, summary, items, state } = await previewChanges(ctx.profileId, changes);
  const approval = approvalNeeded(changes);
  if (report.status === "failed") return { planId: null, expiresAt: null, approvalRequired: approval.needed, approvalReasons: approval.why, approveUrl: null, summary, items, report };
  const expiresAt = new Date(now.getTime() + PLAN_MINUTES * 60_000).toISOString();
  const planId = planIdOf(ctx.userId, state.structure.version, state.notes, changes, expiresAt);
  await storePendingPlan(ctx.userId, ctx.grantId, { planId, summary, items, expiresAt, client: ctx.clientName, ...(approval.needed && !holdsText(changes) ? { changes } : {}) });
  return { planId, expiresAt, approvalRequired: approval.needed, approvalReasons: approval.why, approveUrl: `${ctx.origin}/connect/approve?plan=${planId}`, summary, items, report };
}

export type ExecuteOutcome =
  | { status: "executed"; report: ChangeReport }
  | { status: "already_executed"; report: unknown }
  | { status: "approval_required"; approveUrl: string; message: string }
  | { status: "expired" | "unknown_plan" | "declined"; message: string }
  | { status: "changed"; message: string; preview: PlanPreview };

// confirm: asks the human in the assistant's own UI (MCP elicitation). null
// when the client cannot ask; then only an approval on Kivo counts.
export async function execute(
  ctx: { userId: string; grantId: string; profileId: string; clientName: string; origin: string },
  input: { planId: string; expiresAt: string; changes: Change[] },
  confirm: ((summary: string[]) => Promise<boolean | null>) | null,
  now = new Date(),
): Promise<ExecuteOutcome> {
  const prior = await priorResult(ctx.userId, `plan:${input.planId}`);
  if (prior) return { status: "already_executed", report: prior.result };
  const pending = await pendingPlan(ctx.userId, input.planId);
  if (!pending) return { status: "unknown_plan", message: "No preview with that plan id exists for this account. Call preview_knowledge_changes first." };
  if (pending.declinedAt) return { status: "declined", message: "The learner declined these changes on Kivo. Nothing was done; do not try again unless they ask." };
  if (new Date(input.expiresAt).getTime() !== new Date(pending.expiresAt).getTime()) return { status: "unknown_plan", message: "expiresAt does not match the preview. Send exactly what the preview returned." };
  if (new Date(pending.expiresAt) < now) return { status: "expired", message: "That preview has expired. Preview the changes again." };

  // The same changes, against the same records.
  const state = await stateOf(ctx.profileId, input.changes);
  const expected = planIdOf(ctx.userId, state.structure.version, state.notes, input.changes, pending.expiresAt);
  if (!same(expected, input.planId)) {
    return { status: "changed", message: "The changes sent differ from the preview, or the learner's notes or map changed since. Nothing was done; here is a fresh preview.", preview: await preview(ctx, input.changes, now) };
  }

  const needs = approvalNeeded(input.changes).needed;
  if (needs && !pending.approvedAt) {
    const answer = confirm ? await confirm(pending.summary) : null;
    if (answer !== true) {
      return { status: "approval_required", approveUrl: `${ctx.origin}/connect/approve?plan=${input.planId}`, message: answer === false ? "The learner declined these changes. Nothing was done." : "These changes need the learner's approval. Ask them to open the link, review and approve, then call execute_knowledge_changes again with the same arguments." };
    }
  }

  // Claimed before anything is applied: a second call with this plan, at the
  // same moment or later, gets this run's result and runs nothing.
  const claim = await recordKeyed({ userId: ctx.userId, grantId: ctx.grantId, tool: "execute_knowledge_changes", outcome: "partial", key: `plan:${input.planId}`, result: { status: "running" } });
  if (claim === "duplicate") return { status: "already_executed", report: (await priorResult(ctx.userId, `plan:${input.planId}`))?.result };
  const report = await applyChanges(ctx.profileId, input.changes, { expectVersion: state.structure.version });
  if (report.status === "conflict") {
    await finishKeyed(ctx.userId, `plan:${input.planId}`, "conflict", report);
    return { status: "changed", message: "The learner's subjects changed while this was starting. Nothing was done; preview again.", preview: await preview(ctx, input.changes, now) };
  }
  const outcome = report.status === "completed" ? "ok" : report.status === "failed" ? "failed" : "partial";
  await finishKeyed(ctx.userId, `plan:${input.planId}`, outcome, report, { items: report.items.filter(i => i.resource).map(i => ({ op: i.op, status: i.status, type: i.resource!.type, id: i.resource!.id })) });
  await markPlanApplied(ctx.userId, input.planId);
  return { status: "executed", report };
}

// ── The learner's click on Kivo ──────────────────────────────────────────────
// Approve, and when the plan's changes are kept, apply them now, through the
// same execute (plan id recomputed from the records as they are now, claimed
// once). A plan without kept changes is only approved: the assistant runs it.

export type ApproveOutcome =
  | { status: "applied"; report: ChangeReport | unknown }
  | { status: "approved"; message: string }
  | { status: "changed"; message: string }
  | { status: "expired" | "not_found" | "declined" | "failed"; message: string };

export async function approveAndApply(
  ctx: { userId: string; profileId: string; origin: string },
  planId: string,
  now = new Date(),
): Promise<ApproveOutcome> {
  const approved = await approvePendingPlan(ctx.userId, planId, now);
  if (approved === "not_found") return { status: "not_found", message: "There is no such plan for this account." };
  if (approved === "expired") return { status: "expired", message: "This plan has expired. Ask your assistant to preview the changes again." };
  if (approved === "declined") return { status: "declined", message: "You declined this plan; it can't be applied." };
  const plan = await pendingPlan(ctx.userId, planId);
  const prior = await priorResult(ctx.userId, `plan:${planId}`);
  if (prior) return { status: "applied", report: prior.result };
  if (!plan?.changes?.length) return { status: "approved", message: "Approved. Go back to your assistant: it will apply exactly these changes once." };
  const out = await execute(
    { userId: ctx.userId, grantId: (plan.grantId ?? null) as string, profileId: ctx.profileId, clientName: plan.client, origin: ctx.origin },
    { planId, expiresAt: plan.expiresAt, changes: plan.changes as Change[] },
    null, now,
  );
  switch (out.status) {
    case "executed":         return { status: "applied", report: out.report };
    case "already_executed": return { status: "applied", report: out.report };
    case "changed":          return { status: "changed", message: "Your Kivo changed after this was proposed, so nothing was done. Ask your assistant to look again." };
    default:                 return { status: "failed", message: "message" in out ? out.message : "Nothing was changed." };
  }
}

// What happened to a plan, for the assistant (check_approval). Read-only.
export type PlanStatus =
  | { status: "waiting"; approveUrl: string; expiresAt: string; summary: string[] }
  | { status: "approved"; message: string }
  | { status: "applied"; report: unknown }
  | { status: "declined" | "expired" | "unknown_plan"; message: string };

export async function planStatus(ctx: { userId: string; origin: string }, planId: string, now = new Date()): Promise<PlanStatus> {
  const [plan, prior] = await Promise.all([pendingPlan(ctx.userId, planId), priorResult(ctx.userId, `plan:${planId}`)]);
  if (prior && (prior.result as { status?: string } | null)?.status !== "running") return { status: "applied", report: prior.result };
  if (!plan) return { status: "unknown_plan", message: "No plan with that id exists for this account." };
  if (plan.declinedAt) return { status: "declined", message: "The learner declined these changes. Nothing was done." };
  if (plan.approvedAt) return { status: "approved", message: "Approved but not applied yet: call execute_knowledge_changes with planId, expiresAt and the same changes." };
  if (new Date(plan.expiresAt) < now) return { status: "expired", message: "The plan expired before the learner approved it. Nothing was done." };
  return { status: "waiting", approveUrl: `${ctx.origin}/connect/approve?plan=${planId}`, expiresAt: plan.expiresAt, summary: plan.summary };
}
