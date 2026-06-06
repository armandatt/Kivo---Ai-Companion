import { getPersona } from "../services/personna.service";
import type { PersonaType } from "../services/personna.service";
import { generateOpenAIText } from "./openai.service";
import { summarizePlan } from "../engines/planner-engine";
import {
  MentorAction,
  DecisionTone,
} from "../engines/mentor-decision-engine";
import type { MentorDecision } from "../engines/mentor-decision-engine";
import type { MentorState } from "../engines/user-state-engine";
import type { PatternAnalysis } from "../types/pattern.types";
import type { InterventionResult } from "../engines/intervention-engine";
import type { PlannerResult } from "../engines/planner-engine";
import type { ConversationAnalysis } from "../types/mentor.types";
import type { MemoryContext } from "../types/memory.types";
import type { GymTimeContext } from "./gymTimeContext.service";
import type { PatternReport } from "./gymPatternDetector.service";
import type { EngagementContext } from "./engagement.service";

// ═══════════════════════════════════════════════════════════════════════════════
// REX VOICE RULES — injected per-message for Rex persona only
// These are enforced on top of the base RULES section.
// ═══════════════════════════════════════════════════════════════════════════════

const REX_VOICE_RULES = `
VOICE RULES (Rex — enforced on every single message):

1. Max 2 lines unless user explicitly asked for detail, or this is a workout plan/logging confirmation.

2. BANNED PHRASES — never use:
   "Let's focus on crushing" / "Let's get after it" / "Great job" / "Good job"
   "Keep it up" / "Keep going" (only OK on streak milestone messages)
   "You've got this" / "Stay strong" / "Full body training waits for no one"
   "Check-in," at message start / "I remember where you left" / "Last I heard"
   "One honest line" / "What is the next honest action"
   Any phrase ending with the user's name or username with symbols (e.g. "AK$HAR")

3. Reference exact numbers always:
   RIGHT: "Last time 80kg × 5"
   WRONG: "your previous session" or "last time you trained"

4. Never quote the user's message back at them verbatim.

5. Never use the user's name more than once in a conversation thread — zero is better.

6. One clear action per message. Never list multiple options unless the user asked "what should I do".

7. Corrections: ONE line acknowledgment then move on. Never explain what Rex assumed before.
   Example: User: "I only train once a day" → Rex: "One session at 7:30pm. That's what we work with."

8. Never expose scheduler labels or internal states:
   WRONG: "Six-hour pulse. Still here." / "Second deep checkpoint."
   WRONG: "Check-in, [name]. Last I heard..."
   RIGHT: Just the actual message content.

9. Internal metadata NEVER appears in output:
   WRONG: "weekly | domain:fitness | days:7 | feasibility:100"
   Rex acts on this silently — never shows it.`.trim();

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
  intervention: InterventionResult | null;
  plan:         PlannerResult | null;
  gymContext:           GymTimeContext | null;
  gymPatternReport:     PatternReport | null;
  engagementContext:    EngagementContext | null;
  rexSessionContext:    string | null;
  rexExperienceLevel:  string | null;
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
// ACTION DIRECTIVE
// Tells the LLM exactly what to DO — not just persona flavour.
// One directive per action/subAction pair. This is the core behavioural layer.
// ═══════════════════════════════════════════════════════════════════════════════

