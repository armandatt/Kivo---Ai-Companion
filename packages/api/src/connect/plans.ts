// ─── Kivo Connect: preview, approve, execute ──────────────────────────────────
// A bulk, structural or destructive change is never made in one call. The
// server enforces it, not the assistant's instructions:
//   1. preview_knowledge_changes checks the changes against the learner's
//      records, writes nothing, and returns a plan id: an HMAC (server
//      secret) over the account, the exact changes, the structure version,
//      the version of every note they touch, and an expiry.
//   2. A human approves it: on Kivo (/connect/approve?plan=<id>, signed-in
//      learner only), or in the assistant's own confirmation prompt when the
//      client supports MCP elicitation.
//   3. execute_knowledge_changes is given the id and the same changes. The id
//      is recomputed from the records as they are now: other changes, or
//      anything changed in between, give another id and nothing runs
//      ("changed": preview again). A plan runs once.

import { createHmac, timingSafeEqual } from "node:crypto";
import { serverSecret } from "../auth/secrets";
import { approvalNeeded, applyChanges, previewChanges, stateOf, type Change, type ChangeReport } from "./changes";
import { finishKeyed, pendingPlan, priorResult, recordKeyed, storePendingPlan } from "./audit";

export const PLAN_MINUTES = 30;

export function planIdOf(userId: string, structureVersion: string, notes: Array<{ id: string; updatedAt: string }>, changes: Change[], expiresAt: string): string {
  const noteState = [...notes].sort((a, b) => a.id.localeCompare(b.id)).map(n => `${n.id}@${n.updatedAt}`).join(",");
  return createHmac("sha256", serverSecret())
    .update(`kivo-connect-plan:v1:${userId}:${structureVersion}:${noteState}:${expiresAt}:${JSON.stringify(changes)}`)
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
  report: ChangeReport;
}

export async function preview(ctx: { userId: string; grantId: string; profileId: string; clientName: string; origin: string }, changes: Change[], now = new Date()): Promise<PlanPreview> {
  const { report, summary, state } = await previewChanges(ctx.profileId, changes);
  const approval = approvalNeeded(changes);
  if (report.status === "failed") return { planId: null, expiresAt: null, approvalRequired: approval.needed, approvalReasons: approval.why, approveUrl: null, summary, report };
  const expiresAt = new Date(now.getTime() + PLAN_MINUTES * 60_000).toISOString();
  const planId = planIdOf(ctx.userId, state.structure.version, state.notes, changes, expiresAt);
  await storePendingPlan(ctx.userId, ctx.grantId, { planId, summary, expiresAt, client: ctx.clientName });
  return { planId, expiresAt, approvalRequired: approval.needed, approvalReasons: approval.why, approveUrl: `${ctx.origin}/connect/approve?plan=${planId}`, summary, report };
}

export type ExecuteOutcome =
  | { status: "executed"; report: ChangeReport }
  | { status: "already_executed"; report: unknown }
  | { status: "approval_required"; approveUrl: string; message: string }
  | { status: "expired" | "unknown_plan"; message: string }
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
  return { status: "executed", report };
}
