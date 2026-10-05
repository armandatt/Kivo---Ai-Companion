// ─── Mentor compatibility engine ──────────────────────────────────────────────
// Deterministic mentor selection. No LLM, no I/O, no randomness, no clock:
// the same input always returns the same match.
//
// Four separate steps, in this order of authority:
//   1. Domain filtering decides who is ELIGIBLE. It is a hard constraint.
//   2. A need vector is built from what the user told us. Explicit preferences
//      (accountability style) set values outright; the personality signal may
//      only nudge, and never touches a dimension the user set explicitly.
//   3. Compatibility scoring RANKS the eligible mentors against that vector.
//   4. Ties keep the user's current mentor, then fall back to registry order.
//
// Today each domain has exactly one eligible mentor, so step 1 already decides
// the outcome and the scores are recorded for inspection. Step 3 starts to
// matter the day a second mentor becomes eligible for a domain.
//
// Safe to import from the web app.

import {
  MENTOR_DIMENSIONS,
  MENTOR_REGISTRY,
  MENTOR_REGISTRY_VERSION,
  type MentorDimension,
  type MentorDomain,
  type MentorProfile,
} from "./mentor-registry";
import type { PersonalitySignal } from "./signal-scoring";

export const MATCH_ENGINE_VERSION = "kivo-match-v1";

export type AccountabilityStyle = "hard" | "soft";

export interface MatchInput {
  domain?:              string | null;
  accountabilityStyle?: string | null;
  goalCategory?:        string | null;
  signal?:              PersonalitySignal | null;
  // The mentor the user already has, if any. Only used to break ties.
  currentMentor?:       string | null;
}

export type NeedVector = Record<MentorDimension, number>;

export interface CompatibilityResult {
  mentorId:  string;
  // 0–100, one decimal. Higher is a closer fit.
  score:     number;
  // Per dimension: what the user needs, what the mentor offers, and the gap.
  breakdown: Record<MentorDimension, { need: number; mentor: number; distance: number; weight: number }>;
}

export type MatchDecision =
  | "only_eligible_mentor"
  | "highest_compatibility"
  | "tie_kept_current_mentor"
  | "tie_registry_order"
  | "domain_default";

export interface MentorMatch {
  engineVersion:   string;
  registryVersion: string;
  signalVersion:   string | null;
  domain:          MentorDomain;
  mentorId:        string;
  toneModifier:    string | null;
  decidedBy:       MatchDecision;
  eligible:        string[];
  // Every characterised mentor, best first. Ineligible ones are listed so the
  // result can be inspected, but they can never be selected.
  ranked:          Array<CompatibilityResult & { eligible: boolean }>;
  need:            NeedVector;
  // Which input set or moved each dimension.
  needSources:     Record<MentorDimension, string[]>;
}

// How much each dimension counts. Intensity leads because it is the one the
// user states outright.
export const DIMENSION_WEIGHTS: Record<MentorDimension, number> = {
  intensity: 3, structure: 2, warmth: 1.5, reflectiveness: 1.5,
};

// The most the personality signal may move any one dimension.
export const SIGNAL_MAX_SHIFT = 0.15;

// Scores closer than this are treated as a tie.
export const TIE_MARGIN = 0.5;

const NEUTRAL = 0.5;

// Used only when the registry has no eligible mentor for a domain.
const DOMAIN_DEFAULT: Record<MentorDomain, string> = { gym: "rex", study: "nova", general: "zen" };

export function normalizeDomain(domain: string | null | undefined): MentorDomain {
  const value = (domain ?? "").toLowerCase().trim();
  if (value === "gym") return "gym";
  if (value === "study") return "study";
  return "general";
}

