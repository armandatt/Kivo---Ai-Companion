// ─── Evidence Builder ─────────────────────────────────────────────────────────
// Turns one turn's engine outputs into Evidence. Pure: no DB, no LLM.
// This is the upstream side of the consolidation boundary. Nothing here
// decides what becomes durable.
// Owner: Consolidation layer.

import type { DetectedSignal, PatternAnalysis } from "../types/engine.types";
import type { AcademicUnderstanding } from "../types/understanding.types";
import { isCorroborated } from "../engines/signal-corroboration";
import type { ResponseBrainOutput } from "../types/response.types";
import { isNovaRealityCategory, normalizeStoredReality, normalizeSubtype } from "../types/reality.types";
import type { Evidence } from "../types/consolidation.types";
import { UNFLAGGED_DISCLOSURE_PENALTY } from "./policies/reality-policy";

export interface TurnEvidenceInput {
  userId:          string;
  profileId:       string | null;
  sourceMessageId: string | null;
  userText:        string;
  observedAt:      Date;
  signals:         DetectedSignal[];
  understanding:   AcademicUnderstanding;
  patterns:        PatternAnalysis;
  // null when no reply was generated (a session command from the web app).
  brainOutput:     ResponseBrainOutput | null;
}

export function buildTurnEvidence(input: TurnEvidenceInput): Evidence[] {
  const base = {
    companion:       "nova" as const,
    userId:          input.userId,
    profileId:       input.profileId,
    observedAt:      input.observedAt,
    sourceMessageId: input.sourceMessageId,
    sourceText:      input.userText.slice(0, 300),
  };

  const evidence: Evidence[] = [];

  for (const s of input.signals) {
    evidence.push({
      ...base,
      kind:         "signal",
      source:       "signal_engine",
      confidence:   s.confidence,
      signalType:   s.type,
      intensity:    s.intensity,
      // The orchestrator passes established signals only, so this is true
      // in the live path. It is recomputed here so that evidence built from
      // any other signal list is still weighed honestly.
      corroborated: s.evidence === "command" || s.evidence === "understanding"
        || isCorroborated(s.type, input.understanding),
      topic:        input.understanding.topic,
    });
  }

  for (const p of input.patterns.detectedPatterns) {
    evidence.push({
      ...base,
      kind:        "pattern_detection",
      source:      "pattern_detector",
      confidence:  p.confidence,
      patternType: p.type,
      description: p.recommendation,
      supporting:  p.evidence,
    });
  }

  // Reality: what the Understanding Brain read as a disclosed circumstance.
  // It reports; consolidation decides whether UserReality changes.
  const flagged = input.understanding.disclosureClass !== "none";
  for (const obs of input.understanding.realityObservations ?? []) {
    if (obs.status === "resolved") {
      evidence.push({
        ...base,
        kind:       "reality_resolution",
        source:     "understanding_brain",
        confidence: obs.confidence,
        category:   obs.category,
        subtype:    obs.subtype,
      });
    } else {
      evidence.push({
        ...base,
        kind:        "reality_claim",
        source:      "understanding_brain",
        confidence:  flagged ? obs.confidence : obs.confidence * UNFLAGGED_DISCLOSURE_PENALTY,
        category:    obs.category,
        subtype:     obs.subtype,
        description: obs.claim,
        persistence: obs.persistence,
        expectedDurationHours: obs.expectedDurationHours,
      });
    }
  }

  const inv = input.brainOutput?.investigationUpdate;
  if (inv && input.brainOutput) {
    evidence.push({
      ...base,
      kind:       "investigation_update",
      source:     "response_brain",
      confidence: input.brainOutput.confidence,
      topic:      inv.topic ?? null,
      status:     inv.status ?? null,
      hypotheses: inv.hypotheses ?? null,
    });
  }

  return evidence;
}

// Onboarding extraction is LLM output too: it produces claims, not rows.
// What a student states at onboarding (a job, a commute, a condition) is a
// standing constraint.
export function buildOnboardingRealityEvidence(input: {
  userId:       string;
  profileId:    string | null;
  observedAt:   Date;
  confidence:   number;
  realityFacts: Array<{ category: string; description: string }>;
}): Evidence[] {
  return input.realityFacts.flatMap((rf): Evidence[] => {
    const { category, subtype } = normalizeStoredReality(rf.category, null);
    if (!isNovaRealityCategory(category)) return [];
    return [{
      companion:       "nova",
      userId:          input.userId,
      profileId:       input.profileId,
      observedAt:      input.observedAt,
      sourceMessageId: null,
      sourceText:      rf.description,
      kind:            "reality_claim",
      source:          "onboarding_extractor",
      confidence:      input.confidence,
      category,
      subtype:         normalizeSubtype(category, subtype),
      description:     rf.description,
      persistence:     "standing",
      expectedDurationHours: null,
    }];
  });
}
