// ─── Behavioral pattern policy ────────────────────────────────────────────────
// How evidence moves a pattern's strength and status. Policy only: no
// persistence, no I/O. The store keeps whatever this returns; the numbers and
// the model here can change without a schema or store change.
//
// A pattern's `confidence` is its accumulated strength (0–1). Supporting
// evidence raises it by noisy-OR, so one very strong observation can outweigh
// two weak ones. Contradicting evidence and time lower it. Status follows.

import type { NovaPatternType, SignalType } from "../../types/engine.types";
import type { PatternStatus } from "../../types/consolidation.types";

// How much one detection contributes, scaled by the detector's confidence.
export const DETECTION_WEIGHT = 0.6;

export const ACTIVE_THRESHOLD  = 0.55;   // strength at or above: active
export const RESOLVE_THRESHOLD = 0.2;    // strength below: resolved / expired

// Detections closer together than this are one observation: several messages
// in one sitting do not independently confirm a habit.
export const OBSERVATION_WINDOW_HOURS = 12;

export const CONTRADICTION_DECAY = 0.75;   // per contradicting observation
export const QUIET_AFTER_DAYS    = 7;      // unobserved this long: weakening
export const STALE_AFTER_DAYS    = 14;     // unobserved this long: resolved / expired

// Behavior that is direct counter-evidence for a pattern. Structural patterns
// (calibration_delusion, comparison_trap) are not contradicted by one message.
export const CONTRADICTING_SIGNALS: Partial<Record<NovaPatternType, SignalType[]>> = {
  ghosting:          ["study_report", "consistency"],
  motivation_crash:  ["study_report", "consistency"],
  excuse_loop:       ["study_report", "consistency"],
  avoidance_pattern: ["study_report", "consistency"],
  perfectionism:     ["study_report"],
  overplanning:      ["study_report"],
  restart_cycle:     ["consistency"],
};

export function initialStrength(detectionConfidence: number): number {
  return round(detectionConfidence * DETECTION_WEIGHT);
}

export function reinforcedStrength(current: number, detectionConfidence: number): number {
  return round(1 - (1 - current) * (1 - detectionConfidence * DETECTION_WEIGHT));
}

export function weakenedStrength(current: number): number {
  return round(current * CONTRADICTION_DECAY);
}

// Status is a function of strength and of where the pattern has been.
export function statusFor(strength: number, previous: PatternStatus | null): PatternStatus {
  const wasEstablished = previous === "active" || previous === "weakening";
  if (strength >= ACTIVE_THRESHOLD) return "active";
  if (strength < RESOLVE_THRESHOLD) return wasEstablished ? "resolved" : "expired";
  return wasEstablished ? "weakening" : "emerging";
}

export function severityFor(evidenceCount: number): "emerging" | "confirmed" | "critical" {
  if (evidenceCount >= 5) return "critical";
  if (evidenceCount >= 3) return "confirmed";
  return "emerging";
}

function round(n: number): number {
  return Math.round(Math.max(0, Math.min(1, n)) * 1000) / 1000;
}
