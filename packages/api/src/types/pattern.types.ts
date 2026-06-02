export type PatternType =
  | 'monday_avoidance'
  | 'evening_dropout'
  | 'goal_abandonment_cycle'
  | 'excuse_cycling'
  | 'deadline_miss_pattern'
  | 'consistency_collapse'
  | 'overplanning_underexecuting'
  | 'pressure_withdrawal'
  | 'procrastination_spiral'
  | 'weekend_ghosting'
  | 'late_night_panic'
  | 'commitment_inflation';

export type PatternSeverity = 'emerging' | 'confirmed' | 'entrenched' | 'critical';

export type PatternRecommendation =
  | 'reduce_load'
  | 'change_timing'
  | 'call_out_directly'
  | 'reset_goals'
  | 'increase_accountability_frequency'
  | 'celebrate_small_wins'
  | 'build_habit_anchor'
  | 'reduce_commitment_scope'
  | 'schedule_reflection';

export interface DetectedPattern {
  type: PatternType;
  severity: PatternSeverity;
  occurrences: number;
  firstDetectedAt: Date;
  lastSeenAt: Date;
  evidence: string[];
  confidenceScore: number;
  recommendation: PatternRecommendation;
}

export interface PatternAnalysis {
  patterns: DetectedPattern[];
  dominantPattern: DetectedPattern | null;
  riskScore: number;
  positivePatterns: string[];
  insights: string[];
}

export type InterventionType =
  | 'gentle_re_engagement'
  | 'pattern_confrontation'
  | 'goal_reset'
  | 'load_reduction'
  | 'accountability_escalation'
  | 'momentum_rebuild'
  | 'crisis_check';

export type InterventionTrigger =
  | 'consecutive_misses_3plus'
  | 'silence_72h'
  | 'consistency_collapse'
  | 'repeated_excuse_cycle'
  | 'goal_abandonment_detected'
  | 'stress_overload'
  | 'escalation_threshold_crossed';

export interface InterventionDecision {
  needed: boolean;
  type: InterventionType | null;
  trigger: InterventionTrigger | null;
  urgency: 'low' | 'medium' | 'high' | 'critical';
  approach: 'direct' | 'gentle' | 'question_based' | 'reflection_led' | null;
  cooldownDays: number;
  suppressIfUserEngaged: boolean;
}

export type ReflectionMode =
  | 'daily_review'
  | 'weekly_summary'
  | 'pattern_debrief'
  | 'goal_postmortem'
  | 'spontaneous'
  | 'milestone_review';

export interface ReflectionPrompt {
  id: string;
  text: string;
  category: 'honesty' | 'pattern' | 'growth' | 'commitment' | 'energy' | 'identity';
  depth: 'surface' | 'medium' | 'deep';
  followUpIf: string | null;
}

export interface GrowthArea {
  area: string;
  evidence: string[];
  priority: number;
  suggestedFocus: string;
}

export interface ReflectionContext {
  mode: ReflectionMode;
  readinessScore: number;
  prompts: ReflectionPrompt[];
  previousInsights: string[];
  growthAreas: GrowthArea[];
  suggestedDepth: 'surface' | 'medium' | 'deep';
  blockedBy: string | null;
}
