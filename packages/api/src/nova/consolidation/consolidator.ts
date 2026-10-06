// ─── Nova Consolidator ────────────────────────────────────────────────────────
// SKILL.md §11.7 — the only place that decides whether evidence becomes
// durable state. Pure and deterministic: no DB, no LLM, no clock (now is an
// input). The runner loads state, calls this, and hands decisions to stores.
//
// Every rule weighs: confidence, provenance, recency, repetition,
// contradiction, relevance, expiry/resolution. The numbers live in
// ./policies; this file is the decision structure.
//
// Idempotent: evidence from a message a row has already absorbed is ignored,
// so replaying a turn cannot duplicate state or inflate counts.
// Owner: Consolidation layer.

import type {
  ConsolidationDecision,
  ConsolidationInput,
  ConsolidationState,
  Evidence,
  InvestigationEvidence,
  PatternDetectionEvidence,
  Provenance,
  RealityClaimEvidence,
  RealityResolutionEvidence,
  SignalEvidence,
  StoredFact,
  StoredPattern,
  StoredReality,
} from "../types/consolidation.types";
import type { NovaPatternType } from "../types/engine.types";
import {
  REALITY_CONTRADICTION_MARGIN,
  REALITY_MIN_WRITE_CONFIDENCE,
  realityExpiry,
} from "./policies/reality-policy";
import {
  CONTRADICTING_SIGNALS,
  OBSERVATION_WINDOW_HOURS,
  QUIET_AFTER_DAYS,
  STALE_AFTER_DAYS,
  initialStrength,
  reinforcedStrength,
  severityFor,
  statusFor,
  weakenedStrength,
} from "./policies/pattern-policy";

// ── Thresholds ────────────────────────────────────────────────────────────────

// A regex match the Understanding Brain did not independently agree with.
export const UNCORROBORATED_PENALTY = 0.8;

export const FACT_MIN_CONFIDENCE          = 0.65;
export const ACADEMIC_MIN_CONFIDENCE      = 0.55;
export const INVESTIGATION_MIN_CONFIDENCE = 0.5;

// A weaker contradicting observation may not replace a stronger stored value…
export const CONTRADICTION_MARGIN = 0.1;
// …unless the stored value has not been observed for this long.
export const FACT_STALE_DAYS = 14;

export const REINFORCEMENT_BOOST = 0.05;

export const SELF_REPORT_DEDUP_HOURS = 3;
export const SKIP_DEDUP_HOURS        = 20;
const DEFAULT_REPORTED_MASTERY = 0.6;

export const INVESTIGATION_TTL_DAYS = 14;  // SKILL.md §11.1

const HOUR_MS = 3_600_000;
const DAY_MS  = 86_400_000;

// ── Helpers ───────────────────────────────────────────────────────────────────

function provenanceOf(e: Evidence): Provenance {
  return {
    source:          e.source,
    sourceMessageId: e.sourceMessageId,
    observedAt:      e.observedAt.toISOString(),
    confidence:      e.confidence,
  };
}

