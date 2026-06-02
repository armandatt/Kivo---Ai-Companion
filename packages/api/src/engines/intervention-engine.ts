import type {
  PatternType,
  PatternSeverity,
  PatternAnalysis,
  DetectedPattern,
  InterventionType,
  InterventionTrigger,
  InterventionDecision,
} from "../types/pattern.types";
import type { ConversationAnalysis } from "../types/mentor.types";
import type { MemoryContext } from "../types/memory.types";
import type { MentorState, StateFlag } from "./user-state-engine";

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

// The 11 behavioural sub-classes — mirrors the internal PatternId set from
// pattern-detector.ts. Allows us to differentiate overplanning vs tutorial_hell
// (both share PatternType "overplanning_underexecuting") and perfectionism vs
// all_or_nothing (both share "procrastination_spiral").
export type InterventionClass =
  | "ghosting"
  | "motivation_crash"
  | "excuse_loop"
  | "overplanning"
  | "tutorial_hell"
  | "perfectionism"
  | "restart_cycle"
  | "burnout"
  | "all_or_nothing"
  | "subject_avoidance"
  | "comparison_trap";

export type ApproachStyle =
  | "direct"
  | "gentle"
  | "question_based"
  | "reflection_led"
  | "challenge_based"
  | "crisis_led";

export type InterventionToneLevel = "hard" | "firm" | "standard" | "supportive" | "gentle";

export interface InterventionTriggerSpec {
  type: InterventionTrigger;
  description: string;
  minimumSeverity: PatternSeverity;
  minimumConfidence: number;
  cooldownDays: number;
  suppressIfUserEngaged: boolean;
}

export interface InterventionResponseStyle {
  approach: ApproachStyle;
  tone: InterventionToneLevel;
  urgency: "low" | "medium" | "high" | "critical";
  messageLengthTarget: "brief" | "standard" | "detailed";
  openingMove: string;
  avoidList: string[];
}

export interface InterventionMentorAction {
  primary: string;
  frames: string[];
  demands: string[];
  refuses: string[];
  contextHints: string[];
}

export interface FollowUpSpec {
  delayHours: number;
  prompt: string;
  skipIf: string;
  escalateIf: string;
  escalationAction: string;
}

export interface PlaybookAdaptation {
  condition: string;
  toneShift: InterventionToneLevel | null;
  approachShift: ApproachStyle | null;
  urgencyDowngrade: boolean;
  addContextHint: string | null;
}

export interface InterventionPlaybook {
  class: InterventionClass;
  interventionType: InterventionType;
  name: string;
  description: string;
  trigger: InterventionTriggerSpec;
  responseStyle: InterventionResponseStyle;
  mentorAction: InterventionMentorAction;
  followUp: FollowUpSpec;
  stateAdaptations: PlaybookAdaptation[];
}

export interface InterventionInput {
  patterns: PatternAnalysis;
  state: MentorState;
  analysis: ConversationAnalysis;
  memory: MemoryContext;
  now?: Date;
}

