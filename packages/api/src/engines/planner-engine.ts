import type { ConversationAnalysis, Domain } from "../types/mentor.types";
import type { MemoryContext } from "../types/memory.types";
import type { MentorState } from "./user-state-engine";
import type { FeasibilityResult } from "./feasibility-engine";
import { evaluateFeasibility, getAvailableHours, getSustainableHours } from "./feasibility-engine";

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export type PlanMode = "daily" | "weekly" | "recovery" | "exam_mode" | "busy_week";

export type BlockType =
  | "deep_work"
  | "practice"
  | "review"
  | "light_work"
  | "prep"
  | "break"
  | "buffer";

export type DaySlot = "morning" | "midday" | "afternoon" | "evening" | "flexible";

export interface TimeBlock {
  id: string;
  type: BlockType;
  durationMinutes: number;
  slot: DaySlot;
  label: string;
  description: string;
  isNonNegotiable: boolean;
  capacityRequired: number;
}

export interface DaySchedule {
  dayIndex: number;
  dayLabel: string;
  isRestDay: boolean;
  blocks: TimeBlock[];
  totalMinutes: number;
  totalHours: number;
  targetCompletionRate: number;
  note: string | null;
}

export interface PlanAdaptation {
  dimension: "motivation" | "consistency" | "stress" | "capacity";
  value: number;
  adjustment: string;
  impact: string;
}

export interface PlanGuard {
  type: "capacity_gate" | "constraint_gate" | "feasibility_ceiling" | "burnout_protection";
  triggered: boolean;
  reason: string;
  action: string;
}

export interface PlanWarning {
  id: string;
  message: string;
  recommendation: string;
}

export interface PlanMetadata {
  mode: PlanMode;
  domain: Domain;
  goalDescription: string;
  generatedAt: Date;
  validForDays: number;
  capacityAtGeneration: number;
  sustainableHoursPerDay: number;
  totalPlannedHours: number;
  feasibilityScore: number;
  adaptations: PlanAdaptation[];
  guardsTriggered: PlanGuard[];
  warnings: PlanWarning[];
}

export interface RecoveryProtocol {
  maxDailyMinutes: number;
  breakBetweenBlocksMinutes: number;
  noLateNightWork: boolean;
  focusAreas: string[];
  avoidList: string[];
}

export interface DailyPlanResult {
  mode: "daily";
  schedule: DaySchedule;
  metadata: PlanMetadata;
}

export interface WeeklyPlanResult {
  mode: "weekly";
  days: DaySchedule[];
  weeklyTargetHours: number;
  restDayIndices: number[];
  metadata: PlanMetadata;
}

export interface RecoveryPlanResult {
  mode: "recovery";
  days: DaySchedule[];
  protocol: RecoveryProtocol;
  estimatedRecoveryDays: number;
  metadata: PlanMetadata;
}

export interface ExamModePlanResult {
  mode: "exam_mode";
  days: DaySchedule[];
  intensityLevel: "high" | "maximum";
  totalStudyHours: number;
  examDate: Date | null;
  metadata: PlanMetadata;
}

export interface BusyWeekPlanResult {
  mode: "busy_week";
  days: DaySchedule[];
  minimumViableCommitment: string;
  droppedItems: string[];
  metadata: PlanMetadata;
}

export type GeneratedPlan =
  | DailyPlanResult
  | WeeklyPlanResult
  | RecoveryPlanResult
  | ExamModePlanResult
  | BusyWeekPlanResult;

export interface PlanGenerationError {
  canGenerate: false;
  reason: string;
  requiredCapacity: number;
  currentCapacity: number;
  blockedBy: string[];
  suggestedAction: string;
}

export type PlannerResult =
  | { canGenerate: true; plan: GeneratedPlan }
  | PlanGenerationError;