export function normalizeText(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

// Stable short key for multi-valued facts, so the same statement made twice
// lands on the same row instead of creating a second one.
function stableKey(s: string): string {
  let h = 5381;
  const n = normalizeText(s);
  for (let i = 0; i < n.length; i++) h = ((h << 5) + h + n.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

function slug(s: string): string {
  return normalizeText(s).replace(/\s/g, "_").slice(0, 60);
}

function effectiveConfidence(e: SignalEvidence): number {
  return e.corroborated ? e.confidence : e.confidence * UNCORROBORATED_PENALTY;
}

// True when a stored row has already absorbed evidence from this message.
function alreadyAbsorbed(row: { sourceMessageIds: string[] }, e: Evidence): boolean {
  return e.sourceMessageId !== null && row.sourceMessageIds.includes(e.sourceMessageId);
}

function withSource(ids: string[], e: Evidence): string[] {
  return e.sourceMessageId ? [...ids, e.sourceMessageId] : ids;
}

function ignore(
  target: ConsolidationDecision["target"],
  reason: string,
  e:      Evidence,
): ConsolidationDecision {
  return { action: "IGNORE", target, reason, targetId: null, write: null, provenance: provenanceOf(e) };
}

// ── User facts ────────────────────────────────────────────────────────────────

interface FactCandidate {
  type:         string;
  key:          string;
  value:        string;
  singleValued: boolean;   // one current value per key; a different value contradicts it
}

function factCandidate(e: SignalEvidence): FactCandidate | null {
  const value = (e.sourceText ?? "").slice(0, 150).replace(/\n/g, " ").trim();
  if (!value) return null;

  switch (e.signalType) {
    case "commitment":
      return { type: "commitment", key: "latest_commitment", value, singleValued: true };
    case "mastery_claim":
      return {
        type: "mastery_claim",
        key:  e.topic ? `mastery_claim:${slug(e.topic)}` : "latest_mastery_claim",
        value,
        singleValued: true,
      };
    case "achievement":
      return { type: "achievement", key: `achievement:${stableKey(value)}`, value, singleValued: false };
    default:
      return null;
  }
}

function consolidateFact(
  e:     SignalEvidence,
  cand:  FactCandidate,
  facts: StoredFact[],
  now:   Date,
): ConsolidationDecision {
  const confidence = effectiveConfidence(e);
  if (confidence < FACT_MIN_CONFIDENCE) return ignore("user_fact", "insufficient_confidence", e);

  const existing = facts.find(f => f.type === cand.type && f.key === cand.key);

  if (!existing) {
    return {
      action: "CREATE", target: "user_fact", reason: "new_fact", targetId: null,
      write: {
        target: "user_fact", type: cand.type, key: cand.key, value: cand.value,
        confidence, evidenceCount: 1, supersedes: null,
      },
      provenance: provenanceOf(e),
    };
  }

  if (alreadyAbsorbed(existing, e)) return ignore("user_fact", "duplicate_evidence", e);

  if (normalizeText(existing.value) === normalizeText(cand.value)) {
    return {
      action: "UPDATE", target: "user_fact", reason: "reinforced", targetId: existing.id,
      write: {
        target: "user_fact", type: cand.type, key: cand.key, value: existing.value,
        confidence:    Math.min(1, Math.max(existing.confidence, confidence) + REINFORCEMENT_BOOST),
        evidenceCount: existing.evidenceCount + 1,
        supersedes:    null,
      },
      provenance: provenanceOf(e),
    };
  }

  // Different value on a single-valued key: contradiction.
  const existingIsStale = now.getTime() - existing.lastObservedAt.getTime() > FACT_STALE_DAYS * DAY_MS;
  if (!existingIsStale && confidence < existing.confidence - CONTRADICTION_MARGIN) {
    return ignore("user_fact", "contradiction_weaker_than_existing", e);
  }

  return {
    action: "UPDATE", target: "user_fact",
    reason: existingIsStale ? "superseded_stale" : "superseded",
    targetId: existing.id,
    write: {
      target: "user_fact", type: cand.type, key: cand.key, value: cand.value,
      confidence, evidenceCount: 1,
      supersedes: { value: existing.value, confidence: existing.confidence },
    },
    provenance: provenanceOf(e),
  };
}

// ── Academic observations ─────────────────────────────────────────────────────
// A study report or skip is an academic entity (NovaStudySession), never a
// UserFact. Interactive sessions own their own lifecycle; only self-reports
// with no active session are consolidated here.

function consolidateAcademic(
  e:     SignalEvidence,
  input: ConsolidationInput,
): ConsolidationDecision[] {
  if (!e.profileId) return [ignore("academic_observation", "no_academic_profile", e)];

  const confidence = effectiveConfidence(e);
  if (confidence < ACADEMIC_MIN_CONFIDENCE) {
    return [ignore("academic_observation", "insufficient_confidence", e)];
  }

  const within = (status: string, hours: number) =>
    input.state.recentSessions.some(s =>
      s.status === status &&
      Math.abs(input.now.getTime() - s.sessionDate.getTime()) < hours * HOUR_MS,
    );

  if (e.signalType === "study_skip") {
    if (within("skipped", SKIP_DEDUP_HOURS)) {
      return [ignore("academic_observation", "duplicate_skip_in_window", e)];
    }
    return [{
      action: "CREATE", target: "academic_observation", reason: "self_reported_skip", targetId: null,
      write: { target: "academic_observation", op: "skipped_session", topic: null, confidence },
      provenance: provenanceOf(e),
    }];
  }

  // study_report
  if (input.hasActiveSession) {
    return [ignore("academic_observation", "owned_by_active_session", e)];
  }

  const out: ConsolidationDecision[] = [];
  if (within("completed", SELF_REPORT_DEDUP_HOURS)) {
    out.push(ignore("academic_observation", "duplicate_report_in_window", e));
  } else {
    out.push({
      action: "CREATE", target: "academic_observation", reason: "self_reported_session", targetId: null,
      write: { target: "academic_observation", op: "self_reported_session", topic: e.topic, confidence },
      provenance: provenanceOf(e),
    });
  }

  if (e.topic) {
    // Self-assessed mastery comes from a mastery claim in the same message,
    // not from how clearly the study report itself matched.
    const claim = input.evidence.find(
      (x): x is SignalEvidence => x.kind === "signal" && x.signalType === "mastery_claim",
    );
    out.push({
      action: "UPDATE", target: "academic_observation", reason: "mastery_observation", targetId: null,
      write: {
        target: "academic_observation", op: "mastery_observation", topic: e.topic,
        confidence: claim?.intensity ?? DEFAULT_REPORTED_MASTERY,
      },
      provenance: provenanceOf(e),
    });
  }
  return out;
}

// ── A stated struggle ─────────────────────────────────────────────────────────
// "I keep messing up deadlocks" is something the student said about a topic.
// It is not a fact about the student and never becomes a UserFact or a
// pattern. It is a mastery OBSERVATION: the Knowledge Engine's soft path,
// which nudges the topic's number, changes no review interval and counts no
// review. One statement moves a topic at most once a day, however often it is
// repeated, and a running session owns its own evidence.

export const STRUGGLE_REPORTED_MASTERY = 0.3;   // the "Struggled" value (study-session-engine.ts)

function consolidateStruggle(e: SignalEvidence, input: ConsolidationInput): ConsolidationDecision {
  if (!e.profileId) return ignore("academic_observation", "no_academic_profile", e);
  if (!e.topic)     return ignore("academic_observation", "no_topic_named", e);
  if (effectiveConfidence(e) < ACADEMIC_MIN_CONFIDENCE) {
    return ignore("academic_observation", "insufficient_confidence", e);
  }
  if (input.hasActiveSession) return ignore("academic_observation", "owned_by_active_session", e);
  if ((input.state.recentlyObservedTopics ?? []).includes(e.topic.trim().toLowerCase())) {
    return ignore("academic_observation", "topic_already_observed_today", e);
  }
  return {
    action: "UPDATE", target: "academic_observation", reason: "struggle_observation", targetId: null,
    write: {
      target: "academic_observation", op: "mastery_observation", topic: e.topic,
      confidence: STRUGGLE_REPORTED_MASTERY,
    },
    provenance: provenanceOf(e),
  };
}

// ── Reality ───────────────────────────────────────────────────────────────────
// Identity of a constraint is (category, subtype). One live record per
// identity. Lifecycle: active → resolved | expired.

function consolidateRealityClaim(
  e:     RealityClaimEvidence,
  state: ConsolidationState,
  now:   Date,
): ConsolidationDecision {
  if (e.confidence < REALITY_MIN_WRITE_CONFIDENCE) return ignore("reality", "insufficient_confidence", e);

  const expiresAt = realityExpiry({
    category: e.category, persistence: e.persistence,
    expectedDurationHours: e.expectedDurationHours, now,
  });
  const write = {
    target: "reality" as const,
    category: e.category, subtype: e.subtype, description: e.description,
    confidence: e.confidence, expiresAt, sourceText: e.sourceText,
  };

  // Only a live row can be reinforced. One past its TTL is a finished episode.
  const existing = state.realities.find(r =>
    r.category === e.category && r.subtype === e.subtype && r.expiresAt > now,
  );

  if (!existing) {
    return { action: "CREATE", target: "reality", reason: "new_constraint", targetId: null, write, provenance: provenanceOf(e) };
  }

  if (alreadyAbsorbed(existing, e)) return ignore("reality", "duplicate_evidence", e);

  if (normalizeText(existing.fact) === normalizeText(e.description)) {
    // Same condition mentioned again: still true, so the clock restarts. A
    // re-mention never shortens a horizon already granted.
    return {
      action: "UPDATE", target: "reality", reason: "reinforced", targetId: existing.id,
      write: {
        ...write,
        description: existing.fact,
        confidence:  Math.max(existing.confidence, e.confidence),
        expiresAt:   expiresAt > existing.expiresAt ? expiresAt : existing.expiresAt,
      },
      provenance: provenanceOf(e),
    };
  }

  if (e.confidence < existing.confidence - REALITY_CONTRADICTION_MARGIN) {
    return ignore("reality", "contradiction_weaker_than_existing", e);
  }

  return {
    action: "UPDATE", target: "reality", reason: "superseded", targetId: existing.id,
    write: { ...write, supersedes: { value: existing.fact, confidence: existing.confidence } },
    provenance: provenanceOf(e),
  };
}

function consolidateRealityResolution(
  e:     RealityResolutionEvidence,
  state: ConsolidationState,
): ConsolidationDecision {
  if (e.confidence < REALITY_MIN_WRITE_CONFIDENCE) return ignore("reality", "insufficient_confidence", e);

  // Any row still flagged active qualifies, including one past its TTL:
  // an explicit resolution wins over expiry.
  const inCategory = state.realities.filter(r => r.category === e.category);
  const bySubtype  = e.subtype ? inCategory.filter(r => r.subtype === e.subtype) : [];
  const candidates = bySubtype.length > 0 ? bySubtype : inCategory;

  if (candidates.length === 0) return ignore("reality", "nothing_to_resolve", e);
  if (candidates.length > 1)  return ignore("reality", "ambiguous_resolution", e);

  return {
    action: "RESOLVE", target: "reality", reason: "user_reported_resolved",
    targetId: candidates[0]!.id, write: null, provenance: provenanceOf(e),
  };
}

function sweepExpiredReality(realities: StoredReality[], now: Date): ConsolidationDecision[] {
  return realities
    .filter(r => r.expiresAt <= now)
    .map(r => ({
      action: "EXPIRE" as const, target: "reality" as const, reason: "ttl_elapsed",
      targetId: r.id, write: null, provenance: null,
    }));
}

// ── Behavioral patterns ───────────────────────────────────────────────────────
// A detection is evidence of a pattern, not the pattern. Strength accumulates
// from supporting evidence and falls with contradicting evidence and time.
// Status (emerging → active → weakening → resolved) follows from strength.

const LIVE: ReadonlyArray<StoredPattern["status"]> = ["emerging", "active", "weakening"];

function consolidatePatternDetection(
  e:     PatternDetectionEvidence,
  state: ConsolidationState,
  now:   Date,
): ConsolidationDecision {
  const existing = state.patterns.find(p => p.patternType === e.patternType);

  if (!existing) {
    const strength = initialStrength(e.confidence);
    const status   = statusFor(strength, null);
    return {
      action: "CREATE", target: "behavioral_pattern",
      reason: status === "active" ? "strong_single_observation" : "first_sighting",
      targetId: null,
      write: {
        target: "behavioral_pattern", patternType: e.patternType, description: e.description,
        confidence: strength, evidenceCount: 1, severity: severityFor(1),
        status, supporting: e.supporting, observed: true,
      },
      provenance: provenanceOf(e),
    };
  }

  if (alreadyAbsorbed(existing, e)) return ignore("behavioral_pattern", "duplicate_evidence", e);

  const live = LIVE.includes(existing.status);
  if (live && now.getTime() - existing.lastObservedAt.getTime() < OBSERVATION_WINDOW_HOURS * HOUR_MS) {
    return ignore("behavioral_pattern", "same_observation_window", e);
  }

  // A pattern that had ended starts over from this observation alone.
  const strength = live ? reinforcedStrength(existing.confidence, e.confidence) : initialStrength(e.confidence);
  const count    = existing.evidenceCount + 1;
  const status   = statusFor(strength, live ? existing.status : null);
  const reason   = !live ? "recurred_after_resolution"
    : existing.status !== "active" && status === "active" ? "promoted_on_evidence"
    : "reinforced";

  return {
    action: "UPDATE", target: "behavioral_pattern", reason, targetId: existing.id,
    write: {
      target: "behavioral_pattern", patternType: e.patternType, description: e.description,
      confidence: strength, evidenceCount: count, severity: severityFor(count),
      status, supporting: e.supporting, observed: true,
    },
    provenance: provenanceOf(e),
  };
}

// Patterns the detector looked for this turn and did not find.
function consolidateUndetectedPatterns(
  state:    ConsolidationState,
  detected: Set<string>,
  evidence: Evidence[],
  now:      Date,
): ConsolidationDecision[] {
  const out: ConsolidationDecision[] = [];

  for (const p of state.patterns) {
    if (detected.has(p.patternType) || !LIVE.includes(p.status)) continue;

    const established = p.status === "active" || p.status === "weakening";
    const end = (reason: string, write: ConsolidationDecision["write"], prov: Provenance | null): ConsolidationDecision => ({
      action: established ? "RESOLVE" : "EXPIRE",
      target: "behavioral_pattern", reason, targetId: p.id, write, provenance: prov,
    });
    const patternWrite = (confidence: number, status: StoredPattern["status"]) => ({
      target: "behavioral_pattern" as const, patternType: p.patternType as NovaPatternType,
      description: null, confidence, evidenceCount: p.evidenceCount,
      severity: severityFor(p.evidenceCount), status, supporting: null, observed: false,
    });

    // 1. Behavior that contradicts the pattern, corroborated, in this turn.
    const contradicting = CONTRADICTING_SIGNALS[p.patternType as NovaPatternType] ?? [];
    const counter = evidence.find((e): e is SignalEvidence =>
      e.kind === "signal" && e.corroborated && contradicting.includes(e.signalType),
    );
    const changedRecently = now.getTime() - p.lastChangedAt.getTime() < OBSERVATION_WINDOW_HOURS * HOUR_MS;

    if (counter && !alreadyAbsorbed(p, counter) && !changedRecently) {
      const strength = weakenedStrength(p.confidence);
      const status   = statusFor(strength, p.status);
      out.push(status === "resolved" || status === "expired"
        ? end("contradicted_until_resolved", patternWrite(strength, status), provenanceOf(counter))
        : {
            action: "UPDATE", target: "behavioral_pattern", reason: "weakened_by_contradicting_evidence",
            targetId: p.id, write: patternWrite(strength, status === "active" ? "weakening" : status),
            provenance: provenanceOf(counter),
          });
      continue;
    }

    // 2. Time without a supporting observation.
    const quietDays = (now.getTime() - p.lastObservedAt.getTime()) / DAY_MS;
    if (quietDays >= STALE_AFTER_DAYS) {
      out.push(end("not_observed_recently", null, null));
    } else if (quietDays >= QUIET_AFTER_DAYS && p.status === "active") {
      out.push({
        action: "UPDATE", target: "behavioral_pattern", reason: "quiet_weakening",
        targetId: p.id, write: patternWrite(p.confidence, "weakening"), provenance: null,
      });
    }
  }
  return out;
}

// ── Companion cognitive state (investigation) ─────────────────────────────────

function consolidateInvestigation(
  e:     InvestigationEvidence,
  state: ConsolidationState,
): ConsolidationDecision {
  if (e.confidence < INVESTIGATION_MIN_CONFIDENCE) {
    return ignore("cognitive_state", "insufficient_confidence", e);
  }

  const existing = state.investigation;
  const isOpen   = existing?.status === "open";

  if (e.status === "resolved" || e.status === "abandoned") {
    if (!isOpen) return ignore("cognitive_state", "nothing_to_resolve", e);
    return {
      action: "RESOLVE", target: "cognitive_state", reason: `investigation_${e.status}`, targetId: null,
      write: { target: "cognitive_state", topic: existing?.topic ?? null, status: e.status, hypotheses: e.hypotheses, isNew: false },
      provenance: provenanceOf(e),
    };
  }

  const sameTopic = isOpen && (!e.topic || normalizeText(e.topic) === normalizeText(existing?.topic ?? ""));
  if (sameTopic) {
    return {
      action: "UPDATE", target: "cognitive_state", reason: "investigation_continued", targetId: null,
      write: { target: "cognitive_state", topic: existing?.topic ?? null, status: "open", hypotheses: e.hypotheses, isNew: false },
      provenance: provenanceOf(e),
    };
  }

  if (!e.topic) return ignore("cognitive_state", "no_topic", e);

  return {
    action: "CREATE", target: "cognitive_state", reason: "investigation_opened", targetId: null,
    write: { target: "cognitive_state", topic: e.topic, status: "open", hypotheses: e.hypotheses, isNew: true },
    provenance: provenanceOf(e),
  };
}

function sweepStaleInvestigation(state: ConsolidationState, now: Date): ConsolidationDecision[] {
  const inv = state.investigation;
  if (inv?.status !== "open" || !inv.updatedAt) return [];
  if (now.getTime() - inv.updatedAt.getTime() < INVESTIGATION_TTL_DAYS * DAY_MS) return [];
  return [{
    action: "EXPIRE", target: "cognitive_state", reason: "investigation_ttl_elapsed", targetId: null,
    write: { target: "cognitive_state", topic: inv.topic, status: "abandoned", hypotheses: null, isNew: false },
    provenance: null,
  }];
}

// ── Entry point ───────────────────────────────────────────────────────────────

export function consolidate(input: ConsolidationInput): ConsolidationDecision[] {
  const { evidence, now } = input;
  const decisions: ConsolidationDecision[] = [];

  // Decisions inside one batch must see each other, or two pieces of evidence
  // for the same key in one turn would both CREATE. Work on a local view.
  const state: ConsolidationState = {
    ...input.state,
    facts:     [...input.state.facts],
    realities: [...input.state.realities],
    patterns:  [...input.state.patterns],
  };

  // An investigation past its TTL must not be "continued" by this turn.
  const staleInvestigation = sweepStaleInvestigation(state, now);
  decisions.push(...staleInvestigation);
  if (staleInvestigation.length > 0) state.investigation = null;

  const detectedPatterns = new Set<string>();

  for (const e of evidence) {
    switch (e.kind) {
      case "signal": {
        if (e.signalType === "study_report" || e.signalType === "study_skip") {
          decisions.push(...consolidateAcademic(e, input));
          break;
        }
        if (e.signalType === "topic_struggle") {
          decisions.push(consolidateStruggle(e, input));
          break;
        }
        const cand = factCandidate(e);
        if (!cand) {
          // Excuses, avoidance, burnout wording and the like describe one
          // moment. They stay in the conversation log, where the pattern
          // detector reads them; only repetition can make them durable.
          decisions.push(ignore("user_fact", "transient_signal", e));
          break;
        }
        const d = consolidateFact(e, cand, state.facts, now);
        decisions.push(d);
        if (d.write?.target === "user_fact" && d.action !== "IGNORE") {
          const w = d.write;
          const prior = state.facts.find(f => f.type === w.type && f.key === w.key);
          state.facts = state.facts.filter(f => f !== prior);
          state.facts.push({
            id: d.targetId ?? `pending:${w.type}:${w.key}`,
            type: w.type, key: w.key, value: w.value,
            confidence: w.confidence, evidenceCount: w.evidenceCount, lastObservedAt: now,
            sourceMessageIds: withSource(prior?.sourceMessageIds ?? [], e),
          });
        }
        break;
      }

      case "reality_claim": {
        const d = consolidateRealityClaim(e, state, now);
        decisions.push(d);
        if (d.write?.target === "reality" && d.action !== "IGNORE") {
          const w = d.write;
          const prior = state.realities.find(r => r.id === d.targetId);
          state.realities = state.realities.filter(r => r !== prior);
          state.realities.push({
            id: d.targetId ?? `pending:${w.category}:${w.subtype}`,
            category: w.category, subtype: w.subtype, fact: w.description,
            confidence: w.confidence, expiresAt: w.expiresAt,
            sourceMessageIds: withSource(prior?.sourceMessageIds ?? [], e),
          });
        }
        break;
      }

      case "reality_resolution": {
        const d = consolidateRealityResolution(e, state);
        decisions.push(d);
        if (d.action === "RESOLVE") state.realities = state.realities.filter(r => r.id !== d.targetId);
        break;
      }

      case "pattern_detection": {
        detectedPatterns.add(e.patternType);
        const d = consolidatePatternDetection(e, state, now);
        decisions.push(d);
        if (d.write?.target === "behavioral_pattern" && d.action !== "IGNORE") {
          const w = d.write;
          const prior = state.patterns.find(p => p.patternType === w.patternType);
          state.patterns = state.patterns.filter(p => p !== prior);
          state.patterns.push({
            id: d.targetId ?? `pending:${w.patternType}`,
            patternType: w.patternType, status: w.status, evidenceCount: w.evidenceCount,
            confidence: w.confidence, firstObservedAt: prior?.firstObservedAt ?? now,
            lastObservedAt: now, lastChangedAt: now,
            sourceMessageIds: withSource(prior?.sourceMessageIds ?? [], e),
          });
        }
        break;
      }

      case "investigation_update":
        decisions.push(consolidateInvestigation(e, state));
        break;
    }
  }

  // Expiry last, and only for rows nothing above resolved: explicit
  // resolution wins over expiry.
  decisions.push(...sweepExpiredReality(state.realities, now));

  if (input.patternScanRan) {
    decisions.push(...consolidateUndetectedPatterns(state, detectedPatterns, evidence, now));
  }

  return decisions;
}
