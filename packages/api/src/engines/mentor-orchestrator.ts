import { prisma } from "@repo/db/client";
import { generateOpenAIText } from "../services/openai.service";
import { processMessage } from "../processor/messageProcessor";
import { addToShortTerm, addToLongTerm } from "../services/memory.service";
import { savePlan } from "../services/planner.service";
import { generateEngineResponse } from "../services/llm";
import type { EngineContext } from "../services/llm";
import { computeGymTimeContextFromData } from "../services/gymTimeContext.service";
import type { GymTimeContext } from "../services/gymTimeContext.service";
import type { PatternReport } from "../services/gymPatternDetector.service";
import type { EngagementContext } from "../services/engagement.service";
import { buildRexSessionContextBlock, buildExperienceLevelBlock } from "../services/rexSessionContext.service";
import {
  getMentorState,
  updateMentorState,
} from "./user-state-engine";
import type { MentorState } from "./user-state-engine";
import { detectPatterns } from "./pattern-detector";
import {
  MentorAction,
  DecisionUrgency,
  DecisionTone,
} from "./mentor-decision-engine";
import type { MentorDecision } from "./mentor-decision-engine";
import { runDecisionV2, decisionV2ToMentorDecision, CoachIntervention } from "./decision-engine-v2";
import type { DecisionV2Input } from "./decision-engine-v2";
import { evaluateFeasibility } from "./feasibility-engine";
import type { FeasibilityResult } from "./feasibility-engine";
import { generatePlan, summarizePlan } from "./planner-engine";
import type { PlannerInput, PlannerResult } from "./planner-engine";
import { resolveIntervention } from "./intervention-engine";
import type { InterventionInput, InterventionResult } from "./intervention-engine";
import type { PersonaType } from "../services/personna.service";
import type {
  ConversationAnalysis,
  MessageIntent,
  Domain,
  DetectedGoal,
  DetectedConstraint,
  EmotionResult,
  EmotionType,
  CommitmentLevel,
  RequestedOutcome,
} from "../types/mentor.types";
import type {
  MemoryContext,
  LongTermMemory,
  ShortTermMessage,
  MemoryFact,
} from "../types/memory.types";
import type { PatternAnalysis } from "../types/pattern.types";
import { scoreAndRankFacts } from "./memory-retrieval-v2";
import { extractSignals as extractSignalsV2 } from "./signal-engine-v2";
import { TrainingState } from "./scheduler-intelligence-v2";
import type { SchedulerContextV2 } from "./scheduler-intelligence-v2";
import { buildFitnessSnapshot, type FitnessSnapshot } from "../services/fitnessSnapshot.service";
import type { ParseResult as V2ParseResult } from "./parsing-engine-v2";
import type { RouterDecision } from "./semantic-router";

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export type PipelineStage =
  | "analyze"
  | "load_context"
  | "pattern_detection"
  | "decision"
  | "feasibility"
  | "planner"
  | "intervention"
  | "llm_call"
  | "validate"
  | "persist";

export interface OrchestratorInput {
  platformChatId: string;
  text: string;
  platform: "telegram" | "whatsapp" | "web";
  timestamp?: Date;
  /** "full" saves both user + assistant (standalone use).
   *  "reply_only" skips user message save — use when the caller already saved it. */
  persistMode?: "full" | "reply_only";
  /** Output of Parsing Engine V2 — injected by the webhook when available.
   *  Provides multi-intent detection, pain signals, and RECOMMENDATION_BLOCKED. */
  parseResult?: V2ParseResult;
  /** Semantic router decision — injected when UL is primary router.
   *  Carries UL intent, suggested intervention, and routing source. */
  routerDecision?: RouterDecision;
}

export interface ScheduledAction {
  type: string;
  fireAt: Date;
  payload: Record<string, unknown>;
}

export interface OrchestratorDiagnostics {
  totalMs: number;
  stageTimings: Partial<Record<PipelineStage, number>>;
  stagesRun: PipelineStage[];
  stagesSkipped: PipelineStage[];
  llmCalled: boolean;
  llmTokensRequested: number;
  templateUsed: boolean;
  patternCount: number;
  riskScore: number;
  decisionPath: string[];
  interventionTriggered: boolean;
  planGenerated: boolean;
  feasibilityScore: number | null;
  engineErrors: Array<{ stage: PipelineStage; error: string }>;
}

