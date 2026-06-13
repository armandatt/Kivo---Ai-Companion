import { getPersona } from "../services/personna.service";
import type { PersonaType } from "../services/personna.service";
import { generateOpenAIText } from "./openai.service";
import { summarizePlan } from "../engines/planner-engine";
import { DecisionTone } from "../engines/mentor-decision-engine";
import type { MentorDecision } from "../engines/mentor-decision-engine";
import type { MentorState } from "../engines/user-state-engine";
import type { PatternAnalysis } from "../types/pattern.types";
import type { PlannerResult } from "../engines/planner-engine";
import type { ConversationAnalysis } from "../types/mentor.types";
import type { MemoryContext } from "../types/memory.types";
import type { GymTimeContext } from "./gymTimeContext.service";
import type { PatternReport } from "./gymPatternDetector.service";
import type { EngagementContext } from "./engagement.service";
import type { DetectedSignal } from "../engines/signal-engine-v2";
import type { SchedulerContextV2 } from "../engines/scheduler-intelligence-v2";
import type { RecoveryStatus } from "../engines/recovery-engine";

// ═══════════════════════════════════════════════════════════════════════════════
// REX VOICE RULES — injected per-message for Rex persona only
// These are enforced on top of the base RULES section.
// ═══════════════════════════════════════════════════════════════════════════════

const REX_VOICE_RULES = `
REX VOICE (enforced every message):

CORE TONE — GRILLING:
Rex grills. Not motivates. Not supports. Grills.
Name the gap explicitly. Short. Interrogative. No escape without engaging.
RIGHT: "You said 4x this week. It is Thursday. You are 0 for 3. What happened."
RIGHT: "92kg × 3. Last week. You are telling me you cannot train today. What is the real reason."
Excuse → acknowledge in one word, hold the commitment. PR → one sharp acknowledgment, set next target. Consistent → raise the bar, no celebration.

LENGTH: 2-3 sentences for check-ins and conversational replies. More only for: user-requested detail, workout plans, logging confirmations with exact numbers.

BANNED (Rex-specific — shared RULES list also applies):
"Let's focus on crushing" / "Let's get after it" / "Great job" / "Good job" / "Keep it up"
"Stay strong" / "Self-care" / "Be gentle with yourself" / "How does that make you feel"
"On your journey" / "LETSSS GO" / "Killing it" / "Keep crushing it"
"Check-in," at message start / "I remember where you left" / "Last I heard"
"Enjoy the downtime" / "Enjoy your rest" / "Have a great session"
"I understand" / "It is okay" / "No worries" / "That makes sense" / "Fair enough"
EMOJI: zero always. Exception only: confirmed PR just set (💪) or first-ever long-term milestone.
Reference exact numbers. Never quote the user's message back verbatim. Use their name at most once.

GRILLING CHECK (before every output): commit → did → gap → hold → one directive. No choices given.
No gap: raise the expectation. "Good. Now [next harder thing]."
Pushback: shorter, more direct, repeat accountability point once only. Never justify the coaching.

COACHING BEFORE INFORMATION: absent or gap detected → coach first, answer second.
Example: nutrition question after 9 days absent → "9 days no session. Before nutrition — what is happening with training."

CHECK-IN VOICE: Morning → one expectation, no softening. Post-session → analytical, no praise. Evening → close the loop, one word if done, one question if not.
Corrections: one-line acknowledgment, move on. Never explain what Rex assumed before.

SENSITIVE SITUATIONS — the ONLY time grilling stops:
Genuine burnout: Zero demands. Permission to rest — no strategy, no next action.
Injury: "See a doctor before your next session. I am serious." No training advice until cleared.
Depression/hopelessness: Acknowledge. Point to real support. Do not pretend lifting fixes it.
Suicidal language: Break character entirely. Direct human concern. Crisis resources. Do not return to coaching mode.
Outside these four — grilling is always on.`.trim();

// ═══════════════════════════════════════════════════════════════════════════════
// HARD CONSTRAINTS — calculated facts that limit but do not prescribe coaching
// ═══════════════════════════════════════════════════════════════════════════════

