// ─── Reality Adapter ──────────────────────────────────────────────────────────
// SKILL.md §9 — reads UserReality constraints relevant to the current turn.
// Filters by isActive, TTL, and relevance to current intent.
// No LLM calls. No writes here — persistence layer handles that.
// Owner: Reality Adapter.

import { prisma } from "@repo/db/client";
import type { NovaRealityFact, RealityCategory } from "../types/reality.types.js";
import { REALITY_MIN_CONFIDENCE, REALITY_MIN_RELEVANCE } from "../types/reality.types.js";
import type { AcademicUnderstanding } from "../types/understanding.types.js";

// ── Load active reality facts ──────────────────────────────────────────────────

export async function loadActiveRealityFacts(
  userId:        string,
  understanding: AcademicUnderstanding,
): Promise<NovaRealityFact[]> {
  const now = new Date();

  const stored = await prisma.userReality.findMany({
    where: {
      userId,
      isActive:  true,
      expiresAt: { gte: now },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  const facts: NovaRealityFact[] = stored
    .filter(r => r.confidence >= REALITY_MIN_CONFIDENCE)
    .map(r => ({
      id:          r.id,
      category:    (r.category ?? "other") as RealityCategory,
      description: r.fact,
      confidence:  r.confidence,
      relevance:   computeRelevance(r.category ?? "other", understanding),
      expiresAt:   r.expiresAt,
      sourceText:  r.sourceText ?? null,
    }))
    .filter(f => f.relevance >= REALITY_MIN_RELEVANCE)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, 5);

  return facts;
}

// ── Relevance scoring (deterministic) ─────────────────────────────────────────

function computeRelevance(category: string, understanding: AcademicUnderstanding): number {
  if (category === "academic_constraint") return 0.9;

  if (category === "time_constraint" && ["plan_request", "schedule_query"].includes(understanding.intent)) {
    return 0.85;
  }

  if (category === "health_constraint" && (
    understanding.disclosureClass !== "none" ||
    understanding.emotion === "overwhelmed"
  )) return 0.8;

  if (category === "work_constraint" && ["study_skip_report", "plan_request", "excuse"].includes(understanding.intent)) {
    return 0.75;
  }

  return 0.4;
}

// ── Write a reality fact — semantic upsert by category ────────────────────────
// One active record per (userId, category). If one already exists:
//   - Same description → skip (no-op)
//   - Different description → update with new description, reset TTL
// This prevents duplicate long-lived constraints from repeated mentions.

export async function writeRealityFact(
  userId:      string,
  category:    RealityCategory,
  description: string,
  sourceText:  string,
  confidence:  number,
  ttlDays:     number,
): Promise<void> {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + ttlDays);

  const existing = await prisma.userReality.findFirst({
    where:   { userId, category, isActive: true },
    orderBy: { createdAt: "desc" },
    select:  { id: true, fact: true },
  });

  if (existing) {
    // Skip exact-duplicate writes
    if (existing.fact.trim() === description.trim()) return;

    // Update: new description supersedes old (student gave more detail)
    await prisma.userReality.update({
      where: { id: existing.id },
      data:  { fact: description, sourceText, confidence, expiresAt },
    });
  } else {
    await prisma.userReality.create({
      data: { userId, category, fact: description, sourceText, confidence, expiresAt },
    });
  }
}