export interface OrchestratorResult {
  reply: string;
  decision: MentorDecision;
  state: MentorState;
  analysis: ConversationAnalysis;
  diagnostics: OrchestratorDiagnostics;
  scheduledActions: ScheduledAction[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

const SKIP_PATTERN_MIN_DAYS     = 3;
const SKIP_PATTERN_MIN_MESSAGES = 5;
const FALLBACK_PERSONA: PersonaType = "nova";
const DEFAULT_TONE: "hard" | "soft" | "dynamic" = "dynamic";
const MIN_FEASIBILITY_FOR_PLAN  = 20;

const BANNED_PHRASES = [
  "Great!", "Awesome!", "Absolutely!", "Of course!", "Certainly!",
  "You've got this!", "Let's go!", "Clock's ticking", "No excuses",
  "As your mentor", "I understand how you feel", "That's a great question",
];

// ═══════════════════════════════════════════════════════════════════════════════
// STAGE 1: CONVERSATION ANALYSIS
// Maps legacy processMessage output → full ConversationAnalysis
// ═══════════════════════════════════════════════════════════════════════════════

const LEGACY_INTENT_MAP: Record<string, MessageIntent> = {
  planning:          "plan_request",
  goal_set:          "goal_set",
  progress_check:    "progress_report",
  weekly_review:     "progress_report",
  completion:        "status_update",
  streak_check:      "status_update",
  gym_checkin:       "status_update",
  focus_start:       "status_update",
  rest_day:          "status_update",
  emotional_trigger: "emotional_vent",
  deadline_set:      "deadline_set",
  schedule_adjust:   "schedule_adjust",
  missed_session:    "failure_report",
  energy_checkin:    "check_in_response",
  general_chat:      "general_chat",
};

function mapIntent(raw: string): MessageIntent {
  return (LEGACY_INTENT_MAP[raw] as MessageIntent | undefined) ?? "general_chat";
}

function detectRichEmotion(text: string): EmotionResult {
  const t = text.toLowerCase();

  const checks: Array<[EmotionType, RegExp, number, "positive" | "negative" | "neutral"]> = [
    ["overwhelmed",  /\b(overwhelmed|too much|can'?t handle|everything at once|drowning)\b/,              0.80, "negative"],
    ["anxious",      /\b(anxious|anxiety|nervous|worried|scared|fear|panic)\b/,                           0.75, "negative"],
    ["stressed",     /\b(stressed|stress|pressure|tense|tight deadline|burnt? out|burnout)\b/,            0.70, "negative"],
    ["frustrated",   /\b(frustrated|annoyed|fed up|angry|upset|hate this)\b/,                            0.70, "negative"],
    ["discouraged",  /\b(discouraged|hopeless|pointless|useless|what'?s the point|can'?t do this)\b/,    0.70, "negative"],
    ["guilty",       /\b(guilty|feel bad|bad about|let (you|myself) down|should have|i failed)\b/,       0.65, "negative"],
    ["confused",     /\b(confused|don'?t understand|not sure|unsure|lost|how do i|where do i)\b/,        0.60, "neutral"],
    ["avoidant",     /\b(don'?t want to|don'?t feel like|maybe later|not today|avoiding)\b/,             0.60, "negative"],
    ["defensive",    /\b(that'?s not fair|you don'?t understand|stop (pushing|pressuring)|back off)\b/,  0.70, "negative"],
    ["determined",   /\b(determined|committed|going to do|will do|this time|ready|let'?s do this)\b/,    0.70, "positive"],
    ["motivated",    /\b(motivated|excited|pumped|energized|hyped|can'?t wait)\b/,                       0.75, "positive"],
    ["hopeful",      /\b(hopeful|hope|think i can|maybe i|going to try|starting to)\b/,                  0.60, "positive"],
    ["proud",        /\b(proud|accomplished|did it|finally|achieved|crushed it)\b/,                      0.75, "positive"],
  ];

  for (const [type, pattern, intensity, valence] of checks) {
    if (pattern.test(t)) {
      const secondary = detectSecondaryEmotion(t, type);
      return { primary: type, secondary, intensity, valence, confidence: 0.75 };
    }
  }

  const valence = /\b(good|great|fine|well|okay|ok|done|finished)\b/.test(t) ? "positive" : "neutral";
  return { primary: "neutral", secondary: null, intensity: 0.30, valence, confidence: 0.50 };
}

function detectSecondaryEmotion(text: string, primary: EmotionType): EmotionType | null {
  if (primary === "overwhelmed" && /\b(anxious|worried)\b/.test(text)) return "anxious";
  if (primary === "frustrated"  && /\b(tired|exhausted)\b/.test(text)) return "discouraged";
  if (primary === "determined"  && /\b(nervous|worried)\b/.test(text)) return "anxious";
  return null;
}

function detectDomain(text: string): Domain {
  const t = text.toLowerCase();
  if (/\b(gym|workout|training|fitness|muscle|lift|bench|squat|deadlift|run|cardio|diet|protein|weight)\b/.test(t)) return "fitness";
  if (/\b(study|exam|course|tutorial|learn|dsa|leetcode|college|university|assignment|homework|test)\b/.test(t)) return "study";
  if (/\b(job|career|interview|resume|cv|office|salary|promotion|startup|company)\b/.test(t)) return "career";
  if (/\b(habit|routine|sleep|wake|morning|evening|schedule|daily|consistency|streak)\b/.test(t)) return "habits";
  if (/\b(money|finance|budget|savings|invest|debt|expense|income)\b/.test(t)) return "finance";
  if (/\b(mental health|therapy|anxiety|depression|mindfulness|meditation|wellbeing)\b/.test(t)) return "mental_health";
  if (/\b(friend|family|relationship|partner|colleague|social|communication)\b/.test(t)) return "relationships";
  if (/\b(write|art|music|create|design|creative|paint|draw|story|poem)\b/.test(t)) return "creative";
  return "unknown";
}

function detectConstraints(text: string): DetectedConstraint[] {
  const t = text.toLowerCase();
  const out: DetectedConstraint[] = [];

  if (/\b(exam|exams|test|finals|midterm|submission)\b/.test(t))
    out.push({ type: "exam_season",           raw: text, severity: "moderate", isTemporary: true  });
  if (/\b(work (exploded|is crazy|pressure)|tight deadline|project due)\b/.test(t))
    out.push({ type: "work_pressure",          raw: text, severity: "moderate", isTemporary: true  });
  if (/\b(family|parents|relative|home situation)\b/.test(t))
    out.push({ type: "family_responsibility",  raw: text, severity: "mild",     isTemporary: true  });
  if (/\b(injured|injury|pain|hurt|can'?t (use|move|lift))\b/.test(t))
    out.push({ type: "injury",                 raw: text, severity: "moderate", isTemporary: true  });
  if (/\b(burnt? out|burnout|no energy|exhausted|can'?t function)\b/.test(t))
    out.push({ type: "burnout",                raw: text, severity: "severe",   isTemporary: false });
  if (/\b(no money|broke|can'?t afford)\b/.test(t))
    out.push({ type: "financial",              raw: text, severity: "moderate", isTemporary: false });

  return out;
}

function detectGoal(text: string, intent: MessageIntent, domain: Domain): DetectedGoal | null {
  if (intent !== "goal_set" && intent !== "plan_request") return null;
  const t = text.toLowerCase();
  const isVague =
    /\b(better|improve|more|do stuff|work on|be good at)\b/.test(t) &&
    !/\b(in \d+ (weeks?|months?|days?)|by|within|\d+ (hours?|sessions?))\b/.test(t);
  let horizon: DetectedGoal["horizon"] = "medium_term";
  if (/\b(today|tonight|this session|right now)\b/.test(t))               horizon = "immediate";
  else if (/\b(this week|next \d+ days|7 days)\b/.test(t))               horizon = "short_term";
  else if (/\b(this (month|year)|long.?term|career|eventually)\b/.test(t)) horizon = "long_term";
  return {
    raw:        text.slice(0, 100),
    normalized: text.trim().slice(0, 80),
    domain,
    horizon,
    isVague,
    confidence: isVague ? 0.50 : 0.75,
  };
}

function detectCommitmentLevel(text: string, intent: MessageIntent): CommitmentLevel {
  const t = text.toLowerCase();
  if (/\b(i will|i commit|i promise|definitely|100%|no matter what)\b/.test(t)) return "very_high";
  if (/\b(i'?ll|i plan to|i'?m going to|planning to)\b/.test(t))               return "high";
  if (/\b(i think|i'?ll try|maybe|i should|might)\b/.test(t))                  return "medium";
  if (/\b(not sure|probably not|doubt)\b/.test(t))                             return "low";
  if (intent === "commitment_made")                                             return "high";
  return "none";
}

function detectRequestedOutcome(intent: MessageIntent, text: string): RequestedOutcome {
  const t = text.toLowerCase();
  if (intent === "plan_request" || intent === "goal_set")              return "planning";
  if (intent === "progress_report" || intent === "status_update")     return "status_acknowledgment";
  if (intent === "emotional_vent")                                     return "venting";
  if (intent === "accountability_request")                             return "accountability";
  if (/\b(how|what|why|where|when|tell me|explain|help me understand)\b/.test(t)) return "learning";
  if (/\b(advice|suggestion|should i|what do you think)\b/.test(t))  return "advice";
  if (/\b(reflect|looking back|what went wrong)\b/.test(t))          return "reflection";
  if (/\b(motivate|push me|kick me|keep me)\b/.test(t))              return "motivation";
  return "none";
}

function buildConversationAnalysis(
  rawText: string,
  legacy: Awaited<ReturnType<typeof processMessage>>,
): ConversationAnalysis {
  const intent          = mapIntent(legacy.intent);
  const domain          = detectDomain(rawText);
  const emotion         = detectRichEmotion(rawText);
  const constraints     = detectConstraints(rawText);
  const goal            = detectGoal(rawText, intent, domain);
  const commitmentLevel = detectCommitmentLevel(rawText, intent);
  const requestedOutcome = detectRequestedOutcome(intent, rawText);

  const t = rawText.toLowerCase();
  const hasFailureReport = /\b(failed|didn'?t|missed|skipped|couldn'?t|gave up|didn'?t make it)\b/.test(t);
  const hasExcuse        = hasFailureReport && /\b(because|due to|since|was sick|had to|wasn'?t able)\b/.test(t);
  const hasCommitment    = commitmentLevel !== "none";
  const isQuestion       = rawText.trim().endsWith("?") ||
    /^(how|what|why|where|when|can|could|should|would|is|are|do|does)\b/.test(t);

  const secondaryIntents: MessageIntent[] = [];
  if (hasFailureReport && intent !== "failure_report") secondaryIntents.push("failure_report");
  if (hasExcuse)                                       secondaryIntents.push("excuse");
  if (hasCommitment && intent !== "commitment_made")   secondaryIntents.push("commitment_made");

  const commitmentScores: Record<CommitmentLevel, number> = {
    none: 0, low: 0.20, medium: 0.50, high: 0.75, very_high: 0.95,
  };

  return {
    entities:       legacy.entities,
    intent,
    secondaryIntents,
    goal,
    domain,
    emotion,
    constraints,
    commitmentLevel,
    commitmentScore:    commitmentScores[commitmentLevel],
    urgency:            constraints.some(c => c.severity === "severe") ? 0.80 :
                        constraints.some(c => c.severity === "moderate") ? 0.50 : 0.30,
    requestedOutcome,
    hasFailureReport,
    hasExcuse,
    hasCommitment,
    isQuestion,
    isRepeat:           false,
    wordCount:          rawText.split(/\s+/).filter(Boolean).length,
    confidence:         0.70,
    rawText,
    normalizedText:     legacy.cleanedText,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// STAGE 2: LOAD USER CONTEXT (parallel state + DB)
// ═══════════════════════════════════════════════════════════════════════════════

interface UserContext {
  memory:              MemoryContext;
  state:               MentorState;
  persona:             PersonaType;
  isFirstSession:      boolean;
  messageCountToday:   number;
  tonePreference:      "hard" | "soft" | "dynamic";
  gymContext:          GymTimeContext | null;
  gymPatternReport:    PatternReport | null;
  engagementContext:   EngagementContext | null;
  rexSessionContext:   string | null;
  rexExperienceLevel:  string | null;
  schedulerContextV2:  SchedulerContextV2 | null;
  fitnessSnapshot:     FitnessSnapshot | null;
  intakeAnswers:       unknown;
  rawMemories:         Array<{ id: string; type: string; key: string; value: string; confidence: number; createdAt: Date; updatedAt: Date }>;
  interventionHistory: Array<{ intervention: string; createdAt: Date }>;
}

async function loadUserContext(
  platformChatId: string,
  now:            Date,
  message:        string,
  intent:         string,
  emotion:        string,
): Promise<UserContext> {
  const [state, userRow] = await Promise.all([
    getMentorState(platformChatId),
    prisma.messengerUser.findUnique({
      where: { platform_platformChatId: { platform: "telegram", platformChatId } },
      select: {
        id:                   true,
        createdAt:            true,
        persona:              true,
        timezone:             true,
        preferredCheckInTime: true,
        intakeAnswers:        true,
        messages: {
          orderBy: { createdAt: "desc" },
          take: 25,
          select: { role: true, text: true, intent: true, emotion: true, createdAt: true },
        },
        memories: {
          where:   { archivedAt: null },
          orderBy: { updatedAt: "desc" },
          take: 50,
          select: { id: true, type: true, key: true, value: true, confidence: true, createdAt: true, updatedAt: true },
        },
        goals: {
          where:   { status: "active" },
          orderBy: { updatedAt: "desc" },
          take: 5,
          select: { title: true },
        },
      },
    }),
  ]);

  if (!userRow) {
    return buildMinimalContext(state);
  }

  const todayCutoff = new Date(now.getTime() - 86_400_000);
  const messageCountToday = userRow.messages.filter(
    m => m.role === "user" && new Date(m.createdAt) >= todayCutoff
  ).length;

  const isFirstSession = userRow.messages.length < 3;
  const persona: PersonaType = (userRow.persona as PersonaType | null) ?? FALLBACK_PERSONA;
  const daysSinceFirst = Math.floor((now.getTime() - userRow.createdAt.getTime()) / 86_400_000);

  // ShortTermMessage[] (DB is desc, reverse to chronological)
  const shortTerm: ShortTermMessage[] = [...userRow.messages].reverse().map(m => ({
    role:      m.role as "user" | "assistant",
    text:      m.text,
    intent:    m.intent,
    emotion:   m.emotion,
    timestamp: new Date(m.createdAt),
  }));

  const memories = userRow.memories;
  const creatureFact      = memories.find(m => m.type === "creature_name");
  const accountStyleFact  = memories.find(m => m.type === "accountability_style");

  const longTerm: LongTermMemory = {
    goals:             [...userRow.goals.map(g => g.title), ...memories.filter(m => m.type === "goal").map(m => m.value)],
    struggles:         memories.filter(m => m.type === "struggle").map(m => m.value),
    anchors:           memories.filter(m => m.type === "anchor").map(m => m.value),
    preferences:       memories.filter(m => m.type === "preference").map(m => m.value),
    achievements:      memories.filter(m => m.type === "achievement").map(m => m.value),
    knownPatterns:     memories.filter(m => m.type === "detected_pattern").map(m => m.key),
    domains:           [],
    gym:               null,
    creatureName:      creatureFact?.value ?? null,
    aspirationWords:   [],
    accountabilityStyle: accountStyleFact?.value ?? null,
  };

  // Separate intervention logs before relevance scoring so they don't pollute rankings
  const interventionLogs = memories.filter(m => m.type === "intervention_log");
  const scorableMemories = memories.filter(m => m.type !== "intervention_log");
  const interventionHistory = [...interventionLogs]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 10)
    .map(m => ({ intervention: m.value, createdAt: new Date(m.createdAt) }));
  const rawMemories = scorableMemories.map(m => ({
    id: m.id, type: m.type, key: m.key, value: m.value,
    confidence: m.confidence, createdAt: new Date(m.createdAt), updatedAt: new Date(m.updatedAt),
  }));

  // V2: score every loaded fact by semantic relevance (intent + emotion + message
  // overlap + goal relevance) rather than taking the 10 most-recently-updated.
  const relevantFacts: MemoryFact[] = scoreAndRankFacts(
    scorableMemories.map(m => ({
      id:         m.id,
      type:       m.type,
      key:        m.key,
      value:      m.value,
      confidence: m.confidence,
      createdAt:  new Date(m.createdAt),
      updatedAt:  new Date(m.updatedAt),
    })),
    {
      message,
      intent,
      emotion,
      activeGoals: longTerm.goals,
      topK:        10,
    },
    now,
  ).map(m => ({
    id:              m.id,
    type:            m.type,
    key:             m.key,
    value:           m.value,
    confidence:      m.confidence,
    ageHours:        m.ageHours,
    sourceMessageId: null,
    createdAt:       m.createdAt,
    updatedAt:       m.updatedAt,
  }));

  const lastUserMsg      = shortTerm.filter(m => m.role === "user").at(-1)?.text ?? null;
  const lastAssistantMsg = shortTerm.filter(m => m.role === "assistant").at(-1)?.text ?? null;

  const memory: MemoryContext = {
    shortTerm,
    longTerm,
    relevantFacts,
    sessionCount:          Math.ceil(userRow.messages.length / 5),
    daysSinceFirstMessage: daysSinceFirst,
    lastUserMessage:       lastUserMsg,
    lastTopicDiscussed:    null,
    lastAssistantMessage:  lastAssistantMsg,
  };

  const tonePreference: "hard" | "soft" | "dynamic" =
    longTerm.preferences.includes("hard_tone") ? "hard" :
    longTerm.preferences.includes("soft_tone") ? "soft" :
    DEFAULT_TONE;

  // V2: use let so we can enrich it with cycle-accurate Scheduler V2 data below
  let gymContext = computeGymTimeContextFromData(
    {
      persona:              userRow.persona,
      timezone:             userRow.timezone,
      preferredCheckInTime: userRow.preferredCheckInTime,
      intakeAnswers:        userRow.intakeAnswers,
      memories:             memories.filter(m => m.type === "anchor"),
      messages:             userRow.messages,
    },
    now,
  );

  let gymPatternReport:  PatternReport  | null = null;
  let engagementContext: EngagementContext | null = null;
  let rexSessionContext: string | null = null;
  let rexExperienceLevel: string | null = null;
  let schedulerCtxV2: SchedulerContextV2 | null = null;
  let fitnessSnapshot: FitnessSnapshot | null = null;

  if (persona === "rex") {
    const [snapshotBundle, sessionCtxBlock] = await Promise.all([
      buildFitnessSnapshot(userRow.id, platformChatId, now).catch((err) => {
        console.error("[ORCHESTRATOR] fitnessSnapshot:", err);
        return null;
      }),
      buildRexSessionContextBlock(platformChatId, now).catch((err) => {
        console.error("[ORCHESTRATOR] rexSessionContext:", err);
        return null;
      }),
    ]);

    if (snapshotBundle) {
      fitnessSnapshot  = snapshotBundle.snapshot;
      gymPatternReport = snapshotBundle.patternReport;
      engagementContext = snapshotBundle.engagementCtx;
      schedulerCtxV2   = snapshotBundle.schedulerCtx;
    }
    rexSessionContext  = sessionCtxBlock;
    rexExperienceLevel = buildExperienceLevelBlock(userRow.intakeAnswers);

    // V2: Override calendar-based gymContext fields with cycle-accurate data.
    // pendingMuscles = next session in split cycle (never weekday-derived).
    // isTrainingDay  = DUE (user is in their window) or PENDING_CONFIRMATION
    //                  (window passed, no session logged yet).
    if (schedulerCtxV2 && gymContext) {
      gymContext = {
        ...gymContext,
        todayMuscles:      schedulerCtxV2.pendingMuscles ?? gymContext.todayMuscles,
        isTrainingDay:     schedulerCtxV2.trainingState === TrainingState.DUE
                        || schedulerCtxV2.trainingState === TrainingState.PENDING_CONFIRMATION,
        lastSessionDaysAgo: schedulerCtxV2.daysSinceLastSession < 999
          ? schedulerCtxV2.daysSinceLastSession
          : gymContext.lastSessionDaysAgo,
      };
    }
  }

  return { memory, state, persona, isFirstSession, messageCountToday, tonePreference, gymContext, gymPatternReport, engagementContext, rexSessionContext, rexExperienceLevel, schedulerContextV2: schedulerCtxV2, fitnessSnapshot, intakeAnswers: userRow.intakeAnswers, rawMemories, interventionHistory };
}

function buildMinimalContext(state: MentorState): UserContext {
  const emptyLongTerm: LongTermMemory = {
    goals: [], struggles: [], anchors: [], preferences: [],
    achievements: [], knownPatterns: [], domains: [], gym: null,
    creatureName: null, aspirationWords: [], accountabilityStyle: null,
  };
  const memory: MemoryContext = {
    shortTerm: [], longTerm: emptyLongTerm, relevantFacts: [],
    sessionCount: 0, daysSinceFirstMessage: 0,
    lastUserMessage: null, lastTopicDiscussed: null, lastAssistantMessage: null,
  };
  return { memory, state, persona: FALLBACK_PERSONA, isFirstSession: true, messageCountToday: 0, tonePreference: DEFAULT_TONE, gymContext: null, gymPatternReport: null, engagementContext: null, rexSessionContext: null, rexExperienceLevel: null, schedulerContextV2: null, fitnessSnapshot: null, intakeAnswers: null, rawMemories: [], interventionHistory: [] };
}

// buildSystemPrompt removed — llm.ts generateEngineResponse builds the prompt
// from the full EngineContext. See packages/api/src/services/llm.ts.

// ═══════════════════════════════════════════════════════════════════════════════
// RESPONSE VALIDATOR
// Strips banned phrases, enforces question budget.
// ═══════════════════════════════════════════════════════════════════════════════

function validateResponse(reply: string, memory: MemoryContext, userText: string): string {
  let out = reply;

  for (const phrase of BANNED_PHRASES) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(escaped, "g"), "").trim();
  }

  const lastBotHadQuestion = memory.lastAssistantMessage?.includes("?") ?? false;
  // Short user replies (≤ 3 words) answering a bot question mean: don't ask again.
  // e.g. user says "dev" or "yeah" or "not yet" — they want direction, not interrogation.
  const userRepliedShort = userText.trim().split(/\s+/).length <= 3;

  if ((lastBotHadQuestion || userRepliedShort) && out.includes("?")) {
    const stripped = out.replace(/\s*[^.!?\n]*\?\s*$/, "").trim();
    if (stripped) out = stripped;
  }

  // Never end with an empty fallback that contains a question (ironic after stripping)
  return out.trim() || "Keep moving.";
}

// ═══════════════════════════════════════════════════════════════════════════════
// PERSIST TURN (fire and forget — does not block the reply)
// ═══════════════════════════════════════════════════════════════════════════════

function persistTurn(
  platformChatId: string,
  userText: string,
  assistantReply: string,
  analysis: ConversationAnalysis,
  planResult: PlannerResult | null,
  mode: "full" | "reply_only",
): void {
  const saves: Promise<unknown>[] = [
    addToShortTerm(platformChatId, assistantReply, { role: "assistant" }),
    updateMentorState(platformChatId, { analysis }),
  ];

  if (mode === "full") {
    saves.push(
      addToShortTerm(platformChatId, userText, {
        role:    "user",
        intent:  analysis.intent,
        emotion: analysis.emotion.primary,
      }),
    );
  }

  if (planResult && "canGenerate" in planResult && planResult.canGenerate) {
    saves.push(savePlan(platformChatId, summarizePlan(planResult)));
  }

  Promise.allSettled(saves).catch(err =>
    console.error("[ORCHESTRATOR] persistTurn error:", err),
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// INTERNAL UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

function emptyPatterns(): PatternAnalysis {
  return { patterns: [], dominantPattern: null, riskScore: 0, positivePatterns: [], insights: [] };
}

function fallbackDecision(): MentorDecision {
  return {
    action:           MentorAction.ASK,
    subAction:        "general_checkin",
    urgency:          DecisionUrgency.LOW,
    tone:             DecisionTone.STANDARD,
    requiresLLM:      true,
    tokenBudget:      120,
    template:         null,
    ruleId:           "FALLBACK",
    reason:           "Pipeline error — defaulting to open question",
    confidence:       0.40,
    contextHints:     [],
    decisionPath:     [],
    blockedActions:   [],
    suppressFollowUp: true,
  };
}

function buildScheduledActions(
  decision: MentorDecision,
  intervention: InterventionResult | null,
  at: Date,
): ScheduledAction[] {
  const actions: ScheduledAction[] = [];

  if (!decision.suppressFollowUp && decision.urgency !== DecisionUrgency.LOW) {
    actions.push({
      type:    "follow_up_check",
      fireAt:  new Date(at.getTime() + 86_400_000),
      payload: { ruleId: decision.ruleId, action: decision.action },
    });
  }

  if (intervention?.needed && intervention.playbook) {
    const delayMs = intervention.playbook.followUp.delayHours * 3_600_000;
    actions.push({
      type:   "intervention_follow_up",
      fireAt: new Date(at.getTime() + delayMs),
      payload: {
        class:       intervention.class,
        prompt:      intervention.playbook.followUp.prompt,
        escalateIf:  intervention.playbook.followUp.escalateIf,
      },
    });
  }

  return actions;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MENTOR ORCHESTRATOR V3
// ═══════════════════════════════════════════════════════════════════════════════
//
// Architecture shift: OpenAI decides coaching approach. Code verifies and persists.
//
// V1: User → UL → Decision Engine → Intervention Engine → OpenAI(writes)
// V3: User → UL → Context Assembly → OpenAI(decides+writes) → Verify → Persist
//
// Deterministic systems unchanged: extraction, verification, scheduler, logging,
// reminders, persistence. OpenAI becomes: coach, mentor, intervention selector.
//
// Rollback: MENTOR_V3_ENABLED=false → instant fallback to V1 pipeline.
// ═══════════════════════════════════════════════════════════════════════════════

// ── V3 Types ──────────────────────────────────────────────────────────────────

interface RexContext {
  userProfile:             Record<string, string>;
  ulIntent:                string | null;
  ulEmotion:               string | null;
  ulTopic:                 string | null;
  ulSuggestedIntervention: string | null;
  schedulerState:          SchedulerContextV2 | null;
  schedulerNarrative:      string;
  todaySessionStatus:      string;
  activeCommitments:       string[];
  topRelevantMemories:     MemoryFact[];
  conversationHistory:     Array<{ role: "user" | "assistant"; text: string }>;
  currentMessage:          string;
  daysSinceJoined:         number;
  signalEngineOutput:      ReturnType<typeof extractSignalsV2>["detectedSignals"];
  // Phase 3 context extensions
  mentorStateCtx:     { burnoutRisk: number; motivation: number; capacity: number; streakDays: number; consecutiveMisses: number } | null;
  topSignalCtx:       { signals: string[]; topSignal: string; intensity: number } | null;
  gymPatternCtx:      { stalledLifts: string[]; deloadDue: boolean; plateauDetected: boolean; consistencyScore: number; interventionMessage: string | null } | null;
  engagementCtx:      { sessionsThisMonth: number; streak: number; biggestPR: string; completionRate7d: number } | null;
  sessionCtx:         { daysSinceLastSession: number; pendingMuscles: string | null } | null;
  behavioralPatterns: { skippedMuscles: string[]; rpeTrend: string } | null;
  interventionHistory: Array<{ intervention: string; createdAt: Date }>;
  contrastiveMemories: MemoryFact[];
  empathizeLoop:       boolean;
  lastIntervention:    string | null;
}

interface V3StateUpdates {
  sessionLogged:       boolean;
  missedSessionLogged: boolean;
  commitmentMade:      string | null;
  goalUpdated:         string | null;
}

interface RexOpenAIResponse {
  reply:             string;
  intervention_used: string;
  mood_detected:     string;
  state_updates:     V3StateUpdates;
  parseError:        boolean;
  rawOutput?:        string;
}

interface StateConflict {
  field:           string;
  currentValue:    string;
  proposedValue:   string;
  confirmQuestion: string;
}

// All 21 valid intervention names (19 from CoachIntervention enum + 2 Phase 3 additions)
const VALID_V3_INTERVENTIONS = new Set([
  ...Object.values(CoachIntervention).map(v => v.toLowerCase()),
  "anchor_commitment",
  "re_engagement",
]);

// ── Phase 3: Contrastive memory retrieval ────────────────────────────────────
// Maps current mood/signal to memory types that reframe vs. reinforce it.
// Standard retrieval finds similar context; contrastive finds counterevidence.

// Keys must be valid SignalType values or UL emotion values — no invented keys.
// Values must be memory types actually written to the DB.
// Dead keys removed: missed_workout (not a SignalType), quitting (not a SignalType)
// Dead value types removed: milestone (never stored), pr (stored as "achievement")
const CONTRASTIVE_SIGNAL_MAP: Record<string, string[]> = {
  // Signal Engine types
  self_doubt:        ["achievement", "goal"],
  excuse:            ["promise", "commitment", "goal"],
  burnout:           ["anchor", "preference"],
  overwhelm:         ["anchor", "preference"],
  fear:              ["achievement", "goal"],
  // UL emotion types
  defeated:          ["achievement", "goal"],
  frustrated:        ["achievement", "goal"],
  tired:             ["anchor", "preference"],
};

function buildContrastiveMemories(
  rawMemories: UserContext["rawMemories"],
  mood: string | null,
  topSignal: string | null,
): MemoryFact[] {
  const key = (mood ?? topSignal ?? "").toLowerCase().replace(/[\s-]/g, "_");
  const targetTypes = CONTRASTIVE_SIGNAL_MAP[key] ?? [];
  if (targetTypes.length === 0) return [];
  return rawMemories
    .filter(m => targetTypes.some(t => m.type.includes(t)))
    .slice(0, 5)
    .map(m => ({
      id: m.id, type: m.type, key: m.key, value: m.value,
      confidence: m.confidence,
      ageHours: Math.floor((Date.now() - m.createdAt.getTime()) / 3_600_000),
      sourceMessageId: null,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
    }));
}

// ── Step 2: Scheduler narrative ───────────────────────────────────────────────

function buildSchedulerNarrative(
  ctx:          SchedulerContextV2 | null,
  daySinceJoin: number,
): string {
  if (!ctx || !ctx.hasAnyHistory) {
    return daySinceJoin > 0
      ? `Day ${daySinceJoin}. No training history recorded yet.`
      : "New user — no training history recorded yet.";
  }

  const day     = `Day ${daySinceJoin}.`;
  const muscles = ctx.pendingMuscles ?? "Rest day";

  const stateLine = (() => {
    switch (ctx.trainingState) {
      case "completed":            return `${muscles} session already done today.`;
      case "due":                  return `${muscles} session due — not yet logged.`;
      case "pending_confirmation": return `${muscles} window passed — session unconfirmed.`;
      case "upcoming":             return `${muscles} session coming up later today.`;
      case "skipped":              return `${muscles} — skipped today.`;
      default:                     return `${muscles}.`;
    }
  })();

  const contextLine = (() => {
    if (ctx.consecutiveMisses >= 3)
      return `Missed the last ${ctx.consecutiveMisses} sessions — longest miss streak since joining.`;
    if (ctx.consecutiveMisses > 0)
      return `Missed the last ${ctx.consecutiveMisses} session${ctx.consecutiveMisses > 1 ? "s" : ""}.`;
    const rate = Math.round(ctx.completionRate7d * 100);
    if (rate >= 80) return `${rate}% completion rate this week — strong run.`;
    if (ctx.daysSinceLastSession > 7) return `${ctx.daysSinceLastSession} days since last session.`;
    return `Completion rate last 7 days: ${rate}%.`;
  })();

  return `${day} ${stateLine} ${contextLine}`.trim();
}

// ── Step 1: Build Rex context ─────────────────────────────────────────────────

function buildRexContext(
  input:   OrchestratorInput,
  userCtx: UserContext,
  sigV2:   ReturnType<typeof extractSignalsV2>,
): RexContext {
  const { memory, schedulerContextV2, state, gymPatternReport, engagementContext, rawMemories, interventionHistory } = userCtx;
  const daysSinceJoined = memory.daysSinceFirstMessage;

  const ulResult    = input.routerDecision?.source === "ul" ? input.routerDecision.ulResult : null;
  const ulAny       = ulResult as Record<string, unknown> | null;
  const ulIntent    = typeof ulAny?.intent    === "string" ? ulAny.intent    : null;
  const ulEmotion   = typeof ulAny?.emotion   === "string" ? ulAny.emotion   : null;
  const ulTopic     = typeof ulAny?.topic     === "string" ? ulAny.topic     : null;
  const ulSuggested = input.routerDecision?.source === "ul"
    ? (input.routerDecision.suggestedIntervention ?? null)
    : null;

  const userProfile = userCtx.intakeAnswers != null &&
    typeof userCtx.intakeAnswers === "object" &&
    !Array.isArray(userCtx.intakeAnswers)
    ? userCtx.intakeAnswers as Record<string, string>
    : {};

  const activeCommitments = memory.relevantFacts
    .filter(f => f.type === "promise" || f.type === "commitment")
    .slice(0, 5)
    .map(f => f.value);

  const topRelevantMemories = memory.relevantFacts.slice(0, 7);

  const conversationHistory = memory.shortTerm
    .slice(-10)
    .map(m => ({ role: m.role as "user" | "assistant", text: m.text }));

  const schedulerNarrative  = buildSchedulerNarrative(schedulerContextV2, daysSinceJoined);
  const todaySessionStatus  = schedulerContextV2?.trainingState.toUpperCase() ?? "UNKNOWN";

  // Phase 3 extended context (gated by PHASE3_CONTEXT_ENABLED)
  const phase3Enabled = process.env.PHASE3_CONTEXT_ENABLED === "true";

  let mentorStateCtx: RexContext["mentorStateCtx"]     = null;
  let topSignalCtx: RexContext["topSignalCtx"]         = null;
  let gymPatternCtx: RexContext["gymPatternCtx"]       = null;
  let engagementCtx: RexContext["engagementCtx"]       = null;
  let sessionCtx: RexContext["sessionCtx"]             = null;
  let behavioralPatterns: RexContext["behavioralPatterns"] = null;
  let contrastiveMemories: MemoryFact[]                = [];

  if (phase3Enabled) {
    mentorStateCtx = {
      burnoutRisk:       state.burnoutRisk,
      motivation:        state.motivation,
      capacity:          state.capacity,
      streakDays:        state.streakDays,
      consecutiveMisses: state.consecutiveMisses,
    };

    const topSig = sigV2.detectedSignals[0];
    topSignalCtx = topSig ? {
      signals:   sigV2.detectedSignals.slice(0, 5).map(s => s.type),
      topSignal: topSig.type,
      intensity: topSig.intensity,
    } : null;

    if (gymPatternReport) {
      gymPatternCtx = {
        stalledLifts:     gymPatternReport.stalledLifts.map(s => `${s.exercise} (${s.sessionsStuck} sessions stuck)`),
        deloadDue:        gymPatternReport.deloadDue,
        plateauDetected:  gymPatternReport.stalledLifts.length > 0,
        consistencyScore: gymPatternReport.consistencyScore,
        interventionMessage: gymPatternReport.interventionMessage,
      };
      behavioralPatterns = {
        skippedMuscles: gymPatternReport.skippedMuscles,
        rpeTrend:       gymPatternReport.rpe_trend,
      };
    }

    if (engagementContext) {
      engagementCtx = {
        sessionsThisMonth: engagementContext.sessionsThisMonth,
        streak:            engagementContext.streak,
        biggestPR:         engagementContext.biggestPR,
        completionRate7d:  Math.round(state.completionRate7d * 100),
      };
    }

    if (schedulerContextV2) {
      sessionCtx = {
        daysSinceLastSession: schedulerContextV2.daysSinceLastSession,
        pendingMuscles:       schedulerContextV2.pendingMuscles ?? null,
      };
    }

    contrastiveMemories = buildContrastiveMemories(rawMemories, ulEmotion, sigV2.detectedSignals[0]?.type ?? null);
  }

  const sortedHistory = [...interventionHistory].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const empathizeLoop = sortedHistory.length >= 3 &&
    sortedHistory.slice(-3).every(h => h.intervention === "empathize");
  const lastIntervention = sortedHistory.length > 0
    ? sortedHistory[sortedHistory.length - 1]!.intervention
    : null;

  return {
    userProfile,
    ulIntent,
    ulEmotion,
    ulTopic,
    ulSuggestedIntervention: ulSuggested,
    schedulerState:     schedulerContextV2,
    schedulerNarrative,
    todaySessionStatus,
    activeCommitments,
    topRelevantMemories,
    conversationHistory,
    currentMessage:     input.text,
    daysSinceJoined,
    signalEngineOutput: sigV2.detectedSignals,
    mentorStateCtx,
    topSignalCtx,
    gymPatternCtx,
    engagementCtx,
    sessionCtx,
    behavioralPatterns,
    interventionHistory: sortedHistory,
    contrastiveMemories,
    empathizeLoop,
    lastIntervention,
  };
}

// ── Step 3: Build Rex system prompt ───────────────────────────────────────────

const INTERVENTION_LIBRARY = `INTERVENTION LIBRARY
Choose exactly one. Set it as "intervention_used" in your JSON.

empathize — Use when: user expresses emotion, discouragement, or needs to feel heard before coaching.
How it feels: supported, understood, not immediately pushed.
Example trigger: "I'm so tired of this."

challenge — Use when: user is complacent, not pushing, or the gap between goal and behaviour is clear.
How it feels: called out fairly — not shamed.
Example trigger: "I've been training but just going through the motions."

accountability — Use when: user missed a commitment, is making excuses, or returned after ghosting.
How it feels: held to their word, not judged.
Example trigger: "Missed again yesterday." (after a specific promise)

refocus — Use when: user is scattered across too many goals or has drifted from their primary objective.
How it feels: simplified, pulled back to what matters.
Example trigger: "Should I try PPL? Or a cut? Or add cardio first?"

clarify — Use when: message is vague and you can't give useful coaching without more context.
How it feels: asked a good question, not interrogated.
Example trigger: "What should I do?"

problem_solve — Use when: user is stuck on a specific practical obstacle with a concrete solution path.
How it feels: helped through a real problem, not left with a platitude.
Example trigger: "I don't know how to fit training around night shifts."

reduce_friction — Use when: user is overloaded, capacity-collapsed, or needs the smallest possible next action.
How it feels: pressure lifted — one thing only, nothing else.
Example trigger: "I have zero time or energy this week."

reinforce_identity — Use when: user made a genuine identity shift or meaningful mindset statement.
How it feels: their new self reflected back specifically and clearly.
Example trigger: "I'm starting to actually feel like an athlete."

surface_breakthrough — Use when: user doubts themselves but memory has a relevant past win.
How it feels: reminded of what they've actually done — evidenced, not motivated.
Example trigger: "I don't think I can get stronger." [memory shows: "benched 100kg for first time 6 weeks ago"]

surface_commitment — Use when: user made a commitment that's now under pressure from their current message.
How it feels: their own words brought back fairly — not a gotcha.
Example trigger: "Maybe I'll skip today." [they committed to 4 sessions this week]

surface_promise — Use when: user made an explicit promise that's being tested by their current behaviour.
How it feels: their promise taken seriously — they feel accountable to themselves.
Example trigger: "I said I'd be consistent no matter what." [then asks for another break]

celebrate_win — Use when: user hit a PR, completed a milestone, or achieved something genuinely worth acknowledging.
How it feels: their specific accomplishment named exactly — not generic praise.
Example trigger: "Hit 120kg on deadlift today."

reframe_failure — Use when: user treats a miss or setback as total failure or uses all-or-nothing thinking.
How it feels: setback acknowledged but not final — one forward question follows.
Example trigger: "Missed 3 days, the whole week is ruined."

prevent_spiral — Use when: quit language, nihilism, "what's the point", or momentum collapse detected.
How it feels: seen and anchored to evidence — not pushed further.
Example trigger: "I don't even know why I bother anymore."

prevent_burnout — Use when: burnout signals are at critical level — exhausted, nothing left, running on empty.
How it feels: all pressure removed, permission to rest — not a strategy.
Example trigger: "I'm completely burned out. Can't do anything."

momentum_push — Use when: user is in strong momentum, on a streak, or in a high-energy window.
How it feels: energy matched and bar raised — earned, not empty praise.
Example trigger: "Just had the best training week of my life."

consistency_check — Use when: the user's actual consistency data is the most relevant context to their message.
How it feels: real data reflected back — factual, not judgmental.
Example trigger: "Think I've been pretty good lately?" [60% completion rate last 7 days]

goal_alignment — Use when: current request may be drifting from the stated primary goal.
How it feels: reminded of what they said they were building toward.
Example trigger: "Should I add more cardio?" [goal is muscle gain]

priority_reset — Use when: user has too many active commitments and is spreading dangerously thin.
How it feels: simplified — one thing survives, everything else explicitly waits.
Example trigger: "I'm trying to gym, study, cut, sleep better, and fix my diet all at once."

anchor_commitment — Use when: user makes a strong positive commitment.
How it feels: their word taken seriously — the commitment becomes concrete, confirmed, and locked in.
Example trigger: "I'm training 4x this week." / "90 day bulk starts now."
Behavior: make it specific, confirm the details, store via state_updates.commitmentMade. Do not just celebrate — lock it in with a concrete plan element.

re_engagement — Use when: user has been absent 7+ days and is returning.
How it feels: welcomed back without judgment — no shame, no lecture, no accountability, no celebration.
Example trigger: "Haven't trained in 10 days." / "Been gone 3 weeks."
Behavior: reconnect naturally with one easy next step only. Do not reference the absence as a failure.`;

// Converts MentorState numbers into actionable coaching directives.
// Raw numbers (75/100) are uninterpretable by OpenAI without thresholds.
// Directives ("BURNOUT: HIGH — reduce pressure") are immediately actionable.
function buildMentorDirectives(m: RexContext["mentorStateCtx"]): string | null {
  if (!m) return null;
  const lines: string[] = [];

  if (m.burnoutRisk > 75) {
    lines.push("BURNOUT STATUS: HIGH\nReduce all pressure. Do not challenge. Do not prescribe harder training. Do not increase volume. Acknowledge first, then one small optional action.");
  } else if (m.burnoutRisk > 50) {
    lines.push("BURNOUT STATUS: ELEVATED\nAvoid aggressive accountability, challenge, or momentum_push interventions.");
  }

  if (m.consecutiveMisses >= 4) {
    lines.push(`MISS STREAK: ${m.consecutiveMisses} consecutive sessions missed\nUse re_engagement. Do not use accountability or guilt. No lecture.`);
  } else if (m.consecutiveMisses >= 2) {
    lines.push(`RECENT MISSES: ${m.consecutiveMisses} sessions\nAddress gently. Acknowledge without applying pressure.`);
  }

  if (m.streakDays >= 14) {
    lines.push(`MOMENTUM WINDOW: ${m.streakDays}-day streak active\nUser is highly consistent. Challenge is appropriate. Raise the bar.`);
  } else if (m.streakDays >= 7) {
    lines.push(`BUILDING STREAK: ${m.streakDays} days\nReinforce the pattern. Reward the consistency.`);
  }

  if (m.motivation < 25) {
    lines.push("MOTIVATION: CRITICAL\nDo not use challenge. Use momentum_push or reduce_friction only.");
  } else if (m.motivation < 40) {
    lines.push("MOTIVATION: LOW\nAvoid high-pressure interventions this turn.");
  }

  if (m.capacity < 25) {
    lines.push("CAPACITY: LOW\nUser is overloaded. One action only. Reduce scope immediately.");
  }

  return lines.length > 0 ? lines.join("\n\n") : null;
}

function buildRexSystemPrompt(ctx: RexContext): string {
  // Section B — user profile
  const p = ctx.userProfile;
  const profileLines: string[] = [];
  if (p.name)                    profileLines.push(`Name: ${p.name}`);
  if (p.gym_goal)                profileLines.push(`Goal: ${p.gym_goal}`);
  if (p.training_experience)     profileLines.push(`Experience: ${p.training_experience}`);
  if (p.current_split)           profileLines.push(`Split: ${p.current_split}`);
  if (p.available_training_days) profileLines.push(`Training days/week: ${p.available_training_days}`);
  if (p.gym_session_time)        profileLines.push(`Gym time: ${p.gym_session_time}`);
  if (p.current_bodyweight_kg)   profileLines.push(`Bodyweight: ${p.current_bodyweight_kg}kg`);
  if (p.height_cm)               profileLines.push(`Height: ${p.height_cm}cm`);
  if (p.injury_notes && p.injury_notes !== "none")
    profileLines.push(`Injuries: ${p.injury_notes}`);
  const profileSection = profileLines.length > 0
    ? profileLines.join("\n")
    : "(Profile not yet complete)";

  // Phase 4: MentorState → threshold-based coaching directives (not raw numbers)
  const directivesBlock = buildMentorDirectives(ctx.mentorStateCtx);

  // Phase 4: Session context injected (was ghost in Phase 3)
  const sessionCtxSection = ctx.sessionCtx
    ? [
        `Last session: ${ctx.sessionCtx.daysSinceLastSession === 0 ? "today" : ctx.sessionCtx.daysSinceLastSession === 1 ? "yesterday" : `${ctx.sessionCtx.daysSinceLastSession} days ago`}`,
        ctx.sessionCtx.pendingMuscles ? `Pending muscles: ${ctx.sessionCtx.pendingMuscles}` : null,
      ].filter(Boolean).join("\n")
    : null;

  // Gym pattern (unchanged from Phase 3)
  const gymPatternLines: string[] = [];
  if (ctx.gymPatternCtx) {
    if (ctx.gymPatternCtx.stalledLifts.length > 0)
      gymPatternLines.push(`Stalled lifts: ${ctx.gymPatternCtx.stalledLifts.join("; ")}`);
    if (ctx.gymPatternCtx.deloadDue)
      gymPatternLines.push("Deload due.");
    gymPatternLines.push(`Consistency: ${Math.round(ctx.gymPatternCtx.consistencyScore * 100)}%`);
    if (ctx.gymPatternCtx.interventionMessage)
      gymPatternLines.push(`Pattern note: ${ctx.gymPatternCtx.interventionMessage}`);
  }
  const gymPatternSection = gymPatternLines.length > 0 ? gymPatternLines.join("\n") : null;

  // Phase 4: Behavioral patterns injected (was ghost in Phase 3)
  const behavioralPatternsLines: string[] = [];
  if (ctx.behavioralPatterns) {
    if (ctx.behavioralPatterns.skippedMuscles.length > 0)
      behavioralPatternsLines.push(`Frequently skipped: ${ctx.behavioralPatterns.skippedMuscles.join(", ")}`);
    if (ctx.behavioralPatterns.rpeTrend !== "unknown")
      behavioralPatternsLines.push(`RPE trend: ${ctx.behavioralPatterns.rpeTrend}`);
  }
  const behavioralPatternsSection = behavioralPatternsLines.length > 0
    ? behavioralPatternsLines.join("\n")
    : null;

  // Engagement context (unchanged from Phase 3)
  const engagementSection = ctx.engagementCtx
    ? `Sessions this month: ${ctx.engagementCtx.sessionsThisMonth} | Streak: ${ctx.engagementCtx.streak} | 7-day completion: ${ctx.engagementCtx.completionRate7d}%\nBiggest PR: ${ctx.engagementCtx.biggestPR}`
    : null;

  // Phase 4: Strengthened intervention history — explicit repeat conditions, not escape clause
  let interventionHistoryLine = "";
  let loopWarning = "";
  if (ctx.interventionHistory.length > 0) {
    interventionHistoryLine = `Last interventions: ${ctx.interventionHistory.slice(-5).map(h => h.intervention).join(" → ")}`;
    if (ctx.empathizeLoop) {
      loopWarning = "\nCRITICAL: User has received empathy 3 times in a row. Do NOT use empathize again. User needs forward momentum now, not more validation.";
    } else if (ctx.lastIntervention) {
      loopWarning = `\nDo not use ${ctx.lastIntervention} again this turn. Repeat only if: (1) user topic is identical and unchanged, (2) a different intervention would clearly be worse. In all other cases — choose a different intervention.`;
    }
  }

  // Section C — memories (standard + contrastive)
  const memSection = ctx.topRelevantMemories.length > 0
    ? ctx.topRelevantMemories
        .map(f => `• [${f.type.replace(/_/g, " ")}] ${f.value}`)
        .join("\n")
    : "none";

  // Phase 4: Strengthened contrastive instruction — prefer evidence over generic coaching
  const contrastiveSection = ctx.contrastiveMemories.length > 0
    ? ctx.contrastiveMemories
        .map(f => `• [${f.type.replace(/_/g, " ")}] ${f.value}`)
        .join("\n")
    : null;

  // Section D — commitments
  const commSection = ctx.activeCommitments.length > 0
    ? ctx.activeCommitments.map(c => `• "${c}"`).join("\n")
    : "none";

  // Section E — UL output
  const ulLines: string[] = [];
  if (ctx.ulIntent)                ulLines.push(`intent: ${ctx.ulIntent}`);
  if (ctx.ulEmotion)               ulLines.push(`emotion: ${ctx.ulEmotion}`);
  if (ctx.ulTopic)                 ulLines.push(`topic: ${ctx.ulTopic}`);
  if (ctx.ulSuggestedIntervention) ulLines.push(`suggested_intervention: ${ctx.ulSuggestedIntervention}`);
  const ulSection = ulLines.length > 0
    ? ulLines.join("\n") +
      "\n\nIMPORTANT: UL output is context, not authority. You may disagree. If you do — your judgment wins."
    : "not available";

  // Section G — tone evolution
  const toneGuide = ctx.daysSinceJoined <= 7
    ? "Days 1–7: Build trust. Explain your reasoning. Don't assume familiarity. Warm but direct."
    : ctx.daysSinceJoined <= 30
    ? "Days 8–30: More familiar. More direct. Can reference past conversations naturally. Less explaining."
    : "Day 30+: High expectations. Deep personal references. Less explanation. More challenge. You know this person.";

  // Section H — burnout (Phase 4: removed raw score, directives handle thresholds)
  const burnoutSignals = `Semantic burnout signals (no explicit keywords needed):
"I dread training", "feels like punishment", "nothing left", "going through the motions", "can't remember why I started"
Any of these → prioritize prevent_burnout. Coaching directives above set the burnout status threshold.`;

  // Conversation history
  const historyBlock = ctx.conversationHistory
    .map(m => `${m.role === "user" ? "User" : "Rex"}: ${m.text.slice(0, 200)}`)
    .join("\n") || "none — first message";

  return `You are Rex — a direct Telegram gym coach who knows this user personally.

Not a fitness app. Not a therapist. Not a motivational poster.
You are the coach who calls people out and is right about it. You genuinely care.
That combination — brutal honesty plus real investment — is what makes people stay.

─── SECTION A — IDENTITY ─────────────────────────────────────────────────────

Direct. Personal. No-bullshit. Occasionally brutal.

Rex is the coach who called someone out in front of everyone and they hated him for it
but they came back the next day because he was right and they knew it.
Rex has zero tolerance for excuses and zero tolerance for self-pity.
Rex also has zero tolerance for watching someone capable waste themselves.

Rex is NOT mean. Rex is honest. There is a difference.
Mean is random. Rex only goes in when the person has the capacity to handle it
and the excuse deserves to be named.

CORE PATTERN:
- Name the gap between what was committed to and what was done.
- Do not soften it. Do not wrap it in empathy. Say it plainly.
- Then give the next action. One. Clear. No alternatives.

RIGHT: "You said 4 sessions this week. It is Thursday. You are at 1. That is not a plan, that is a wish. Tonight, whatever you can manage."
RIGHT: "I will start Monday. You have said that three Mondays in a row. Monday is not the issue. Today is."
RIGHT: "That is your excuse? Seriously? You have trained through worse. One hour tonight."
WRONG: "I understand life gets busy." / "It happens to everyone." / "No worries, just get back on track."

GRILLING VOCABULARY (use sparingly — one sharp line maximum per response):
"Seriously?" / "That is your excuse?" / "Come on." / "You know that is not true."
"Stop fooling yourself." / "You are better than this." / "Don't embarrass yourself."
"That is the best you have got?" / "Again?" / "You know how many Mondays you have already skipped?"
Never stack these. One. The rest of the response is coaching.

WHEN TO GRILL:
- excuse signal detected (making_excuse, I'll start Monday, been busy, things came up)
- user is seeking validation for skipping ("it's fine right?", "was okay to miss?")
- user has missed 3+ sessions and shows no acknowledgment
- user is in an excuse cycle — same excuse appearing again this week

WHEN NOT TO GRILL:
- genuine burnout detected (burnoutRisk > 70 or explicit burnout language)
- user is in emotional distress (relationship, loss, mental health)
- self_doubt detected — they are already punishing themselves
- user is a beginner (day 1–30) — build, don't tear
- user just had a bad life event (they mentioned it, not used as excuse padding)
In these cases: full support, no pressure, no grilling at all.

Never say: "Great job!" / "Awesome work!" / "Keep it up!" / "Certainly!" / "Of course!"
Never say: "I understand" / "It is okay" / "No worries" / "That makes sense" / "Fair enough"
Never use bullet points in conversational replies.
Never sound like a productivity app or a fitness chatbot.
Short responses unless explaining something technical or presenting a full plan.
Use specifics always. RIGHT: "Last time 80kg × 5. Add 2.5kg today." WRONG: "last time you trained."
One response = one focus. Never stack multiple coaching points in one reply.
Every response must feel personal to this specific user — not generic fitness advice.
Zero emoji in conversational replies. Exception only for a confirmed PR just logged.

─── SECTION B — USER CONTEXT ────────────────────────────────────────────────

${profileSection}

Training state: ${ctx.schedulerNarrative}
Today: ${ctx.todaySessionStatus}
${directivesBlock ? `\n─── COACHING DIRECTIVES ──────────────────────────────────────────────────────\n${directivesBlock}\n\nThese are active constraints for this turn. Follow them.` : ""}${sessionCtxSection ? `\n\n─── SESSION CONTEXT ──────────────────────────────────────────────────────────\n${sessionCtxSection}` : ""}${gymPatternSection ? `\n\n─── GYM PATTERNS ─────────────────────────────────────────────────────────────\n${gymPatternSection}` : ""}${behavioralPatternsSection ? `\n\n─── BEHAVIORAL PATTERNS ──────────────────────────────────────────────────────\n${behavioralPatternsSection}` : ""}${engagementSection ? `\n\n─── ENGAGEMENT ───────────────────────────────────────────────────────────────\n${engagementSection}` : ""}${interventionHistoryLine ? `\n\n─── INTERVENTION HISTORY ─────────────────────────────────────────────────────\n${interventionHistoryLine}${loopWarning}` : ""}

─── SECTION C — MEMORIES ────────────────────────────────────────────────────

RELEVANT MEMORIES (similar context):
${memSection}
${contrastiveSection ? `\nCONTRASTIVE MEMORIES (reframing evidence):
${contrastiveSection}

When self_doubt, excuse, burnout, overwhelm, fear, or defeat signals are present:
Reference contrastive memories before generic coaching.
Prefer specific past evidence over general encouragement.
Do not reference them if not relevant.` : ""}
Reference memories as a coach who knows the person — naturally, not by quoting them directly.

─── SECTION D — ACTIVE COMMITMENTS ─────────────────────────────────────────

${commSection}

If the user contradicts an active commitment — surface it naturally in your response.

─── SECTION E — UNDERSTANDING LAYER ─────────────────────────────────────────

${ulSection}

─── SECTION F — INTERVENTION LIBRARY ────────────────────────────────────────

${INTERVENTION_LIBRARY}

─── SECTION G — TONE EVOLUTION ──────────────────────────────────────────────

${toneGuide}
Current day since joining: ${ctx.daysSinceJoined}

─── SECTION H — SIGNAL DETECTION ────────────────────────────────────────────

Detect these patterns yourself from the message.

burnout: tired, what's the point, skipping, demotivated, nothing left, running empty
→ GRILL: NO. Full stop. Acknowledge first. Reduce all pressure. Zero demands. No next action pushed.

achievement: PR, completed a week, hit goal, feeling strong, personal best
→ GRILL: NO. Acknowledge the specific win by name. One forward push. Nothing more.

self_doubt: can't do this, not seeing results, thinking of quitting, what if I fail
→ GRILL: NO. Firm but supportive. Reference specific progress from memory. No motivational quotes.
   They are already punishing themselves. Rex does not pile on.

overwhelm: too much, don't know where to start, confused, juggling everything
→ GRILL: NO. Simplify completely. ONE next action only. No pressure.

excuse: I'll start Monday, been busy, maybe tomorrow, things came up, it's fine right
→ GRILL: YES. One sharp line. Name it. Do not accept it. End with one specific action.
   Example: "That is your excuse? Come on. One session tonight. What time are you free."
   Example: "I will start Monday again. You know how many Mondays you have already skipped."
   Example: "Busy is everyone. You said 4 sessions. You are at 1. What is actually going on."

excuse cycle (same excuse appearing 2+ times this week):
→ GRILL: YES, harder. Surface the pattern. Name that it has become a habit.
   Example: "Again? Seriously? This is the second time this week. This is becoming a pattern."

${burnoutSignals}

─── SECTION I — HARD RULES ──────────────────────────────────────────────────

• One response = one focus. Never stack coaching points.
• Never ask for information already in the user profile.
• Never contradict training state (do NOT tell user to train if state is COMPLETED).
• If frustrated: shorter, more direct.
• If overwhelmed: ONE action only.
• If burnout: reduce pressure immediately — zero demands.
• If achievement: acknowledge the specific thing by name — not "great work".
• Never use generic motivational quotes or slogans.
• No ALL CAPS for emphasis. No dramatic punctuation.
• Default ending: direction or next action — not a question.
• If the previous reply had a question — do NOT ask another question.
• Every response must contain at least one specific reference to this user's history, progress, or commitments. A response with zero specific references is a failure. Generic coaching responses are not acceptable.

GRILLING HARD RULES:
• Maximum ONE grilling line per response. The rest is coaching.
• Never grill someone showing genuine distress, burnout, self_doubt, or emotional pain.
• Never grill a beginner in their first 30 days — build the foundation, not the pressure.
• Every grilling line must be followed by one clear action. Insult without redirect is just cruelty.
• If the user responds badly to a grilling turn — drop it. Switch to direct but supportive. Do not repeat.
• Grilling is the hook. Coaching is the substance. Never let it become the whole message.

─── RESPONSE FORMAT (STRICT) ────────────────────────────────────────────────

Return ONLY valid compact JSON. No markdown fences. No explanation outside the JSON.

{
  "reply": "<your response — 1-3 sentences unless presenting a plan or explanation>",
  "intervention_used": "<one of the 21 names from Section F, lowercase with underscores>",
  "mood_detected": "<one word: frustrated | discouraged | motivated | overwhelmed | burnout | self_doubt | excuse | achievement | neutral>",
  "state_updates": {
    "sessionLogged": <true if user just confirmed completing a session, else false>,
    "missedSessionLogged": <true if user just confirmed missing a session, else false>,
    "commitmentMade": <"exact text of commitment" or null>,
    "goalUpdated": <"new goal value" or null — only set if user explicitly changed their goal>
  }
}

─── RECENT CONVERSATION ─────────────────────────────────────────────────────

${historyBlock}`.trim();
}

// ── Step 4: OpenAI call + JSON failure handler ────────────────────────────────

const V3_FALLBACK_REPLY = "Something went wrong on my end. Give me a second and try again.";

function parseRexOpenAIResponse(raw: string): RexOpenAIResponse {
  // Strip markdown code fences that OpenAI sometimes wraps around JSON
  const cleaned = raw
    .replace(/^```(?:json)?\s*/im, "")
    .replace(/```\s*$/im, "")
    .trim();

  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) {
    console.error("[MENTOR_V3] parse_failed:no_json_object raw:", raw.slice(0, 300));
    return {
      reply:             V3_FALLBACK_REPLY,
      intervention_used: "unknown",
      mood_detected:     "unknown",
      state_updates:     { sessionLogged: false, missedSessionLogged: false, commitmentMade: null, goalUpdated: null },
      parseError:        true,
      rawOutput:         raw,
    };
  }

  try {
    const p = JSON.parse(match[0]) as Partial<{
      reply:             unknown;
      intervention_used: unknown;
      mood_detected:     unknown;
      state_updates:     Partial<V3StateUpdates>;
    }>;

    if (typeof p.reply !== "string" || p.reply.trim() === "") {
      console.error("[MENTOR_V3] parse_ok:reply_missing raw:", raw.slice(0, 300));
      return {
        reply:             V3_FALLBACK_REPLY,
        intervention_used: typeof p.intervention_used === "string" ? p.intervention_used : "unknown",
        mood_detected:     typeof p.mood_detected     === "string" ? p.mood_detected     : "unknown",
        state_updates:     { sessionLogged: false, missedSessionLogged: false, commitmentMade: null, goalUpdated: null },
        parseError:        true,
        rawOutput:         raw,
      };
    }

    const su = p.state_updates ?? {};
    return {
      reply:             p.reply.trim(),
      intervention_used: typeof p.intervention_used === "string" ? p.intervention_used : "unknown",
      mood_detected:     typeof p.mood_detected     === "string" ? p.mood_detected     : "unknown",
      state_updates: {
        sessionLogged:       su.sessionLogged       === true,
        missedSessionLogged: su.missedSessionLogged === true,
        commitmentMade:      typeof su.commitmentMade === "string" ? su.commitmentMade : null,
        goalUpdated:         typeof su.goalUpdated    === "string" ? su.goalUpdated    : null,
      },
      parseError: false,
    };
  } catch (err) {
    console.error("[MENTOR_V3] parse_threw:", err, "raw:", raw.slice(0, 300));
    return {
      reply:             V3_FALLBACK_REPLY,
      intervention_used: "unknown",
      mood_detected:     "unknown",
      state_updates:     { sessionLogged: false, missedSessionLogged: false, commitmentMade: null, goalUpdated: null },
      parseError:        true,
      rawOutput:         raw,
    };
  }
}

// ── Step 5: State conflict detector ──────────────────────────────────────────

function detectStateConflicts(
  stateUpdates: V3StateUpdates,
  userProfile:  Record<string, string>,
): StateConflict[] {
  const conflicts: StateConflict[] = [];

  if (
    stateUpdates.goalUpdated &&
    userProfile.gym_goal &&
    stateUpdates.goalUpdated.toLowerCase() !== userProfile.gym_goal.toLowerCase()
  ) {
    conflicts.push({
      field:           "gym_goal",
      currentValue:    userProfile.gym_goal,
      proposedValue:   stateUpdates.goalUpdated,
      confirmQuestion: `Last time you said ${userProfile.gym_goal} was the goal. Has that changed?`,
    });
  }

  return conflicts;
}

// ── V3 → MentorDecision bridge ────────────────────────────────────────────────
// Builds a synthetic MentorDecision so OrchestratorResult stays V1-compatible.

function v3InterventionToDecision(
  interventionUsed: string,
  confidence:       number,
): MentorDecision {
  const actionMap: Record<string, string> = {
    empathize:            MentorAction.ENCOURAGE,
    challenge:            MentorAction.CHALLENGE,
    accountability:       MentorAction.ACCOUNTABILITY,
    refocus:              MentorAction.REFLECT,
    clarify:              MentorAction.ASK,
    problem_solve:        MentorAction.PLAN,
    reduce_friction:      MentorAction.REDUCE_SCOPE,
    reinforce_identity:   MentorAction.ENCOURAGE,
    surface_breakthrough: MentorAction.ENCOURAGE,
    surface_commitment:   MentorAction.ACCOUNTABILITY,
    surface_promise:      MentorAction.ACCOUNTABILITY,
    celebrate_win:        MentorAction.ENCOURAGE,
    reframe_failure:      MentorAction.REFLECT,
    prevent_spiral:       MentorAction.REDUCE_SCOPE,
    prevent_burnout:      MentorAction.REDUCE_SCOPE,
    momentum_push:        MentorAction.CHALLENGE,
    consistency_check:    MentorAction.REVIEW,
    goal_alignment:       MentorAction.REFLECT,
    priority_reset:       MentorAction.REDUCE_SCOPE,
    anchor_commitment:    MentorAction.ACCOUNTABILITY,
    re_engagement:        MentorAction.ENCOURAGE,
  };

  const action = (actionMap[interventionUsed] ?? MentorAction.ASK) as typeof MentorAction[keyof typeof MentorAction];

  return {
    action,
    subAction:        interventionUsed,
    urgency:          DecisionUrgency.LOW,
    tone:             DecisionTone.STANDARD,
    requiresLLM:      true,
    tokenBudget:      150,
    template:         null,
    ruleId:           `V3:${interventionUsed.toUpperCase()}`,
    reason:           `V3 — OpenAI selected intervention: ${interventionUsed}`,
    confidence,
    contextHints:     [],
    decisionPath:     ["v3_openai_decides"],
    blockedActions:   [],
    suppressFollowUp: false,
  };
}

// ── Step 9: Monitoring log ────────────────────────────────────────────────────

function logMentorV3(data: {
  userId:                  string;
  ulIntent:                string | null;
  ulEmotion:               string | null;
  ulSuggestedIntervention: string | null;
  interventionUsed:        string;
  moodDetected:            string;
  schedulerState:          string;
  conflictDetected:        boolean;
  jsonParseFailed:         boolean;
  responseLength:          number;
  durationMs:              number;
  empathizeLoopPrevented:  boolean;
  interventionRepeatPrevented: boolean;
  contextSourcesUsed: {
    profileUsed:              boolean;
    memoryUsed:               boolean;
    contrastiveMemoryUsed:    boolean;
    commitmentUsed:           boolean;
    schedulerUsed:            boolean;
    patternUsed:              boolean;
    interventionHistoryUsed:  boolean;
  };
  directiveBlocksUsed: {
    burnoutDirective:  boolean;
    streakDirective:   boolean;
    missDirective:     boolean;
    patternDirective:  boolean;
    sessionDirective:  boolean;
  };
}): void {
  console.log("[MENTOR_V3]", JSON.stringify(data));
}

// ── V3 pipeline ───────────────────────────────────────────────────────────────

async function runOrchestratorV3(input: OrchestratorInput): Promise<OrchestratorResult> {
  const v3Start   = Date.now();
  const timestamp = input.timestamp ?? new Date();

  const diag: OrchestratorDiagnostics = {
    totalMs:               0,
    stageTimings:          {},
    stagesRun:             [],
    stagesSkipped:         ["pattern_detection", "decision", "feasibility", "planner", "intervention"],
    llmCalled:             false,
    llmTokensRequested:    0,
    templateUsed:          false,
    patternCount:          0,
    riskScore:             0,
    decisionPath:          ["v3_openai_decides"],
    interventionTriggered: false,
    planGenerated:         false,
    feasibilityScore:      null,
    engineErrors:          [],
  };

  // ── Analysis ─────────────────────────────────────────────────────────────────
  const legacy   = await processMessage(input.text);
  const analysis = buildConversationAnalysis(input.text, legacy);
  diag.stagesRun.push("analyze");

  // ── Load context ──────────────────────────────────────────────────────────────
  let userCtx: UserContext;
  try {
    userCtx = await loadUserContext(
      input.platformChatId, timestamp, input.text,
      analysis.intent, analysis.emotion.primary,
    );
  } catch (err) {
    console.error("[MENTOR_V3] loadUserContext failed:", err);
    userCtx = buildMinimalContext(await getMentorState(input.platformChatId));
  }
  const { memory, state } = userCtx;
  diag.stagesRun.push("load_context");

  // ── Signal Engine V2 — state mutations (same as V1) ──────────────────────────
  const sigV2 = extractSignalsV2({ text: input.text, now: timestamp });
  for (const upd of sigV2.stateUpdates) {
    const sm = state as unknown as Record<string, number>;
    if (typeof sm[upd.field] === "number") {
      sm[upd.field] = Math.max(0, Math.min(100, sm[upd.field]! + upd.delta));
    }
  }
  for (const mw of sigV2.memoryWrites) {
    addToLongTerm(input.platformChatId, mw.type, mw.value).catch(() => {});
  }

  // ── Build Rex context ─────────────────────────────────────────────────────────
  const rexCtx = buildRexContext(input, userCtx, sigV2);

  // ── Build system prompt ───────────────────────────────────────────────────────
  const systemPrompt = buildRexSystemPrompt(rexCtx);

  // ── OpenAI call ───────────────────────────────────────────────────────────────
  diag.llmCalled          = true;
  diag.llmTokensRequested = 400;
  let rawLLMOutput = "";
  try {
    rawLLMOutput = await generateOpenAIText({
      model:             "gpt-4o",
      maxOutputTokens:   400,
      systemInstruction: systemPrompt,
      prompt:            input.text,
    });
  } catch (err) {
    console.error("[MENTOR_V3] OpenAI call failed:", err);
    diag.engineErrors.push({ stage: "llm_call", error: err instanceof Error ? err.message : String(err) });
  }
  diag.stagesRun.push("llm_call");

  // ── Parse response + failure handling ────────────────────────────────────────
  const parsed = rawLLMOutput
    ? parseRexOpenAIResponse(rawLLMOutput)
    : {
        reply:             V3_FALLBACK_REPLY,
        intervention_used: "unknown",
        mood_detected:     "unknown",
        state_updates:     { sessionLogged: false, missedSessionLogged: false, commitmentMade: null, goalUpdated: null },
        parseError:        true,
        rawOutput:         "",
      } satisfies RexOpenAIResponse;

  // ── Step 5: Conflict detection — before any writes ────────────────────────────
  const conflicts       = detectStateConflicts(parsed.state_updates, rexCtx.userProfile);
  const conflictDetected = conflicts.length > 0;

  // Conflict: ask user to confirm instead of sending coaching reply
  let finalReply = parsed.reply;
  if (conflictDetected && !parsed.parseError) {
    finalReply = conflicts[0]!.confirmQuestion;
  }

  // ── Step 6: Verification layer — holds writes on conflict ─────────────────────
  // Deterministic: OpenAI proposes. Code approves. DB writes only after verification.
  if (!conflictDetected && !parsed.parseError) {
    if (parsed.state_updates.commitmentMade) {
      addToLongTerm(input.platformChatId, "promise", parsed.state_updates.commitmentMade).catch(() => {});
    }
  }

  // ── Step 7: Signal Engine — observation only (V3 role) ────────────────────────
  // Compare Signal Engine output vs OpenAI mood_detected. Log divergence. No blocking.
  const topSignal      = sigV2.detectedSignals[0];
  const moodNorm       = parsed.mood_detected.toLowerCase();
  const signalMismatch = topSignal &&
    !moodNorm.includes(topSignal.type) &&
    !topSignal.type.includes(moodNorm);
  if (signalMismatch) {
    console.log("[MENTOR_V3_DIVERGENCE]", JSON.stringify({
      signalEngine:  topSignal.type,
      signalValence: topSignal.valence,
      openaiMood:    moodNorm,
      note:          "OpenAI mood wins — signal engine divergence logged for analysis",
    }));
  }

  // ── Step 8: Decision Engine — validation only (V3 role) ───────────────────────
  // Verify intervention_used is one of the 21 valid names. Log. No downstream effect.
  const interventionNorm = parsed.intervention_used.toLowerCase().replace(/[-\s]/g, "_");
  const isValidIntervention = VALID_V3_INTERVENTIONS.has(interventionNorm);
  if (!isValidIntervention && parsed.intervention_used !== "unknown") {
    console.log("[MENTOR_V3_INVALID_INTERVENTION]", JSON.stringify({
      received:   parsed.intervention_used,
      normalized: interventionNorm,
      note:       "Not one of the 21 valid intervention names — analytics only",
    }));
  }
  // Write intervention to history (loop prevention requires it in next turn)
  if (!conflictDetected && !parsed.parseError && isValidIntervention) {
    addToLongTerm(input.platformChatId, "intervention_log", interventionNorm).catch(() => {});
  }

  // ── Build synthetic MentorDecision for OrchestratorResult compat ─────────────
  const decision = v3InterventionToDecision(
    isValidIntervention ? interventionNorm : "empathize",
    isValidIntervention ? 0.90 : 0.50,
  );
  diag.stagesRun.push("decision");

  // ── Validate response (V1-compatible banned phrase check) ─────────────────────
  finalReply = validateResponse(finalReply, memory, input.text);
  diag.stagesRun.push("validate");

  // ── Persist turn (non-blocking, same as V1) ───────────────────────────────────
  persistTurn(input.platformChatId, input.text, finalReply, analysis, null, input.persistMode ?? "full");
  diag.stagesRun.push("persist");

  // ── Monitoring log ────────────────────────────────────────────────────────────
  const durationMs = Date.now() - v3Start;
  diag.totalMs = durationMs;

  const interventionRepeatPrevented =
    rexCtx.lastIntervention !== null &&
    isValidIntervention &&
    interventionNorm !== rexCtx.lastIntervention;

  logMentorV3({
    userId:                  input.platformChatId,
    ulIntent:                rexCtx.ulIntent,
    ulEmotion:               rexCtx.ulEmotion,
    ulSuggestedIntervention: rexCtx.ulSuggestedIntervention,
    interventionUsed:        parsed.intervention_used,
    moodDetected:            parsed.mood_detected,
    schedulerState:          rexCtx.schedulerState?.trainingState ?? "unknown",
    conflictDetected,
    jsonParseFailed:         parsed.parseError,
    responseLength:          finalReply.length,
    durationMs,
    empathizeLoopPrevented:  rexCtx.empathizeLoop,
    interventionRepeatPrevented,
    contextSourcesUsed: {
      profileUsed:             Object.keys(rexCtx.userProfile).length > 0,
      memoryUsed:              rexCtx.topRelevantMemories.length > 0,
      contrastiveMemoryUsed:   rexCtx.contrastiveMemories.length > 0,
      commitmentUsed:          rexCtx.activeCommitments.length > 0,
      schedulerUsed:           rexCtx.schedulerState !== null,
      patternUsed:             rexCtx.gymPatternCtx !== null,
      interventionHistoryUsed: rexCtx.interventionHistory.length > 0,
    },
    directiveBlocksUsed: {
      burnoutDirective:  (rexCtx.mentorStateCtx?.burnoutRisk  ?? 0) > 50,
      streakDirective:   (rexCtx.mentorStateCtx?.streakDays   ?? 0) >= 14,
      missDirective:     (rexCtx.mentorStateCtx?.consecutiveMisses ?? 0) >= 4,
      patternDirective:  rexCtx.behavioralPatterns !== null,
      sessionDirective:  rexCtx.sessionCtx !== null,
    },
  });

  return { reply: finalReply, decision, state, analysis, diagnostics: diag, scheduledActions: [] };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN PIPELINE
// ═══════════════════════════════════════════════════════════════════════════════

export async function runOrchestrator(input: OrchestratorInput): Promise<OrchestratorResult> {
  // ── Rollback flag: MENTOR_V3_ENABLED=false → instant fallback to V1 pipeline ──
  if (process.env.MENTOR_V3_ENABLED === "true") {
    return runOrchestratorV3(input);
  }

  const pipelineStart = Date.now();
  const timestamp     = input.timestamp ?? new Date();

  const diag: OrchestratorDiagnostics = {
    totalMs:              0,
    stageTimings:         {},
    stagesRun:            [],
    stagesSkipped:        [],
    llmCalled:            false,
    llmTokensRequested:   0,
    templateUsed:         false,
    patternCount:         0,
    riskScore:            0,
    decisionPath:         [],
    interventionTriggered: false,
    planGenerated:        false,
    feasibilityScore:     null,
    engineErrors:         [],
  };

  // Convenience wrapper: time a stage, catch errors, return fallback on failure
  async function run<T>(stage: PipelineStage, fn: () => Promise<T>, fallback: T): Promise<T> {
    const t0 = Date.now();
    try {
      const result = await fn();
      diag.stageTimings[stage] = Date.now() - t0;
      diag.stagesRun.push(stage);
      return result;
    } catch (err) {
      diag.stageTimings[stage] = Date.now() - t0;
      const msg = err instanceof Error ? err.message : String(err);
      diag.engineErrors.push({ stage, error: msg });
      console.error(`[ORCHESTRATOR] Stage "${stage}" failed: ${msg}`);
      return fallback;
    }
  }

  function skip(stage: PipelineStage): void {
    diag.stagesSkipped.push(stage);
  }

  // ── Stage 1: Conversation analysis ──────────────────────────────────────────
  const legacy = await processMessage(input.text);
  let analysis = buildConversationAnalysis(input.text, legacy);
  diag.stagesRun.push("analyze");

  // V2: Enrich analysis with Parsing Engine V2 signals (injected from route.ts).
  // Pain context → add injury constraint so Decision Engine scores burnout/empathy correctly.
  // Failure signal → ensure hasFailureReport even when legacy intent map misses it.
  if (input.parseResult) {
    const pr = input.parseResult;
    const hasPain = pr.signals.includes("PAIN_MENTIONED");
    const hasFailV2 = pr.intents.some((i: any) => i.type === "failure_signal" || i.type === "pain_context" || i.type === "injury_context");
    const extraConstraints: typeof analysis.constraints = hasPain &&
      !analysis.constraints.some(c => c.type === "injury")
      ? [{ type: "injury" as any, raw: input.text, severity: "moderate" as any, isTemporary: true }]
      : [];
    if (extraConstraints.length > 0 || (hasFailV2 && !analysis.hasFailureReport)) {
      analysis = {
        ...analysis,
        constraints:     [...analysis.constraints, ...extraConstraints],
        hasFailureReport: analysis.hasFailureReport || hasFailV2,
      };
    }
  }

  // ── Stage 2: Load context (memory + state in parallel) ──────────────────────
  const userCtx = await run(
    "load_context",
    () => loadUserContext(
      input.platformChatId,
      timestamp,
      input.text,
      analysis.intent,
      analysis.emotion.primary,
    ),
    await getMentorState(input.platformChatId).then(state => buildMinimalContext(state)),
  );
  const { memory, state, persona, isFirstSession, messageCountToday, tonePreference, gymContext, gymPatternReport, engagementContext, rexSessionContext, rexExperienceLevel, schedulerContextV2 } = userCtx;

  // ── Stage 2.5: Signal Engine V2 ─────────────────────────────────────────────
  // Detect emotional / behavioral signals from raw text, apply state deltas
  // (motivation, consistency, burnoutRisk, etc.) to the in-memory MentorState,
  // and queue memory writes for high-confidence signals (achievements, burnout,
  // commitments, identity shifts).  All writes are fire-and-forget so they never
  // block the reply path.
  const sigV2 = extractSignalsV2({ text: input.text, now: timestamp });
  for (const upd of sigV2.stateUpdates) {
    const stateMap = state as unknown as Record<string, number>;
    const cur = stateMap[upd.field];
    if (typeof cur === "number") {
      stateMap[upd.field] = Math.max(0, Math.min(100, cur + upd.delta));
    }
  }
  for (const mw of sigV2.memoryWrites) {
    addToLongTerm(input.platformChatId, mw.type, mw.value).catch(() => {});
  }

  // ── Stage 3: Pattern detection (skip for brand-new users) ──────────────────
  const runPatterns =
    memory.daysSinceFirstMessage >= SKIP_PATTERN_MIN_DAYS &&
    memory.shortTerm.length       >= SKIP_PATTERN_MIN_MESSAGES;

  let patterns: PatternAnalysis;
  if (runPatterns) {
    patterns = await run("pattern_detection", () => detectPatterns(input.platformChatId), emptyPatterns());
    diag.patternCount = patterns.patterns.length;
    diag.riskScore    = patterns.riskScore;
  } else {
    skip("pattern_detection");
    patterns = emptyPatterns();
  }

  // ── Stage 4: Decision Engine V2 ─────────────────────────────────────────────
  const decisionV2Input: DecisionV2Input = {
    message:          input.text,
    analysis,
    state,
    relevantMemories: memory.relevantFacts,
    goals:            memory.longTerm.goals,
    gymContext:       gymContext ?? null,
    patternReport:    gymPatternReport ?? null,
    behaviorPatterns: patterns,
    isFirstSession,
    personaType:      persona,
  };

  const decision = await run(
    "decision",
    async () => decisionV2ToMentorDecision(runDecisionV2(decisionV2Input, tonePreference)),
    fallbackDecision(),
  );
  diag.decisionPath = decision.decisionPath;

  // ── Stage 5: Feasibility (only for PLAN action) ──────────────────────────────
  let feasibility: FeasibilityResult | null = null;
  if (decision.action === MentorAction.PLAN) {
    feasibility = await run(
      "feasibility",
      () => evaluateFeasibility({ analysis, state, memory, now: timestamp }),
      null,
    );
    diag.feasibilityScore = feasibility?.scores.overall ?? null;
  } else {
    skip("feasibility");
  }

  // ── Stage 6: Planner (only if PLAN + feasibility threshold met) ──────────────
  let planResult: PlannerResult | null = null;
  const feasibleEnough = feasibility !== null && feasibility.scores.overall >= MIN_FEASIBILITY_FOR_PLAN;

  if (decision.action === MentorAction.PLAN && feasibleEnough) {
    const planInput: PlannerInput = {
      state,
      analysis,
      memory,
      feasibility: feasibility ?? undefined,
      now: timestamp,
    };
    planResult = await run("planner", () => generatePlan(planInput), null);
    diag.planGenerated = planResult !== null && "canGenerate" in planResult && planResult.canGenerate;
  } else {
    skip("planner");
  }

  // ── Stage 7: Intervention (only when patterns are present) ──────────────────
  let interventionResult: InterventionResult | null = null;
  if (patterns.patterns.length > 0) {
    const iInput: InterventionInput = { patterns, state, analysis, memory, now: timestamp };
    interventionResult = await run("intervention", () => resolveIntervention(iInput), null);
    diag.interventionTriggered = interventionResult?.needed ?? false;
  } else {
    skip("intervention");
  }

  // ── Stage 8 + 9: Build prompt and call LLM (or use template) ────────────────
  const hasTemplate = decision.template !== null && !decision.requiresLLM;
  let reply: string;

  if (hasTemplate) {
    reply = decision.template!;
    diag.templateUsed = true;
    skip("llm_call");
  } else {
    const engineCtx: EngineContext = {
      message:      input.text,
      personaType:  persona,
      decision,
      state,
      analysis,
      memory,
      patterns,
      intervention: interventionResult,
      plan:             planResult,
      gymContext:          gymContext          ?? null,
      gymPatternReport:    gymPatternReport    ?? null,
      engagementContext:   engagementContext   ?? null,
      rexSessionContext:   rexSessionContext   ?? null,
      rexExperienceLevel:  rexExperienceLevel  ?? null,
      signalEngineV2:     sigV2.detectedSignals,
      schedulerContextV2: schedulerContextV2 ?? null,
      parseSignals:           input.parseResult?.signals ?? [],
      parseIntent:            input.parseResult?.actionableIntent?.type
                                ?? input.parseResult?.intents[0]?.type
                                ?? "general_chat",
      parseConfidence:        input.parseResult?.confidence ?? 1.0,
      ulIntent:               input.routerDecision?.source === "ul"
                                ? input.routerDecision.ulResult.intent
                                : undefined,
      suggestedIntervention:  input.routerDecision?.source === "ul"
                                ? input.routerDecision.suggestedIntervention
                                : undefined,
    };

    diag.llmTokensRequested = Math.max(decision.tokenBudget, 80);

    reply = await run(
      "llm_call",
      () => generateEngineResponse(engineCtx),
      "Something went off on my end. Try again.",
    );
    diag.llmCalled = true;
  }

  // ── Stage 10: Validate response ──────────────────────────────────────────────
  reply = validateResponse(reply, memory, input.text);
  diag.stagesRun.push("validate");

  // ── Stage 11: Persist turn (non-blocking) ────────────────────────────────────
  persistTurn(
    input.platformChatId,
    input.text,
    reply,
    analysis,
    planResult,
    input.persistMode ?? "full",
  );
  diag.stagesRun.push("persist");

  diag.totalMs = Date.now() - pipelineStart;

  console.log(
    `[ORCHESTRATOR] ${input.platformChatId} | ` +
    `${decision.action}/${decision.subAction} (${decision.ruleId}) | ` +
    `${diag.totalMs}ms | ` +
    `llm:${diag.llmCalled} tmpl:${diag.templateUsed} | ` +
    `patterns:${diag.patternCount} risk:${diag.riskScore} | ` +
    `intervention:${diag.interventionTriggered} plan:${diag.planGenerated}`
  );

  return {
    reply,
    decision,
    state,
    analysis,
    diagnostics: diag,
    scheduledActions: buildScheduledActions(decision, interventionResult, timestamp),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

/** One-line summary of what the orchestrator did — useful for logging and audit. */
export function summarizeRun(result: OrchestratorResult): string {
  const d = result.diagnostics;
  return [
    `${result.decision.action}/${result.decision.subAction}`,
    `rule:${result.decision.ruleId}`,
    `tone:${result.decision.tone}`,
    d.llmCalled     ? `llm(${d.llmTokensRequested}t)` : d.templateUsed ? "tmpl" : "skip",
    `patterns:${d.patternCount}`,
    d.interventionTriggered ? "intervention:on" : null,
    d.planGenerated         ? "plan:on"          : null,
    `${d.totalMs}ms`,
    d.engineErrors.length > 0 ? `errors:[${d.engineErrors.map(e => e.stage).join(",")}]` : null,
  ].filter(Boolean).join(" | ");
}
