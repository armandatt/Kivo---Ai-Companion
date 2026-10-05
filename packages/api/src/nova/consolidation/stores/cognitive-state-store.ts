// ─── Cognitive State Store ────────────────────────────────────────────────────
// SKILL.md §11.1, §16.4 — owner of Nova's investigation state.
// The Response Brain proposes an update; the consolidator validates it;
// this store writes it. Writes only what the consolidator decided.

import { prisma } from "@repo/db/client";
import type { ConsolidationDecision, StoredInvestigation } from "../../types/consolidation.types";
import type { Db } from "./db";

export async function loadInvestigation(profileId: string): Promise<StoredInvestigation | null> {
  const row = await prisma.novaCognitiveState.findUnique({
    where:  { profileId },
    select: { investigationTopic: true, investigationStatus: true, investigationUpdatedAt: true },
  });
  if (!row) return null;
  return {
    topic:     row.investigationTopic,
    status:    row.investigationStatus,
    updatedAt: row.investigationUpdatedAt,
  };
}

export async function applyInvestigationDecision(
  db:        Db,
  profileId: string,
  decision:  ConsolidationDecision,
  now:       Date,
): Promise<void> {
  const w = decision.write;
  if (w?.target !== "cognitive_state" || decision.action === "IGNORE") return;

  if (w.isNew) {
    const fresh = {
      investigationTopic:       w.topic,
      investigationStatus:      w.status,
      investigationHypotheses:  w.hypotheses ?? [],
      investigationMissingData: [],
      investigationAttempts:    1,
      investigationStartedAt:   now,
      investigationUpdatedAt:   now,
    };
    await db.novaCognitiveState.upsert({
      where:  { profileId },
      update: fresh,
      create: { profileId, ...fresh },
    });
    return;
  }

  await db.novaCognitiveState.update({
    where: { profileId },
    data:  {
      investigationStatus:     w.status,
      investigationHypotheses: w.hypotheses ?? undefined,
      investigationUpdatedAt:  now,
      ...(decision.action === "UPDATE" ? { investigationAttempts: { increment: 1 } } : {}),
    },
  });
}
