// ─── Memory Adapter ───────────────────────────────────────────────────────────
// Read side of the UserFact store: scored retrieval for the current turn.
// SKILL.md §11: UserFacts = scored retrieval, CognitiveState = typed retrieval.
// Read-only. Facts are written by the consolidation layer and nowhere else.
// Owner: Memory Adapter. No LLM calls.

import { prisma } from "@repo/db/client";
import type { NovaUserFact, NovaCognitiveState } from "../types/memory.types";
import { MEMORY_INTENT_OVERLAP } from "../types/memory.types";
import type { AcademicUnderstanding } from "../types/understanding.types";

// ── Retrieve relevant memories ─────────────────────────────────────────────────

export async function getRelevantMemories(
  userId:        string,
  understanding: AcademicUnderstanding,
  limit = 6,
): Promise<{ top: NovaUserFact[]; contrastive: NovaUserFact[] }> {
  const facts = await prisma.userFact.findMany({
    where:   { userId, status: "active" },
    orderBy: { lastObservedAt: "desc" },
    take:    50,
  });

  const scored = facts.map(f => {
    let score = 0;

    const intentOverlap = MEMORY_INTENT_OVERLAP[understanding.intent];
    if (intentOverlap?.includes(f.type as NovaUserFact["factType"])) score += 20;

    const ageDays = (Date.now() - f.lastObservedAt.getTime()) / 86_400_000;
    score += Math.max(0, 30 - ageDays * 0.5);

    score += f.confidence * 15;

    if (understanding.topic && f.value.toLowerCase().includes(understanding.topic.toLowerCase())) {
      score += 25;
    }

    return { fact: f, score };
  });

  scored.sort((a, b) => b.score - a.score);

  const toFact = (s: { fact: typeof facts[0]; score: number }): NovaUserFact => ({
    factType:      s.fact.type as NovaUserFact["factType"],
    key:           s.fact.key,
    value:         s.fact.value,
    confidence:    s.fact.confidence,
    relevance:     Math.min(1, s.score / 100),
    lastUpdated:   s.fact.lastObservedAt,
    evidenceCount: s.fact.evidenceCount,
  });

  const top = scored.slice(0, limit).map(toFact);

  const contrastive = scored
    .filter(s => s.fact.type === "commitment" || s.fact.type === "commitment_breach")
    .slice(0, 2)
    .map(toFact);

  return { top, contrastive };
}

// ── Load cognitive state ──────────────────────────────────────────────────────

export async function loadCognitiveState(profileId: string): Promise<NovaCognitiveState> {
  const stored = await prisma.novaCognitiveState.findUnique({ where: { profileId } });

  return {
    investigationTopic:       stored?.investigationTopic ?? null,
    investigationHypotheses:  stored?.investigationHypotheses ?? [],
    investigationMissingData: stored?.investigationMissingData ?? [],
    investigationEvidence:    (stored?.investigationEvidence ?? null) as Record<string, string> | null,
    investigationAttempts:    stored?.investigationAttempts ?? 0,
    investigationStatus:      stored?.investigationStatus ?? null,
    investigationStartedAt:   stored?.investigationStartedAt ?? null,
    investigationUpdatedAt:   stored?.investigationUpdatedAt ?? null,
    followUpChecks:           stored?.followUpChecks ?? null,
    reasoningHistory:         stored?.reasoningHistory ?? null,
  };
}