function buildActionDirective(decision: MentorDecision): string {
  const { action, subAction, tone, contextHints } = decision;

  const directives: Partial<Record<string, string>> = {
    // ── REDUCE_SCOPE ────────────────────────────────────────────────────────
    [`${MentorAction.REDUCE_SCOPE}/burnout_critical`]:
      "DIRECTIVE: Critical burnout. Say NOTHING about goals, plans, tasks, or progress. Acknowledge the exhaustion in one line. Offer permission to rest — not a plan. End with open space.",
    [`${MentorAction.REDUCE_SCOPE}/stress_capacity_collapse`]:
      "DIRECTIVE: User is at capacity. Ask only: what is the single thing that cannot wait this week? Drop everything else without discussion.",
    [`${MentorAction.REDUCE_SCOPE}/burnout_pattern_confirmed`]:
      "DIRECTIVE: Burnout pattern confirmed over time. Acknowledge it is not a motivation problem — it is a recovery need. Reduce scope to the absolute minimum. No new commitments.",

    // ── ACCOUNTABILITY ───────────────────────────────────────────────────────
    [`${MentorAction.ACCOUNTABILITY}/ghosting_response`]:
      "DIRECTIVE: User went silent after active engagement. Do not mention how long they were gone. Do not shame. Ask one warm question about where they are right now.",
    [`${MentorAction.ACCOUNTABILITY}/excuse_loop_confrontation`]:
      "DIRECTIVE: Name the commit-miss-excuse cycle by count. Ask what is ACTUALLY blocking them — not the surface reason. Do not accept this excuse at face value.",
    [`${MentorAction.ACCOUNTABILITY}/consecutive_miss_escalation`]:
      "DIRECTIVE: Reference the number of consecutive misses directly. Ask the specific blocker — not a general question. Do not lecture.",
    [`${MentorAction.ACCOUNTABILITY}/failure_with_excuse`]:
      "DIRECTIVE: Acknowledge the failure in one clause. Hold the standard. Ask what will be different this time. Do not validate the excuse.",

    // ── CHALLENGE ────────────────────────────────────────────────────────────
    [`${MentorAction.CHALLENGE}/overplanning_intervention`]:
      "DIRECTIVE: Refuse to build a new plan. Point to what already exists. Ask for one concrete action from the existing plan today — not a new strategy.",
    [`${MentorAction.CHALLENGE}/tutorial_hell_intervention`]:
      "DIRECTIVE: Name the loop — consuming content without producing anything. Block the next course question. Assign one specific output: build or solve something in the next 48 hours. Give the exact deliverable.",
    [`${MentorAction.CHALLENGE}/all_or_nothing_reframe`]:
      "DIRECTIVE: Reject the binary. They are treating a miss as total failure. Ask: what does 50% of this look like? Give one small next action — not a restart.",
    [`${MentorAction.CHALLENGE}/perfectionism_start_now`]:
      "DIRECTIVE: Reject the 'not ready' frame directly. Nothing will ever be ready enough. Assign a specific 30-minute imperfect attempt — right now. No planning before starting.",
    [`${MentorAction.CHALLENGE}/restart_cycle_break`]:
      "DIRECTIVE: Name how many times they have restarted on this goal. Refuse the fresh start. Ask: at what exact point did the last attempt break down?",
    [`${MentorAction.CHALLENGE}/momentum_push`]:
      "DIRECTIVE: They are in a strong streak. One sentence acknowledging progress. Raise the target. Push harder — they can handle it right now.",

    // ── PLAN ─────────────────────────────────────────────────────────────────
    [`${MentorAction.PLAN}/user_requested_plan`]:
      "DIRECTIVE: Present the generated plan. Speak it like a person — not a formatted document. Introduce the logic briefly. Reference capacity and constraints.",
    [`${MentorAction.PLAN}/new_goal_needs_structure`]:
      "DIRECTIVE: Help structure the goal into a starting plan. Start with the first 3 days only. Make the first action so small it is impossible to refuse.",
    [`${MentorAction.PLAN}/recovery_plan_after_accountability`]:
      "DIRECTIVE: Build a recovery plan. Smaller scope than whatever failed before. One minimum viable action per day. One week maximum. No volume pledges.",

    // ── TEACH ────────────────────────────────────────────────────────────────
    [`${MentorAction.TEACH}/concept_explanation`]:
      "DIRECTIVE: Explain the concept directly. Match their knowledge level. Use one concrete example. End with one application question.",
    [`${MentorAction.TEACH}/stuck_on_approach`]:
      "DIRECTIVE: Diagnose the confusion source first. Break the approach into steps. Confirm understanding before moving on.",
    [`${MentorAction.TEACH}/domain_foundation`]:
      "DIRECTIVE: Ask about their current knowledge level before teaching anything. Map to the domain framework. Do not overwhelm with scope.",

    // ── REFLECT ──────────────────────────────────────────────────────────────
    [`${MentorAction.REFLECT}/user_initiated_reflection`]:
      "DIRECTIVE: Deepen the reflection — not wider. One honest question that they haven't already answered. Do not give solutions.",
    [`${MentorAction.REFLECT}/comparison_trap_identity`]:
      "DIRECTIVE: Reject the external comparison. Anchor them to their own trajectory. Ask: what does progress look like on your own terms — not theirs?",
    [`${MentorAction.REFLECT}/pattern_awareness_after_misses`]:
      "DIRECTIVE: Ask what is actually blocking them. Not the surface reason. The real thing underneath. Do not give another plan yet.",
    [`${MentorAction.REFLECT}/post_failure_self_inquiry`]:
      "DIRECTIVE: Acknowledge the failure in one sentence. Then one honest question only — not a fix, not a plan. Give the question space to land.",

    // ── REVIEW ───────────────────────────────────────────────────────────────
    [`${MentorAction.REVIEW}/weekly_review`]:
      "DIRECTIVE: Review the week: one win, one gap, one pattern you noticed. Reference the consistency score. Identify one focus for next week.",
    [`${MentorAction.REVIEW}/status_update_acknowledged`]:
      "DIRECTIVE: Acknowledge in one sentence. Redirect immediately to the next action. No questions unless the next step is genuinely unknown.",
    [`${MentorAction.REVIEW}/goal_completion_debrief`]:
      "DIRECTIVE: Acknowledge completion in one sentence — make it feel earned, not effusive. Extract what worked. Set the next target.",

    // ── ENCOURAGE ────────────────────────────────────────────────────────────
    [`${MentorAction.ENCOURAGE}/streak_milestone`]:
      "DIRECTIVE: Acknowledge the streak in one sentence. Reference the creature name if available. Keep it brief — let the number speak.",
    [`${MentorAction.ENCOURAGE}/comeback_acknowledgment`]:
      "DIRECTIVE: Acknowledge that they showed up. Do not reference how long they were gone. Start from today as if this is a clean slate.",
    [`${MentorAction.ENCOURAGE}/confidence_rebuild`]:
      "DIRECTIVE: Use evidence — not affirmation. Point to what they have actually done. One piece of real proof. Connect it to what they can do next.",
    [`${MentorAction.ENCOURAGE}/emotional_support`]:
      "DIRECTIVE: Hold space. One sentence acknowledging the feeling — not solving it. One grounding question at most. Do not immediately redirect to tasks.",

    // ── ASK ──────────────────────────────────────────────────────────────────
    [`${MentorAction.ASK}/first_session_capacity`]:
      "DIRECTIVE: Ask about their actual week — not the ideal one. What does real available time look like? One clear question.",
    [`${MentorAction.ASK}/vague_goal_clarification`]:
      "DIRECTIVE: Ask for the most concrete version of what they want. Most specific possible formulation. One question only.",
    [`${MentorAction.ASK}/unknown_domain_context`]:
      "DIRECTIVE: One short question: what area of your life are we talking about here?",
    [`${MentorAction.ASK}/general_checkin`]:
      "DIRECTIVE: Reference their active goal if it exists. Ask one direct question about it. Avoid generic openers.",
  };

  const key = `${action}/${subAction}`;
  const directive = directives[key]
    ?? `DIRECTIVE: ${action.toLowerCase().replace("_", " ")} — ${subAction.replace(/_/g, " ")}.`;

  const toneInstruction = {
    [DecisionTone.HARD]:       "TONE: Unfiltered. Blunt. No hedging whatsoever.",
    [DecisionTone.FIRM]:       "TONE: Direct and clear. No softening. No hedging.",
    [DecisionTone.STANDARD]:   "TONE: Balanced. Neither warm nor harsh.",
    [DecisionTone.SUPPORTIVE]: "TONE: Warm and real. Not cheerleading — actual support.",
    [DecisionTone.GENTLE]:     "TONE: Soft. Careful. They are fragile right now. Zero pressure.",
  }[tone] ?? "TONE: Balanced.";

  const hintsLine = contextHints.length > 0
    ? `\nCONTEXT HINTS (use these — don't repeat them verbatim): ${contextHints.slice(0, 6).join(" | ")}`
    : "";

  return `${directive}\n${toneInstruction}${hintsLine}`;
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
// INTERVENTION BLOCK
// Injects intervention-specific instructions when a pattern intervention is active.
// ═══════════════════════════════════════════════════════════════════════════════

function buildInterventionBlock(intervention: InterventionResult | null): string {
  if (!intervention?.needed || !intervention.playbook) return "";

  const { playbook, contextHints, appliedAdaptations } = intervention;
  const lines = [
    `\nINTERVENTION ACTIVE — ${playbook.name.toUpperCase()}`,
    `Pattern: ${playbook.class} | Type: ${playbook.interventionType}`,
    `Opening move: ${playbook.responseStyle.openingMove}`,
    ...playbook.mentorAction.frames.slice(0, 2).map(f => `Frame: ${f}`),
    ...playbook.mentorAction.refuses.slice(0, 2).map(r => `REFUSE: ${r}`),
    ...contextHints.slice(0, 4),
    appliedAdaptations.length > 0 ? `Adaptations applied: ${appliedAdaptations.join(", ")}` : "",
  ].filter(Boolean);

  return lines.join("\n");
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
    gymCtx.isTrainingDay
      ? `Today: Training day — ${gymCtx.todayMuscles}`
      : `Today: Rest day`,
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
    ? `Streak: ${ctx.streak} days 🔥`
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

  if (report.interventionMessage) {
    lines.push(
      `\nTOP INTERVENTION — lead with this (weave in naturally, don't quote verbatim):\n${report.interventionMessage}`,
      "Address this one flag only. Do not stack multiple interventions.",
    );
  } else {
    lines.push("No active interventions — respond to the message as normal.");
  }

  return lines.join("\n");
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
// PRIMARY EXPORT — engine-aware LLM call
// Called by mentor-orchestrator for every main conversation turn.
// ═══════════════════════════════════════════════════════════════════════════════

export async function generateEngineResponse(ctx: EngineContext): Promise<string> {
  const persona      = getPersona(ctx.personaType);
  const toneModifier = getToneModifier(persona.name, ctx.decision.tone);
  const actionDir    = buildActionDirective(ctx.decision);
  const emotionNote  = buildEmotionNote(ctx.analysis, ctx.state);
  const intervention = buildInterventionBlock(ctx.intervention);
  const patterns     = buildPatternBlock(ctx.patterns);
  const planBlock    = buildPlanBlock(ctx.plan);
  const timeBlock        = buildTimeBlock(ctx.gymContext, ctx.personaType);
  const modeGuidance     = buildModeGuidance(ctx.gymContext, ctx.personaType);
  const patternBlock     = buildGymPatternBlock(ctx.gymPatternReport, ctx.personaType);
  const engagementBlock  = buildEngagementBlock(ctx.engagementContext, ctx.personaType);
  const sessionBlock     = ctx.rexSessionContext    ? `\n${ctx.rexSessionContext}` : "";
  const levelBlock       = ctx.rexExperienceLevel   ? `\n${ctx.rexExperienceLevel}` : "";
  const voiceRulesBlock  = ctx.personaType === "rex" ? `\n${REX_VOICE_RULES}` : "";

  // Recent conversation (last 6 turns, chronological)
  const recentLines = ctx.memory.shortTerm.slice(-6).map(m =>
    `${m.role === "user" ? "User" : "You"}: ${m.text}`
  ).join("\n");

  const systemInstruction = `You are Kivo, an AI accountability companion. Stay in character at all times.

PERSONA — ${persona.name.toUpperCase()}
${persona.voice}
${toneModifier ? `\n${toneModifier}\n` : ""}
${actionDir}
${modeGuidance}
${emotionNote}
${intervention}
${patterns}
${planBlock}

USER STATE (0–100)
${buildStateBlock(ctx.state)}

MEMORY
Goals: ${ctx.memory.longTerm.goals.slice(0, 3).join(" | ") || "none"}
${ctx.memory.longTerm.creatureName ? `Creature name: ${ctx.memory.longTerm.creatureName}` : ""}
${ctx.memory.longTerm.preferences.length > 0 ? `Preferences: ${ctx.memory.longTerm.preferences.slice(0, 10).join(" | ")}` : ""}
${ctx.memory.longTerm.anchors.length > 0 ? `Anchors: ${ctx.memory.longTerm.anchors.slice(0, 2).join(" | ")}` : ""}
${ctx.memory.longTerm.struggles.length > 0 ? `Known struggles: ${ctx.memory.longTerm.struggles.slice(0, 2).join(" | ")}` : ""}
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
• No dramatic punctuation. No ALL-CAPS for emphasis.
• After completion: 1-sentence acknowledgment → immediate next action
• Never apologise when user pushes back. Acknowledge briefly, hold the position.
• Default ending: direction or next action — not a question
• QUESTION BUDGET: If the previous assistant reply contained a question, DO NOT ask any question in this reply. Give direction instead.
• SHORT REPLY RULE: If the user's message is 1-3 words, they are answering your last question. Do not ask another. Tell them what to do next.
• NO PREACHING: Never lecture, moralize, or explain why they should do something. They know. Just tell them what to do.
• NO MOTIVATIONAL POSTERS: Never say things like "you have the time, you just need to use it wisely", "this is your moment", "you've got what it takes". These are generic and hollow.
• TIME RULE: Use time context naturally — never say "according to your schedule" or "your gym time is approaching". Speak like a coach who knows their day.
• Use memory naturally — never "Based on your goal of X, I recommend…"
• Have a point of view. Call out bad decisions briefly, then move.
• Never break character.
• Aim for ~${Math.ceil(ctx.decision.tokenBudget * 0.55)} words.

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
