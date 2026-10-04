// ─── Intervention registry ────────────────────────────────────────────────────
// SKILL.md §7.3 — single source of truth. No string literals in the codebase
// that are not drawn from this object.

export const INTERVENTIONS = {
  EMPATHIZE:            "empathize",
  CHALLENGE:            "challenge",
  ACCOUNTABILITY:       "accountability",
  REFOCUS:              "refocus",
  CLARIFY:              "clarify",
  PROBLEM_SOLVE:        "problem_solve",
  REDUCE_FRICTION:      "reduce_friction",
  REINFORCE_IDENTITY:   "reinforce_identity",
  SURFACE_BREAKTHROUGH: "surface_breakthrough",
  SURFACE_COMMITMENT:   "surface_commitment",
  ANCHOR_COMMITMENT:    "anchor_commitment",
  CELEBRATE_WIN:        "celebrate_win",
  REFRAME_FAILURE:      "reframe_failure",
  PREVENT_SPIRAL:       "prevent_spiral",
  PREVENT_BURNOUT:      "prevent_burnout",
  MOMENTUM_PUSH:        "momentum_push",
  CONSISTENCY_CHECK:    "consistency_check",
  GOAL_ALIGNMENT:       "goal_alignment",
  CALIBRATION_CHECK:    "calibration_check",
  CRISIS_REDIRECT:      "crisis_redirect",
  RE_ENGAGEMENT:        "re_engagement",
} as const;

export type InterventionName = (typeof INTERVENTIONS)[keyof typeof INTERVENTIONS];

export const VALID_INTERVENTIONS = new Set<string>(Object.values(INTERVENTIONS));

// ─── Intervention family groupings (for Decision Graph node 2/3) ──────────────

export const INTERVENTION_FAMILIES = {
  burnout:     [INTERVENTIONS.PREVENT_BURNOUT, INTERVENTIONS.EMPATHIZE, INTERVENTIONS.REDUCE_FRICTION] as InterventionName[],
  emotional:   [INTERVENTIONS.EMPATHIZE, INTERVENTIONS.PREVENT_SPIRAL] as InterventionName[],
  reengagement:[INTERVENTIONS.RE_ENGAGEMENT, INTERVENTIONS.EMPATHIZE, INTERVENTIONS.MOMENTUM_PUSH] as InterventionName[],
  momentum:    [INTERVENTIONS.MOMENTUM_PUSH, INTERVENTIONS.CELEBRATE_WIN] as InterventionName[],
  accountability: [INTERVENTIONS.ACCOUNTABILITY, INTERVENTIONS.CHALLENGE] as InterventionName[],
  study_report:   [INTERVENTIONS.CELEBRATE_WIN, INTERVENTIONS.CONSISTENCY_CHECK, INTERVENTIONS.ANCHOR_COMMITMENT] as InterventionName[],
  skip_report:    [INTERVENTIONS.ACCOUNTABILITY, INTERVENTIONS.EMPATHIZE, INTERVENTIONS.CHALLENGE, INTERVENTIONS.REFRAME_FAILURE] as InterventionName[],
  topic_help:     [INTERVENTIONS.PROBLEM_SOLVE, INTERVENTIONS.CLARIFY] as InterventionName[],
  planning:       [INTERVENTIONS.PROBLEM_SOLVE, INTERVENTIONS.GOAL_ALIGNMENT] as InterventionName[],
  exam_prep:      [INTERVENTIONS.EMPATHIZE, INTERVENTIONS.REDUCE_FRICTION, INTERVENTIONS.PROBLEM_SOLVE] as InterventionName[],
  calibration:    [INTERVENTIONS.CALIBRATION_CHECK, INTERVENTIONS.GOAL_ALIGNMENT] as InterventionName[],
  identity:       [INTERVENTIONS.REINFORCE_IDENTITY, INTERVENTIONS.SURFACE_BREAKTHROUGH] as InterventionName[],
  reflection:     [INTERVENTIONS.REFRAME_FAILURE, INTERVENTIONS.SURFACE_BREAKTHROUGH, INTERVENTIONS.GOAL_ALIGNMENT] as InterventionName[],
} as const;
