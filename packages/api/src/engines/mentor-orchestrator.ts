import { prisma } from "@repo/db/client";
import { processMessage } from "../processor/messageProcessor";
import { addToShortTerm } from "../services/memory.service";
import { savePlan } from "../services/planner.service";
import { generateEngineResponse } from "../services/llm";
import type { EngineContext } from "../services/llm";
import { computeGymTimeContextFromData } from "../services/gymTimeContext.service";
import type { GymTimeContext } from "../services/gymTimeContext.service";
import { computePatternReport } from "../services/gymPatternDetector.service";
import type { PatternReport } from "../services/gymPatternDetector.service";
import { buildEngagementContext } from "../services/engagement.service";
import type { EngagementContext } from "../services/engagement.service";
import {
  getMentorState,
  updateMentorState,
} from "./user-state-engine";
import type { MentorState } from "./user-state-engine";
import { detectPatterns } from "./pattern-detector";
import {
  makeMentorDecision,
  MentorAction,
  DecisionUrgency,
  DecisionTone,
} from "./mentor-decision-engine";
import type { DecisionInput, MentorDecision } from "./mentor-decision-engine";
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
  legacy: ReturnType<typeof processMessage>,
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
  memory:            MemoryContext;
  state:             MentorState;
  persona:           PersonaType;
  isFirstSession:    boolean;
  messageCountToday: number;
  tonePreference:    "hard" | "soft" | "dynamic";
  gymContext:        GymTimeContext | null;
  gymPatternReport:  PatternReport | null;
  engagementContext: EngagementContext | null;
}

async function loadUserContext(platformChatId: string, now: Date): Promise<UserContext> {
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

  const relevantFacts: MemoryFact[] = memories
    .filter(m => !["goal", "detected_pattern"].includes(m.type))
    .slice(0, 10)
    .map(m => ({
      id:              m.id,
      type:            m.type,
      key:             m.key,
      value:           m.value,
      confidence:      m.confidence,
      ageHours:        Math.floor((now.getTime() - new Date(m.createdAt).getTime()) / 3_600_000),
      sourceMessageId: null,
      createdAt:       new Date(m.createdAt),
      updatedAt:       new Date(m.updatedAt),
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

  const gymContext = computeGymTimeContextFromData(
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
  if (persona === "rex") {
    [gymPatternReport, engagementContext] = await Promise.all([
      userRow.intakeAnswers
        ? computePatternReport(userRow.id, now).catch((err) => { console.error("[ORCHESTRATOR] gymPatternReport:", err); return null; })
        : Promise.resolve(null),
      buildEngagementContext(userRow.id, now).catch((err) => { console.error("[ORCHESTRATOR] engagementContext:", err); return null; }),
    ]);
  }

  return { memory, state, persona, isFirstSession, messageCountToday, tonePreference, gymContext, gymPatternReport, engagementContext };
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
  return { memory, state, persona: FALLBACK_PERSONA, isFirstSession: true, messageCountToday: 0, tonePreference: DEFAULT_TONE, gymContext: null, gymPatternReport: null, engagementContext: null };
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
// MAIN PIPELINE
// ═══════════════════════════════════════════════════════════════════════════════

export async function runOrchestrator(input: OrchestratorInput): Promise<OrchestratorResult> {
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
  const legacy   = processMessage(input.text);
  const analysis = buildConversationAnalysis(input.text, legacy);
  diag.stagesRun.push("analyze");

  // ── Stage 2: Load context (memory + state in parallel) ──────────────────────
  const userCtx = await run(
    "load_context",
    () => loadUserContext(input.platformChatId, timestamp),
    await getMentorState(input.platformChatId).then(state => buildMinimalContext(state)),
  );
  const { memory, state, persona, isFirstSession, messageCountToday, tonePreference, gymContext, gymPatternReport, engagementContext } = userCtx;

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

  // ── Stage 4: Mentor decision ─────────────────────────────────────────────────
  const decisionInput: DecisionInput = {
    analysis,
    state,
    patterns,
    memory,
    persona,
    tonePreference,
    isFirstSession,
    messageCountToday,
  };

  const decision = await run("decision", async () => makeMentorDecision(decisionInput), fallbackDecision());
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
      gymContext:        gymContext ?? null,
      gymPatternReport:  gymPatternReport ?? null,
      engagementContext: engagementContext ?? null,
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
