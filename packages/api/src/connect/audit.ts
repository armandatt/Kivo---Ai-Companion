// ─── Kivo Connect: the record of what assistants did ──────────────────────────
// The only writer of NovaConnectAudit. One row per write (and per refusal),
// naming the tool, the outcome and the ids touched: never note text, a
// prompt or a token. A write that carries an idempotency key runs once: a
// retry with the same key gets the first result back.

import { prisma } from "@repo/db/client";

export type AuditOutcome = "ok" | "partial" | "refused" | "failed" | "conflict";

export interface AuditEntry {
  userId: string;
  grantId: string | null;
  tool: string;
  outcome: AuditOutcome;
  resources?: Record<string, unknown> | null;
}

export async function recordAudit(e: AuditEntry): Promise<void> {
  await prisma.novaConnectAudit.create({
    data: { userId: e.userId, grantId: e.grantId, tool: e.tool, outcome: e.outcome, resources: (e.resources ?? undefined) as object | undefined },
  }).catch(err => console.error(JSON.stringify({ layer: "kivo_connect", event: "audit_failed", tool: e.tool, error: err instanceof Error ? err.name : "unknown" })));
}

export const IDEMPOTENCY_KEY_MAX = 120;
export const idempotencyKeyOk = (k: unknown): k is string => typeof k === "string" && k.length > 0 && k.length <= IDEMPOTENCY_KEY_MAX;

// The result a key already produced, if any.
export async function priorResult(userId: string, key: string): Promise<{ tool: string; result: unknown } | null> {
  const row = await prisma.novaConnectAudit.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey: key } }, select: { tool: true, result: true } });
  return row && row.result !== null ? { tool: row.tool, result: row.result } : null;
}

// Records a keyed write's result. Two calls racing with one key: the second
// insert fails on the unique key, and the caller reads the first's result.
export async function recordKeyed(e: AuditEntry & { key: string; result: unknown }): Promise<"recorded" | "duplicate"> {
  try {
    await prisma.novaConnectAudit.create({
      data: { userId: e.userId, grantId: e.grantId, tool: e.tool, outcome: e.outcome, resources: (e.resources ?? undefined) as object | undefined, idempotencyKey: e.key, result: e.result as object },
    });
    return "recorded";
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") return "duplicate";
    throw err;
  }
}

// Whether a reviewed plan was already executed (its id is used as the key).
export const planExecuted = async (userId: string, planId: string) => (await priorResult(userId, `plan:${planId}`)) !== null;

// ── Plans waiting for the learner's approval (plans.ts) ──────────────────────
// A previewed plan is one row (key "pending:<planId>"): what it will do, in
// sentences, and until when. Approval is a guarded write by the learner (on
// Kivo, or through their assistant's own confirmation prompt); executing
// is recorded under "plan:<planId>", so a plan runs once.

// items: the same changes as structured lines for the approval page.
// changes: kept only while the plan waits, and only when no change carries
// note text (no create_note / append_to_note), so the learner's approval on
// Kivo can apply it at once; removed when it runs or is declined.
export interface PendingPlan {
  planId: string; summary: string[]; expiresAt: string; client: string; approvedAt: string | null;
  items?: unknown[]; changes?: unknown[]; declinedAt?: string | null; appliedAt?: string | null;
}

export async function storePendingPlan(userId: string, grantId: string | null, plan: Omit<PendingPlan, "approvedAt">): Promise<void> {
  await prisma.novaConnectAudit.upsert({
    where:  { userId_idempotencyKey: { userId, idempotencyKey: `pending:${plan.planId}` } },
    create: { userId, grantId, tool: "preview_knowledge_changes", outcome: "pending", idempotencyKey: `pending:${plan.planId}`, result: { ...plan, approvedAt: null } as object },
    update: {},
  });
}

const PLAN_ID = (planId: unknown): planId is string => typeof planId === "string" && /^[a-f0-9]{32}$/.test(planId);

export async function pendingPlan(userId: string, planId: string): Promise<(PendingPlan & { grantId: string | null }) | null> {
  if (!PLAN_ID(planId)) return null;
  const row = await prisma.novaConnectAudit.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey: `pending:${planId}` } }, select: { result: true, outcome: true, grantId: true } });
  return row ? { ...(row.result as unknown as PendingPlan), grantId: row.grantId } : null;
}

export async function approvePendingPlan(userId: string, planId: string, now = new Date()): Promise<"approved" | "expired" | "not_found" | "declined"> {
  const plan = await pendingPlan(userId, planId);
  if (!plan) return "not_found";
  if (plan.declinedAt) return "declined";
  if (plan.approvedAt) return "approved";
  if (new Date(plan.expiresAt) < now) return "expired";
  const { grantId: _g, ...stored } = plan;
  const n = await prisma.novaConnectAudit.updateMany({
    where: { userId, idempotencyKey: `pending:${planId}`, outcome: "pending" },
    data:  { outcome: "approved", result: { ...stored, approvedAt: now.toISOString() } as object },
  });
  if (n.count === 0) return (await pendingPlan(userId, planId))?.declinedAt ? "declined" : "approved";
  return "approved";
}

// The learner said no. Guarded on the plan still waiting: a plan already
// approved (and so perhaps applied) is not declined after the fact.
export async function declinePendingPlan(userId: string, planId: string, now = new Date()): Promise<"declined" | "already_approved" | "not_found"> {
  const plan = await pendingPlan(userId, planId);
  if (!plan) return "not_found";
  if (plan.declinedAt) return "declined";
  const { grantId: _g, changes: _c, ...stored } = plan;
  const n = await prisma.novaConnectAudit.updateMany({
    where: { userId, idempotencyKey: `pending:${planId}`, outcome: "pending" },
    data:  { outcome: "declined", result: { ...stored, declinedAt: now.toISOString() } as object },
  });
  return n.count === 1 ? "declined" : "already_approved";
}

// Once a plan has run: its changes are no longer kept.
export async function markPlanApplied(userId: string, planId: string, now = new Date()): Promise<void> {
  const plan = await pendingPlan(userId, planId);
  if (!plan) return;
  const { grantId: _g, changes: _c, ...stored } = plan;
  await prisma.novaConnectAudit.updateMany({ where: { userId, idempotencyKey: `pending:${planId}` }, data: { result: { ...stored, appliedAt: now.toISOString() } as object } });
}

// A keyed write's final result, after it was claimed with recordKeyed.
export async function finishKeyed(userId: string, key: string, outcome: AuditOutcome, result: unknown, resources?: Record<string, unknown>): Promise<void> {
  await prisma.novaConnectAudit.updateMany({ where: { userId, idempotencyKey: key }, data: { outcome, result: result as object, ...(resources ? { resources: resources as object } : {}) } });
}
