import type { ConversationAnalysis, Domain, DetectedConstraint, ConstraintType } from "../types/mentor.types";
import type { MemoryContext } from "../types/memory.types";
import type { MentorState } from "./user-state-engine";

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export type FeasibilityStatus = "feasible" | "partially_feasible" | "not_feasible";

export type BlockerType =
  | "time_overcommit"
  | "stress_too_high"
  | "consistency_history_insufficient"
  | "habit_gap_too_large"
  | "goal_overload"
  | "recovery_insufficient"
  | "buffer_missing"
  | "scope_undefined";

export interface FeasibilityBlocker {
  type: BlockerType;
  severity: "critical" | "major" | "minor";
  description: string;
  impact: string;
  fixable: boolean;
  suggestedFix: string;
}

export interface FeasibilityWarning {
  id: string;
  message: string;
  recommendation: string;
}

export interface PlanAdjustment {
  field: "daily_hours" | "timeline_weeks" | "tasks_per_day" | "scope" | "frequency" | "phase_approach";
  originalValue: string;
  suggestedValue: string;
  reason: string;
  impact: string;
}

export interface PlanPhase {
  phaseNumber: number;
  name: string;
  durationWeeks: number;
  dailyHours: number;
  dailyTasks: number | null;
  focus: string;
  milestone: string;
  successCriteria: string;
}

export interface AdjustedPlan {
  approach: "scaled_down" | "phased" | "timeline_extended" | "scope_reduced" | "minimum_viable";
  summary: string;
  adjustedDailyHours: number;
  adjustedTimelineWeeks: number;
  phases: PlanPhase[];
  reductionRatio: number;
  bufferPercent: number;
  estimatedCompletionDate: Date;
}

export interface EvaluationScores {
  time: number;
  stress: number;
  consistency: number;
  habitGap: number;
  overall: number;
}

export interface PlanRequest {
  dailyHours: number | null;
  weeklyHours: number | null;
  effectiveDailyHours: number;
  tasksPerDay: number | null;
  timelineWeeks: number | null;
  domain: Domain;
  goalDescription: string;
  horizon: string;
  isExplicitTime: boolean;
  rawTimeExpression: string | null;
}

export interface FeasibilityInput {
  analysis: ConversationAnalysis;
  state: MentorState;
  memory: MemoryContext;
  now?: Date;
}

