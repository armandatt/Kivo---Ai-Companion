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

export interface PendingPlan { planId: string; summary: string[]; expiresAt: string; client: string; approvedAt: string | null }

export async function storePendingPlan(userId: string, grantId: string | null, plan: Omit<PendingPlan, "approvedAt">): Promise<void> {
  await prisma.novaConnectAudit.upsert({
    where:  { userId_idempotencyKey: { userId, idempotencyKey: `pending:${plan.planId}` } },
    create: { userId, grantId, tool: "preview_knowledge_changes", outcome: "pending", idempotencyKey: `pending:${plan.planId}`, result: { ...plan, approvedAt: null } as object },
    update: {},
  });
}

export async function pendingPlan(userId: string, planId: string): Promise<PendingPlan | null> {
  if (typeof planId !== "string" || !/^[a-f0-9]{32}$/.test(planId)) return null;
  const row = await prisma.novaConnectAudit.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey: `pending:${planId}` } }, select: { result: true, outcome: true } });
  return row ? (row.result as unknown as PendingPlan) : null;
}

export async function approvePendingPlan(userId: string, planId: string, now = new Date()): Promise<"approved" | "expired" | "not_found"> {
  const plan = await pendingPlan(userId, planId);
  if (!plan) return "not_found";
  if (new Date(plan.expiresAt) < now) return "expired";
  if (plan.approvedAt) return "approved";
  await prisma.novaConnectAudit.updateMany({
    where: { userId, idempotencyKey: `pending:${planId}`, outcome: "pending" },
    data:  { outcome: "approved", result: { ...plan, approvedAt: now.toISOString() } as object },
  });
  return "approved";
}

// A keyed write's final result, after it was claimed with recordKeyed.
export async function finishKeyed(userId: string, key: string, outcome: AuditOutcome, result: unknown, resources?: Record<string, unknown>): Promise<void> {
  await prisma.novaConnectAudit.updateMany({ where: { userId, idempotencyKey: key }, data: { outcome, result: result as object, ...(resources ? { resources: resources as object } : {}) } });
}