// Accepts the stored values ("hard" / "soft") and the quiz labels
// ("No mercy" / "Gentle nudges"). Anything else means no explicit preference.
export function normalizeAccountability(style: string | null | undefined): AccountabilityStyle | null {
  const value = (style ?? "").toLowerCase().trim();
  if (value === "hard" || value.includes("mercy")) return "hard";
  if (value === "soft" || value.includes("gentle")) return "soft";
  return null;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const round1  = (n: number) => Math.round(n * 10) / 10;
const round3  = (n: number) => Math.round(n * 1000) / 1000;

export function buildNeedVector(input: MatchInput): { need: NeedVector; sources: Record<MentorDimension, string[]> } {
  const need: NeedVector = { intensity: NEUTRAL, warmth: NEUTRAL, structure: NEUTRAL, reflectiveness: NEUTRAL };
  const sources: Record<MentorDimension, string[]> = { intensity: [], warmth: [], structure: [], reflectiveness: [] };

  // ── Explicit preference: sets intensity outright and locks it ───────────────
  const accountability = normalizeAccountability(input.accountabilityStyle);
  if (accountability === "hard") { need.intensity = 0.9; sources.intensity.push("accountability:hard"); }
  if (accountability === "soft") { need.intensity = 0.2; sources.intensity.push("accountability:soft"); }
  const intensityLocked = accountability !== null;

  // ── Goal: an outcome goal with a deadline wants more structure ──────────────
  const goal = (input.goalCategory ?? "").toLowerCase().trim();
  if (goal === "fitness" || goal === "study" || goal === "work") {
    need.structure = 0.7;
    sources.structure.push(`goal:${goal}`);
  }

  // ── Personality signal: small nudges only ───────────────────────────────────
  const bands = input.signal?.bands;
  if (bands) {
    const nudge = (dim: MentorDimension, by: number, source: string) => {
      need[dim] = clamp01(need[dim] + by);
      sources[dim].push(source);
    };

    if (bands.reflection === "high") nudge("reflectiveness", +SIGNAL_MAX_SHIFT, "signal:reflection_high");
    if (bands.reflection === "low")  nudge("reflectiveness", -SIGNAL_MAX_SHIFT, "signal:reflection_low");

    if (bands.routine === "low")  nudge("structure", +SIGNAL_MAX_SHIFT, "signal:routine_low");
    if (bands.routine === "high") nudge("structure", -SIGNAL_MAX_SHIFT, "signal:routine_high");

    if (bands.composure === "low") nudge("warmth", +SIGNAL_MAX_SHIFT, "signal:composure_low");

    // The signal never overrides how hard the user asked to be pushed.
    if (!intensityLocked) {
      if (bands.composure === "low")  nudge("intensity", -SIGNAL_MAX_SHIFT, "signal:composure_low");
      if (bands.composure === "high") nudge("intensity", +SIGNAL_MAX_SHIFT, "signal:composure_high");
    }
  }

  for (const dim of MENTOR_DIMENSIONS) need[dim] = round3(need[dim]);
  return { need, sources };
}

// Returns null for a mentor with no characteristics (the stubs).
export function mentorCompatibility(need: NeedVector, mentor: MentorProfile): CompatibilityResult | null {
  if (!mentor.characteristics) return null;

  const breakdown = {} as CompatibilityResult["breakdown"];
  let weighted = 0;
  let total    = 0;

  for (const dim of MENTOR_DIMENSIONS) {
    const weight   = DIMENSION_WEIGHTS[dim];
    const offered  = mentor.characteristics[dim];
    const distance = Math.abs(need[dim] - offered);
    breakdown[dim] = { need: need[dim], mentor: offered, distance: round3(distance), weight };
    weighted += weight * distance;
    total    += weight;
  }

  return { mentorId: mentor.id, score: round1(100 * (1 - weighted / total)), breakdown };
}

// Tone calibration that never switches the mentor. Same rule the web onboarding
// has always used.
export function toneModifierFor(mentorId: string, accountability: AccountabilityStyle | null): string | null {
  if (mentorId === "rex"  && accountability === "soft") return "firm_not_brutal";
  if (mentorId === "nova" && accountability === "hard") return "structured_direct";
  if (mentorId === "zen"  && accountability === "hard") return "purposeful_direct";
  return null;
}

export function matchMentor(
  input: MatchInput,
  registry: readonly MentorProfile[] = MENTOR_REGISTRY,
): MentorMatch {
  const domain = normalizeDomain(input.domain);
  const { need, sources } = buildNeedVector(input);

  // Step 1: eligibility. Authoritative.
  const eligibleIds = new Set(
    registry
      .filter(m => m.assignable && m.characteristics !== null && m.domains.includes(domain))
      .map(m => m.id as string),
  );

  // Step 3: rank everyone that can be scored. Registry order breaks equal scores.
  const order = new Map(registry.map((m, i) => [m.id as string, i]));
  const ranked = registry
    .map(m => mentorCompatibility(need, m))
    .filter((r): r is CompatibilityResult => r !== null)
    .map(r => ({ ...r, eligible: eligibleIds.has(r.mentorId) }))
    .sort((a, b) => b.score - a.score || order.get(a.mentorId)! - order.get(b.mentorId)!);

  const candidates = ranked.filter(r => r.eligible);

  let mentorId:  string;
  let decidedBy: MatchDecision;

  if (candidates.length === 0) {
    mentorId  = DOMAIN_DEFAULT[domain];
    decidedBy = "domain_default";
  } else if (candidates.length === 1) {
    mentorId  = candidates[0]!.mentorId;
    decidedBy = "only_eligible_mentor";
  } else {
    const top  = candidates[0]!;
    const tied = candidates.filter(c => top.score - c.score <= TIE_MARGIN);
    if (tied.length === 1) {
      mentorId  = top.mentorId;
      decidedBy = "highest_compatibility";
    } else {
      const current = (input.currentMentor ?? "").toLowerCase().trim();
      const kept    = tied.find(c => c.mentorId === current);
      if (kept) {
        mentorId  = kept.mentorId;
        decidedBy = "tie_kept_current_mentor";
      } else {
        mentorId  = [...tied].sort((a, b) => order.get(a.mentorId)! - order.get(b.mentorId)!)[0]!.mentorId;
        decidedBy = "tie_registry_order";
      }
    }
  }

  return {
    engineVersion:   MATCH_ENGINE_VERSION,
    registryVersion: MENTOR_REGISTRY_VERSION,
    signalVersion:   input.signal?.version ?? null,
    domain,
    mentorId,
    toneModifier:    toneModifierFor(mentorId, normalizeAccountability(input.accountabilityStyle)),
    decidedBy,
    eligible:        candidates.map(c => c.mentorId),
    ranked,
    need,
    needSources:     sources,
  };
}