export interface PlannerInput {
  state: MentorState;
  analysis: ConversationAnalysis;
  memory: MemoryContext;
  requestedMode?: PlanMode;
  feasibility?: FeasibilityResult;
  examDate?: Date;
  now?: Date;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

const MIN_CAPACITY_TO_PLAN      = 15;
const MIN_FEASIBILITY_SCORE     = 20;
const RECOVERY_STRESS_THRESHOLD = 70;
const RECOVERY_BURNOUT_THRESHOLD = 65;
const EXAM_MODE_DAILY_CAP_HOURS = 8;
const BUSY_WEEK_MAX_DAILY_HOURS = 1.5;
const BUFFER_RATIO              = 0.20;

// Motivation → multiplier on sustainable hours
const MOTIVATION_MULTIPLIERS: Array<[minMotivation: number, multiplier: number]> = [
  [70, 1.00],
  [50, 0.90],
  [35, 0.75],
  [0,  0.60],
];

// Consistency → recommended rest days per week
const CONSISTENCY_REST_DAYS: Array<[minConsistency: number, restDays: number]> = [
  [70, 1],
  [50, 2],
  [30, 3],
  [0,  4],
];

const DAY_LABELS       = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const HEAVY_LOAD_DAYS  = [1, 2, 3]; // Tue, Wed, Thu (0-based, Monday = 0)

// ═══════════════════════════════════════════════════════════════════════════════
// BLOCK TEMPLATES
// ═══════════════════════════════════════════════════════════════════════════════

interface BlockTemplate {
  type: BlockType;
  label: string;
  description: string;
  durationMinutes: number;
  slot: DaySlot;
  capacityRequired: number;
  motivationRequired: number;
  isCore: boolean;
}

const DOMAIN_BLOCK_TEMPLATES: Record<Domain, BlockTemplate[]> = {
  study: [
    { type: "deep_work",  label: "Deep study block",     description: "High-focus, distraction-free study session.",              durationMinutes: 90, slot: "morning",   capacityRequired: 55, motivationRequired: 40, isCore: true  },
    { type: "practice",   label: "Practice problems",    description: "Timed exercises to reinforce learning.",                   durationMinutes: 45, slot: "afternoon", capacityRequired: 40, motivationRequired: 30, isCore: false },
    { type: "review",     label: "Review & consolidate", description: "Flashcards, notes review, and spaced repetition.",         durationMinutes: 30, slot: "evening",   capacityRequired: 25, motivationRequired: 20, isCore: false },
    { type: "light_work", label: "Light reading",        description: "Passive review — notes or lecture recap.",                 durationMinutes: 30, slot: "flexible",  capacityRequired: 20, motivationRequired: 15, isCore: false },
  ],
  fitness: [
    { type: "deep_work",  label: "Workout session",      description: "Full workout — primary training block.",                   durationMinutes: 75, slot: "morning",   capacityRequired: 50, motivationRequired: 35, isCore: true  },
    { type: "light_work", label: "Mobility & stretch",   description: "Cooldown: mobility work, foam rolling, stretching.",       durationMinutes: 15, slot: "evening",   capacityRequired: 20, motivationRequired: 15, isCore: false },
    { type: "review",     label: "Log & reflect",        description: "Log workout, note performance, adjust next session.",      durationMinutes: 10, slot: "evening",   capacityRequired: 15, motivationRequired: 10, isCore: false },
  ],
  career: [
    { type: "deep_work",  label: "Deep focus work",      description: "Highest-priority task, zero interruptions.",               durationMinutes: 90, slot: "morning",   capacityRequired: 55, motivationRequired: 40, isCore: true  },
    { type: "practice",   label: "Skill building",       description: "Deliberate practice: coding, writing, case prep.",         durationMinutes: 60, slot: "afternoon", capacityRequired: 40, motivationRequired: 30, isCore: false },
    { type: "review",     label: "Progress review",      description: "Review output, update task tracker, plan tomorrow.",       durationMinutes: 20, slot: "evening",   capacityRequired: 25, motivationRequired: 20, isCore: false },
  ],
  habits: [
    { type: "prep",       label: "Morning routine",      description: "Anchor habit stack — non-negotiable morning ritual.",      durationMinutes: 30, slot: "morning",   capacityRequired: 25, motivationRequired: 20, isCore: true  },
    { type: "review",     label: "Evening reflection",   description: "Journal, habit tracker, 3 wins from today.",               durationMinutes: 20, slot: "evening",   capacityRequired: 20, motivationRequired: 15, isCore: false },
    { type: "light_work", label: "Habit check-in",       description: "Quick mid-day habit reinforcement.",                       durationMinutes: 10, slot: "midday",    capacityRequired: 15, motivationRequired: 10, isCore: false },
  ],
  finance: [
    { type: "deep_work",  label: "Finance review block", description: "Budget tracking, investment review, or financial planning.",durationMinutes: 60, slot: "morning",   capacityRequired: 45, motivationRequired: 35, isCore: true  },
    { type: "review",     label: "Daily expense log",    description: "Log expenses, review vs. budget.",                         durationMinutes: 15, slot: "evening",   capacityRequired: 20, motivationRequired: 15, isCore: false },
  ],
  mental_health: [
    { type: "prep",       label: "Mindfulness session",  description: "Meditation, breathwork, or grounding practice.",           durationMinutes: 20, slot: "morning",   capacityRequired: 20, motivationRequired: 15, isCore: true  },
    { type: "review",     label: "Journal & reflect",    description: "Unstructured journaling — what's coming up, what's true.", durationMinutes: 20, slot: "evening",   capacityRequired: 20, motivationRequired: 10, isCore: false },
    { type: "light_work", label: "Check-in with self",   description: "Mid-day emotional state check-in.",                        durationMinutes: 10, slot: "midday",    capacityRequired: 15, motivationRequired: 10, isCore: false },
  ],
  relationships: [
    { type: "deep_work",  label: "Quality time block",   description: "Scheduled, intentional time with important person(s).",   durationMinutes: 60, slot: "evening",   capacityRequired: 35, motivationRequired: 25, isCore: true  },
    { type: "light_work", label: "Reach out",            description: "Quick messages, check-in calls, or social media.",        durationMinutes: 15, slot: "flexible",  capacityRequired: 20, motivationRequired: 15, isCore: false },
  ],
  creative: [
    { type: "deep_work",  label: "Creative output block",description: "Distraction-free creative work — writing, building, making.", durationMinutes: 90, slot: "morning",   capacityRequired: 50, motivationRequired: 45, isCore: true  },
    { type: "practice",   label: "Skill sharpening",     description: "Targeted practice on a specific technique.",               durationMinutes: 45, slot: "afternoon", capacityRequired: 35, motivationRequired: 30, isCore: false },
    { type: "review",     label: "Review & iterate",     description: "Review today's output, identify what to improve.",         durationMinutes: 20, slot: "evening",   capacityRequired: 20, motivationRequired: 15, isCore: false },
  ],
  unknown: [
    { type: "deep_work",  label: "Focus block",          description: "Dedicated focus time for your primary goal.",              durationMinutes: 60, slot: "morning",   capacityRequired: 40, motivationRequired: 30, isCore: true  },
    { type: "review",     label: "Review",               description: "Review what was done and plan next steps.",                durationMinutes: 20, slot: "evening",   capacityRequired: 20, motivationRequired: 15, isCore: false },
  ],
};

const RECOVERY_BLOCK: BlockTemplate = {
  type: "light_work", label: "Minimum viable block",
  description: "One small, low-stakes action that keeps momentum alive.",
  durationMinutes: 30, slot: "flexible", capacityRequired: 20, motivationRequired: 10, isCore: true,
};

const BREAK_BLOCK: BlockTemplate = {
  type: "break", label: "Recovery break",
  description: "Mandatory rest between intensive blocks.",
  durationMinutes: 20, slot: "flexible", capacityRequired: 0, motivationRequired: 0, isCore: false,
};

// ═══════════════════════════════════════════════════════════════════════════════
// CAPACITY & ADAPTATION RESOLVERS
// ═══════════════════════════════════════════════════════════════════════════════

function resolveMotivationMultiplier(motivation: number): number {
  for (const [min, mult] of MOTIVATION_MULTIPLIERS) {
    if (motivation >= min) return mult;
  }
  return 0.60;
}

function resolveRestDayCount(consistency: number): number {
  for (const [min, days] of CONSISTENCY_REST_DAYS) {
    if (consistency >= min) return days;
  }
  return 4;
}

function resolveTargetHoursPerDay(
  sustainableHours: number,
  state: MentorState,
  mode: PlanMode
): number {
  if (mode === "recovery")  return Math.min(sustainableHours, 0.75);
  if (mode === "busy_week") return Math.min(sustainableHours, BUSY_WEEK_MAX_DAILY_HOURS);
  if (mode === "exam_mode") return Math.min(sustainableHours, EXAM_MODE_DAILY_CAP_HOURS);

  const motivationMult  = resolveMotivationMultiplier(state.motivation);
  const stressPenalty   = state.stress > 55 ? (state.stress - 55) / 200 : 0;
  const consistencyMult = state.consistency < 35 ? 0.70 : 1.0;

  return Math.max(
    0.25,
    parseFloat((sustainableHours * motivationMult * consistencyMult * (1 - stressPenalty) * (1 - BUFFER_RATIO)).toFixed(2))
  );
}

function resolveTargetCompletionRate(state: MentorState): number {
  const base = state.completionRate7d > 0
    ? state.completionRate7d
    : state.completionRate30d > 0 ? state.completionRate30d : 0.6;
  const motivationBoost = state.motivation > 65 ? 0.05 : 0;
  const stressPenalty   = state.stress > 60 ? 0.10 : state.stress > 45 ? 0.05 : 0;
  return parseFloat(Math.min(0.95, Math.max(0.25, base + motivationBoost - stressPenalty)).toFixed(2));
}

function detectAdaptations(state: MentorState, mode: PlanMode): PlanAdaptation[] {
  const adaptations: PlanAdaptation[] = [];

  if (state.motivation <= 30) {
    adaptations.push({
      dimension: "motivation", value: state.motivation,
      adjustment: "Reduced to single non-negotiable block per day",
      impact: "Lowers the floor to guarantee a win. Volume expands once momentum returns.",
    });
  } else if (state.motivation <= 50) {
    adaptations.push({
      dimension: "motivation", value: state.motivation,
      adjustment: "Planned hours reduced by 25%",
      impact: "Matches realistic output given current drive level.",
    });
  }

  if (state.consistency <= 25) {
    adaptations.push({
      dimension: "consistency", value: state.consistency,
      adjustment: "Plan uses minimum viable structure — 1 core block only",
      impact: "Rebuilds the habit loop before adding volume.",
    });
  } else if (state.consistency <= 45) {
    adaptations.push({
      dimension: "consistency", value: state.consistency,
      adjustment: "Additional rest days added to the weekly plan",
      impact: "Reduces pressure points that cause avoidance.",
    });
  }

  if (state.stress >= RECOVERY_STRESS_THRESHOLD && mode !== "recovery") {
    adaptations.push({
      dimension: "stress", value: state.stress,
      adjustment: "Forced into recovery-mode scheduling",
      impact: "High stress makes intensive blocks counterproductive.",
    });
  } else if (state.stress >= 55) {
    adaptations.push({
      dimension: "stress", value: state.stress,
      adjustment: "Deep work blocks shortened by 15 minutes, breaks added",
      impact: "Maintains output quality when cognitive capacity is compressed.",
    });
  }

  if (state.capacity <= 30) {
    adaptations.push({
      dimension: "capacity", value: state.capacity,
      adjustment: "Only low-demand blocks scheduled (capacityRequired ≤ 35)",
      impact: "Prevents overcommitment when bandwidth is genuinely low.",
    });
  }

  return adaptations;
}

// ═══════════════════════════════════════════════════════════════════════════════
// GUARDS
// ═══════════════════════════════════════════════════════════════════════════════

function checkCapacityGate(state: MentorState): PlanGuard {
  const triggered = state.capacity < MIN_CAPACITY_TO_PLAN;
  return {
    type: "capacity_gate",
    triggered,
    reason: triggered
      ? `Capacity is ${state.capacity}/100 — below minimum of ${MIN_CAPACITY_TO_PLAN} required to plan.`
      : `Capacity is ${state.capacity}/100 — sufficient to plan.`,
    action: triggered ? "Plan generation blocked. Recommend rest before planning." : "Proceed.",
  };
}

function checkConstraintGate(analysis: ConversationAnalysis): PlanGuard {
  const hasData = analysis.constraints.length > 0 || analysis.intent !== "general_chat";
  return {
    type: "constraint_gate",
    triggered: false,
    reason: hasData
      ? `Constraint data present: [${analysis.constraints.map((c) => c.type).join(", ") || "none declared"}]`
      : "No constraints declared — defaulting to zero constraint load.",
    action: "Proceed with available constraint data.",
  };
}

function checkFeasibilityCeiling(feasibility: FeasibilityResult): PlanGuard {
  const triggered = feasibility.scores.overall < MIN_FEASIBILITY_SCORE;
  return {
    type: "feasibility_ceiling",
    triggered,
    reason: triggered
      ? `Feasibility score (${feasibility.scores.overall}/100) is below threshold of ${MIN_FEASIBILITY_SCORE}.`
      : `Feasibility score (${feasibility.scores.overall}/100) is acceptable.`,
    action: triggered
      ? "Plan generation blocked. Address blockers before planning."
      : "Cap planned hours at sustainable ceiling.",
  };
}

function checkBurnoutProtection(state: MentorState): PlanGuard {
  const triggered = state.burnoutRisk >= RECOVERY_BURNOUT_THRESHOLD;
  return {
    type: "burnout_protection",
    triggered,
    reason: triggered
      ? `Burnout risk (${state.burnoutRisk}/100) exceeds threshold of ${RECOVERY_BURNOUT_THRESHOLD} — intensive plans are unsafe.`
      : `Burnout risk (${state.burnoutRisk}/100) within acceptable range.`,
    action: triggered ? "Plan redirected to recovery mode." : "Standard plan generation permitted.",
  };
}

function runGuards(
  state: MentorState,
  analysis: ConversationAnalysis,
  feasibility: FeasibilityResult
): { pass: boolean; guards: PlanGuard[]; blockingReason: string | null } {
  const capacityGuard    = checkCapacityGate(state);
  const constraintGuard  = checkConstraintGate(analysis);
  const feasibilityGuard = checkFeasibilityCeiling(feasibility);
  const burnoutGuard     = checkBurnoutProtection(state);

  const guards = [capacityGuard, constraintGuard, feasibilityGuard, burnoutGuard];

  const hardBlocked   = capacityGuard.triggered || feasibilityGuard.triggered;
  const blockingReason = hardBlocked
    ? [
        capacityGuard.triggered    ? capacityGuard.reason    : null,
        feasibilityGuard.triggered ? feasibilityGuard.reason : null,
      ].filter(Boolean).join(" ")
    : null;

  return { pass: !hardBlocked, guards, blockingReason };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODE SELECTION
// ═══════════════════════════════════════════════════════════════════════════════

function autoSelectMode(
  state: MentorState,
  analysis: ConversationAnalysis,
  requestedMode?: PlanMode
): PlanMode {
  // Stress/burnout overrides all — safety first
  if (state.stress >= RECOVERY_STRESS_THRESHOLD || state.burnoutRisk >= RECOVERY_BURNOUT_THRESHOLD) {
    return "recovery";
  }

  if (requestedMode) return requestedMode;

  const hasExamConstraint = analysis.constraints.some((c) => c.type === "exam_season");
  const hasBusyConstraint = analysis.constraints.some(
    (c) => (c.type === "work_pressure" || c.type === "family_responsibility") && c.severity !== "mild"
  );

  if (hasExamConstraint) return "exam_mode";
  if (hasBusyConstraint) return "busy_week";
  if (state.capacity <= 30 || state.burnoutRisk >= 50) return "recovery";

  return "weekly";
}

// ═══════════════════════════════════════════════════════════════════════════════
// BLOCK SELECTORS
// ═══════════════════════════════════════════════════════════════════════════════

function selectBlocksForCapacity(
  templates: BlockTemplate[],
  targetMinutes: number,
  state: MentorState
): BlockTemplate[] {
  const capacityFilter   = state.capacity   <= 30 ? 35  : state.capacity   <= 50 ? 55  : 100;
  const motivationFilter = state.motivation <= 30 ? 15  : state.motivation <= 50 ? 30  : 100;

  const eligible      = templates.filter((t) => t.capacityRequired <= capacityFilter && t.motivationRequired <= motivationFilter);
  const coreBlocks    = eligible.filter((t) => t.isCore);
  const optionalBlocks = eligible.filter((t) => !t.isCore);

  // Very low motivation or consistency: core only
  if (state.motivation <= 30 || state.consistency <= 25) {
    return coreBlocks.slice(0, 1);
  }

  const selected: BlockTemplate[] = [...coreBlocks];
  let usedMinutes = coreBlocks.reduce((s, t) => s + t.durationMinutes, 0);

  for (const block of optionalBlocks) {
    if (usedMinutes + block.durationMinutes <= targetMinutes) {
      selected.push(block);
      usedMinutes += block.durationMinutes;
    }
  }

  return selected;
}

function buildTimeBlock(
  template: BlockTemplate,
  id: string,
  state: MentorState
): TimeBlock {
  // Shorten deep-work blocks slightly when stress is elevated
  const shortened =
    state.stress >= 55 && template.type === "deep_work"
      ? Math.max(template.durationMinutes - 15, 20)
      : template.durationMinutes;

  return {
    id,
    type: template.type,
    durationMinutes: shortened,
    slot: template.slot,
    label: template.label,
    description: template.description,
    isNonNegotiable: template.isCore,
    capacityRequired: template.capacityRequired,
  };
}

function buildDayNote(
  state: MentorState,
  isHeavyDay: boolean,
  isRestDay: boolean,
  mode: PlanMode
): string | null {
  if (isRestDay) return "Rest day — no structured blocks. Light movement or passive review only.";
  if (mode === "recovery") return "Recovery day — complete at least one block. Stop when done.";
  if (isHeavyDay && state.stress >= 55) return "High-load day — monitor energy. Drop extra blocks if needed.";
  if (state.consecutiveMisses >= 3) return "Coming back from a miss streak — just show up. Duration doesn't matter.";
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCHEDULE BUILDERS
// ═══════════════════════════════════════════════════════════════════════════════

function buildDaySchedule(
  dayIndex: number,
  isRestDay: boolean,
  isHeavyDay: boolean,
  templates: BlockTemplate[],
  targetMinutes: number,
  state: MentorState,
  mode: PlanMode
): DaySchedule {
  const dayLabel = DAY_LABELS[dayIndex % 7] ?? `Day ${dayIndex + 1}`;

  if (isRestDay) {
    return {
      dayIndex, dayLabel, isRestDay: true, blocks: [],
      totalMinutes: 0, totalHours: 0,
      targetCompletionRate: 1.0,
      note: buildDayNote(state, false, true, mode),
    };
  }

  // Light days use only core blocks
  const dayTemplates    = isHeavyDay ? templates : templates.filter((t) => t.isCore || t.type !== "deep_work");
  const selected        = selectBlocksForCapacity(dayTemplates, targetMinutes, state);
  const blocks: TimeBlock[] = selected.map((t, i) => buildTimeBlock(t, `${mode}_d${dayIndex}_b${i}`, state));
  const totalMinutes    = blocks.reduce((s, b) => s + b.durationMinutes, 0);

  return {
    dayIndex, dayLabel, isRestDay: false, blocks,
    totalMinutes,
    totalHours: parseFloat((totalMinutes / 60).toFixed(2)),
    targetCompletionRate: resolveTargetCompletionRate(state),
    note: buildDayNote(state, isHeavyDay, false, mode),
  };
}

// ─── Daily ────────────────────────────────────────────────────────────────────

function buildDailyPlan(
  state: MentorState,
  domain: Domain,
  targetHours: number,
  sustainableHours: number,
  feasibility: FeasibilityResult,
  guards: PlanGuard[],
  now: Date
): DailyPlanResult {
  const templates   = DOMAIN_BLOCK_TEMPLATES[domain] ?? DOMAIN_BLOCK_TEMPLATES.unknown;
  const targetMins  = Math.round(targetHours * 60);
  const adaptations = detectAdaptations(state, "daily");
  const schedule    = buildDaySchedule(0, false, true, templates, targetMins, state, "daily");
  const metadata    = buildMetadata(
    "daily", domain, feasibility, state, sustainableHours,
    schedule.totalHours, 1, guards, adaptations, [], now
  );
  return { mode: "daily", schedule, metadata };
}

// ─── Weekly ───────────────────────────────────────────────────────────────────

function buildWeeklyPlan(
  state: MentorState,
  domain: Domain,
  targetHours: number,
  sustainableHours: number,
  feasibility: FeasibilityResult,
  analysis: ConversationAnalysis,
  guards: PlanGuard[],
  now: Date
): WeeklyPlanResult {
  const templates       = DOMAIN_BLOCK_TEMPLATES[domain] ?? DOMAIN_BLOCK_TEMPLATES.unknown;
  const targetMins      = Math.round(targetHours * 60);
  const adaptations     = detectAdaptations(state, "weekly");
  const restCount       = resolveRestDayCount(state.consistency);

  // Prioritise weekends as rest days, then Mon/Fri, then midweek
  const REST_PRIORITY   = [6, 5, 0, 4, 1, 3, 2];
  const restDayIndices  = REST_PRIORITY.slice(0, restCount);

  const days: DaySchedule[] = Array.from({ length: 7 }, (_, i) => {
    const isRestDay  = restDayIndices.includes(i);
    const isHeavyDay = HEAVY_LOAD_DAYS.includes(i) && !isRestDay;
    return buildDaySchedule(i, isRestDay, isHeavyDay, templates, targetMins, state, "weekly");
  });

  const totalHours = days.reduce((s, d) => s + d.totalHours, 0);
  const warnings   = buildWeeklyWarnings(state, targetHours, sustainableHours, restCount);
  const metadata   = buildMetadata(
    "weekly", domain, feasibility, state, sustainableHours,
    totalHours, 7, guards, adaptations, warnings, now
  );

  return {
    mode: "weekly",
    days,
    weeklyTargetHours: parseFloat((targetHours * (7 - restCount)).toFixed(2)),
    restDayIndices,
    metadata,
  };
}

function buildWeeklyWarnings(
  state: MentorState,
  targetHours: number,
  sustainableHours: number,
  restDays: number
): PlanWarning[] {
  const warnings: PlanWarning[] = [];

  if (targetHours > sustainableHours * 0.90) {
    warnings.push({
      id: "near_sustainable_ceiling",
      message: `Plan sits at ${Math.round((targetHours / sustainableHours) * 100)}% of sustainable capacity — no buffer for disruption.`,
      recommendation: "Keep at least one unscheduled buffer day.",
    });
  }

  if (restDays >= 3 && state.consistency < 35) {
    warnings.push({
      id: "low_consistency_warning",
      message: "Consistency is low — 3+ rest days included to prevent avoidance.",
      recommendation: "Focus on completing the non-negotiable block every active day before attempting full blocks.",
    });
  }

  if (state.streakDays === 0 && state.consecutiveMisses > 0) {
    warnings.push({
      id: "streak_rebuild",
      message: "No active streak — prioritise showing up over output volume this week.",
      recommendation: "Mark the first non-negotiable block as the only goal for this week.",
    });
  }

  return warnings;
}

// ─── Recovery ─────────────────────────────────────────────────────────────────

function buildRecoveryPlan(
  state: MentorState,
  domain: Domain,
  sustainableHours: number,
  feasibility: FeasibilityResult,
  guards: PlanGuard[],
  now: Date
): RecoveryPlanResult {
  const adaptations    = detectAdaptations(state, "recovery");
  const recoveryDays   = state.burnoutRisk >= 80 ? 5 : state.stress >= 75 ? 4 : 3;

  const protocol: RecoveryProtocol = {
    maxDailyMinutes: 45,
    breakBetweenBlocksMinutes: 30,
    noLateNightWork: true,
    focusAreas: ["minimum viable action", "low-stakes review", "habit anchoring"],
    avoidList: ["deep work", "new commitments", "performance pressure"],
  };

  const days: DaySchedule[] = Array.from({ length: recoveryDays }, (_, i) => {
    // Days 2 and 4 (index 1 and 3) are full rest
    if (i === 1 || i === 3) {
      return {
        dayIndex: i, dayLabel: DAY_LABELS[i % 7] ?? `Day ${i + 1}`,
        isRestDay: true, blocks: [], totalMinutes: 0, totalHours: 0,
        targetCompletionRate: 1.0, note: "Full rest. No work. No guilt.",
      };
    }
    const block = buildTimeBlock(RECOVERY_BLOCK, `recovery_d${i}_b0`, state);
    return {
      dayIndex: i, dayLabel: DAY_LABELS[i % 7] ?? `Day ${i + 1}`,
      isRestDay: false, blocks: [block],
      totalMinutes: block.durationMinutes,
      totalHours: parseFloat((block.durationMinutes / 60).toFixed(2)),
      targetCompletionRate: 0.80,
      note: "One block. That is the entire goal today.",
    };
  });

  const totalHours = days.reduce((s, d) => s + d.totalHours, 0);
  const metadata   = buildMetadata(
    "recovery", domain, feasibility, state, sustainableHours,
    totalHours, recoveryDays, guards, adaptations, [], now
  );

  return { mode: "recovery", days, protocol, estimatedRecoveryDays: recoveryDays, metadata };
}

// ─── Exam Mode ────────────────────────────────────────────────────────────────

function buildExamModePlan(
  state: MentorState,
  domain: Domain,
  targetHours: number,
  sustainableHours: number,
  feasibility: FeasibilityResult,
  guards: PlanGuard[],
  examDate: Date | null,
  now: Date
): ExamModePlanResult {
  const adaptations     = detectAdaptations(state, "exam_mode");
  const daysUntilExam   = examDate
    ? Math.max(1, Math.ceil((examDate.getTime() - now.getTime()) / 86_400_000))
    : 7;

  const cappedHours       = Math.min(targetHours, EXAM_MODE_DAILY_CAP_HOURS);
  const intensityLevel: "high" | "maximum" = cappedHours >= 6 ? "maximum" : "high";
  const studyTemplates    = DOMAIN_BLOCK_TEMPLATES.study;

  const days: DaySchedule[] = Array.from({ length: Math.min(daysUntilExam, 14) }, (_, i) => {
    const isExamEve     = i === daysUntilExam - 1;
    const dailyTargetMins = isExamEve ? 45 : Math.round(cappedHours * 60);

    const dayTemplates  = isExamEve
      ? studyTemplates.filter((t) => t.type === "review" || t.type === "light_work")
      : studyTemplates;

    const blocks: TimeBlock[] = [];
    let usedMinutes = 0;
    let blockIdx    = 0;

    for (const template of dayTemplates) {
      if (usedMinutes + template.durationMinutes > dailyTargetMins) break;
      blocks.push(buildTimeBlock(template, `exam_d${i}_b${blockIdx}`, state));
      usedMinutes += template.durationMinutes;
      blockIdx++;

      // Mandatory break after each deep_work block
      if (
        template.type === "deep_work" &&
        usedMinutes + BREAK_BLOCK.durationMinutes <= dailyTargetMins
      ) {
        blocks.push(buildTimeBlock(BREAK_BLOCK, `exam_d${i}_brk${blockIdx}`, state));
        usedMinutes += BREAK_BLOCK.durationMinutes;
      }
    }

    const studyMinutes = blocks.filter((b) => b.type !== "break").reduce((s, b) => s + b.durationMinutes, 0);
    return {
      dayIndex: i,
      dayLabel: isExamEve ? "Exam Eve" : (DAY_LABELS[i % 7] ?? `Day ${i + 1}`),
      isRestDay: false, blocks,
      totalMinutes: studyMinutes,
      totalHours: parseFloat((studyMinutes / 60).toFixed(2)),
      targetCompletionRate: resolveTargetCompletionRate(state),
      note: isExamEve ? "Exam eve — light review only. Sleep early. No new material." : null,
    };
  });

  const totalHours = days.reduce((s, d) => s + d.totalHours, 0);
  const metadata   = buildMetadata(
    "exam_mode", domain, feasibility, state, sustainableHours,
    totalHours, days.length, guards, adaptations, [], now
  );

  return {
    mode: "exam_mode", days, intensityLevel,
    totalStudyHours: parseFloat(totalHours.toFixed(2)),
    examDate, metadata,
  };
}

// ─── Busy Week ────────────────────────────────────────────────────────────────

function buildBusyWeekPlan(
  state: MentorState,
  domain: Domain,
  sustainableHours: number,
  feasibility: FeasibilityResult,
  guards: PlanGuard[],
  now: Date
): BusyWeekPlanResult {
  const adaptations    = detectAdaptations(state, "busy_week");
  const templates      = DOMAIN_BLOCK_TEMPLATES[domain] ?? DOMAIN_BLOCK_TEMPLATES.unknown;
  const coreBlock      = templates.find((t) => t.isCore) ?? RECOVERY_BLOCK;
  const droppedItems   = templates.filter((t) => !t.isCore).map((t) => t.label);

  const days: DaySchedule[] = Array.from({ length: 7 }, (_, i) => {
    const isWeekend  = i >= 5;
    const isRestDay  = isWeekend && state.consistency < 60;

    if (isRestDay) {
      return {
        dayIndex: i, dayLabel: DAY_LABELS[i] ?? `Day ${i + 1}`,
        isRestDay: true, blocks: [], totalMinutes: 0, totalHours: 0,
        targetCompletionRate: 1.0, note: "Busy week rest day. Full permission to rest.",
      };
    }

    const raw    = buildTimeBlock(coreBlock, `busy_d${i}_b0`, state);
    const capped = { ...raw, durationMinutes: Math.min(raw.durationMinutes, Math.round(BUSY_WEEK_MAX_DAILY_HOURS * 60)) };
    return {
      dayIndex: i, dayLabel: DAY_LABELS[i] ?? `Day ${i + 1}`,
      isRestDay: false, blocks: [capped],
      totalMinutes: capped.durationMinutes,
      totalHours: parseFloat((capped.durationMinutes / 60).toFixed(2)),
      targetCompletionRate: resolveTargetCompletionRate(state),
      note: "Busy week — one block only. Skip if today is genuinely impossible.",
    };
  });

  const totalHours = days.reduce((s, d) => s + d.totalHours, 0);
  const minimumViableCommitment = `${coreBlock.label} — ${Math.min(coreBlock.durationMinutes, 30)} min, any time of day`;
  const metadata = buildMetadata(
    "busy_week", domain, feasibility, state, sustainableHours,
    totalHours, 7, guards, adaptations, [], now
  );

  return { mode: "busy_week", days, minimumViableCommitment, droppedItems, metadata };
}

// ═══════════════════════════════════════════════════════════════════════════════
// METADATA BUILDER
// ═══════════════════════════════════════════════════════════════════════════════

function buildMetadata(
  mode: PlanMode,
  domain: Domain,
  feasibility: FeasibilityResult,
  state: MentorState,
  sustainableHours: number,
  totalPlanHours: number,
  validForDays: number,
  guards: PlanGuard[],
  adaptations: PlanAdaptation[],
  warnings: PlanWarning[],
  now: Date
): PlanMetadata {
  return {
    mode,
    domain,
    goalDescription: feasibility.parsedRequest.goalDescription || "unspecified goal",
    generatedAt: now,
    validForDays,
    capacityAtGeneration: state.capacity,
    sustainableHoursPerDay: sustainableHours,
    totalPlannedHours: parseFloat(totalPlanHours.toFixed(2)),
    feasibilityScore: feasibility.scores.overall,
    adaptations,
    guardsTriggered: guards.filter((g) => g.triggered),
    warnings,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generates a realistic, capacity-aware plan.
 *
 * Guards enforce (in order):
 *   1. capacity_gate       — refuses if capacity < 15
 *   2. constraint_gate     — records active constraints
 *   3. feasibility_ceiling — refuses if feasibility score < 20; caps hours otherwise
 *   4. burnout_protection  — redirects to recovery if burnoutRisk ≥ 65
 *
 * Adapts planned volume to motivation, consistency, stress, and capacity.
 */
export function generatePlan(input: PlannerInput): PlannerResult {
  const { state, analysis, memory, requestedMode, examDate } = input;
  const now = input.now ?? new Date();

  // 1. Resolve feasibility (reuse if already computed upstream)
  const feasibility = input.feasibility ?? evaluateFeasibility({ analysis, state, memory, now });

  // 2. Run guards
  const { pass, guards, blockingReason } = runGuards(state, analysis, feasibility);

  if (!pass) {
    const blockedBy: string[] = [];
    if (state.capacity < MIN_CAPACITY_TO_PLAN)           blockedBy.push("capacity_too_low");
    if (feasibility.scores.overall < MIN_FEASIBILITY_SCORE) blockedBy.push("feasibility_score_too_low");

    return {
      canGenerate: false,
      reason: blockingReason ?? "Guards blocked plan generation.",
      requiredCapacity: MIN_CAPACITY_TO_PLAN,
      currentCapacity: state.capacity,
      blockedBy,
      suggestedAction:
        state.capacity < MIN_CAPACITY_TO_PLAN
          ? "Rest for 1–2 days before planning. Re-evaluate when capacity recovers."
          : "Address feasibility blockers — reduce scope, timeline, or daily hours.",
    };
  }

  // 3. Resolve capacity ceilings from feasibility engine
  const goalCount        = memory.longTerm.goals.length;
  const sustainableHours = getSustainableHours(state, analysis.constraints, goalCount);

  // 4. Select mode (burnout/stress can override requestedMode)
  const mode = autoSelectMode(state, analysis, requestedMode);

  // 5. Target hours per day, capped at feasibility sustainable ceiling
  const uncapped    = resolveTargetHoursPerDay(sustainableHours, state, mode);
  const targetHours = Math.min(uncapped, feasibility.sustainableHoursPerDay);

  // 6. Domain — prefer analysis, fall back to first known domain from memory
  const domain: Domain =
    analysis.domain !== "unknown"
      ? analysis.domain
      : (memory.longTerm.domains[0] ?? "unknown");

  // 7. Dispatch to mode-specific builder
  let plan: GeneratedPlan;
  switch (mode) {
    case "daily":
      plan = buildDailyPlan(state, domain, targetHours, sustainableHours, feasibility, guards, now);
      break;
    case "recovery":
      plan = buildRecoveryPlan(state, domain, sustainableHours, feasibility, guards, now);
      break;
    case "exam_mode":
      plan = buildExamModePlan(state, domain, targetHours, sustainableHours, feasibility, guards, examDate ?? null, now);
      break;
    case "busy_week":
      plan = buildBusyWeekPlan(state, domain, sustainableHours, feasibility, guards, now);
      break;
    case "weekly":
    default:
      plan = buildWeeklyPlan(state, domain, targetHours, sustainableHours, feasibility, analysis, guards, now);
      break;
  }

  return { canGenerate: true, plan };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Returns which plan mode would be auto-selected given the current state.
 * Useful for the decision engine to preview mode before calling generatePlan.
 */
export function selectPlanMode(state: MentorState, analysis: ConversationAnalysis): PlanMode {
  return autoSelectMode(state, analysis, undefined);
}

/**
 * Quick capacity + feasibility gate check without running the full planner.
 */
export function canGeneratePlan(
  state: MentorState,
  feasibilityScore: number
): { can: boolean; reason?: string } {
  if (state.capacity < MIN_CAPACITY_TO_PLAN) {
    return { can: false, reason: `Capacity too low (${state.capacity}/100). Minimum: ${MIN_CAPACITY_TO_PLAN}.` };
  }
  if (feasibilityScore < MIN_FEASIBILITY_SCORE) {
    return { can: false, reason: `Feasibility score too low (${feasibilityScore}/100). Minimum: ${MIN_FEASIBILITY_SCORE}.` };
  }
  return { can: true };
}

/**
 * One-line summary for logging and decision engine context hints.
 */
export function summarizePlan(result: PlannerResult): string {
  if (!result.canGenerate) {
    return `plan_blocked | reason:${result.reason.slice(0, 60)} capacity:${result.currentCapacity}`;
  }

  const { plan } = result;
  const meta = plan.metadata;

  const dayCount =
    plan.mode === "daily"     ? 1 :
    plan.mode === "recovery"  ? (plan as RecoveryPlanResult).estimatedRecoveryDays :
    plan.mode === "exam_mode" ? (plan as ExamModePlanResult).days.length :
    7;

  return [
    plan.mode,
    `domain:${meta.domain}`,
    `days:${dayCount}`,
    `total:${meta.totalPlannedHours.toFixed(1)}h`,
    `feasibility:${meta.feasibilityScore}`,
    `capacity:${meta.capacityAtGeneration}`,
    meta.adaptations.length > 0 ? `adapted:[${meta.adaptations.map((a) => a.dimension).join(",")}]` : null,
    meta.guardsTriggered.length > 0 ? `guards:[${meta.guardsTriggered.map((g) => g.type).join(",")}]` : null,
  ].filter(Boolean).join(" | ");
}