export interface FeasibilityResult {
  status: FeasibilityStatus;
  scores: EvaluationScores;
  blockers: FeasibilityBlocker[];
  adjustments: PlanAdjustment[];
  warnings: FeasibilityWarning[];
  adjustedPlan: AdjustedPlan | null;
  availableHoursPerDay: number;
  requestedHoursPerDay: number;
  sustainableHoursPerDay: number;
  capacityUsedPercent: number;
  capacityRemainingPercent: number;
  reasoning: string;
  parsedRequest: PlanRequest;
  canEvaluate: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

const SCORE_WEIGHTS = {
  time:        0.35,
  stress:      0.25,
  consistency: 0.25,
  habitGap:    0.15,
} as const;

const THRESHOLDS = {
  feasible:          70,
  partially_feasible: 40,
} as const;

// capacity score (0–100) → productive hours available per day
const CAPACITY_HOUR_MAP: Array<[minCapacity: number, maxCapacity: number, hours: number]> = [
  [0,  15,  0.25],
  [15, 25,  0.75],
  [25, 40,  1.50],
  [40, 55,  2.50],
  [55, 65,  3.50],
  [65, 75,  5.00],
  [75, 85,  6.50],
  [85, 100, 8.00],
];

// How many hours each constraint type removes from available daily hours
const CONSTRAINT_HOUR_PENALTY: Partial<Record<ConstraintType, number>> = {
  time:                   1.5,
  energy:                 2.0,
  injury:                 1.0,
  burnout:                3.5,
  work_pressure:          2.0,
  exam_season:            2.5,
  family_responsibility:  1.5,
  financial:              0.5,
  mental_health:          2.5,
  social_pressure:        0.5,
  environment:            1.0,
};

// Hours per unit for task-based goal expressions
// e.g. "10 LeetCode problems" → 10 * 0.75h = 7.5h
const TASK_TIME_HOURS: Record<Domain, Array<{ match: RegExp; hoursEach: number }>> = {
  study: [
    { match: /\b(leetcode|problem|question|exercise|task)\b/i, hoursEach: 0.75 },
    { match: /\b(chapter|section|unit)\b/i,                     hoursEach: 1.25 },
    { match: /\b(topic|concept|module)\b/i,                     hoursEach: 1.50 },
    { match: /\b(revision|review|revise|flash)\b/i,             hoursEach: 0.50 },
    { match: /\b(mock test|full test|past paper)\b/i,           hoursEach: 2.00 },
  ],
  fitness: [
    { match: /\b(session|workout|training|gym)\b/i,             hoursEach: 1.25 },
    { match: /\b(run|jog|walk)\b/i,                             hoursEach: 0.75 },
    { match: /\b(set|rep)\b/i,                                  hoursEach: 0.03 },
    { match: /\b(mile|km|kilometer)\b/i,                        hoursEach: 0.12 },
  ],
  career: [
    { match: /\b(application|apply|job)\b/i,                    hoursEach: 0.50 },
    { match: /\b(mock interview|interview prep)\b/i,            hoursEach: 1.00 },
    { match: /\b(feature|ticket|task|issue)\b/i,                hoursEach: 2.00 },
    { match: /\b(connection|linkedin|reach out)\b/i,            hoursEach: 0.25 },
  ],
  habits: [
    { match: /\b(page|pages)\b/i,                               hoursEach: 0.05 },
    { match: /\b(journal|entry|write)\b/i,                      hoursEach: 0.33 },
    { match: /\b(meditat|mindful)\b/i,                          hoursEach: 0.33 },
    { match: /\b(book|chapter)\b/i,                             hoursEach: 1.00 },
  ],
  finance:      [{ match: /\b(hour)\b/i, hoursEach: 1.0 }],
  mental_health:[{ match: /\b(session|hour)\b/i, hoursEach: 1.0 }],
  relationships:[{ match: /\b(hour|meeting)\b/i, hoursEach: 1.0 }],
  creative:     [
    { match: /\b(word|words)\b/i,                               hoursEach: 0.005 },
    { match: /\b(page|scene|chapter)\b/i,                       hoursEach: 1.00  },
    { match: /\b(hour|session)\b/i,                             hoursEach: 1.00  },
  ],
  unknown:      [{ match: /\b(hour|session)\b/i, hoursEach: 1.0 }],
};

// Active goals each consume ~this many hours per day
const EXISTING_GOAL_DAILY_HOURS = 0.5;

// Maximum productive hours a human can sustain reliably
const MAX_PRODUCTIVE_HOURS_PER_DAY = 8.0;

// Buffer we always preserve (30% of available)
const BUFFER_RATIO = 0.30;

// ═══════════════════════════════════════════════════════════════════════════════
// PARSERS
// ═══════════════════════════════════════════════════════════════════════════════

const DAILY_HOURS_RE   = /(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\s*(?:per|a|each|every|\/)\s*day/i;
const WEEKLY_HOURS_RE  = /(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\s*(?:per|a|each|every|\/)\s*week/i;
const DAILY_MINUTES_RE = /(\d+)\s*(?:minutes?|mins?)\s*(?:per|a|each|every|\/)\s*day/i;
const HOURS_ALONE_RE   = /^.*?(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/i;
const DAILY_TASKS_RE   = /(\d+)\s*(problems?|questions?|chapters?|sections?|topics?|sessions?|workouts?|pages?|exercises?|tasks?)\s*(?:per|a|each|every|\/)\s*day/i;
const WEEKLY_SESSIONS_RE = /(\d+)\s*(?:times?|sessions?|workouts?|days?)\s*(?:per|a|each|every|\/)\s*week/i;
const TIMELINE_RE      = /(\d+)\s*(?:weeks?|months?|days?)/i;

const INTENSITY_DAILY_HOURS: Array<{ pattern: RegExp; hours: number }> = [
  { pattern: /\b(all.?day|full.?time|12\s*h|10\s*h)\b/i,      hours: 10 },
  { pattern: /\b(8\s*hours?|eight\s*hours?)\b/i,               hours: 8  },
  { pattern: /\b(6\s*hours?|six\s*hours?|intensiv)\b/i,        hours: 6  },
  { pattern: /\b(4\s*hours?|four\s*hours?|seriously)\b/i,      hours: 4  },
  { pattern: /\b(3\s*hours?|three\s*hours?)\b/i,               hours: 3  },
  { pattern: /\b(2\s*hours?|two\s*hours?|few\s*hours)\b/i,     hours: 2  },
  { pattern: /\b(1\s*hour|one\s*hour|an?\s*hour)\b/i,          hours: 1  },
  { pattern: /\b(30\s*min|half\s*hour|thirty\s*min)\b/i,       hours: 0.5 },
  { pattern: /\b(casual|slowly|gradually|whenever)\b/i,        hours: 0.5 },
];

function parsePlanRequest(analysis: ConversationAnalysis): PlanRequest {
  const raw = analysis.normalizedText;
  let dailyHours: number | null = null;
  let weeklyHours: number | null = null;
  let tasksPerDay: number | null = null;
  let timelineWeeks: number | null = null;
  let isExplicitTime = false;
  let rawTimeExpression: string | null = null;

  // 1. "X hours per day"
  const dailyHoursMatch = raw.match(DAILY_HOURS_RE);
  if (dailyHoursMatch) {
    dailyHours = parseFloat(dailyHoursMatch[1]);
    rawTimeExpression = dailyHoursMatch[0];
    isExplicitTime = true;
  }

  // 2. "X hours per week" → daily
  if (!dailyHours) {
    const weeklyHoursMatch = raw.match(WEEKLY_HOURS_RE);
    if (weeklyHoursMatch) {
      weeklyHours = parseFloat(weeklyHoursMatch[1]);
      dailyHours = weeklyHours / 7;
      rawTimeExpression = weeklyHoursMatch[0];
      isExplicitTime = true;
    }
  }

  // 3. "X minutes per day"
  if (!dailyHours) {
    const dailyMinMatch = raw.match(DAILY_MINUTES_RE);
    if (dailyMinMatch) {
      dailyHours = parseInt(dailyMinMatch[1]) / 60;
      rawTimeExpression = dailyMinMatch[0];
      isExplicitTime = true;
    }
  }

  // 4. "X tasks/problems/chapters per day" → estimate hours
  if (!dailyHours) {
    const taskMatch = raw.match(DAILY_TASKS_RE);
    if (taskMatch) {
      const count = parseInt(taskMatch[1]);
      const taskWord = taskMatch[2].toLowerCase();
      tasksPerDay = count;
      dailyHours = estimateTaskHours(count, taskWord, analysis.domain);
      rawTimeExpression = taskMatch[0];
      isExplicitTime = true;
    }
  }

  // 5. "X sessions per week" → daily average
  if (!dailyHours) {
    const weeklyMatch = raw.match(WEEKLY_SESSIONS_RE);
    if (weeklyMatch) {
      const sessions = parseInt(weeklyMatch[1]);
      dailyHours = (sessions * estimateSessionHours(analysis.domain)) / 7;
      rawTimeExpression = weeklyMatch[0];
      isExplicitTime = true;
    }
  }

  // 6. Bare "X hours" in short message
  if (!dailyHours && analysis.wordCount <= 20) {
    const hoursAloneMatch = raw.match(HOURS_ALONE_RE);
    if (hoursAloneMatch) {
      dailyHours = parseFloat(hoursAloneMatch[1]);
      rawTimeExpression = hoursAloneMatch[0];
      isExplicitTime = true;
    }
  }

  // 7. Intensity keyword fallback
  if (!dailyHours) {
    for (const { pattern, hours } of INTENSITY_DAILY_HOURS) {
      if (pattern.test(raw)) {
        dailyHours = hours;
        isExplicitTime = false;
        break;
      }
    }
  }

  // Parse timeline
  const timelineMatch = raw.match(TIMELINE_RE);
  if (timelineMatch) {
    const val = parseInt(timelineMatch[1]);
    const unit = timelineMatch[0].toLowerCase();
    if (/month/.test(unit))  timelineWeeks = val * 4;
    else if (/week/.test(unit)) timelineWeeks = val;
    else if (/day/.test(unit))  timelineWeeks = Math.ceil(val / 7);
  }

  // Derive from horizon if timeline not found
  if (!timelineWeeks) {
    const horizonMap: Record<string, number> = {
      immediate: 1, short_term: 2, medium_term: 8, long_term: 16,
    };
    timelineWeeks = horizonMap[analysis.goal?.horizon ?? "medium_term"] ?? 8;
  }

  const effectiveDailyHours = dailyHours ?? domainDefaultHours(analysis.domain);

  return {
    dailyHours,
    weeklyHours,
    effectiveDailyHours,
    tasksPerDay,
    timelineWeeks,
    domain: analysis.domain,
    goalDescription: analysis.goal?.normalized ?? analysis.normalizedText.slice(0, 80),
    horizon: analysis.goal?.horizon ?? "medium_term",
    isExplicitTime,
    rawTimeExpression,
  };
}

function estimateTaskHours(count: number, taskWord: string, domain: Domain): number {
  const table = TASK_TIME_HOURS[domain] ?? TASK_TIME_HOURS.unknown;
  const match = table.find((e) => e.match.test(taskWord));
  return match ? count * match.hoursEach : count * 0.75;
}

function estimateSessionHours(domain: Domain): number {
  const defaults: Record<Domain, number> = {
    fitness: 1.25, study: 1.5, career: 1.0,
    habits: 0.5, finance: 0.5, mental_health: 1.0,
    relationships: 1.0, creative: 1.5, unknown: 1.0,
  };
  return defaults[domain] ?? 1.0;
}

function domainDefaultHours(domain: Domain): number {
  const defaults: Record<Domain, number> = {
    fitness: 1.0, study: 2.0, career: 2.0,
    habits: 0.5, finance: 0.5, mental_health: 0.5,
    relationships: 0.5, creative: 1.5, unknown: 1.0,
  };
  return defaults[domain] ?? 1.0;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CAPACITY RESOLVER
// ═══════════════════════════════════════════════════════════════════════════════

function resolveAvailableHours(
  state: MentorState,
  constraints: DetectedConstraint[],
  activeGoalCount: number
): number {
  // Map capacity score to base productive hours
  let baseHours = 1.0;
  for (const [min, max, hours] of CAPACITY_HOUR_MAP) {
    if (state.capacity >= min && state.capacity < max) {
      // Linear interpolation within bucket
      const ratio = (state.capacity - min) / (max - min);
      const nextHours = CAPACITY_HOUR_MAP.find(([m]) => m === max)?.[2] ?? hours;
      baseHours = hours + ratio * (nextHours - hours);
      break;
    }
  }

  // Apply burnoutRisk penalty on top of capacity
  const burnoutPenalty = state.burnoutRisk > 60
    ? ((state.burnoutRisk - 60) / 40) * 2.0
    : 0;

  // Constraint hour penalties
  let constraintPenalty = 0;
  for (const c of constraints) {
    const base = CONSTRAINT_HOUR_PENALTY[c.type as ConstraintType] ?? 0;
    const severityMult = c.severity === "severe" ? 1.5 : c.severity === "mild" ? 0.5 : 1.0;
    const temporaryMult = c.isTemporary ? 0.65 : 1.0;
    constraintPenalty += base * severityMult * temporaryMult;
  }

  // Existing goals consume time
  const existingLoad = Math.min(activeGoalCount * EXISTING_GOAL_DAILY_HOURS, 3.0);

  const available = Math.max(0.25, baseHours - burnoutPenalty - constraintPenalty - existingLoad);
  return parseFloat(available.toFixed(2));
}

function resolveSustainableHours(available: number, state: MentorState): number {
  const completionFactor = state.completionRate30d > 0 ? state.completionRate30d : 0.5;
  const stressFactor     = Math.max(0.3, 1 - (state.stress / 200));
  const raw = available * completionFactor * stressFactor * (1 - BUFFER_RATIO);
  return parseFloat(Math.max(0.25, raw).toFixed(2));
}

// ═══════════════════════════════════════════════════════════════════════════════
// EVALUATORS (each returns 0-100)
// ═══════════════════════════════════════════════════════════════════════════════

interface EvalResult {
  score: number;
  blocker: FeasibilityBlocker | null;
  warning: FeasibilityWarning | null;
}

function evaluateTime(
  requested: number,
  available: number,
  domain: Domain
): EvalResult {
  const ratio = available > 0 ? requested / available : 10;

  let score: number;
  if      (ratio <= 0.60) score = 100;
  else if (ratio <= 0.80) score = 90;
  else if (ratio <= 1.00) score = 70;
  else if (ratio <= 1.25) score = 45;
  else if (ratio <= 1.60) score = 20;
  else                    score = 0;

  const blocker: FeasibilityBlocker | null =
    ratio > 1.0
      ? {
          type: "time_overcommit",
          severity: ratio > 2.0 ? "critical" : ratio > 1.4 ? "major" : "minor",
          description: `Requested ${requested.toFixed(1)}h/day but only ${available.toFixed(1)}h available (${Math.round(ratio * 100)}% of capacity)`,
          impact: `At this load, the plan fails within 1–2 weeks when any life disruption occurs.`,
          fixable: true,
          suggestedFix: `Reduce to ${(available * 0.75).toFixed(1)}h/day — sustainable load with buffer.`,
        }
      : null;

  const warning: FeasibilityWarning | null =
    ratio > 0.85 && ratio <= 1.0
      ? {
          id: "near_capacity",
          message: `Plan uses ${Math.round(ratio * 100)}% of available capacity — no buffer for life disruptions.`,
          recommendation: "Reserve at least 20–30% buffer. Reduce daily target slightly.",
        }
      : null;

  return { score, blocker, warning };
}

function evaluateStress(state: MentorState, requested: number): EvalResult {
  let score: number;
  if      (state.stress <= 25) score = 100;
  else if (state.stress <= 40) score = 90;
  else if (state.stress <= 55) score = 75;
  else if (state.stress <= 65) score = 55;
  else if (state.stress <= 75) score = 30;
  else if (state.stress <= 85) score = 15;
  else                         score = 5;

  const blocker: FeasibilityBlocker | null =
    state.stress >= 70
      ? {
          type: "stress_too_high",
          severity: state.stress >= 80 ? "critical" : "major",
          description: `Current stress level (${state.stress}/100) makes a ${requested.toFixed(1)}h/day plan unsustainable.`,
          impact: "High stress compounds — adding load now will increase burnout risk, not productivity.",
          fixable: true,
          suggestedFix: `Reduce plan to under ${(requested * 0.5).toFixed(1)}h/day until stress drops below 50.`,
        }
      : null;

  const warning: FeasibilityWarning | null =
    state.stress >= 55 && state.stress < 70
      ? {
          id: "elevated_stress",
          message: `Stress at ${state.stress}/100 — plan may slip under pressure.`,
          recommendation: "Build recovery blocks into the plan. Adjust intensity on high-stress days.",
        }
      : null;

  return { score, blocker, warning };
}

function evaluateConsistency(state: MentorState, requested: number, available: number): EvalResult {
  const rate = state.completionRate30d > 0 ? state.completionRate30d : state.completionRate7d;
  const effectiveCapacity = available * rate;
  const ratio = effectiveCapacity > 0 ? requested / effectiveCapacity : 5;

  let score: number;
  if      (ratio <= 0.70) score = 100;
  else if (ratio <= 1.00) score = 80;
  else if (ratio <= 1.30) score = 60;
  else if (ratio <= 1.60) score = 35;
  else if (ratio <= 2.50) score = 15;
  else                    score = 5;

  // Penalty for consecutive misses
  if (state.consecutiveMisses >= 3) score = Math.max(0, score - 20);
  if (state.consecutiveMisses >= 5) score = Math.max(0, score - 15);

  const blocker: FeasibilityBlocker | null =
    score < 40
      ? {
          type: "consistency_history_insufficient",
          severity: score < 20 ? "critical" : "major",
          description: `Historical completion rate (${Math.round(rate * 100)}%) means effective capacity is only ${effectiveCapacity.toFixed(1)}h/day, not the theoretical ${available.toFixed(1)}h.`,
          impact: `Requesting ${requested.toFixed(1)}h/day when history shows ${effectiveCapacity.toFixed(1)}h/day of actual output.`,
          fixable: true,
          suggestedFix: `Match target to actual output: ${(effectiveCapacity * 0.9).toFixed(1)}h/day. Improve the rate before increasing load.`,
        }
      : null;

  const warning: FeasibilityWarning | null =
    state.consecutiveMisses >= 2
      ? {
          id: "streak_at_risk",
          message: `${state.consecutiveMisses} consecutive misses — commitment pattern is currently unreliable.`,
          recommendation: "Start with a smaller daily minimum to rebuild momentum before targeting full load.",
        }
      : null;

  return { score, blocker, warning };
}

function evaluateHabitGap(state: MentorState, requested: number, available: number): EvalResult {
  // What the user currently actually produces per day
  const currentDailyOutput = available * Math.max(state.completionRate7d, 0.1);
  const ratio = currentDailyOutput > 0 ? requested / currentDailyOutput : 10;

  let score: number;
  if      (ratio <= 1.20) score = 100; // realistic step up
  else if (ratio <= 1.50) score = 85;
  else if (ratio <= 2.00) score = 65;
  else if (ratio <= 3.00) score = 35;
  else if (ratio <= 5.00) score = 15;
  else                    score = 0;

  const blocker: FeasibilityBlocker | null =
    ratio > 3.0
      ? {
          type: "habit_gap_too_large",
          severity: ratio > 5 ? "critical" : "major",
          description: `Requesting ${ratio.toFixed(1)}× current actual output (current: ~${currentDailyOutput.toFixed(1)}h/day → target: ${requested.toFixed(1)}h/day).`,
          impact: "Habit research shows >2× jumps fail 80%+ of the time. The gap is too large to bridge in one step.",
          fixable: true,
          suggestedFix: `Start at ${(currentDailyOutput * 1.3).toFixed(1)}h/day (30% increase). Scale up every 2 weeks.`,
        }
      : null;

  const warning: FeasibilityWarning | null =
    ratio > 2.0 && ratio <= 3.0
      ? {
          id: "large_habit_jump",
          message: `Requested load is ${ratio.toFixed(1)}× current actual output — high drop-off risk in week 2.`,
          recommendation: "Add a ramp period: week 1 at 60% of target, week 2 at 80%, week 3 at full.",
        }
      : null;

  return { score, blocker, warning };
}

function evaluateGoalOverload(memory: MemoryContext, state: MentorState): EvalResult {
  const activeGoals = memory.longTerm.goals.length;
  let score: number;
  let blocker: FeasibilityBlocker | null = null;
  let warning: FeasibilityWarning | null = null;

  if      (activeGoals === 0) score = 100;
  else if (activeGoals === 1) score = 90;
  else if (activeGoals === 2) score = 75;
  else if (activeGoals === 3) score = 55;
  else if (activeGoals === 4) score = 35;
  else                        score = 15;

  if (activeGoals >= 4) {
    blocker = {
      type: "goal_overload",
      severity: activeGoals >= 5 ? "major" : "minor",
      description: `${activeGoals} active goals are already consuming capacity.`,
      impact: "Each active goal reduces focus and increases cognitive load. Adding another fragments attention.",
      fixable: true,
      suggestedFix: "Complete or pause one existing goal before starting a new one.",
    };
  } else if (activeGoals === 3) {
    warning = {
      id: "approaching_overload",
      message: `${activeGoals} active goals — adding another risks splitting attention below effective threshold.`,
      recommendation: "Confirm this is the highest priority. Deprioritise or pause one existing goal.",
    };
  }

  return { score, blocker, warning };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ADJUSTED PLAN GENERATOR
// ═══════════════════════════════════════════════════════════════════════════════

function generateAdjustedPlan(
  request: PlanRequest,
  sustainable: number,
  scores: EvaluationScores,
  state: MentorState,
  now: Date
): AdjustedPlan {
  const domain   = request.domain;
  const timeline = request.timelineWeeks ?? 8;
  const original = request.effectiveDailyHours;

  // Decide approach based on scores and gap magnitude
  const habitGapSevere   = scores.habitGap < 40;
  const consistencyLow   = scores.consistency < 45;
  const timeGapSevere    = scores.time < 30;

  let approach: AdjustedPlan["approach"];
  if (habitGapSevere || consistencyLow) {
    approach = "phased";
  } else if (timeGapSevere) {
    approach = "scaled_down";
  } else {
    approach = "timeline_extended";
  }

  // Calculate adjusted daily hours (sustainable × 0.85 to preserve buffer)
  const target = parseFloat((sustainable * 0.85).toFixed(2));

  // Extended timeline proportional to reduction
  const scaleFactor     = original > 0 ? target / original : 1;
  const adjustedWeeks   = Math.ceil(timeline / scaleFactor);
  const reductionRatio  = parseFloat(scaleFactor.toFixed(2));

  // Build phases
  const phases: PlanPhase[] = buildPhases(approach, target, adjustedWeeks, domain, request, state);

  const estimatedCompletion = new Date(now.getTime() + adjustedWeeks * 7 * 86_400_000);

  const summaryParts = [
    `Start at ${phases[0]?.dailyHours.toFixed(1) ?? target.toFixed(1)}h/day`,
    phases.length > 1 ? `scale to ${target.toFixed(1)}h/day by week ${phases[1]?.durationWeeks ?? 2}` : null,
    `timeline: ${adjustedWeeks} weeks`,
  ].filter(Boolean);

  return {
    approach,
    summary: summaryParts.join(" → "),
    adjustedDailyHours: target,
    adjustedTimelineWeeks: adjustedWeeks,
    phases,
    reductionRatio,
    bufferPercent: Math.round((1 - target / (sustainable || 1)) * 100),
    estimatedCompletionDate: estimatedCompletion,
  };
}

function buildPhases(
  approach: AdjustedPlan["approach"],
  targetHours: number,
  totalWeeks: number,
  domain: Domain,
  request: PlanRequest,
  state: MentorState
): PlanPhase[] {
  const taskEstimate = request.tasksPerDay
    ? Math.round(request.tasksPerDay * (targetHours / (request.effectiveDailyHours || targetHours)))
    : null;

  if (approach === "scaled_down" || totalWeeks <= 3) {
    return [
      {
        phaseNumber: 1,
        name: "Sustainable Execution",
        durationWeeks: totalWeeks,
        dailyHours: targetHours,
        dailyTasks: taskEstimate,
        focus: `Consistent ${targetHours.toFixed(1)}h/day on ${request.goalDescription.slice(0, 50)}`,
        milestone: `${totalWeeks} weeks of sustained effort at realistic load`,
        successCriteria: `Complete ${Math.round(totalWeeks * 7 * targetHours)} total hours of work`,
      },
    ];
  }

  if (approach === "phased") {
    const phase1Hours = parseFloat((targetHours * 0.50).toFixed(2));
    const phase2Hours = parseFloat((targetHours * 0.75).toFixed(2));

    const week1End = 2;
    const week2End = Math.min(Math.round(totalWeeks * 0.40), week1End + 3);
    const week3End = totalWeeks;

    const phases: PlanPhase[] = [
      {
        phaseNumber: 1,
        name: "Habit Anchor",
        durationWeeks: week1End,
        dailyHours: phase1Hours,
        dailyTasks: taskEstimate ? Math.max(1, Math.round(taskEstimate * 0.5)) : null,
        focus: `Build the daily habit at ${phase1Hours.toFixed(1)}h/day — no exceptions`,
        milestone: `14 consecutive days of showing up`,
        successCriteria: `Miss fewer than 2 days in these ${week1End} weeks`,
      },
      {
        phaseNumber: 2,
        name: "Load Build",
        durationWeeks: week2End - week1End,
        dailyHours: phase2Hours,
        dailyTasks: taskEstimate ? Math.max(1, Math.round(taskEstimate * 0.75)) : null,
        focus: `Increase to ${phase2Hours.toFixed(1)}h/day while maintaining daily habit`,
        milestone: `Weekly targets hit 4/5 days`,
        successCriteria: `70%+ completion rate over this phase`,
      },
    ];

    if (week3End > week2End) {
      phases.push({
        phaseNumber: 3,
        name: "Full Execution",
        durationWeeks: week3End - week2End,
        dailyHours: targetHours,
        dailyTasks: taskEstimate,
        focus: `Full ${targetHours.toFixed(1)}h/day — sustainable max load`,
        milestone: `Deliver the original goal`,
        successCriteria: `80%+ weekly completion, goal complete by week ${week3End}`,
      });
    }

    return phases;
  }

  // timeline_extended: two equal phases
  const halfPoint = Math.ceil(totalWeeks / 2);
  return [
    {
      phaseNumber: 1,
      name: "Consistent Start",
      durationWeeks: halfPoint,
      dailyHours: parseFloat((targetHours * 0.80).toFixed(2)),
      dailyTasks: taskEstimate ? Math.round(taskEstimate * 0.8) : null,
      focus: `Build rhythm at ${(targetHours * 0.80).toFixed(1)}h/day`,
      milestone: `Streak of 10+ days without a miss`,
      successCriteria: `75%+ completion rate`,
    },
    {
      phaseNumber: 2,
      name: "Full Execution",
      durationWeeks: totalWeeks - halfPoint,
      dailyHours: targetHours,
      dailyTasks: taskEstimate,
      focus: `Lock in ${targetHours.toFixed(1)}h/day — finish strong`,
      milestone: `Complete goal`,
      successCriteria: `80%+ weekly completion rate`,
    },
  ];
}

// ═══════════════════════════════════════════════════════════════════════════════
// ADJUSTMENT RECOMMENDATIONS
// ═══════════════════════════════════════════════════════════════════════════════

function buildAdjustments(
  request: PlanRequest,
  scores: EvaluationScores,
  available: number,
  sustainable: number
): PlanAdjustment[] {
  const adjustments: PlanAdjustment[] = [];

  if (scores.time < 65) {
    const recommended = parseFloat((sustainable * 0.85).toFixed(2));
    adjustments.push({
      field: "daily_hours",
      originalValue: `${request.effectiveDailyHours.toFixed(1)}h/day`,
      suggestedValue: `${recommended.toFixed(1)}h/day`,
      reason: `Current capacity supports ${available.toFixed(1)}h/day; sustainable target is ~${recommended.toFixed(1)}h/day with buffer`,
      impact: `Reduces overcommitment risk by ${Math.round((1 - recommended / request.effectiveDailyHours) * 100)}%`,
    });
  }

  if (scores.consistency < 55 || scores.habitGap < 55) {
    adjustments.push({
      field: "phase_approach",
      originalValue: "single block execution",
      suggestedValue: "3-phase ramp: habit anchor → load build → full execution",
      reason: `Consistency score (${Math.round(scores.consistency)}) and habit gap indicate a ramp is needed to prevent early dropout`,
      impact: "Increases 8-week completion probability from ~30% to ~65%",
    });
  }

  if (request.timelineWeeks && scores.time < 55) {
    const extended = Math.ceil(request.timelineWeeks / (sustainable / request.effectiveDailyHours));
    adjustments.push({
      field: "timeline_weeks",
      originalValue: `${request.timelineWeeks} weeks`,
      suggestedValue: `${extended} weeks`,
      reason: "Extended timeline compensates for reduced daily load",
      impact: `Same total work delivered — spread over ${extended} weeks instead of ${request.timelineWeeks}`,
    });
  }

  if (request.tasksPerDay && scores.time < 65) {
    const scaleFactor = sustainable / request.effectiveDailyHours;
    const adjustedTasks = Math.max(1, Math.round(request.tasksPerDay * scaleFactor));
    adjustments.push({
      field: "tasks_per_day",
      originalValue: `${request.tasksPerDay} tasks/day`,
      suggestedValue: `${adjustedTasks} tasks/day`,
      reason: "Scaled proportionally to match sustainable daily hours",
      impact: `Maintains quality over quantity`,
    });
  }

  return adjustments;
}

// ═══════════════════════════════════════════════════════════════════════════════
// REASONING BUILDER
// ═══════════════════════════════════════════════════════════════════════════════

function buildReasoning(
  status: FeasibilityStatus,
  request: PlanRequest,
  available: number,
  sustainable: number,
  scores: EvaluationScores,
  blockers: FeasibilityBlocker[]
): string {
  const parts: string[] = [];

  parts.push(`Requested: ${request.effectiveDailyHours.toFixed(1)}h/day. Available: ${available.toFixed(1)}h/day. Sustainable: ${sustainable.toFixed(1)}h/day.`);

  if (blockers.length > 0) {
    parts.push(`Primary blockers: ${blockers.map((b) => b.type.replace(/_/g, " ")).join(", ")}.`);
  }

  const lowestDimension = Object.entries(scores)
    .filter(([k]) => k !== "overall")
    .sort(([, a], [, b]) => a - b)[0];

  if (lowestDimension) {
    parts.push(`Weakest dimension: ${lowestDimension[0]} (${Math.round(lowestDimension[1])}/100).`);
  }

  if (status === "feasible") {
    parts.push("This plan is achievable with current capacity.");
  } else if (status === "partially_feasible") {
    parts.push("Achievable with scope reduction or phased approach.");
  } else {
    parts.push("Not achievable at this load given current state.");
  }

  return parts.join(" ");
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Evaluates whether a requested plan/commitment is achievable
 * given the user's current capacity, stress, consistency history, and habits.
 */
export function evaluateFeasibility(input: FeasibilityInput): FeasibilityResult {
  const { analysis, state, memory } = input;
  const now = input.now ?? new Date();

  // 1. Determine if there is enough information to evaluate
  const canEvaluate =
    (analysis.intent === "plan_request" ||
      analysis.intent === "goal_set" ||
      analysis.intent === "commitment_made") &&
    analysis.goal !== null;

  if (!canEvaluate) {
    return emptyResult(analysis, state, memory, now);
  }

  // 2. Parse what was requested
  const request = parsePlanRequest(analysis);

  // 3. Resolve actual capacity
  const activeGoalCount = memory.longTerm.goals.length;
  const available       = resolveAvailableHours(state, analysis.constraints, activeGoalCount);
  const sustainable     = resolveSustainableHours(available, state);

  // 4. Run all evaluators
  const timeEval        = evaluateTime(request.effectiveDailyHours, available, request.domain);
  const stressEval      = evaluateStress(state, request.effectiveDailyHours);
  const consistencyEval = evaluateConsistency(state, request.effectiveDailyHours, available);
  const habitEval       = evaluateHabitGap(state, request.effectiveDailyHours, available);
  const overloadEval    = evaluateGoalOverload(memory, state);

  // 5. Compute weighted overall score
  const overall = Math.round(
    timeEval.score        * SCORE_WEIGHTS.time        +
    stressEval.score      * SCORE_WEIGHTS.stress      +
    consistencyEval.score * SCORE_WEIGHTS.consistency +
    habitEval.score       * SCORE_WEIGHTS.habitGap
  );

  const scores: EvaluationScores = {
    time:        timeEval.score,
    stress:      stressEval.score,
    consistency: consistencyEval.score,
    habitGap:    habitEval.score,
    overall,
  };

  // 6. Determine status
  const status: FeasibilityStatus =
    overall >= THRESHOLDS.feasible
      ? "feasible"
      : overall >= THRESHOLDS.partially_feasible
      ? "partially_feasible"
      : "not_feasible";

  // 7. Collect blockers and warnings
  const blockers: FeasibilityBlocker[] = [
    timeEval.blocker,
    stressEval.blocker,
    consistencyEval.blocker,
    habitEval.blocker,
    overloadEval.blocker,
  ].filter((b): b is FeasibilityBlocker => b !== null);

  const warnings: FeasibilityWarning[] = [
    timeEval.warning,
    stressEval.warning,
    consistencyEval.warning,
    habitEval.warning,
    overloadEval.warning,
  ].filter((w): w is FeasibilityWarning => w !== null);

  // 8. Build adjustments
  const adjustments = buildAdjustments(request, scores, available, sustainable);

  // 9. Generate adjusted plan for non-feasible or partially feasible
  const adjustedPlan =
    status !== "feasible"
      ? generateAdjustedPlan(request, sustainable, scores, state, now)
      : null;

  // 10. Capacity utilisation
  const capacityUsed      = available > 0 ? Math.round((request.effectiveDailyHours / available) * 100) : 100;
  const capacityRemaining = Math.max(0, 100 - capacityUsed);

  return {
    status,
    scores,
    blockers,
    adjustments,
    warnings,
    adjustedPlan,
    availableHoursPerDay:   available,
    requestedHoursPerDay:   request.effectiveDailyHours,
    sustainableHoursPerDay: sustainable,
    capacityUsedPercent:    capacityUsed,
    capacityRemainingPercent: capacityRemaining,
    reasoning: buildReasoning(status, request, available, sustainable, scores, blockers),
    parsedRequest: request,
    canEvaluate: true,
  };
}

function emptyResult(
  analysis: ConversationAnalysis,
  state: MentorState,
  memory: MemoryContext,
  now: Date
): FeasibilityResult {
  const available   = resolveAvailableHours(state, analysis.constraints, memory.longTerm.goals.length);
  const sustainable = resolveSustainableHours(available, state);

  return {
    status: "feasible",
    scores: { time: 100, stress: 100, consistency: 100, habitGap: 100, overall: 100 },
    blockers: [],
    adjustments: [],
    warnings: [],
    adjustedPlan: null,
    availableHoursPerDay:     available,
    requestedHoursPerDay:     0,
    sustainableHoursPerDay:   sustainable,
    capacityUsedPercent:      0,
    capacityRemainingPercent: 100,
    reasoning: "No specific plan request detected — no feasibility evaluation needed.",
    parsedRequest: {
      dailyHours: null, weeklyHours: null, effectiveDailyHours: 0,
      tasksPerDay: null, timelineWeeks: null,
      domain: analysis.domain, goalDescription: "",
      horizon: "medium_term", isExplicitTime: false, rawTimeExpression: null,
    },
    canEvaluate: false,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Quick check for use in the decision engine: is this plan feasible?
 */
export function isFeasible(input: FeasibilityInput): boolean {
  return evaluateFeasibility(input).status === "feasible";
}

/**
 * Returns just the available hours per day for the current user state.
 * Used by the planner engine to set its upper bound.
 */
export function getAvailableHours(state: MentorState, constraints: DetectedConstraint[], goalCount: number): number {
  return resolveAvailableHours(state, constraints, goalCount);
}

/**
 * Returns just the sustainable hours per day — the realistic daily target
 * after factoring in history, stress, and buffer.
 */
export function getSustainableHours(state: MentorState, constraints: DetectedConstraint[], goalCount: number): number {
  const available = resolveAvailableHours(state, constraints, goalCount);
  return resolveSustainableHours(available, state);
}

/**
 * One-line summary for logging and decision engine context hints.
 */
export function summarizeFeasibility(result: FeasibilityResult): string {
  if (!result.canEvaluate) return "no_plan_request";
  return [
    result.status,
    `score:${result.scores.overall}`,
    `req:${result.requestedHoursPerDay.toFixed(1)}h available:${result.availableHoursPerDay.toFixed(1)}h`,
    result.blockers.length > 0 ? `blockers:${result.blockers.map((b) => b.type).join(",")}` : null,
  ].filter(Boolean).join(" | ");
}