export interface InterventionResult {
  needed: boolean;
  class: InterventionClass | null;
  playbook: InterventionPlaybook | null;
  decision: InterventionDecision;
  contextHints: string[];
  appliedAdaptations: string[];
  suppressionReason: string | null;
  summaryLine: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

const MIN_CONFIDENCE_TO_INTERVENE = 0.50;
const BURNOUT_CONFRONTATION_BLOCK  = 80;  // burnoutRisk threshold
const HIGH_STRESS_TONE_SOFTEN      = 65;  // stress threshold — soften by one level
const OVERWHELM_APPROACH_SHIFT     = 0.7; // emotion intensity threshold for gentle override

// Urgency priority for tiebreaking multiple active patterns
const CLASS_URGENCY_ORDER: InterventionClass[] = [
  "burnout",
  "excuse_loop",
  "ghosting",
  "motivation_crash",
  "tutorial_hell",
  "overplanning",
  "restart_cycle",
  "perfectionism",
  "all_or_nothing",
  "subject_avoidance",
  "comparison_trap",
];

// ═══════════════════════════════════════════════════════════════════════════════
// PLAYBOOKS
// ═══════════════════════════════════════════════════════════════════════════════

const PLAYBOOKS: Record<InterventionClass, InterventionPlaybook> = {

  // ── Ghosting ──────────────────────────────────────────────────────────────

  ghosting: {
    class: "ghosting",
    interventionType: "gentle_re_engagement",
    name: "Ghosting Re-engagement",
    description: "User disappeared after active engagement. Re-open the channel without guilt.",
    trigger: {
      type: "silence_72h",
      description: "User has been silent for 3–14+ days after a period of activity",
      minimumSeverity: "confirmed",
      minimumConfidence: 0.50,
      cooldownDays: 3,
      suppressIfUserEngaged: true,
    },
    responseStyle: {
      approach: "question_based",
      tone: "supportive",
      urgency: "medium",
      messageLengthTarget: "brief",
      openingMove: "No mention of the silence. Warm, direct single question referencing the last goal or commitment.",
      avoidList: ["mentioning how long they've been gone", "guilt language", "listing what they missed", "multiple questions"],
    },
    mentorAction: {
      primary: "Re-open the channel with a low-pressure question tied to the last known goal",
      frames: [
        "Act as if picking up a natural conversation, not addressing an absence",
        "Reference the last commitment they made, not the silence",
        "One question only — make it easy to respond to",
      ],
      demands: [],
      refuses: ["shame or guilt language", "listing missed days", "demanding explanation for absence"],
      contextHints: [
        "reference_last_commitment",
        "one_question_only",
        "no_mention_of_silence_duration",
        "warm_not_transactional",
      ],
    },
    followUp: {
      delayHours: 24,
      prompt: "If no response after 24h, send a single-sentence check-in: 'Still here if you want to pick it back up.'",
      skipIf: "user_has_responded",
      escalateIf: "silence_exceeds_7_additional_days",
      escalationAction: "crisis_check — ask directly if everything is OK",
    },
    stateAdaptations: [
      {
        condition: "state.streakDays === 0 && state.consecutiveMisses >= 3",
        toneShift: "gentle",
        approachShift: "gentle",
        urgencyDowngrade: true,
        addContextHint: "streak_broken_context",
      },
      {
        condition: "state.burnoutRisk >= 60",
        toneShift: "gentle",
        approachShift: "gentle",
        urgencyDowngrade: false,
        addContextHint: "possible_burnout_behind_absence",
      },
    ],
  },

  // ── Motivation Crash ──────────────────────────────────────────────────────

  motivation_crash: {
    class: "motivation_crash",
    interventionType: "momentum_rebuild",
    name: "Motivation Crash Recovery",
    description: "Energy collapsed after early enthusiasm or first setback. Reduce scope, find one win.",
    trigger: {
      type: "consistency_collapse",
      description: "Motivation score dropped sharply; activity fell off after initial high engagement",
      minimumSeverity: "confirmed",
      minimumConfidence: 0.55,
      cooldownDays: 4,
      suppressIfUserEngaged: false,
    },
    responseStyle: {
      approach: "reflection_led",
      tone: "supportive",
      urgency: "medium",
      messageLengthTarget: "standard",
      openingMove: "Acknowledge the drop without labelling it failure. Ask what actually happened — not what they planned to do.",
      avoidList: ["motivational hype", "pep talk language", "adding new tasks", "telling them they can do it", "mentioning the original goal scope"],
    },
    mentorAction: {
      primary: "Reduce scope to one non-negotiable action. Deliver one small win today.",
      frames: [
        "Crash is data, not verdict — ask what it revealed",
        "One thing only: what is the smallest version of this goal that still counts?",
        "The goal isn't gone — the load was wrong",
      ],
      demands: ["identify one thing you can do in the next 24 hours"],
      refuses: ["re-motivating with affirmations", "adding new goals", "discussing the original scope"],
      contextHints: [
        "reduce_to_one_action",
        "ask_what_actually_happened",
        "no_pep_talk",
        "reference_original_motivation_if_known",
        "single_small_win_focus",
      ],
    },
    followUp: {
      delayHours: 24,
      prompt: "24h check-in: 'Did you get to that one thing?' — nothing more.",
      skipIf: "user_reported_progress",
      escalateIf: "no_response_and_motivation_below_20",
      escalationAction: "ghosting re-engagement protocol",
    },
    stateAdaptations: [
      {
        condition: "state.consecutiveMisses >= 5",
        toneShift: "gentle",
        approachShift: "gentle",
        urgencyDowngrade: false,
        addContextHint: "extended_miss_streak_context",
      },
      {
        condition: "state.burnoutRisk >= 55",
        toneShift: "gentle",
        approachShift: "gentle",
        urgencyDowngrade: true,
        addContextHint: "possible_burnout_not_motivation_issue",
      },
    ],
  },

  // ── Excuse Loop ───────────────────────────────────────────────────────────

  excuse_loop: {
    class: "excuse_loop",
    interventionType: "accountability_escalation",
    name: "Excuse Loop Confrontation",
    description: "Rotating justifications systematically prevent progress. Name the cycle. Ask the real question.",
    trigger: {
      type: "repeated_excuse_cycle",
      description: "3+ commit→miss→excuse cycles detected across different excuse categories",
      minimumSeverity: "confirmed",
      minimumConfidence: 0.60,
      cooldownDays: 5,
      suppressIfUserEngaged: false,
    },
    responseStyle: {
      approach: "direct",
      tone: "firm",
      urgency: "high",
      messageLengthTarget: "standard",
      openingMove: "Name the pattern explicitly by count, without shaming. Then ask the real question underneath the excuse.",
      avoidList: ["accepting this excuse at face value", "sympathy without redirection", "offering solutions before asking the real question", "listing all the excuses"],
    },
    mentorAction: {
      primary: "Name the excuse cycle by count. Separate the excuse from the real blocker. Hold the commitment.",
      frames: [
        "This is the Nth time this has happened — not an accusation, a fact",
        "The excuses are different each time. The outcome is always the same.",
        "What is the real thing blocking this — underneath the [current excuse]?",
      ],
      demands: ["name the actual blocker, not the circumstance", "one commitment with a specific time and date"],
      refuses: ["accepting the excuse without acknowledgment of the pattern", "offering a new plan before addressing the cycle"],
      contextHints: [
        "name_the_pattern_by_count",
        "ask_real_blocker_not_surface_excuse",
        "do_not_accept_at_face_value",
        "hold_prior_commitment",
        "one_specific_re_commitment_only",
      ],
    },
    followUp: {
      delayHours: 48,
      prompt: "48h check-in: Ask specifically about the commitment they just made, not the goal broadly.",
      skipIf: "user_reported_completion",
      escalateIf: "another_excuse_within_48h",
      escalationAction: "pattern_confrontation — name the cycle a second time, harder",
    },
    stateAdaptations: [
      {
        condition: "state.stress >= HIGH_STRESS_TONE_SOFTEN",
        toneShift: "standard",
        approachShift: null,
        urgencyDowngrade: false,
        addContextHint: "high_stress_soften_delivery_not_message",
      },
      {
        condition: "analysis.emotion.primary === 'overwhelmed'",
        toneShift: "supportive",
        approachShift: "gentle",
        urgencyDowngrade: true,
        addContextHint: "overwhelmed_hold_space_first_then_redirect",
      },
    ],
  },

  // ── Overplanning ──────────────────────────────────────────────────────────

  overplanning: {
    class: "overplanning",
    interventionType: "pattern_confrontation",
    name: "Overplanning Intervention",
    description: "Planning investment exceeds execution. Refuse the new plan. Point to what already exists. Demand one execution update.",
    trigger: {
      type: "goal_abandonment_detected",
      description: "Plan requests outnumber execution updates by ≥3:1 over 21 days",
      minimumSeverity: "confirmed",
      minimumConfidence: 0.55,
      cooldownDays: 5,
      suppressIfUserEngaged: false,
    },
    responseStyle: {
      approach: "direct",
      tone: "firm",
      urgency: "high",
      messageLengthTarget: "brief",
      openingMove: "Refuse the new plan request explicitly. Reference the existing plan. Redirect to execution.",
      avoidList: ["providing a new plan", "agreeing to revise the plan again", "acknowledging the plan request as valid", "lengthy explanation"],
    },
    mentorAction: {
      primary: "Refuse the new plan. Redirect to the existing one. Ask for one execution update.",
      frames: [
        "You already have a plan. The problem isn't the plan.",
        "No new plan until I see evidence the last one was tried.",
        "Planning feels like progress. It isn't. What did you actually do this week?",
      ],
      demands: ["tell me the last time you executed anything from an existing plan", "one specific action from the current plan — today"],
      refuses: ["creating another plan", "revising the existing plan", "treating planning as a form of progress"],
      contextHints: [
        "refuse_new_plan_explicitly",
        "reference_existing_plan_count",
        "demand_execution_evidence_first",
        "no_new_planning_until_output_reported",
        "name_planning_as_avoidance",
      ],
    },
    followUp: {
      delayHours: 24,
      prompt: "24h check-in: ask for a completion update on the specific action assigned — not for a new plan.",
      skipIf: "user_reported_execution",
      escalateIf: "user_requests_another_plan_within_24h",
      escalationAction: "refuse again, firmer — cite the pattern count",
    },
    stateAdaptations: [
      {
        condition: "state.consistency < 30",
        toneShift: null,
        approachShift: null,
        urgencyDowngrade: false,
        addContextHint: "low_consistency_compound_signal",
      },
    ],
  },

  // ── Tutorial Hell ─────────────────────────────────────────────────────────

  tutorial_hell: {
    class: "tutorial_hell",
    interventionType: "pattern_confrontation",
    name: "Tutorial Hell Intervention",
    description: "Endless content consumption with zero practical output. Stop consuming. Assign a project. Ship something.",
    trigger: {
      type: "goal_abandonment_detected",
      description: "4+ course/tutorial mentions with 0 build/solve completions over 30 days",
      minimumSeverity: "confirmed",
      minimumConfidence: 0.55,
      cooldownDays: 7,
      suppressIfUserEngaged: false,
    },
    responseStyle: {
      approach: "challenge_based",
      tone: "firm",
      urgency: "high",
      messageLengthTarget: "standard",
      openingMove: "Name the tutorial loop by name. Assign a specific project with a deadline. Block the next course question.",
      avoidList: ["recommending more courses", "supporting 'after I finish this' deferral", "validating the 'not ready' frame", "vague output suggestions"],
    },
    mentorAction: {
      primary: "Stop consumption. Assign a specific, small, concrete project. Set a 48h deadline.",
      frames: [
        "You're not learning — you're avoiding the discomfort of building.",
        "The course is not the problem. The course is the excuse.",
        "You know enough to start. You will learn the rest by doing.",
      ],
      demands: [
        "name one specific project you will build or problem you will solve — not another course",
        "a commit or submission within 48 hours",
        "close the course tab",
      ],
      refuses: [
        "answering questions about which course to take next",
        "validating 'I'll start after this module'",
        "treating course completion as meaningful progress",
      ],
      contextHints: [
        "name_tutorial_loop_explicitly",
        "assign_specific_deliverable_not_vague_output",
        "block_next_course_question",
        "48h_deadline_on_first_output",
        "reference_how_long_consuming_without_building",
      ],
    },
    followUp: {
      delayHours: 48,
      prompt: "48h check-in: 'Did you build/solve/ship something? Show me.' — no exceptions for 'almost'.",
      skipIf: "user_reported_shipped_output",
      escalateIf: "user_mentions_new_course_within_48h",
      escalationAction: "refuse course discussion again, harder — name the avoidance explicitly",
    },
    stateAdaptations: [
      {
        condition: "state.confidence < 40",
        toneShift: "standard",
        approachShift: null,
        urgencyDowngrade: false,
        addContextHint: "low_confidence_assign_very_small_first_output",
      },
      {
        condition: "state.stress >= HIGH_STRESS_TONE_SOFTEN",
        toneShift: "standard",
        approachShift: null,
        urgencyDowngrade: false,
        addContextHint: "high_stress_make_project_scope_very_small",
      },
    ],
  },

  // ── Perfectionism ─────────────────────────────────────────────────────────

  perfectionism: {
    class: "perfectionism",
    interventionType: "momentum_rebuild",
    name: "Perfectionism Interrupt",
    description: "'Not ready yet' is indefinite deferral. Reject the readiness frame. Assign the imperfect version now.",
    trigger: {
      type: "goal_abandonment_detected",
      description: "Ongoing 'not ready / once I / waiting until' language with unstarted goals",
      minimumSeverity: "confirmed",
      minimumConfidence: 0.55,
      cooldownDays: 4,
      suppressIfUserEngaged: false,
    },
    responseStyle: {
      approach: "challenge_based",
      tone: "firm",
      urgency: "medium",
      messageLengthTarget: "brief",
      openingMove: "Reject 'not ready' as a frame explicitly. Assign the 30-minute imperfect version today. Set a specific time.",
      avoidList: ["agreeing to wait until ready", "offering help to 'prepare' further", "treating readiness as a valid condition", "multi-step advice"],
    },
    mentorAction: {
      primary: "Reject the readiness frame. Ship the imperfect version. Assign a 30-minute task with a specific time today.",
      frames: [
        "'Not ready' is a feeling, not a fact. You're ready enough.",
        "The perfect version will never exist. The imperfect version ships today.",
        "30 minutes. Imperfect. Today. That's the assignment.",
      ],
      demands: [
        "a 30-minute imperfect version of the first step — today",
        "a specific time today when this will happen",
        "no preparation allowed — start with what you have",
      ],
      refuses: [
        "any further planning or preparation",
        "'when I feel ready' as a timeline",
        "adding more prerequisites before starting",
      ],
      contextHints: [
        "reject_not_ready_frame_explicitly",
        "assign_30min_imperfect_version",
        "specific_time_today_required",
        "no_prep_allowed",
        "ship_something_bad_is_better_than_nothing_perfect",
      ],
    },
    followUp: {
      delayHours: 24,
      prompt: "24h check-in: 'Did the 30-minute version happen? What was the output?' — accept imperfect, reject 'not yet'.",
      skipIf: "user_reported_any_start",
      escalateIf: "user_defers_again_within_24h",
      escalationAction: "assign an even smaller version — 10 minutes, right now",
    },
    stateAdaptations: [
      {
        condition: "state.confidence < 35",
        toneShift: "standard",
        approachShift: null,
        urgencyDowngrade: false,
        addContextHint: "low_confidence_normalise_imperfection_explicitly",
      },
    ],
  },

  // ── Restart Cycle ─────────────────────────────────────────────────────────

  restart_cycle: {
    class: "restart_cycle",
    interventionType: "goal_reset",
    name: "Restart Cycle Break",
    description: "Treat restart as progress — name the pattern, refuse another reset, ask what was different when the last attempt failed.",
    trigger: {
      type: "goal_abandonment_detected",
      description: "2+ abandoned goals or 'fresh start' language recurs across multiple weeks",
      minimumSeverity: "confirmed",
      minimumConfidence: 0.60,
      cooldownDays: 7,
      suppressIfUserEngaged: false,
    },
    responseStyle: {
      approach: "direct",
      tone: "firm",
      urgency: "high",
      messageLengthTarget: "standard",
      openingMove: "Name the restart count explicitly. Refuse to reset. Ask what actually failed last time and what is genuinely different now.",
      avoidList: ["agreeing to start fresh", "treating 'this time will be different' as meaningful without evidence", "providing a new plan before understanding the failure", "shaming"],
    },
    mentorAction: {
      primary: "Name the restart count. Refuse the reset. Diagnose the failure point from the last attempt.",
      frames: [
        "This is the Nth fresh start on this goal. Restarting isn't progress — it's avoidance of the specific point where it always breaks.",
        "Before we do anything — where did the last attempt actually fail? Not what happened, but when exactly did you stop?",
        "Starting fresh erases the evidence. We need that evidence.",
      ],
      demands: [
        "identify the exact point where the last attempt failed",
        "name what is concretely different this time — not 'I'm more motivated'",
        "continue from week 3 of the existing plan instead of restarting week 1",
      ],
      refuses: [
        "creating a new plan from zero",
        "accepting 'this time is different' without evidence",
        "treating reset as a valid intervention",
      ],
      contextHints: [
        "name_restart_count_explicitly",
        "refuse_new_start_from_zero",
        "ask_specific_failure_point_from_last_attempt",
        "demand_concrete_difference_not_motivation",
        "continue_from_failure_point_not_beginning",
      ],
    },
    followUp: {
      delayHours: 72,
      prompt: "72h checkpoint: Ask specifically about the failure point they identified — did they address it?",
      skipIf: "user_reported_progress_past_previous_failure_point",
      escalateIf: "user_requests_another_reset_within_7_days",
      escalationAction: "refuse again — reference the total restart count",
    },
    stateAdaptations: [
      {
        condition: "state.confidence < 35",
        toneShift: "standard",
        approachShift: null,
        urgencyDowngrade: false,
        addContextHint: "low_confidence_acknowledge_effort_before_confronting_pattern",
      },
    ],
  },

  // ── Burnout ───────────────────────────────────────────────────────────────

  burnout: {
    class: "burnout",
    interventionType: "load_reduction",
    name: "Burnout Recovery Protocol",
    description: "This is not a motivation issue — it is a recovery need. Acknowledge first, always. No pushback, no demands. Single optional action.",
    trigger: {
      type: "stress_overload",
      description: "burnoutRisk ≥ 65, stress ≥ 70, or sustained consecutive misses with exhaustion language",
      minimumSeverity: "confirmed",
      minimumConfidence: 0.60,
      cooldownDays: 3,
      suppressIfUserEngaged: false,
    },
    responseStyle: {
      approach: "crisis_led",
      tone: "gentle",
      urgency: "critical",
      messageLengthTarget: "brief",
      openingMove: "Acknowledge the exhaustion without minimising it. No goals, no tasks, no accountability. Ask only how they're doing.",
      avoidList: [
        "any mention of goals or tasks",
        "accountability or progress language",
        "suggesting they push through",
        "listing what they've missed",
        "expressing disappointment",
        "offering a lighter plan",
        "any expectation whatsoever",
      ],
    },
    mentorAction: {
      primary: "Acknowledge exhaustion. Remove all pressure. Offer a single optional micro-action only if they ask.",
      frames: [
        "This isn't laziness — this is a signal your system is running empty.",
        "The goal is still there. It will still be there in a week. Right now it doesn't matter.",
        "The only question is: what do you actually need right now?",
      ],
      demands: [],
      refuses: [
        "any goal or task assignment",
        "suggesting they 'at least do something small'",
        "framing rest as temporary before returning to the plan",
        "any performance expectation",
      ],
      contextHints: [
        "acknowledge_exhaustion_before_anything_else",
        "no_goals_no_tasks_no_accountability",
        "ask_what_they_need_not_what_they_should_do",
        "recovery_is_the_goal_right_now",
        "do_not_push_do_not_suggest",
        "gentle_presence_only",
      ],
    },
    followUp: {
      delayHours: 48,
      prompt: "48h check-in: Ask only 'How are you feeling?' — nothing about the goal.",
      skipIf: "user_is_actively_engaging_about_goal",
      escalateIf: "burnout_language_intensifies_or_safety_concern_arises",
      escalationAction: "crisis_check — ask directly if they are OK and if they have support",
    },
    stateAdaptations: [
      {
        condition: "state.burnoutRisk >= BURNOUT_CONFRONTATION_BLOCK",
        toneShift: "gentle",
        approachShift: "crisis_led",
        urgencyDowngrade: false,
        addContextHint: "critical_burnout_no_agenda_whatsoever",
      },
      {
        condition: "analysis.emotion.primary === 'overwhelmed' || analysis.emotion.primary === 'anxious'",
        toneShift: "gentle",
        approachShift: "gentle",
        urgencyDowngrade: false,
        addContextHint: "hold_space_before_any_direction",
      },
    ],
  },

  // ── All-or-Nothing ────────────────────────────────────────────────────────

  all_or_nothing: {
    class: "all_or_nothing",
    interventionType: "pattern_confrontation",
    name: "All-or-Nothing Reframe",
    description: "One miss ≠ total failure. Reject the binary frame. Ask what 20% looks like.",
    trigger: {
      type: "consistency_collapse",
      description: "User treats any deviation as complete failure and/or requests restart after single miss",
      minimumSeverity: "confirmed",
      minimumConfidence: 0.55,
      cooldownDays: 4,
      suppressIfUserEngaged: false,
    },
    responseStyle: {
      approach: "challenge_based",
      tone: "firm",
      urgency: "medium",
      messageLengthTarget: "brief",
      openingMove: "Reject the binary frame explicitly. Ask what partial progress looks like. Reference the streak or wins if they exist.",
      avoidList: ["agreeing with the 'all ruined' framing", "suggesting they restart", "extensive explanation of why the thinking is wrong", "pep talk"],
    },
    mentorAction: {
      primary: "Reject the binary. Define what partial progress actually is. Get back on track without a restart.",
      frames: [
        "One miss doesn't undo everything. That's not how progress works.",
        "You didn't fail. You had a bad day. Those are different things.",
        "What does 50% of your original plan look like? Start there.",
      ],
      demands: [
        "name one thing you can do today — not restart the whole plan",
        "define what 'partial success' looks like for this week",
      ],
      refuses: [
        "agreeing to restart",
        "treating a single miss as a reason to reassess the entire goal",
        "framing progress in binary terms",
      ],
      contextHints: [
        "reject_binary_framing_explicitly",
        "name_what_partial_progress_is",
        "reference_streak_or_wins_if_any",
        "get_back_on_track_not_restart",
        "do_not_treat_miss_as_verdict",
      ],
    },
    followUp: {
      delayHours: 24,
      prompt: "24h check-in: Did you do the one thing? Not the full plan — the one thing.",
      skipIf: "user_reported_any_completion",
      escalateIf: "user_requests_restart_again_within_24h",
      escalationAction: "name all_or_nothing pattern explicitly — second confrontation",
    },
    stateAdaptations: [
      {
        condition: "state.consecutiveMisses >= 4",
        toneShift: "standard",
        approachShift: "gentle",
        urgencyDowngrade: false,
        addContextHint: "extended_miss_streak_soften_but_hold_frame",
      },
    ],
  },

  // ── Subject Avoidance ─────────────────────────────────────────────────────

  subject_avoidance: {
    class: "subject_avoidance",
    interventionType: "accountability_escalation",
    name: "Subject Avoidance Naming",
    description: "User updates on everything except the active goal. Name the absence without accusation. Ask directly.",
    trigger: {
      type: "goal_abandonment_detected",
      description: "Active goal (14+ days) with zero mentions across multiple check-in responses",
      minimumSeverity: "confirmed",
      minimumConfidence: 0.55,
      cooldownDays: 5,
      suppressIfUserEngaged: false,
    },
    responseStyle: {
      approach: "question_based",
      tone: "standard",
      urgency: "medium",
      messageLengthTarget: "brief",
      openingMove: "Acknowledge their other updates briefly. Then name the absent topic directly, without accusation. Ask one question about it.",
      avoidList: ["accusing them of avoiding it", "lengthy build-up before asking", "suggesting they're lazy or uncommitted", "asking multiple questions at once"],
    },
    mentorAction: {
      primary: "Name the absent topic. Ask one direct question about it. Do not accept a pivot back to other topics.",
      frames: [
        "I notice [goal] hasn't come up in our last [N] conversations.",
        "You've updated me on a lot — but not on [specific goal]. What's happening there?",
        "I'm going to ask directly about [goal] because it matters and we keep not talking about it.",
      ],
      demands: ["a direct answer about the avoided goal — not a pivot"],
      refuses: ["accepting a topic change before they've answered about the avoided goal"],
      contextHints: [
        "name_the_absent_goal_specifically",
        "one_direct_question_about_avoided_topic",
        "do_not_accept_topic_pivot",
        "acknowledge_other_updates_briefly_first",
        "not_accusatory_just_direct",
      ],
    },
    followUp: {
      delayHours: 48,
      prompt: "48h check-in: ask specifically and only about the avoided goal — not about other areas.",
      skipIf: "user_mentioned_avoided_goal_unprompted",
      escalateIf: "avoidance_continues_for_third_check_in",
      escalationAction: "name avoidance pattern directly — ask what the real reason is",
    },
    stateAdaptations: [
      {
        condition: "state.stress >= HIGH_STRESS_TONE_SOFTEN",
        toneShift: "supportive",
        approachShift: "gentle",
        urgencyDowngrade: true,
        addContextHint: "high_stress_soften_approach_but_still_name_avoidance",
      },
    ],
  },

  // ── Comparison Trap ───────────────────────────────────────────────────────

  comparison_trap: {
    class: "comparison_trap",
    interventionType: "momentum_rebuild",
    name: "Comparison Trap Redirect",
    description: "Progress measured against others leads to artificial urgency and demotivation. Reject the comparison frame. Anchor to personal trajectory.",
    trigger: {
      type: "escalation_threshold_crossed",
      description: "Recurring peer comparison with discouragement or unrealistic timeline goals following",
      minimumSeverity: "confirmed",
      minimumConfidence: 0.55,
      cooldownDays: 5,
      suppressIfUserEngaged: true,
    },
    responseStyle: {
      approach: "reflection_led",
      tone: "supportive",
      urgency: "low",
      messageLengthTarget: "standard",
      openingMove: "Acknowledge the feeling of being behind. Reject the comparison frame explicitly. Ask about their own pace and definition of success.",
      avoidList: ["agreeing that they are behind", "comparing them to others favourably", "telling them they're doing great when they're not", "dismissing the feeling"],
    },
    mentorAction: {
      primary: "Reject external comparison. Anchor to personal baseline and trajectory. Redefine success on their terms.",
      frames: [
        "Their timeline is not your data. You are not in the same race.",
        "The only comparison that matters: where you were 30 days ago vs. where you are now.",
        "What does progress look like at YOUR pace — not their pace?",
      ],
      demands: [
        "name your own definition of what 'on track' looks like",
        "compare yourself to yourself 30 days ago — not to anyone else",
      ],
      refuses: [
        "engaging with comparisons to specific peers",
        "setting timelines designed to 'catch up' to others",
        "validating the idea that their pace is inherently wrong",
      ],
      contextHints: [
        "reject_external_comparison_frame",
        "anchor_to_personal_trajectory_not_peers",
        "ask_their_own_definition_of_success",
        "acknowledge_the_feeling_without_validating_the_frame",
        "reference_own_progress_last_30_days",
      ],
    },
    followUp: {
      delayHours: 72,
      prompt: "72h: Ask about their personal definition of progress — not about catching up.",
      skipIf: "user_has_reframed_to_personal_progress",
      escalateIf: "comparison_language_persists_with_increasing_discouragement",
      escalationAction: "deeper reflection — ask about identity and who they are building this for",
    },
    stateAdaptations: [
      {
        condition: "state.confidence < 40",
        toneShift: "gentle",
        approachShift: "gentle",
        urgencyDowngrade: true,
        addContextHint: "low_confidence_be_especially_warm_while_rejecting_comparison",
      },
    ],
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// PATTERN DISCRIMINATOR
// Maps a PatternType + evidence → the specific InterventionClass.
// Handles the ambiguous cases where multiple classes share one PatternType.
// ═══════════════════════════════════════════════════════════════════════════════

const TUTORIAL_HELL_EVIDENCE_SIGNALS = /course|tutorial|udemy|coursera|module|chapter|finishing|after i|bootcamp/i;
const PERFECTIONISM_EVIDENCE_SIGNALS  = /not ready|delay|waiting|once i|perfect|properly|set up/i;
const BURNOUT_EVIDENCE_SIGNALS        = /burnout|burnoutRisk|exhausted|can'?t (anymore|function)|no energy/i;

function discriminatePattern(p: DetectedPattern): InterventionClass {
  const evidenceText = p.evidence.join(" ").toLowerCase();

  switch (p.type) {
    case "overplanning_underexecuting":
      return TUTORIAL_HELL_EVIDENCE_SIGNALS.test(evidenceText) ? "tutorial_hell" : "overplanning";

    case "procrastination_spiral":
      // perfectionism tends to have delay/readiness language; all_or_nothing has binary/restart
      return PERFECTIONISM_EVIDENCE_SIGNALS.test(evidenceText) ? "perfectionism" : "all_or_nothing";

    case "consistency_collapse":
      return BURNOUT_EVIDENCE_SIGNALS.test(evidenceText) ? "burnout" : "motivation_crash";

    case "weekend_ghosting":       return "ghosting";
    case "excuse_cycling":         return "excuse_loop";
    case "goal_abandonment_cycle": return "restart_cycle";
    case "monday_avoidance":       return "subject_avoidance";
    case "commitment_inflation":   return "comparison_trap";

    // The remaining types have direct 1:1 mappings via their evidence
    case "deadline_miss_pattern":  return "excuse_loop";
    case "pressure_withdrawal":    return "burnout";
    case "late_night_panic":       return "all_or_nothing";

    default:
      return "motivation_crash";
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUPPRESSION CHECKER
// Returns a reason string if the intervention should be suppressed, null if OK.
// ═══════════════════════════════════════════════════════════════════════════════

function checkSuppression(
  cls: InterventionClass,
  playbook: InterventionPlaybook,
  state: MentorState,
  analysis: ConversationAnalysis
): string | null {
  // Burnout-critical blocks ALL confrontational interventions
  if (state.burnoutRisk >= BURNOUT_CONFRONTATION_BLOCK) {
    const safe: InterventionClass[] = ["burnout", "ghosting"];
    if (!safe.includes(cls)) {
      return `burnout_critical:${state.burnoutRisk} — confrontation is unsafe; only burnout/re-engagement permitted`;
    }
  }

  // Stress blocks challenge-based interventions
  if (state.stress >= 75) {
    const blocked: ApproachStyle[] = ["challenge_based", "direct"];
    if (blocked.includes(playbook.responseStyle.approach) && cls !== "burnout") {
      return `high_stress:${state.stress} — challenge approach blocked; user capacity is saturated`;
    }
  }

  // Overwhelmed emotion gates hard confrontation
  if (
    (analysis.emotion.primary === "overwhelmed" || analysis.emotion.primary === "anxious") &&
    analysis.emotion.intensity >= OVERWHELM_APPROACH_SHIFT
  ) {
    const hardApproaches: ApproachStyle[] = ["challenge_based", "direct"];
    if (hardApproaches.includes(playbook.responseStyle.approach)) {
      return `overwhelmed_emotion:intensity_${analysis.emotion.intensity.toFixed(2)} — hard confrontation suppressed`;
    }
  }

  // Suppress if the playbook says so and user is currently engaged
  if (playbook.trigger.suppressIfUserEngaged) {
    const engagedIntents = ["progress_report", "status_update", "commitment_made", "check_in_response"];
    if (engagedIntents.includes(analysis.intent)) {
      return `user_engaged:intent_${analysis.intent} — playbook marks suppress_if_engaged`;
    }
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ADAPTATION ENGINE
// Applies state-aware adjustments to the base playbook.
// Returns the modified playbook copy and a list of applied adaptation descriptions.
// ═══════════════════════════════════════════════════════════════════════════════

function applyAdaptations(
  playbook: InterventionPlaybook,
  state: MentorState,
  analysis: ConversationAnalysis
): { adapted: InterventionPlaybook; appliedAdaptations: string[] } {
  const applied: string[] = [];
  let tone       = playbook.responseStyle.tone;
  let approach   = playbook.responseStyle.approach;
  const extraHints: string[] = [];

  // Global: high stress softens tone by one level
  if (state.stress >= HIGH_STRESS_TONE_SOFTEN) {
    const softenMap: Partial<Record<InterventionToneLevel, InterventionToneLevel>> = {
      hard: "firm", firm: "standard", standard: "supportive",
    };
    const softened = softenMap[tone];
    if (softened) {
      applied.push(`stress:${state.stress} → tone softened from ${tone} to ${softened}`);
      tone = softened;
    }
  }

  // Global: overwhelmed emotion softens approach
  if (
    (analysis.emotion.primary === "overwhelmed" || analysis.emotion.primary === "anxious") &&
    analysis.emotion.intensity >= 0.6
  ) {
    const softApproaches: ApproachStyle[] = ["gentle", "question_based", "reflection_led", "crisis_led"];
    if (!softApproaches.includes(approach)) {
      applied.push(`overwhelmed_emotion → approach shifted from ${approach} to question_based`);
      approach = "question_based";
      extraHints.push("acknowledge_overwhelm_before_intervention");
    }
  }

  // Global: first week users — never confront
  if (state.daysSinceFirstSession <= 7 && ["challenge_based", "direct"].includes(approach)) {
    applied.push("first_week → approach shifted to question_based");
    approach = "question_based";
    extraHints.push("first_week_earn_trust_before_confronting");
  }

  // Global: comeback/returning users get gentler delivery
  if (state.flags.includes("comeback") || state.flags.includes("returning_after_gap")) {
    if (tone === "hard" || tone === "firm") {
      applied.push("comeback_flag → tone softened to standard");
      tone = "standard";
      extraHints.push("acknowledge_return_before_any_confrontation");
    }
  }

  // Per-playbook adaptations
  for (const adaptation of playbook.stateAdaptations) {
    // We can't eval() the condition string so we re-check the known conditions at runtime
    const conditionMet = evaluateAdaptationCondition(adaptation.condition, state, analysis);
    if (!conditionMet) continue;

    if (adaptation.toneShift) {
      applied.push(`${adaptation.condition} → tone: ${tone} → ${adaptation.toneShift}`);
      tone = adaptation.toneShift;
    }
    if (adaptation.approachShift) {
      applied.push(`${adaptation.condition} → approach: ${approach} → ${adaptation.approachShift}`);
      approach = adaptation.approachShift;
    }
    if (adaptation.addContextHint) {
      extraHints.push(adaptation.addContextHint);
    }
  }

  const adapted: InterventionPlaybook = {
    ...playbook,
    responseStyle: { ...playbook.responseStyle, tone, approach },
    mentorAction: {
      ...playbook.mentorAction,
      contextHints: [...playbook.mentorAction.contextHints, ...extraHints],
    },
  };

  return { adapted, appliedAdaptations: applied };
}

function evaluateAdaptationCondition(
  condition: string,
  state: MentorState,
  analysis: ConversationAnalysis
): boolean {
  // Map condition strings to actual runtime checks
  if (condition.includes("state.streakDays === 0 && state.consecutiveMisses >= 3"))
    return state.streakDays === 0 && state.consecutiveMisses >= 3;
  if (condition.includes("state.burnoutRisk >= 60"))
    return state.burnoutRisk >= 60;
  if (condition.includes("state.burnoutRisk >= BURNOUT_CONFRONTATION_BLOCK"))
    return state.burnoutRisk >= BURNOUT_CONFRONTATION_BLOCK;
  if (condition.includes("state.consecutiveMisses >= 5"))
    return state.consecutiveMisses >= 5;
  if (condition.includes("state.consecutiveMisses >= 4"))
    return state.consecutiveMisses >= 4;
  if (condition.includes("state.burnoutRisk >= 55"))
    return state.burnoutRisk >= 55;
  if (condition.includes("state.stress >= HIGH_STRESS_TONE_SOFTEN") || condition.includes("state.stress >= 65"))
    return state.stress >= HIGH_STRESS_TONE_SOFTEN;
  if (condition.includes("analysis.emotion.primary === 'overwhelmed'"))
    return analysis.emotion.primary === "overwhelmed" || analysis.emotion.primary === "anxious";
  if (condition.includes("state.consistency < 30"))
    return state.consistency < 30;
  if (condition.includes("state.confidence < 35"))
    return state.confidence < 35;
  if (condition.includes("state.confidence < 40"))
    return state.confidence < 40;
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONTEXT HINT BUILDER
// Assembles the final context hint array injected into the LLM system prompt.
// ═══════════════════════════════════════════════════════════════════════════════

function buildContextHints(
  playbook: InterventionPlaybook,
  pattern: DetectedPattern,
  state: MentorState,
  memory: MemoryContext
): string[] {
  const hints = [...playbook.mentorAction.contextHints];

  // Evidence count — give the LLM a number to reference
  hints.push(`pattern_evidence_count:${pattern.evidence.length}`);
  hints.push(`pattern_confidence:${(pattern.confidenceScore * 100).toFixed(0)}%`);
  hints.push(`pattern_severity:${pattern.severity}`);

  // Active goal reference
  const firstGoal = memory.longTerm.goals[0];
  if (firstGoal) hints.push(`active_goal:${firstGoal.slice(0, 60)}`);

  // Streak / miss context
  if (state.streakDays >= 3)          hints.push(`current_streak:${state.streakDays}_days`);
  if (state.consecutiveMisses >= 2)   hints.push(`consecutive_misses:${state.consecutiveMisses}`);
  if (state.longestStreak >= 7)       hints.push(`longest_streak:${state.longestStreak}_days`);

  // Creature name — personalisation hook
  if (memory.longTerm.creatureName)   hints.push(`creature_name:${memory.longTerm.creatureName}`);

  // Capacity snapshot for scope decisions
  hints.push(`capacity:${state.capacity}`);
  hints.push(`burnout_risk:${state.burnoutRisk}`);

  // Domain
  hints.push(`domain:${memory.longTerm.domains[0] ?? "unknown"}`);

  return hints;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PATTERN CANDIDATE SELECTOR
// Picks the highest-priority, highest-confidence pattern to intervene on.
// ═══════════════════════════════════════════════════════════════════════════════

interface PatternCandidate {
  pattern: DetectedPattern;
  class: InterventionClass;
  urgencyRank: number; // lower = higher urgency
}

function selectCandidate(patterns: PatternAnalysis, state: MentorState): PatternCandidate | null {
  const candidates: PatternCandidate[] = patterns.patterns
    .filter((p) => p.confidenceScore >= MIN_CONFIDENCE_TO_INTERVENE)
    .map((p) => {
      const cls = discriminatePattern(p);
      const urgencyRank = CLASS_URGENCY_ORDER.indexOf(cls);
      return { pattern: p, class: cls, urgencyRank: urgencyRank === -1 ? 99 : urgencyRank };
    });

  if (candidates.length === 0) return null;

  // Sort: severity (critical > entrenched > confirmed > emerging), then urgencyRank, then confidence
  const SEVERITY_ORDER: PatternSeverity[] = ["critical", "entrenched", "confirmed", "emerging"];

  candidates.sort((a, b) => {
    const sevA = SEVERITY_ORDER.indexOf(a.pattern.severity);
    const sevB = SEVERITY_ORDER.indexOf(b.pattern.severity);
    if (sevA !== sevB) return sevA - sevB;
    if (a.urgencyRank !== b.urgencyRank) return a.urgencyRank - b.urgencyRank;
    return b.pattern.confidenceScore - a.pattern.confidenceScore;
  });

  return candidates[0] ?? null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Maps detected patterns to a complete intervention plan.
 *
 * For every returned intervention:
 *   - trigger    — what pattern activated it and why
 *   - responseStyle — tone, approach, urgency, opening move
 *   - mentorAction  — what to do, what to demand, what to refuse
 *   - followUp      — scheduled check-in with skip/escalate conditions
 *
 * Applies state-aware adaptations (stress, burnout, emotion).
 * Enforces suppression when confrontation is unsafe.
 */
export function resolveIntervention(input: InterventionInput): InterventionResult {
  const { patterns, state, analysis, memory } = input;

  // 1. Select the highest-priority candidate
  const candidate = selectCandidate(patterns, state);

  if (!candidate) {
    return noIntervention("no_qualifying_pattern");
  }

  const rawPlaybook = PLAYBOOKS[candidate.class];

  // 2. Check severity/confidence gate
  if (candidate.pattern.severity === "emerging" && candidate.pattern.confidenceScore < 0.60) {
    return noIntervention(`emerging_pattern_below_confidence_gate:${candidate.pattern.confidenceScore.toFixed(2)}`);
  }

  // 3. Check suppression conditions
  const suppressReason = checkSuppression(candidate.class, rawPlaybook, state, analysis);
  if (suppressReason && candidate.class !== "burnout") {
    return noIntervention(suppressReason);
  }

  // 4. Apply state adaptations
  const { adapted: playbook, appliedAdaptations } = applyAdaptations(rawPlaybook, state, analysis);

  // 5. Build context hints
  const contextHints = buildContextHints(playbook, candidate.pattern, state, memory);

  // 6. Compose the base InterventionDecision (compatible with pattern.types.ts interface)
  const decision: InterventionDecision = {
    needed: true,
    type: playbook.interventionType,
    trigger: playbook.trigger.type,
    urgency: playbook.responseStyle.urgency,
    approach: mapApproach(playbook.responseStyle.approach),
    cooldownDays: playbook.trigger.cooldownDays,
    suppressIfUserEngaged: playbook.trigger.suppressIfUserEngaged,
  };

  // 7. Build summary
  const summaryLine = buildSummaryLine(candidate, playbook, appliedAdaptations);

  return {
    needed: true,
    class: candidate.class,
    playbook,
    decision,
    contextHints,
    appliedAdaptations,
    suppressionReason: suppressReason, // may be non-null if burnout was overridden
    summaryLine,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function noIntervention(reason: string): InterventionResult {
  return {
    needed: false,
    class: null,
    playbook: null,
    decision: {
      needed: false,
      type: null,
      trigger: null,
      urgency: "low",
      approach: null,
      cooldownDays: 0,
      suppressIfUserEngaged: false,
    },
    contextHints: [],
    appliedAdaptations: [],
    suppressionReason: reason,
    summaryLine: `no_intervention | reason:${reason}`,
  };
}

function mapApproach(
  style: ApproachStyle
): "direct" | "gentle" | "question_based" | "reflection_led" | null {
  const map: Partial<Record<ApproachStyle, "direct" | "gentle" | "question_based" | "reflection_led">> = {
    direct:          "direct",
    gentle:          "gentle",
    question_based:  "question_based",
    reflection_led:  "reflection_led",
    challenge_based: "direct",
    crisis_led:      "gentle",
  };
  return map[style] ?? null;
}

function buildSummaryLine(
  candidate: PatternCandidate,
  playbook: InterventionPlaybook,
  adaptations: string[]
): string {
  return [
    `intervention:${candidate.class}`,
    `type:${playbook.interventionType}`,
    `approach:${playbook.responseStyle.approach}`,
    `tone:${playbook.responseStyle.tone}`,
    `urgency:${playbook.responseStyle.urgency}`,
    `confidence:${(candidate.pattern.confidenceScore * 100).toFixed(0)}%`,
    `severity:${candidate.pattern.severity}`,
    adaptations.length > 0 ? `adapted:[${adaptations.length}]` : null,
  ].filter(Boolean).join(" | ");
}

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Returns the playbook for a specific intervention class.
 * Used by the LLM layer to understand full intervention detail for any class.
 */
export function getPlaybook(cls: InterventionClass): InterventionPlaybook {
  return PLAYBOOKS[cls];
}

/**
 * Returns all playbooks — used for system prompt construction and debug views.
 */
export function getAllPlaybooks(): InterventionPlaybook[] {
  return Object.values(PLAYBOOKS);
}

/**
 * Maps a PatternType to the InterventionClass it would produce.
 * Useful for preview/display without a full PatternAnalysis.
 */
export function classifyPattern(p: DetectedPattern): InterventionClass {
  return discriminatePattern(p);
}

/**
 * One-line string for logging the intervention result.
 */
export function summarizeIntervention(result: InterventionResult): string {
  return result.summaryLine;
}
