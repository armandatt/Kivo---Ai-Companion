// ─── Reality Store ────────────────────────────────────────────────────────────
// SKILL.md §9, §16.4 — owner of Nova's writes to the shared UserReality table.
// Lifecycle: active → resolved (the user said it ended) | expired (TTL elapsed).
// Writes only what the consolidator decided.

import { prisma } from "@repo/db/client";
import type { ConsolidationDecision, StoredReality } from "../../types/consolidation.types";
import { normalizeStoredReality } from "../../types/reality.types";
import { appendProvenance, sourceMessageIds } from "./provenance";
import type { Db } from "./db";

// Every row still flagged active, including ones past their TTL, so the
// consolidator can resolve or expire them. Categories are normalized to the
// canonical vocabulary so legacy rows match new evidence.
export async function loadActiveRealityRows(userId: string): Promise<StoredReality[]> {
  const rows = await prisma.userReality.findMany({
    where:   { userId, isActive: true },
    orderBy: { createdAt: "desc" },
    take:    50,
    select:  {
      id: true, category: true, subtype: true, fact: true,
      confidence: true, expiresAt: true, provenance: true,
    },
  });
  return rows.map(r => ({
    id: r.id, fact: r.fact, confidence: r.confidence, expiresAt: r.expiresAt,
    ...normalizeStoredReality(r.category, r.subtype),
    sourceMessageIds: sourceMessageIds(r.provenance),
  }));
}

export async function applyRealityDecision(
  db:       Db,
  userId:   string,
  decision: ConsolidationDecision,
  now:      Date,
): Promise<void> {
  const w = decision.write?.target === "reality" ? decision.write : null;

  switch (decision.action) {
    case "CREATE":
      if (!w) return;
      await db.userReality.create({
        data: {
          userId, category: w.category, subtype: w.subtype, fact: w.description,
          sourceText: w.sourceText, confidence: w.confidence, expiresAt: w.expiresAt,
          provenance: appendProvenance(null, decision.provenance, null, now),
        },
      });
      return;

    case "UPDATE": {
      if (!w || !decision.targetId) return;
      const prior = await db.userReality.findUnique({
        where: { id: decision.targetId }, select: { provenance: true },
      });
      await db.userReality.update({
        where: { id: decision.targetId },
        data:  {
          category: w.category, subtype: w.subtype, fact: w.description,
          sourceText: w.sourceText, confidence: w.confidence, expiresAt: w.expiresAt,
          provenance: appendProvenance(prior?.provenance, decision.provenance, w.supersedes, now),
        },
      });
      return;
    }

    case "RESOLVE": {
      if (!decision.targetId) return;
      const prior = await db.userReality.findUnique({
        where: { id: decision.targetId }, select: { provenance: true },
      });
      await db.userReality.update({
        where: { id: decision.targetId },
        data:  {
          isActive: false, resolvedAt: now,
          provenance: appendProvenance(prior?.provenance, decision.provenance, null, now),
        },
      });
      return;
    }

    case "EXPIRE":
      if (!decision.targetId) return;
      await db.userReality.update({
        where: { id: decision.targetId },
        data:  { isActive: false },
      });
      return;

    default:
      return;
  }
}
