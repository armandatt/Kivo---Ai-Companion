// ─── Consolidation Job Store ──────────────────────────────────────────────────
// Infrastructure state: the retry record for one turn's consolidation.
//
//   pending ──claim──▶ processing ──commit──▶ completed
//                          │
//                          └─ error / crash ─▶ failed, or a lease that runs out
//                                              (both claimable again)
//
// Every transition is a single conditional UPDATE, so two workers can never
// hold the same job. No rules about evidence live here.

import { prisma } from "@repo/db/client";
import type { Db } from "./db";
import type { Evidence } from "../../types/consolidation.types";

export const MAX_ATTEMPTS        = 5;
export const LEASE_MS            = 5 * 60_000;   // a processing job older than this was abandoned
export const RETRY_AFTER_MS      = 60_000;       // leave fresh pending jobs to their own turn
export const COMPLETED_RETENTION_MS = 30 * 86_400_000;

export interface JobPayload {
  profileId:        string | null;
  evidence:         Evidence[];
  patternScanRan:   boolean;
  hasActiveSession: boolean;
}

// Evidence travels through JSON; dates come back as strings.
function reviveEvidence(raw: unknown): Evidence[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Array<Record<string, unknown>>).map(e => ({
    ...e,
    observedAt: new Date(String(e["observedAt"])),
  })) as unknown as Evidence[];
}

// Returns false when the turn already has a job: it was enqueued before.
export async function enqueueJob(messageId: string, userId: string, payload: JobPayload): Promise<boolean> {
  try {
    await prisma.novaConsolidationJob.create({
      data: { messageId, userId, status: "pending", payload: JSON.parse(JSON.stringify(payload)) as object },
    });
    return true;
  } catch (err) {
    if ((err as { code?: string } | null)?.code === "P2002") return false;
    throw err;
  }
}

// Atomic claim. Succeeds for a pending or failed job, or a processing job
// whose lease ran out, while attempts remain. Returns the payload, or null if
// someone else holds the job or it is finished.
export async function claimJob(messageId: string, now: Date): Promise<JobPayload | null> {
  const claimed = await prisma.novaConsolidationJob.updateMany({
    where: {
      messageId,
      attempts: { lt: MAX_ATTEMPTS },
      OR: [
        { status: { in: ["pending", "failed"] } },
        { status: "processing", claimedAt: { lt: new Date(now.getTime() - LEASE_MS) } },
      ],
    },
    data: { status: "processing", claimedAt: now, attempts: { increment: 1 } },
  });
  if (claimed.count !== 1) return null;

  const job = await prisma.novaConsolidationJob.findUnique({ where: { messageId }, select: { payload: true } });
  const p = (job?.payload ?? null) as Record<string, unknown> | null;
  if (!p) return { profileId: null, evidence: [], patternScanRan: false, hasActiveSession: false };

  return {
    profileId:        typeof p["profileId"] === "string" ? p["profileId"] : null,
    evidence:         reviveEvidence(p["evidence"]),
    patternScanRan:   p["patternScanRan"] === true,
    hasActiveSession: p["hasActiveSession"] === true,
  };
}

// Called inside the same transaction as the state writes: the job is
// completed if and only if those writes committed. The payload is emptied,
// since evidence is not kept once it has been consolidated.
export async function completeJob(db: Db, messageId: string, now: Date): Promise<void> {
  await db.novaConsolidationJob.update({
    where: { messageId },
    data:  { status: "completed", completedAt: now, payload: {}, lastError: null },
  });
}

export async function failJob(messageId: string, error: unknown): Promise<void> {
  await prisma.novaConsolidationJob.update({
    where: { messageId },
    data:  { status: "failed", lastError: String((error as Error)?.message ?? error).slice(0, 2000) },
  }).catch(err => console.error("[nova:consolidation] could not record job failure", err));
}

// Jobs a worker should pick up: failed, abandoned mid-attempt, or pending and
// never started. Jobs out of attempts stay "failed" and visible.
export async function findRetryableJobs(now: Date, limit: number): Promise<Array<{ messageId: string; userId: string }>> {
  return prisma.novaConsolidationJob.findMany({
    where: {
      attempts: { lt: MAX_ATTEMPTS },
      OR: [
        { status: "failed" },
        { status: "pending",    createdAt: { lt: new Date(now.getTime() - RETRY_AFTER_MS) } },
        { status: "processing", claimedAt: { lt: new Date(now.getTime() - LEASE_MS) } },
      ],
    },
    orderBy: { createdAt: "asc" },
    take:    limit,
    select:  { messageId: true, userId: true },
  });
}

export async function purgeCompletedJobs(now: Date): Promise<number> {
  const removed = await prisma.novaConsolidationJob.deleteMany({
    where: { status: "completed", completedAt: { lt: new Date(now.getTime() - COMPLETED_RETENTION_MS) } },
  });
  return removed.count;
}
