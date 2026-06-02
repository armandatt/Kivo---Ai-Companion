export type MessageIntent =
  | 'goal_set'
  | 'plan_request'
  | 'status_update'
  | 'progress_report'
  | 'accountability_request'
  | 'deadline_set'
  | 'schedule_adjust'
  | 'reflection'
  | 'question'
  | 'commitment_made'
  | 'failure_report'
  | 'excuse'
  | 'emotional_vent'
  | 'check_in_response'
  | 'general_chat';

export type Domain =
  | 'fitness'
  | 'study'
  | 'career'
  | 'habits'
  | 'finance'
  | 'mental_health'
  | 'relationships'
  | 'creative'
  | 'unknown';

export type EmotionType =
  | 'neutral'
  | 'motivated'
  | 'frustrated'
  | 'overwhelmed'
  | 'discouraged'
  | 'confused'
  | 'anxious'
  | 'hopeful'
  | 'stressed'
  | 'proud'
  | 'guilty'
  | 'avoidant'
  | 'defensive'
  | 'determined';

export type ConstraintType =
  | 'time'
  | 'energy'
  | 'injury'
  | 'burnout'
  | 'work_pressure'
  | 'exam_season'
  | 'family_responsibility'
  | 'financial'
  | 'mental_health'
  | 'social_pressure'
  | 'environment';

export type CommitmentLevel = 'none' | 'low' | 'medium' | 'high' | 'very_high';

export type RequestedOutcome =
  | 'advice'
  | 'planning'
  | 'accountability'
  | 'learning'
  | 'reflection'
  | 'motivation'
  | 'venting'
  | 'status_acknowledgment'
  | 'none';

export interface DetectedGoal {
  raw: string;
  normalized: string;
  domain: Domain;
  horizon: 'immediate' | 'short_term' | 'medium_term' | 'long_term';
  isVague: boolean;
  confidence: number;
}

export interface DetectedConstraint {
  type: ConstraintType;
  raw: string;
  severity: 'mild' | 'moderate' | 'severe';
  isTemporary: boolean;
}

export interface EmotionResult {
  primary: EmotionType;
  secondary: EmotionType | null;
  intensity: number;
  valence: 'positive' | 'negative' | 'neutral';
  confidence: number;
}

export interface ConversationAnalysis {
  intent: MessageIntent;
  secondaryIntents: MessageIntent[];
  goal: DetectedGoal | null;
  domain: Domain;
  emotion: EmotionResult;
  constraints: DetectedConstraint[];
  commitmentLevel: CommitmentLevel;
  commitmentScore: number;
  urgency: number;
  requestedOutcome: RequestedOutcome;
  hasFailureReport: boolean;
  hasExcuse: boolean;
  hasCommitment: boolean;
  isQuestion: boolean;
  isRepeat: boolean;
  wordCount: number;
  confidence: number;
  rawText: string;
  normalizedText: string;
}

// ── Mentor Decision ───────────────────────────────────────────────────────────

export type MentorAction =
  | 'respond_conversationally'
  | 'ask_single_question'
  | 'give_direct_feedback'
  | 'present_plan'
  | 'call_out_pattern'
  | 'celebrate_win'
  | 'trigger_intervention'
  | 'schedule_check_in'
  | 'adjust_plan'
  | 'reflect_prompt'
  | 'hold_space'
  | 'no_response';

export type ResponseType =
  | 'conversational'
  | 'structured_plan'
  | 'accountability_message'
  | 'reflection_prompt'
  | 'motivational'
  | 'analytical'
  | 'celebratory'
  | 'confrontational'
  | 'empathetic_redirect';

export interface ToneProfile {
  persona: string;
  modifier: 'standard' | 'softer' | 'harder' | 'empathetic' | 'clinical';
  urgency: 'calm' | 'firm' | 'urgent';
  lengthTarget: 'brief' | 'standard' | 'detailed';
}

export interface MentorDecision {
  action: MentorAction;
  responseType: ResponseType;
  tone: ToneProfile;
  priority: 'immediate' | 'standard' | 'deferred';
  requiresLLM: boolean;
  tokenBudget: number;
  template: string | null;
  suppressionReason: string | null;
  scheduledFollowUp: { type: string; delayMin: number } | null;
  decisionReason: string;
}

// ── Pipeline ──────────────────────────────────────────────────────────────────

export interface PipelineInput {
  platformChatId: string;
  text: string;
  platform: 'telegram' | 'whatsapp' | 'web';
  timestamp: Date;
}

export interface PipelineDiagnostics {
  pipelineMs: number;
  llmCalled: boolean;
  llmTokensUsed: number;
  enginesRun: string[];
  stagesSkipped: string[];
  decisionPath: string;
  flags: string[];
}

export interface PipelineOutput {
  decision: MentorDecision;
  reply: string;
  scheduledActions: Array<{
    type: string;
    fireAt: Date;
    payload: Record<string, unknown>;
  }>;
  diagnostics: PipelineDiagnostics;
}
