// ─── Memory Adapter ───────────────────────────────────────────────────────────
// Bridges NovaUserFact and NovaCognitiveState to the DB.
// Reuses Rex's MemoryFact table (userId + type + key as compound unique).
// SKILL.md §11: UserFacts = scored retrieval, CognitiveState = typed retrieval.
// Owner: Memory Adapter. No LLM calls.

import { prisma } from "@repo/db/client";
import type { NovaUserFact, NovaCognitiveState } from "../types/memory.types.js";
import { MEMORY_INTENT_OVERLAP } from "../types/memory.types.js";
import type { AcademicUnderstanding } from "../types/understanding.types.js";

// ── Retrieve relevant memories ─────────────────────────────────────────────────

export async function getRelevantMemories(
  userId:        string,
  understanding: AcademicUnderstanding,
  limit = 6,
): Promise<{ top: NovaUserFact[]; contrastive: NovaUserFact[] }> {
  const facts = await prisma.memoryFact.findMany({
    where:   { userId },
    orderBy: { createdAt: "desc" },
    take:    50,
  });

  const scored = facts.map(f => {
    let score = 0;

    const intentOverlap = MEMORY_INTENT_OVERLAP[understanding.intent];
    if (intentOverlap?.includes(f.type as NovaUserFact["factType"])) score += 20;

    const ageDays = (Date.now() - f.createdAt.getTime()) / 86_400_000;
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
    lastUpdated:   s.fact.createdAt,
    evidenceCount: 1,
  });

  const top = scored.slice(0, limit).map(toFact);

  const contrastive = scored
    .filter(s => s.fact.type === "commitment" || s.fact.type === "commitment_breach")
    .slice(0, 2)
    .map(toFact);

  return { top, contrastive };
}

// ── Write a memory fact ────────────────────────────────────────────────────────

export async function writeMemoryFact(
  userId:     string,
  factType:   string,
  key:        string,
  value:      string,
  confidence: number,
  upsert:     boolean,
): Promise<void> {
  if (upsert) {
    await prisma.memoryFact.upsert({
      where:  { userId_type_key: { userId, type: factType, key } },
      update: { value, confidence },
      create: { userId, type: factType, key, value, confidence },
    });
  } else {
    await prisma.memoryFact.create({
      data: { userId, type: factType, key, value, confidence },
    });
  }
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

// ── Persist cognitive state update (from Response Brain output) ────────────────

export async function persistCognitiveStateUpdate(
  profileId: string,
  update:    import("../types/response.types.js").ResponseBrainOutput["investigationUpdate"],
): Promise<void> {
  if (!update) return;

  await prisma.novaCognitiveState.upsert({
    where:  { profileId },
    update: {
      investigationTopic:       update.topic ?? undefined,
      investigationStatus:      update.status ?? undefined,
      investigationAttempts:    { increment: 1 },
      investigationHypotheses:  update.hypotheses ?? undefined,
      investigationUpdatedAt:   new Date(),
    },
    create: {
      profileId,
      investigationTopic:      update.topic ?? null,
      investigationStatus:     update.status ?? null,
      investigationAttempts:   1,
      investigationHypotheses: update.hypotheses ?? [],
    },
  });
}
