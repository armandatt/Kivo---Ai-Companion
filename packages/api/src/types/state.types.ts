export type UserStateFlag =
  | 'high_stress'
  | 'low_capacity'
  | 'streak_at_risk'
  | 'streak_broken'
  | 'overcommitted'
  | 'underperforming'
  | 'comeback_momentum'
  | 'peak_performance'
  | 'avoidance_pattern_active'
  | 'disengaged'
  | 'first_week'
  | 'returning_after_gap';

export type MomentumDirection = 'building' | 'stable' | 'declining' | 'collapsed';

export interface UserState {
  userId: string;
  capacityScore: number;
  stressLevel: number;
  consistencyScore: number;
  streakDays: number;
  longestStreak: number;
  momentum: MomentumDirection;
  flags: UserStateFlag[];
  lastActiveAt: Date | null;
  daysSinceLastCheckIn: number;
  completionRate7d: number;
  completionRate30d: number;
  averageResponseTimeMin: number;
  totalSessionCount: number;
  computedAt: Date;
}

export interface ConsistencySnapshot {
  id: string;
  userId: string;
  date: Date;
  tasksCommitted: number;
  tasksCompleted: number;
  checkInResponded: boolean;
  sessionCount: number;
  capacityScore: number | null;
  stressLevel: number | null;
}

export type EscalationLevel = 'watching' | 'nudge' | 'confront' | 'intervention' | 'reset';

export type AccountabilityAction =
  | 'acknowledge_silently'
  | 'soft_nudge'
  | 'direct_confront'
  | 'call_out_pattern'
  | 'trigger_intervention'
  | 'celebrate_streak'
  | 'plan_adjustment_needed'
  | 'quiet_observation'
  | 'check_in_overdue_message';

export interface MissedCommitment {
  id: string;
  description: string;
  dueAt: Date;
  missedAt: Date;
  excuse: string | null;
  excuseCategory: 'time' | 'energy' | 'forgot' | 'avoidance' | 'external' | null;
  isPatternMatch: boolean;
  consecutiveMiss: boolean;
}

export interface AccountabilityState {
  userId: string;
  score: number;
  missedCommitments: MissedCommitment[];
  keptCommitments: number;
  totalCommitments: number;
  keepRate: number;
  consecutiveMisses: number;
  escalationLevel: EscalationLevel;
  nextAction: AccountabilityAction;
  lastEscalationAt: Date | null;
  cooldownUntil: Date | null;
  daysSinceLastCelebration: number;
}

export interface FeasibilityBlocker {
  type: 'timeline_too_short' | 'capacity_insufficient' | 'deadline_conflict' | 'history_of_failure' | 'dependency_missing';
  description: string;
  severity: 'blocking' | 'warning';
  suggestedFix: string | null;
}

export interface PlanAdjustment {
  field: 'duration' | 'intensity' | 'frequency' | 'scope' | 'start_date';
  originalValue: string;
  suggestedValue: string;
  reason: string;
}

export interface FeasibilityResult {
  feasible: boolean;
  score: number;
  blockers: FeasibilityBlocker[];
  adjustments: PlanAdjustment[];
  warnings: string[];
  capacityRequired: number;
  capacityAvailable: number;
  timeRequiredDaily: number;
  conflictingCommitments: string[];
  historicalSuccessRate: number;
  adjustedGoal: string | null;
}

export interface PlannedTask {
  id: string;
  title: string;
  estimatedMinutes: number;
  preferredDaysOfWeek: number[] | null;
  isBlocking: boolean;
  dependencies: string[];
  category: string;
}

export interface PlanPhase {
  phaseNumber: number;
  name: string;
  durationDays: number;
  focusArea: string;
  tasks: PlannedTask[];
  milestone: string;
  successCriteria: string;
}

export interface StructuredPlan {
  id: string;
  goalId: string;
  title: string;
  category: string;
  phases: PlanPhase[];
  dailyTimeRequired: number;
  checkpoints: Array<{
    dayOffset: number;
    question: string;
    successMetric: string;
  }>;
  feasibilityScore: number;
  estimatedCompletionDate: Date;
  adjustedFromOriginal: boolean;
  adjustmentReason: string | null;
}