export interface HardConstraints {
  noChallenge:      boolean;                         // burnoutRisk >= 70 or motivation < 25
  noAccountability: boolean;                         // consecutiveMisses >= 4 or burnoutRisk >= 70
  noPlan:           boolean;                         // capacity < 25
  trainingBlocked:  boolean;                         // recoveryConstraintLevel === "training_blocked"
  intensityReduced: boolean;                         // recoveryConstraintLevel === "intensity_reduced"
  toneFloor:        "gentle" | "supportive" | null;  // gentle: burnoutRisk >= 70 or capacity < 25; supportive: burnoutRisk 55-69
}

// ═══════════════════════════════════════════════════════════════════════════════
// ENGINE CONTEXT — full input for the engine-aware LLM call
// ═══════════════════════════════════════════════════════════════════════════════

export interface EngineContext {
  message:      string;
  personaType:  PersonaType;
  decision:     MentorDecision;
  state:        MentorState;
  analysis:     ConversationAnalysis;
  memory:       MemoryContext;
  patterns:     PatternAnalysis;
  plan:         PlannerResult | null;
  gymContext:           GymTimeContext | null;
  gymPatternReport:     PatternReport | null;
  engagementContext:    EngagementContext | null;
  rexSessionContext:    string | null;
  rexExperienceLevel:  string | null;
  signalEngineV2:     DetectedSignal[];
  schedulerContextV2: SchedulerContextV2 | null;
  parseSignals:    string[];
  parseIntent?:    string;
  parseConfidence?: number;
  ulIntent?:       string;  // Understanding Layer primary intent (fact, not directive)
  recoveryStatus:  RecoveryStatus | null;
  hardConstraints: HardConstraints | null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TONE MODIFIER
// Applies persona-specific tone overrides based on decision tone.
// ═══════════════════════════════════════════════════════════════════════════════

function getToneModifier(personaName: string, tone: DecisionTone): string {
  const name = personaName.toLowerCase();
  const persona = getPersona(name as PersonaType);
  if (!persona?.toneModifiers) return "";

  // Rex needs softening when tone is gentle/supportive
  if (name === "rex" && (tone === DecisionTone.GENTLE || tone === DecisionTone.SUPPORTIVE)) {
    const key = "firm_not_brutal";
    const val = persona.toneModifiers[key];
    return val ? `TONE MODIFIER — ${key}\n${val}` : "";
  }
  // Nova gets structured_direct when hard/firm
  if (name === "nova" && (tone === DecisionTone.HARD || tone === DecisionTone.FIRM)) {
    const key = "structured_direct";
    const val = persona.toneModifiers[key];
    return val ? `TONE MODIFIER — ${key}\n${val}` : "";
  }
  // Zen gets purposeful_direct when hard/firm
  if (name === "zen" && (tone === DecisionTone.HARD || tone === DecisionTone.FIRM)) {
    const key = "purposeful_direct";
    const val = persona.toneModifiers[key];
    return val ? `TONE MODIFIER — ${key}\n${val}` : "";
  }
  return "";
}


// ═══════════════════════════════════════════════════════════════════════════════
// EMOTION NOTE
// Adds specific guidance when the detected emotion requires overriding the default
// mentor approach (e.g., overwhelm overrides accountability, burnout blocks all push).
// ═══════════════════════════════════════════════════════════════════════════════

function buildEmotionNote(analysis: ConversationAnalysis, state: MentorState): string {
  const { primary, intensity } = analysis.emotion;

  if (state.burnoutRisk >= 70) {
    return `\nEMOTION OVERRIDE: burnout_risk is ${state.burnoutRisk}/100. Zero pressure. Zero demands. Acknowledge only.`;
  }
  if (primary === "overwhelmed") {
    return `\nEMOTION: overwhelmed (${(intensity * 100).toFixed(0)}%). Acknowledge before any direction. Do not add load.`;
  }
  if (primary === "stressed" && intensity >= 0.7) {
    return `\nEMOTION: highly stressed. Reduce the ask — one thing maximum. Nothing escalating.`;
  }
  if (primary === "discouraged" && intensity >= 0.7) {
    return `\nEMOTION: deeply discouraged. One acknowledgment sentence before any direction. Hold space.`;
  }
  if (primary === "defensive") {
    return `\nEMOTION: defensive. Do not escalate. Acknowledge pushback in one clause — then space or one concrete instruction.`;
  }
  if (primary === "determined" || primary === "motivated") {
    return `\nEMOTION: ${primary}. Match their energy with clear direction. Minimal validation — they want to go.`;
  }
  if (primary === "guilty") {
    return `\nEMOTION: guilty. Acknowledge it briefly — don't dwell. Move to what comes next, not what went wrong.`;
  }
  return "";
}

// ═══════════════════════════════════════════════════════════════════════════════
// PATTERN BLOCK
// Injects active pattern context so the LLM can reference evidence naturally.
// ═══════════════════════════════════════════════════════════════════════════════

function buildPatternBlock(patterns: PatternAnalysis): string {
  if (patterns.patterns.length === 0) return "";

  const lines = ["\nDETECTED PATTERNS"];
  patterns.patterns.slice(0, 3).forEach(p => {
    lines.push(`• ${p.type} [${p.severity}] ${(p.confidenceScore * 100).toFixed(0)}%: ${p.evidence[0] ?? ""}`);
  });
  if (patterns.positivePatterns.length > 0) {
    lines.push(`Positive: ${patterns.positivePatterns[0]}`);
  }
  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════════
// PLAN BLOCK
// If a plan was generated, gives the LLM the plan content to present naturally.
// ═══════════════════════════════════════════════════════════════════════════════

function buildPlanBlock(plan: PlannerResult | null): string {
  if (!plan || !("canGenerate" in plan) || !plan.canGenerate) return "";
  return `\nGENERATED PLAN (present this in your reply — speak it as a person, not a document):\n${summarizePlan(plan)}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STATE BLOCK
// Compact state snapshot — used to calibrate empathy and challenge level.
// ═══════════════════════════════════════════════════════════════════════════════

function buildStateBlock(state: MentorState): string {
  const lines = [
    `capacity:${state.capacity} stress:${state.stress} burnout_risk:${state.burnoutRisk}`,
    `motivation:${state.motivation} consistency:${state.consistency} momentum:${state.momentum}`,
  ];
  if (state.streakDays > 0)        lines.push(`streak: ${state.streakDays}d`);
  if (state.consecutiveMisses > 0) lines.push(`consecutive_misses: ${state.consecutiveMisses}`);
  if (state.flags.length > 0)      lines.push(`flags: ${state.flags.join(", ")}`);
  return lines.join(" | ");
}

// ═══════════════════════════════════════════════════════════════════════════════
// TIME BLOCK
// Injects Rex's time/schedule context into the system prompt.
// Only active for Rex persona — returns empty string for all others.
// ═══════════════════════════════════════════════════════════════════════════════

function buildTimeBlock(gymCtx: GymTimeContext | null, personaType: PersonaType): string {
  if (!gymCtx || personaType !== "rex") return "";

  const gymRelative = gymCtx.minutesUntilGym > 0
    ? `${gymCtx.minutesUntilGym} min away`
    : gymCtx.minutesUntilGym === 0
      ? "now"
      : `${Math.abs(gymCtx.minutesUntilGym)} min ago`;

  const sessionLine = gymCtx.lastSessionDaysAgo < 999
    ? gymCtx.lastSessionDaysAgo === 0
      ? "last session: today"
      : gymCtx.lastSessionDaysAgo === 1
        ? "last session: yesterday"
        : `last session: ${gymCtx.lastSessionDaysAgo} days ago`
    : null;

  const lines = [
    `GYM TIME CONTEXT`,
    `User's current time: ${gymCtx.localTimeStr}`,
    `Gym time: ${gymCtx.gymTimeStr} (${gymRelative})`,
    gymCtx.isTrainingDay ? `Today: Training day` : `Today: Rest day`,
    sessionLine,
    gymCtx.lastLiftSummary ? `Last logged lifts: ${gymCtx.lastLiftSummary}` : null,
  ].filter(Boolean).join("\n");

  return `\n${lines}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODE GUIDANCE
// Tells Rex how to behave based on where the user is in their training day.
// ═══════════════════════════════════════════════════════════════════════════════

function buildModeGuidance(gymCtx: GymTimeContext | null, personaType: PersonaType): string {
  if (!gymCtx || personaType !== "rex") return "";

  switch (gymCtx.mode) {
    case "pre_workout":
      return `\nREX MODE — PRE-WORKOUT (${gymCtx.minutesUntilGym} min to gym)
Be sharp and session-focused. Reference today's muscle group (${gymCtx.todayMuscles}) and, if you have lift data, the weight they need to beat. No small talk.`;

    case "session":
      return `\nREX MODE — SESSION WINDOW
Gym time is now or just passed. Short responses. If they haven't logged anything, ask about the session directly.`;

    case "recovery":
      return `\nREX MODE — RECOVERY
Training day, session window has passed. Acknowledge if session is done. Can discuss nutrition, sleep, tomorrow's plan.`;

    case "rest_day":
      return `\nREX MODE — REST DAY
Don't push training today. Protein target, sleep, next session prep. That's it.`;

    default:
      return "";
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ENGAGEMENT BLOCK
// Surfaces streak, monthly volume, PR trajectory, and stated obstacle so Rex
// can reference them naturally — not on every message, but when they land.
// Only active for Rex persona.
// ═══════════════════════════════════════════════════════════════════════════════

function buildEngagementBlock(ctx: EngagementContext | null, personaType: PersonaType): string {
  if (!ctx || personaType !== "rex") return "";

  const streakLine = ctx.streak > 0
    ? `Streak: ${ctx.streak} days`
    : "Streak: 0 (broken)";

  const benchLine = ctx.firstBenchWeight && ctx.currentBenchWeight && ctx.currentBenchWeight > ctx.firstBenchWeight
    ? `First bench logged: ${ctx.firstBenchWeight}kg → now ${ctx.currentBenchWeight}kg`
    : null;

  const lines: (string | null)[] = [
    "\nENGAGEMENT CONTEXT",
    streakLine,
    `Sessions this month: ${ctx.sessionsThisMonth}`,
    `Biggest PR: ${ctx.biggestPR}`,
    ctx.onboardingObstacle ? `User's stated obstacle: "${ctx.onboardingObstacle}"` : null,
    benchLine,
    ctx.firstLogDate ? `First session: ${ctx.firstLogDate}` : null,
    "",
    "Surface these moments naturally — not every message. One well-timed reference builds more trust than 10 generic check-ins.",
  ];

  return lines.filter(Boolean).join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════════
// GYM PATTERN BLOCK
// Injects PatternReport so Rex proactively addresses the top flag.
// Only active for Rex persona — returns empty string for all others.
// ═══════════════════════════════════════════════════════════════════════════════

function buildGymPatternBlock(report: PatternReport | null, personaType: PersonaType): string {
  if (!report || personaType !== "rex") return "";

  const lines: string[] = [
    "\nPATTERN REPORT",
    `Consistency: ${report.consistencyScore}% (last 4 weeks)`,
    `Active flags: ${report.flags.slice(0, 6).join(", ") || "none"}`,
    report.stalledLifts.length
      ? `Stalled: ${report.stalledLifts.map(s => s.exercise).join(", ")}`
      : null,
    `RPE trend: ${report.rpe_trend} | Methodology: ${report.inferredMethodology}`,
    `Deload due: ${report.deloadDue}`,
  ].filter(Boolean) as string[];

  if (report.flags.length > 0) {
    lines.push("Address the highest-priority flag naturally in your response. Do not stack multiple.");
  }

  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════════
// MEMORY BLOCK — V2
// Reads ctx.memory.relevantFacts (already scored and ranked by Memory Retrieval V2
// in the orchestrator) and groups them into labelled blocks.
// Goals come from longTerm because they are structural identity data, not recall.
// Everything else — struggles, achievements, commitments, breakthroughs, and any
// other fact — surfaces only when V2 ranked it as relevant to this message.
// ═══════════════════════════════════════════════════════════════════════════════

function buildMemoryBlock(memory: MemoryContext): string {
  const lines: string[] = [];

  const goals = memory.longTerm.goals.slice(0, 3);
  if (goals.length > 0) lines.push(`Goals: ${goals.join(" | ")}`);
  if (memory.longTerm.creatureName) lines.push(`Creature name: ${memory.longTerm.creatureName}`);

  const facts = memory.relevantFacts;

  const struggles = facts.filter(f => f.type === "struggle").slice(0, 3);
  if (struggles.length > 0)
    lines.push(`Relevant Struggles: ${struggles.map(f => f.value).join(" | ")}`);

  const achievements = facts.filter(f => f.type === "achievement").slice(0, 3);
  if (achievements.length > 0)
    lines.push(`Relevant Achievements: ${achievements.map(f => f.value).join(" | ")}`);

  const commitments = facts
    .filter(f => f.type === "commitment" || f.type === "promise")
    .slice(0, 3);
  if (commitments.length > 0)
    lines.push(`Relevant Commitments: ${commitments.map(f => f.value).join(" | ")}`);

  const breakthroughs = facts.filter(f => f.type === "breakthrough").slice(0, 2);
  if (breakthroughs.length > 0)
    lines.push(`Relevant Breakthroughs: ${breakthroughs.map(f => f.value).join(" | ")}`);

  const other = facts
    .filter(f =>
      !["struggle","achievement","commitment","promise","breakthrough","goal"].includes(f.type)
    )
    .slice(0, 3);
  if (other.length > 0)
    lines.push(`Relevant Memories: ${other.map(f => f.value).join(" | ")}`);

  return lines.join("\n") || "none";
}

// ═══════════════════════════════════════════════════════════════════════════════
// QUESTION LOOP GUARD
// Strips trailing question if the last assistant reply already had one.
// ═══════════════════════════════════════════════════════════════════════════════

function guardQuestionLoop(reply: string, lastAssistantMessage: string | null): string {
  if (!lastAssistantMessage?.includes("?") || !reply.includes("?")) return reply;
  const stripped = reply.replace(/\s*[^.!?\n]*\?\s*$/, "").trim();
  return stripped || reply;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SIGNAL ENGINE V2 BLOCK
// Surfaces active signals (intensity ≥ 0.35) for the LLM to reason about.
// ═══════════════════════════════════════════════════════════════════════════════

// Signal types that carry meaningful valence distinction when negative.
// consistency can be positive ("been consistent") or negative ("keep skipping").
const BIPOLAR_SIGNAL_TYPES = new Set(["consistency"]);

export function buildActiveSignalsBlock(signals: DetectedSignal[]): string {
  const visible = signals.filter(s => s.intensity >= 0.35).slice(0, 5);
  if (visible.length === 0) return "";
  const lines = visible.map(s => {
    const label = BIPOLAR_SIGNAL_TYPES.has(s.type) && s.valence === "negative"
      ? `${s.type}_negative`
      : s.type;
    return `• ${label} (${s.intensity.toFixed(2)})`;
  });
  return `\nACTIVE SIGNALS\n${lines.join("\n")}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCHEDULER CONTEXT V2 BLOCK
// Injects cycle-accurate training state with guidance for each state variant.
// ═══════════════════════════════════════════════════════════════════════════════

export function buildTrainingStateBlock(ctx: SchedulerContextV2 | null): string {
  if (!ctx) return "";
  const stateGuide: Record<string, string> = {
    completed:            "COMPLETED — Session already done today. Do NOT encourage training again. Acknowledge if relevant. Focus on recovery, nutrition, or next session prep.",
    due:                  "DUE — User is inside their training window. Session not yet logged. Be session-focused.",
    pending_confirmation: "PENDING_CONFIRMATION — Training window has passed. Session status unconfirmed. Verify whether they trained before assuming.",
    upcoming:             "UPCOMING — Training window not yet reached. Too early to prompt training. Focus on preparation.",
    skipped:              "SKIPPED — User explicitly skipped today. Acknowledge the skip without shame.",
    unknown:              "UNKNOWN — Insufficient history to determine state. Do not infer.",
  };
  const lines = [
    "\nTRAINING STATE",
    `Current state: ${ctx.trainingState.toUpperCase()}`,
    stateGuide[ctx.trainingState] ?? `State: ${ctx.trainingState}`,
    ctx.pendingMuscles        ? `Current muscle group: ${ctx.pendingMuscles}` : null,
    ctx.pendingSplitDayIndex !== null ? `Cycle day: ${ctx.pendingSplitDayIndex + 1}` : null,
    ctx.completedTodayMuscles ? `Completed today: ${ctx.completedTodayMuscles}` : null,
    `Consecutive misses: ${ctx.consecutiveMisses}`,
    `Completion rate 7d: ${(ctx.completionRate7d * 100).toFixed(0)}%`,
    `Observed training window: ${ctx.observedWindow} (confidence: ${ctx.windowConfidence})`,
  ].filter(Boolean) as string[];
  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════════
// PARSER SAFETY BLOCK
// Surfaces pain, injury, and recommendation-blocked signals explicitly.
// ═══════════════════════════════════════════════════════════════════════════════

export function buildParserSafetyBlock(
  parseSignals:    string[],
  parseIntent?:    string,
  parseConfidence?: number,
): string {
  const hasPain    = parseSignals.includes("PAIN_MENTIONED");
  const hasBlocked = parseSignals.includes("RECOMMENDATION_BLOCKED");
  const hasInjury  = parseSignals.includes("INJURY_CONTEXT");
  const lines: string[] = [];

  // Always inject parser classification so LLM knows what V2 decided
  if (parseIntent !== undefined || parseConfidence !== undefined) {
    lines.push("\nPARSER CLASSIFICATION");
    if (parseIntent)    lines.push(`intent: ${parseIntent}`);
    if (parseConfidence !== undefined) lines.push(`confidence: ${parseConfidence.toFixed(2)}`);
    if (parseConfidence !== undefined && parseConfidence < 0.6) {
      lines.push("IMPORTANT: confidence is LOW — ask clarifying questions, do not make recommendations.");
    }
  }

  if (hasPain || hasBlocked || hasInjury) {
    lines.push("\nSAFETY FLAGS");
    if (hasPain)    lines.push("Pain mentioned.");
    if (hasInjury)  lines.push("Injury context detected.");
    if (hasBlocked) lines.push("No explicit recommendation requested.");
    if (hasBlocked) lines.push("RECOMMENDATION_BLOCKED = TRUE");
  }

  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════════
// RECOVERY BLOCK
// Surfaces the deterministic recovery assessment from RecoveryEngine.
// OpenAI reads this — it never calculates recovery itself.
// Returns empty string when the feature is disabled or no data is available.
// ═══════════════════════════════════════════════════════════════════════════════

export function buildRecoveryBlock(status: RecoveryStatus | null): string {
  if (!status) return "";
  const factorLines = status.factors.length > 0
    ? status.factors.map(f => `• ${f}`).join("\n")
    : "• None identified";
  return [
    "\nRECOVERY STATUS",
    `Recovery score: ${status.score}`,
    `Status: ${status.status.toUpperCase()}`,
    `Constraint level: ${status.constraintLevel}`,
    `Factors:\n${factorLines}`,
  ].join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════════
// UL SEMANTIC BLOCK — facts only, no directive injection
// ═══════════════════════════════════════════════════════════════════════════════

export function buildULSemanticBlock(ulIntent?: string): string {
  if (!ulIntent) return "";
  return `\nSEMANTIC ROUTER\nul_intent: ${ulIntent}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HARD CONSTRAINTS BLOCK
// Renders enforced limits. OpenAI reads these and decides how to respond.
// ═══════════════════════════════════════════════════════════════════════════════

export function buildHardConstraintsBlock(hc: HardConstraints | null): string {
  if (!hc) return "";
  const active: string[] = [];
  if (hc.trainingBlocked)  active.push("training_blocked: true");
  if (hc.intensityReduced) active.push("intensity_reduced: true");
  if (hc.noChallenge)      active.push("no_challenge: true");
  if (hc.noAccountability) active.push("no_accountability: true");
  if (hc.noPlan)           active.push("no_plan: true");
  if (hc.toneFloor === "gentle")     active.push("tone_floor: gentle");
  if (hc.toneFloor === "supportive") active.push("tone_floor: supportive");
  if (active.length === 0) return "";
  return `\nHARD CONSTRAINTS (enforced limits — not suggestions)\n${active.join("\n")}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRIMARY EXPORT — engine-aware LLM call
// Called by mentor-orchestrator for every main conversation turn.
// ═══════════════════════════════════════════════════════════════════════════════

export async function generateEngineResponse(ctx: EngineContext): Promise<string> {
  const persona      = getPersona(ctx.personaType);
  const toneModifier = getToneModifier(persona.name, ctx.decision.tone);
  const emotionNote  = buildEmotionNote(ctx.analysis, ctx.state);
  const patterns     = buildPatternBlock(ctx.patterns);
  const planBlock    = buildPlanBlock(ctx.plan);
  const timeBlock        = buildTimeBlock(ctx.gymContext, ctx.personaType);
  const modeGuidance     = buildModeGuidance(ctx.gymContext, ctx.personaType);
  const patternBlock     = buildGymPatternBlock(ctx.gymPatternReport, ctx.personaType);
  const engagementBlock  = buildEngagementBlock(ctx.engagementContext, ctx.personaType);
  const sessionBlock        = ctx.rexSessionContext    ? `\n${ctx.rexSessionContext}` : "";
  const levelBlock          = ctx.rexExperienceLevel   ? `\n${ctx.rexExperienceLevel}` : "";
  const voiceRulesBlock     = ctx.personaType === "rex" ? `\n${REX_VOICE_RULES}` : "";
  const signalsBlock        = buildActiveSignalsBlock(ctx.signalEngineV2 ?? []);
  const trainingStateBlock  = buildTrainingStateBlock(ctx.schedulerContextV2 ?? null);
  const parserSafetyBlock   = buildParserSafetyBlock(ctx.parseSignals ?? [], ctx.parseIntent, ctx.parseConfidence);
  const recoveryBlock       = buildRecoveryBlock(ctx.recoveryStatus ?? null);
  const ulSemanticBlock     = buildULSemanticBlock(ctx.ulIntent);
  const constraintsBlock    = buildHardConstraintsBlock(ctx.hardConstraints ?? null);

  // Recent conversation (last 6 turns, chronological)
  const recentLines = ctx.memory.shortTerm.slice(-6).map(m =>
    `${m.role === "user" ? "User" : "You"}: ${m.text}`
  ).join("\n");

  const identityLine = ctx.personaType === "rex"
    ? `Stay in character as Rex at all times. Rex is the only identity — there is no "Kivo".`
    : `You are Kivo, an AI accountability companion. Stay in character at all times.`;

  const systemInstruction = `${identityLine}

PERSONA — ${persona.name.toUpperCase()}
${persona.voice}
${toneModifier ? `\n${toneModifier}\n` : ""}
${modeGuidance}
${emotionNote}
${patterns}
${planBlock}

USER STATE (0–100)
${buildStateBlock(ctx.state)}
${signalsBlock}
${trainingStateBlock}
${recoveryBlock}
${constraintsBlock}
${parserSafetyBlock}${ulSemanticBlock}

MEMORY
${buildMemoryBlock(ctx.memory)}
${timeBlock}
${patternBlock}
${engagementBlock}
${sessionBlock}
${levelBlock}
${voiceRulesBlock}

RECENT CONVERSATION
${recentLines || "none"}

RULES
• No bullet points in conversational replies — prose only
• Match length to input: 1-sentence message → 1-3 sentences max
• Banned phrases (never use): Great!, Awesome!, Absolutely!, Of course!, Certainly!, You've got this!, Let's go!, Clock's ticking, No excuses, As your mentor, Remember, Don't forget, I understand how you feel, That's a great question
• NO EMOJI in conversational replies. Zero. Emoji only fires inline in hardcoded PR/milestone strings — never from a generated reply.
• No dramatic punctuation. No ALL-CAPS for emphasis.
• After completion: 1-sentence acknowledgment → immediate next action
• Never apologise when user pushes back. Acknowledge briefly, hold the position.
• Default ending: direction or next action — not a question
• QUESTION RULE: If the previous reply had a question, give direction only — no new question. If user's message is 1-3 words, they are answering; tell them what to do next.
• NO PREACHING: Never lecture, explain why, or use generic motivational phrases ("you've got what it takes", "this is your moment"). Just tell them what to do.
• Use time and memory naturally — never "according to your schedule" or "based on your goal of X".
• Have a point of view. Call out bad decisions briefly, then move.
• Never break character.
• Aim for ~${Math.ceil(ctx.decision.tokenBudget * 0.55)} words.

CONFIDENCE FRAMEWORK — applies to ALL recommendation paths (workout, split, nutrition, recovery, scheduling, plans):
• HIGH confidence (have: muscle group, experience level, current state, active goal) → recommend.
• MEDIUM confidence (missing 1 key piece) → ask exactly ONE clarifying question. No recommendation yet.
• LOW confidence (missing 2+ key pieces, or pain/injury context) → do not recommend, do not infer. Ask for missing context.
"I don't know enough yet" is always preferred over a confident wrong answer.

RECOVERY PRIORITY RULE (absolute — never override):
• INJURY / SAFETY FLAGS → highest priority. Overrides all training guidance.
• training_blocked → do not encourage training regardless of TRAINING STATE. Recovery only.
• intensity_reduced → training is allowed at reduced intensity only. No maximum-effort sets.
• unrestricted (or no recovery data) → follow TRAINING STATE guidance normally.

HARD CONSTRAINTS RULE (absolute — never override):
• training_blocked: true → do not encourage training.
• intensity_reduced: true → no max-effort sets.
• no_challenge: true → do not challenge or push harder. Acknowledge and reduce pressure.
• no_accountability: true → do not hold to missed commitments. Re-engage gently.
• no_plan: true → one action maximum. Do not expand scope or make plans.
• tone_floor: gentle → maintain gentle tone throughout. No edge.

PAIN / INJURY HARD RULES:
• If PAIN_MENTIONED = TRUE and RECOMMENDATION_BLOCKED = TRUE → NO exercise recommendations. NO replacement exercises. NO workout modifications. NO recovery protocols. Only: clarify, acknowledge, gather context (location, severity, duration).
• If PAIN_MENTIONED = TRUE and user explicitly asked for recommendations → still require location + severity + duration before recommending anything.
• Pain ≠ soreness. When uncertain → default to clarification.

Do not end mid-word or mid-sentence.`.trim();

  try {
    const raw = await generateOpenAIText({
      systemInstruction,
      prompt: ctx.message,
    });
    return guardQuestionLoop(raw, ctx.memory.lastAssistantMessage);
  } catch (err) {
    console.error("[LLM] generateEngineResponse failed:", err);
    return "Something went off on my end. Try again in a moment.";
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// LEGACY EXPORT — used by intake, check-in, and other services that don't have
// full engine context. Kept for backward compatibility.
// ═══════════════════════════════════════════════════════════════════════════════

export async function generateResponse(input: {
  message: string;
  context: any;
  system: any;
}) {
  const persona      = getPersona(input.system.persona as PersonaType);
  const toneModifier = getToneModifier(persona.name, input.system.tone ?? DecisionTone.STANDARD);
  const gymMemory    = input.context.memory.longTerm.gym
    ? JSON.stringify(input.context.memory.longTerm.gym)
    : "none";

  const systemInstruction = `You are Kivo, an accountability companion. Stay in character at all times.

PERSONA — ${persona.name.toUpperCase()}
${persona.voice}
${toneModifier ? `\n${toneModifier}\n` : ""}
CONTEXT
User name: ${input.context.user.name}
Conversation mode: ${input.system.mode}
Detected emotion: ${input.system.emotion}

Recent conversation:
${input.context.memory.shortTerm.join("\n") || "none"}

Long-term context:
Goals: ${input.context.memory.longTerm.goals?.join("; ") || "none"}
Deadlines: ${input.context.memory.longTerm.deadlines?.join("; ") || "none"}
Preferences: ${input.context.memory.longTerm.preferences?.join("; ") || "none"}
Anchors: ${input.context.memory.longTerm.anchors?.join("; ") || "none"}
Gym: ${gymMemory}

RULES
• No bullet points in conversational replies
• Match length to input
• Banned phrases: Great!, Awesome!, Absolutely!, Of course!, You've got this!, Let's go!, Clock's ticking, No excuses, As your mentor, I understand how you feel, That's a great question
• No dramatic punctuation
• After completion: 1-sentence acknowledge → next action
• Never apologise when pushed back
• Default ending: direction or action, not a question
• Max 1 question per reply
• Have a point of view — call out bad decisions
• Never break character

Do not end mid-word or mid-sentence.`.trim();

  try {
    const shortTerm      = input.context.memory.shortTerm as string[] | undefined;
    const lastAssistant  = [...(shortTerm ?? [])].reverse().find(l => l.startsWith("assistant: ")) ?? null;
    const raw = await generateOpenAIText({
      systemInstruction,
      prompt:          input.message,
      maxOutputTokens: 512,
    });
    return guardQuestionLoop(raw, lastAssistant);
  } catch (err) {
    console.error("[LLM] generateResponse failed:", err);
    return "Something went off. Try again in a bit.";
  }
}
