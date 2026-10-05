// ─── Mentor registry ──────────────────────────────────────────────────────────
// What the compatibility engine knows about each existing persona. The personas
// themselves (names, voices) are defined once, in services/personna.service.ts;
// this file only adds matching metadata keyed by the same ids.
//
// The characteristic numbers are a PRODUCT HYPOTHESIS read off each persona's
// voice prompt. They are not derived from personality psychology and should be
// tuned from real usage. Bump the version whenever a value changes.
//
// Pure data: no I/O. Safe to import from the web app.

import type { PersonaType } from "../services/personna.service";

export const MENTOR_REGISTRY_VERSION = "kivo-mentors-v1";

export type MentorDomain = "gym" | "study" | "general";

export type MentorDimension = "intensity" | "warmth" | "structure" | "reflectiveness";

export const MENTOR_DIMENSIONS: readonly MentorDimension[] = [
  "intensity", "warmth", "structure", "reflectiveness",
];

export interface MentorProfile {
  id: PersonaType;
  // Only assignable mentors can be chosen. A persona stays false until it has a
  // real voice and a pipeline that can serve it.
  assignable: boolean;
  // Product domains this mentor can serve today. A persona currently selects a
  // whole pipeline (rex → gym, nova → study), so this is a hard constraint.
  domains: readonly MentorDomain[];
  // Each 0–1. null for personas that are not characterised yet.
  characteristics: Record<MentorDimension, number> | null;
}

// Order is the final tie-break, so it must stay stable.
export const MENTOR_REGISTRY: readonly MentorProfile[] = [
  {
    // "Not warm by default", "not a therapist", "one point, delivered with precision".
    id: "rex", assignable: true, domains: ["gym"],
    characteristics: { intensity: 0.9, warmth: 0.3, structure: 0.8, reflectiveness: 0.1 },
  },
  {
    // "Warm but never soft", "explain the logic briefly, not just the tasks".
    id: "nova", assignable: true, domains: ["study"],
    characteristics: { intensity: 0.5, warmth: 0.7, structure: 0.8, reflectiveness: 0.3 },
  },
  {
    // "Never give a 5-step plan", "sometimes you do not answer — you ask instead".
    id: "zen", assignable: true, domains: ["general"],
    characteristics: { intensity: 0.2, warmth: 0.6, structure: 0.1, reflectiveness: 0.95 },
  },
  // One-line stubs in personna.service.ts. Not assignable until they are built out.
  { id: "vera",    assignable: false, domains: [], characteristics: null },
  { id: "spark",   assignable: false, domains: [], characteristics: null },
  { id: "compass", assignable: false, domains: [], characteristics: null },
  { id: "anchor",  assignable: false, domains: [], characteristics: null },
  { id: "lingua",  assignable: false, domains: [], characteristics: null },
];
