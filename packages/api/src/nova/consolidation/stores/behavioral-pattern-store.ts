// ─── BehavioralPattern Store ──────────────────────────────────────────────────
// SKILL.md §16.4 — owner of inferred recurring behavior.
// Lifecycle: emerging → active → weakening → resolved, or emerging → expired.
// Persistence only: strength and status are computed by the consolidator from
// consolidation/policies/pattern-policy.ts and stored as given.

import { prisma } from "@repo/db/client";
import type {
  ConsolidationDecision,
  PatternStatus,
  StoredPattern,
} from "../../types/consolidation.types";
import type { DetectedPattern, NovaPatternType } from "../../types/engine.types";
import { appendProvenance, readProvenance, sourceMessageIds } from "./provenance";
import type { Db } from "./db";

const COMPANION = "nova";
const LIVE_STATUSES = ["emerging", "active", "weakening"];

interface PatternEvidenceJson {
  supporting?: string[];
}

export async function loadPatterns(userId: string): Promise<StoredPattern[]> {
  const rows = await prisma.behavioralPattern.findMany({
    where:  { userId, companion: COMPANION },
    select: {
      id: true, patternType: true, status: true, evidenceCount: true, confidence: true,
      firstObservedAt: true, lastObservedAt: true, updatedAt: true, evidence: true,
    },
  });
  return rows.map(r => ({
    id: r.id, patternType: r.patternType, status: r.status as PatternStatus,
    evidenceCount: r.evidenceCount, confidence: r.confidence,
    firstObservedAt: r.firstObservedAt, lastObservedAt: r.lastObservedAt,
    lastChangedAt: r.updatedAt,
    sourceMessageIds: sourceMessageIds(r.evidence),
  }));
}

// Read side for the pattern detector: what has already been established,
// so it can report occurrence counts instead of starting from zero each turn.
export async function loadPriorPatterns(userId: string): Promise<DetectedPattern[]> {
  const rows = await prisma.behavioralPattern.findMany({
    where:  { userId, companion: COMPANION, status: { in: LIVE_STATUSES } },
    select: {
      patternType: true, confidence: true, severity: true, description: true,
      evidenceCount: true, firstObservedAt: true, evidence: true,
    },
  });
  return rows.map(r => ({
    type:           r.patternType as NovaPatternType,
    confidence:     r.confidence,
    severity:       r.severity as DetectedPattern["severity"],
    firstSeenAt:    r.firstObservedAt,
    occurrences:    r.evidenceCount,
    evidence:       ((r.evidence ?? null) as PatternEvidenceJson | null)?.supporting ?? [],
    recommendation: r.description,
  }));
}

export async function applyPatternDecision(
  db:       Db,
  userId:   string,
  decision: ConsolidationDecision,
  now:      Date,
): Promise<void> {
  if (decision.action === "IGNORE") return;
  const w = decision.write?.target === "behavioral_pattern" ? decision.write : null;

  if (decision.action === "CREATE") {
    if (!w) return;
    const data = {
      description: w.description ?? "", confidence: w.confidence, evidenceCount: w.evidenceCount,
      severity: w.severity, status: w.status, lastObservedAt: now,
      evidence: { ...appendProvenance(null, decision.provenance, null, now), supporting: w.supporting ?? [] },
    };
    await db.behavioralPattern.upsert({
      where:  { userId_companion_patternType: { userId, companion: COMPANION, patternType: w.patternType } },
      update: data,
      create: { userId, companion: COMPANION, patternType: w.patternType, firstObservedAt: now, ...data },
    });
    return;
  }

  if (!decision.targetId) return;
  const prior = await db.behavioralPattern.findUnique({
    where: { id: decision.targetId }, select: { evidence: true },
  });
  const priorSupporting = ((prior?.evidence ?? null) as PatternEvidenceJson | null)?.supporting ?? [];
  const evidence = {
    ...appendProvenance(readProvenance(prior?.evidence), decision.provenance, null, now),
    supporting: w?.supporting ?? priorSupporting,
  };

  // RESOLVE / EXPIRE with no write: time ran out, values stay as they were.
  const ended = decision.action === "RESOLVE" ? "resolved" : decision.action === "EXPIRE" ? "expired" : null;

  await db.behavioralPattern.update({
    where: { id: decision.targetId },
    data:  {
      ...(w ? {
        confidence: w.confidence, evidenceCount: w.evidenceCount, severity: w.severity,
        ...(w.description !== null ? { description: w.description } : {}),
        ...(w.observed ? { lastObservedAt: now } : {}),
      } : {}),
      status:     ended ?? w?.status ?? undefined,
      resolvedAt: decision.action === "RESOLVE" ? now : decision.action === "UPDATE" ? null : undefined,
      evidence,
    },
  });
}
