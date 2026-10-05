// ─── Reality Adapter ──────────────────────────────────────────────────────────
// SKILL.md §9 — reads UserReality constraints relevant to the current turn.
// Filters by isActive, TTL, and relevance to current intent.
// No LLM calls. Read-only — reality is written by the consolidation layer.
// Owner: Reality Adapter.

import { prisma } from "@repo/db/client";
import type { NovaRealityFact, RealityCategory } from "../types/reality.types";
import { REALITY_MIN_CONFIDENCE, REALITY_MIN_RELEVANCE, normalizeStoredReality } from "../types/reality.types";
import type { AcademicUnderstanding } from "../types/understanding.types";

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
    .map(r => {
      const { category, subtype } = normalizeStoredReality(r.category, r.subtype);
      return {
        id:          r.id,
        category,
        subtype,
        description: r.fact,
        confidence:  r.confidence,
        relevance:   computeRelevance(category, subtype, understanding),
        expiresAt:   r.expiresAt,
        sourceText:  r.sourceText ?? null,
      };
    })
    .filter(f => f.relevance >= REALITY_MIN_RELEVANCE)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, 5);

  return facts;
}

// ── Relevance scoring (deterministic) ─────────────────────────────────────────

function computeRelevance(
  category:      RealityCategory,
  subtype:       string | null,
  understanding: AcademicUnderstanding,
): number {
  if (category === "academic_constraint") return 0.9;

  const planning = ["plan_request", "schedule_query"].includes(understanding.intent);
  const strained = understanding.disclosureClass !== "none" || understanding.emotion === "overwhelmed";

  if (category === "life_constraint") {
    if (planning) return 0.85;
    if (subtype === "work" && ["study_skip_report", "excuse"].includes(understanding.intent)) return 0.75;
    return 0.4;
  }

  if ((category === "health" || category === "injury" || category === "emotional") && (strained || planning)) {
    return 0.8;
  }

  return 0.4;
}
