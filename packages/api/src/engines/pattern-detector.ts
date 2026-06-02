import { prisma } from "@repo/db/client";
import type {
  PatternType,
  DetectedPattern,
  PatternSeverity,
  PatternRecommendation,
  PatternAnalysis,
} from "../types/pattern.types";
import { getMentorState } from "./user-state-engine";
import type { MentorState } from "./user-state-engine";

// ── Internal pattern identifiers (the 11 the system detects) ─────────────────

type PatternId =
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

// Maps internal IDs to the closest PatternType in pattern.types.ts
const PATTERN_TYPE_MAP: Record<PatternId, PatternType> = {
  ghosting:          "weekend_ghosting",
  motivation_crash:  "consistency_collapse",
  excuse_loop:       "excuse_cycling",
  overplanning:      "overplanning_underexecuting",
  tutorial_hell:     "overplanning_underexecuting",
  perfectionism:     "procrastination_spiral",
  restart_cycle:     "goal_abandonment_cycle",
  burnout:           "consistency_collapse",
  all_or_nothing:    "procrastination_spiral",
  subject_avoidance: "monday_avoidance",
  comparison_trap:   "commitment_inflation",
};

// ── Supporting types ──────────────────────────────────────────────────────────

interface RawMessage {
  role: string;
  text: string;
  intent: string | null;
  emotion: string | null;
  createdAt: Date;
}

interface GoalRecord {
  title: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

interface TriggerCondition {
  id: string;
  description: string;
  met: boolean;
  weight: number;
  evidence: string | null;
}

interface PatternDefinition {
  id: PatternId;
  name: string;
  description: string;
  minConfidence: number;
  baseSeverity: PatternSeverity;
  recommendation: PatternRecommendation;
  examples: string[];
}

interface DetectionResult {
  id: PatternId;
  detected: boolean;
  confidence: number;
  severity: PatternSeverity;
  evidence: string[];
  conditions: TriggerCondition[];
  recommendation: PatternRecommendation;
}

interface DetectionInput {
  userId: string;
  platformChatId: string;
  userMessages: RawMessage[];
  allMessages: RawMessage[];
  goals: GoalRecord[];
  state: MentorState;
  previousPatterns: StoredPattern[];
  daysSinceFirstMessage: number;
  now: Date;
}

interface StoredPattern {
  id: string;
  confidence: number;
  severity: string;
  firstSeenAt: Date;
  occurrences: number;
}

// ── Pattern definitions ───────────────────────────────────────────────────────

const DEFINITIONS: Record<PatternId, PatternDefinition> = {
  ghosting: {
    id: "ghosting",
    name: "Ghosting",
    description:
      "User disappears after engagement. Stops responding to check-ins without warning. Often follows a period of high activity.",
    minConfidence: 0.50,
    baseSeverity: "confirmed",
    recommendation: "gentle_re_engagement",
    examples: [
      "Active daily for 5 days, then completely silent for 9 days",
      "Agreed to check in tomorrow — no message in 4 days",
      "Mid-conversation: 'I'll get back to you' — never did",
      "Last message: 'Doing well, talk later' — 12 days ago",
    ],
  },

  motivation_crash: {
    id: "motivation_crash",
    name: "Motivation Crash",
    description:
      "User starts strong with high energy then drops suddenly after first obstacle, missed milestone, or early setback.",
    minConfidence: 0.55,
    baseSeverity: "confirmed",
    recommendation: "momentum_rebuild",
    examples: [
      "'I'm SO ready for this!' → silence for 8 days after first miss",
      "Week 1: 5 messages/day. Week 3: 0 messages",
      "Motivation score: 85 → 28 in one week following a failure",
      "'I thought I could do this but I was wrong'",
    ],
  },

  excuse_loop: {
    id: "excuse_loop",
    name: "Excuse Loop",
    description:
      "User produces rotating justifications that systematically prevent progress. Each miss has a different reason; the pattern always ends the same.",
    minConfidence: 0.60,
    baseSeverity: "confirmed",
    recommendation: "call_out_directly",
    examples: [
      "Week 1: 'I was sick.' Week 2: 'Work exploded.' Week 3: 'Family issue.'",
      "4 consecutive misses, 4 different reasons for the same task",
      "Commits → misses → excuse → recommits → misses (×3 in 4 weeks)",
      "Excuse categories: time, energy, environment cycling every week",
    ],
  },

  overplanning: {
    id: "overplanning",
    name: "Overplanning",
    description:
      "User over-invests in planning and scheduling but under-executes. Plans are detailed and frequent; completion reports are absent.",
    minConfidence: 0.55,
    baseSeverity: "confirmed",
    recommendation: "reduce_commitment_scope",
    examples: [
      "3 detailed weekly plans created, 0 reported completions",
      "Asks for a new plan every Sunday before finishing the last one",
      "Plan requests: 6. Status updates: 1. Over 3 weeks.",
      "'OK I made a new schedule, this time it will work'",
    ],
  },

  tutorial_hell: {
    id: "tutorial_hell",
    name: "Tutorial Hell",
    description:
      "User endlessly consumes learning content (courses, tutorials, books) without applying or building. Always one course away from starting.",
    minConfidence: 0.55,
    baseSeverity: "confirmed",
    recommendation: "build_habit_anchor",
    examples: [
      "Finished 4 courses on DSA, hasn't solved a problem independently",
      "'After I finish this Udemy course I'll start LeetCode'",
      "6 weeks in, still 'learning the fundamentals properly'",
      "Mentions new course every week; no project, no output",
    ],
  },

  perfectionism: {
    id: "perfectionism",
    name: "Perfectionism",
    description:
      "User delays action indefinitely waiting for ideal conditions, complete knowledge, or perfect motivation. Plans exist; execution is permanently deferred.",
    minConfidence: 0.55,
    baseSeverity: "confirmed",
    recommendation: "build_habit_anchor",
    examples: [
      "'I'll start once I understand everything properly'",
      "'I want to set up my system correctly before I begin'",
      "14-day-old goal with 0 execution updates",
      "'Not ready yet' appears in 3 separate conversations",
    ],
  },

  restart_cycle: {
    id: "restart_cycle",
    name: "Restart Cycle",
    description:
      "User abandons current effort and 'starts fresh' repeatedly. Treats reset as progress. Never reaches the phase where previous attempt failed.",
    minConfidence: 0.60,
    baseSeverity: "confirmed",
    recommendation: "reset_goals",
    examples: [
      "Third 'fresh start' on DSA this month",
      "Switches plan every 10 days before anything compounds",
      "'This time I'm going to do it properly from the beginning'",
      "Goals abandoned: 3. Goals completed: 0.",
    ],
  },

  burnout: {
    id: "burnout",
    name: "Burnout",
    description:
      "User shows clinical-level exhaustion preventing meaningful engagement. Not a motivation issue — a recovery need.",
    minConfidence: 0.60,
    baseSeverity: "critical",
    recommendation: "reduce_load",
    examples: [
      "burnoutRisk: 83, stress: 79, consecutiveMisses: 6",
      "'I can't even look at my notes, I'm so tired'",
      "Energy/burnout constraint (severe) × 4 messages this week",
      "'I know I should but I literally cannot'",
    ],
  },

  all_or_nothing: {
    id: "all_or_nothing",
    name: "All-or-Nothing Thinking",
    description:
      "User treats any deviation as total failure. One missed session means the whole week is 'ruined'. Responds to imperfection with complete abandonment.",
    minConfidence: 0.55,
    baseSeverity: "confirmed",
    recommendation: "call_out_directly",
    examples: [
      "'I missed Monday so the whole week is ruined anyway'",
      "Skipped gym once → 'I've completely given up on fitness'",
      "Bad day → immediate request to restart the entire plan",
      "'If I can't do it perfectly, there's no point'",
    ],
  },

  subject_avoidance: {
    id: "subject_avoidance",
    name: "Subject Avoidance",
    description:
      "User systematically avoids one specific goal or domain while engaging actively with everything else. The avoided topic is always conspicuously absent.",
    minConfidence: 0.55,
    baseSeverity: "confirmed",
    recommendation: "schedule_reflection",
    examples: [
      "Updates on gym/diet/sleep but never on the job search (goal set 3 weeks ago)",
      "Discusses life and habits freely, never mentions the DSA goal",
      "6 check-in responses, 0 mention the active goal",
      "Every update topic except the one thing committed to",
    ],
  },

  comparison_trap: {
    id: "comparison_trap",
    name: "Comparison Trap",
    description:
      "User measures their progress against others, leading to artificial urgency, demotivation, and unrealistic timelines set to 'catch up'.",
    minConfidence: 0.55,
    baseSeverity: "confirmed",
    recommendation: "schedule_reflection",
    examples: [
      "'My batchmate already has 2 offers and I'm still on basics'",
      "'Everyone around me is so far ahead'",
      "Sets a 4-week DSA goal because 'others did it in 30 days'",
      "Discouragement always follows references to peers",
    ],
  },
};

// ── Keyword and phrase databases ──────────────────────────────────────────────

const EXCUSE_PATTERNS: Array<{ pattern: RegExp; category: string }> = [
  { pattern: /\b(was sick|fell sick|not feeling well|got sick|health issue)\b/i, category: "health" },
  { pattern: /\b(too busy|work (got crazy|exploded|was hectic)|office|meeting|deadline)\b/i, category: "work" },
  { pattern: /\b(family (stuff|issue|emergency|came up)|home|relative|parents)\b/i, category: "family" },
  { pattern: /\b(no (time|energy)|tired|exhausted|drained|low energy)\b/i, category: "energy" },
  { pattern: /\b(forgot|slipped my mind|lost track|it slipped)\b/i, category: "memory" },
  { pattern: /\b(internet|power cut|electricity|wifi|laptop (issue|crashed|broke))\b/i, category: "environment" },
  { pattern: /\b(exam|test|submission|assignment|college)\b/i, category: "academics" },
  { pattern: /\b(mood (off|bad)|not in the (mood|zone)|off day|bad day)\b/i, category: "mood" },
];

const TUTORIAL_HELL_PATTERNS = [
  /\b(watching|finished|completing|going through|currently on|halfway through|started)\b.{0,30}\b(course|tutorial|video|udemy|coursera|youtube|book|chapter|module|bootcamp)\b/i,
  /\b(after (i finish|completing|i'm done with|this course|this chapter|this module))\b.{0,50}\b(i'?ll? (start|begin|try|practice|build|do))\b/i,
  /\b(need to (learn|understand|study|finish|complete|cover)\b.{0,30}\b(first|before|properly|thoroughly))\b/i,
  /\b(still (learning|studying|on) the (basics|fundamentals|foundation))\b/i,
  /\b(not ready (yet|to start)|need more (practice|knowledge|understanding) before)\b/i,
];

const PERFECTIONISM_PATTERNS = [
  /\b(not ready (yet|to start)|once (i|i'?m|i have|i finish|i understand|everything is))\b/i,
  /\b(when (i'?m ready|the time is right|i feel prepared|i have more time|things settle down))\b/i,
  /\b(want to (understand|learn|do) (it|this|everything) (properly|correctly|perfectly|right|fully) (first|before))\b/i,
  /\b(need to (set up|create|build|design|have) (the|a|my) (perfect|proper|right|good) (system|plan|schedule|setup|routine) (first|before))\b/i,
  /\b(can'?t start until|not (starting|beginning) until|will (start|begin) when)\b/i,
];

const RESTART_CYCLE_PATTERNS = [
  /\b(fresh start|starting (fresh|over|from scratch|from zero|from the beginning|again)|starting new)\b/i,
  /\b(reset(ting)?|going to reset|resetting (my|the) (plan|goal|routine|schedule))\b/i,
  /\b(this time (i'?ll?|i will|it will be|it'?s going to be) (different|better|proper|for real))\b/i,
  /\b(properly (this time|from the start)|do(ing)? it (right|properly|correctly) this time)\b/i,
  /\b(wipe (the slate|everything)|start (clean|blank|anew))\b/i,
];

const ALL_OR_NOTHING_PATTERNS = [
  /\b(whole (week|month|day|plan) is (ruined|gone|wasted|over|pointless))\b/i,
  /\b(if i (miss|skip|fail|can'?t do) (one|a|any) (day|session|thing|time).{0,40}(ruined|pointless|fail|give up|useless|no point))\b/i,
  /\b(completely (failed|given up|off track|lost it|ruined it))\b/i,
  /\b(if (i can'?t|it'?s not) (perfect|100%|done properly|exactly right).{0,30}(no point|pointless|give up|not worth))\b/i,
  /\b(either (do it (right|perfectly|fully|completely)|don'?t (do it|bother))|all or nothing)\b/i,
];

const COMPARISON_PATTERNS = [
  /\b(my (friend|batchmate|classmate|colleague|roommate|cousin).{0,50}(already|got|cracked|landed|has|placed|done))\b/i,
  /\b(everyone (else|around me|i know|in my (class|batch|year)).{0,30}(ahead|doing better|progressing|placed|got))\b/i,
  /\b(so (far behind|behind|slow|much slower) (than|compared to))\b/i,
  /\b(i'?m (falling|so far|left) behind)\b/i,
  /\b(others (did|completed|finished|cracked|achieved).{0,30}in (less|fewer|30|2|3|4|5|6|7)\b)\b/i,
  /\b(why (can'?t|am) i (do|progress|achieve|learn) (as fast|as quickly|like|as well))\b/i,
];

// ── Utility functions ─────────────────────────────────────────────────────────

function userMessagesInDays(messages: RawMessage[], days: number, now: Date): RawMessage[] {
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  return messages.filter((m) => m.role === "user" && m.createdAt >= cutoff);
}

function daysSince(date: Date, now: Date): number {
  return Math.floor((now.getTime() - date.getTime()) / 86_400_000);
}

function countByIntent(messages: RawMessage[], intent: string): number {
  return messages.filter((m) => m.intent === intent).length;
}

function countByEmotion(messages: RawMessage[], emotion: string): number {
  return messages.filter((m) => m.emotion === emotion).length;
}

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

function matchCount(messages: RawMessage[], patterns: RegExp[]): number {
  return messages.filter((m) => matchesAny(m.text, patterns)).length;
}

function combinedUserText(messages: RawMessage[]): string {
  return messages
    .filter((m) => m.role === "user")
    .map((m) => m.text)
    .join(" ");
}

function messagesPerDay(messages: RawMessage[], days: number, now: Date): number {
  const count = userMessagesInDays(messages, days, now).length;
  return count / Math.max(days, 1);
}

function detectExcuseCategories(messages: RawMessage[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const msg of messages) {
    for (const { pattern, category } of EXCUSE_PATTERNS) {
      if (pattern.test(msg.text)) {
        counts.set(category, (counts.get(category) ?? 0) + 1);
      }
    }
  }
  return counts;
}

function computeSeverity(confidence: number, definition: PatternDefinition, state: MentorState): PatternSeverity {
  if (confidence >= 0.85) return "critical";
  if (confidence >= 0.70) return "entrenched";
  if (confidence >= 0.55) return "confirmed";
  return "emerging";
}

function buildDetectedPattern(
  result: DetectionResult,
  definition: PatternDefinition,
  state: MentorState,
  previous: StoredPattern | null,
  now: Date
): DetectedPattern {
  return {
    type: PATTERN_TYPE_MAP[result.id],
    severity: result.severity,
    occurrences: previous ? previous.occurrences + 1 : 1,
    firstDetectedAt: previous?.firstSeenAt ?? now,
    lastSeenAt: now,
    evidence: result.evidence,
    confidenceScore: parseFloat(result.confidence.toFixed(3)),
    recommendation: result.recommendation,
  };
}

// ── Individual pattern detection functions ────────────────────────────────────

function detectGhosting(input: DetectionInput): DetectionResult {
  const def = DEFINITIONS.ghosting;
  const conditions: TriggerCondition[] = [];
  const evidence: string[] = [];

  const allUserMessages = input.userMessages;
  const lastMessage = allUserMessages[0];
  const silentDays = lastMessage ? daysSince(lastMessage.createdAt, input.now) : 999;

  const preSilenceWindow = allUserMessages.filter(
    (m) => daysSince(m.createdAt, input.now) >= silentDays && daysSince(m.createdAt, input.now) < silentDays + 14
  );
  const preSilenceRate = preSilenceWindow.length / 14;

  conditions.push({
    id: "silence_14d",
    description: "Silent for 14+ days",
    met: silentDays >= 14,
    weight: 0.55,
    evidence: silentDays >= 14 ? `${silentDays} days since last message` : null,
  });

  conditions.push({
    id: "silence_7d",
    description: "Silent for 7+ days",
    met: silentDays >= 7 && silentDays < 14,
    weight: 0.40,
    evidence: silentDays >= 7 && silentDays < 14 ? `${silentDays} days since last message` : null,
  });

  conditions.push({
    id: "silence_3d",
    description: "Silent for 3+ days",
    met: silentDays >= 3 && silentDays < 7,
    weight: 0.20,
    evidence: silentDays >= 3 && silentDays < 7 ? `${silentDays} days since last message` : null,
  });

  conditions.push({
    id: "was_active",
    description: "Was previously active (>= 1 msg/day in 7 days pre-silence)",
    met: preSilenceRate >= 0.7,
    weight: 0.25,
    evidence: preSilenceRate >= 0.7 ? `avg ${preSilenceRate.toFixed(1)} msgs/day before going silent` : null,
  });

  conditions.push({
    id: "promised_update",
    description: "Last message contained a follow-up promise",
    met: lastMessage ? /\b(i'?ll? (update|message|text|be back|check in)|talk (later|tomorrow|soon)|let you know)\b/i.test(lastMessage.text) : false,
    weight: 0.25,
    evidence: lastMessage && /\b(i'?ll? (update|message|text|be back|check in)|talk (later|tomorrow|soon)|let you know)\b/i.test(lastMessage.text) ? "Last message promised follow-up" : null,
  });

  conditions.push({
    id: "high_streak_before",
    description: "User had a streak before going silent",
    met: input.state.streakDays > 0 || input.state.longestStreak >= 3,
    weight: 0.15,
    evidence: input.state.longestStreak >= 3 ? `Longest streak was ${input.state.longestStreak} days` : null,
  });

  const confidence = conditions.filter((c) => c.met).reduce((sum, c) => sum + c.weight, 0);
  const metConditions = conditions.filter((c) => c.met && c.evidence);
  metConditions.forEach((c) => c.evidence && evidence.push(c.evidence));

  return {
    id: def.id,
    detected: confidence >= def.minConfidence,
    confidence: Math.min(confidence, 1),
    severity: computeSeverity(confidence, def, input.state),
    evidence,
    conditions,
    recommendation: def.recommendation,
  };
}

function detectMotivationCrash(input: DetectionInput): DetectionResult {
  const def = DEFINITIONS.motivation_crash;
  const conditions: TriggerCondition[] = [];
  const evidence: string[] = [];

  const messages14d = userMessagesInDays(input.userMessages, 14, input.now);
  const messages7d  = userMessagesInDays(input.userMessages, 7,  input.now);
  const messages30d = userMessagesInDays(input.userMessages, 30, input.now);

  const recentRate  = messagesPerDay(messages7d,  7,  input.now);
  const earlierRate = messagesPerDay(
    input.userMessages.filter(
      (m) => daysSince(m.createdAt, input.now) >= 7 && daysSince(m.createdAt, input.now) < 21
    ),
    14, input.now
  );
  const activityDropped = earlierRate >= 0.8 && recentRate < 0.2;

  const earlyPositive = input.allMessages
    .filter((m) => m.role === "user" && daysSince(m.createdAt, input.now) >= 14 && daysSince(m.createdAt, input.now) < 28)
    .filter((m) => ["motivated", "determined", "hopeful"].includes(m.emotion ?? "")).length;

  conditions.push({
    id: "low_motivation_state",
    description: "Current motivation score below 35",
    met: input.state.motivation < 35,
    weight: 0.35,
    evidence: input.state.motivation < 35 ? `Motivation score: ${input.state.motivation}` : null,
  });

  conditions.push({
    id: "activity_drop",
    description: "Message frequency dropped sharply",
    met: activityDropped,
    weight: 0.35,
    evidence: activityDropped ? `Activity: ${earlierRate.toFixed(1)} msg/day → ${recentRate.toFixed(1)} msg/day` : null,
  });

  conditions.push({
    id: "early_enthusiasm",
    description: "Early messages showed high motivation/enthusiasm",
    met: earlyPositive >= 2,
    weight: 0.20,
    evidence: earlyPositive >= 2 ? `${earlyPositive} motivated/enthusiastic messages in first 2 weeks` : null,
  });

  conditions.push({
    id: "discouraged_emotion",
    description: "Recent messages show discouragement",
    met: countByEmotion(messages14d, "discouraged") >= 2,
    weight: 0.20,
    evidence: countByEmotion(messages14d, "discouraged") >= 2
      ? `${countByEmotion(messages14d, "discouraged")} discouraged messages in last 14 days`
      : null,
  });

  conditions.push({
    id: "failed_reports",
    description: "Multiple failure reports in recent messages",
    met: countByIntent(messages14d, "failure_report") >= 2,
    weight: 0.20,
    evidence: countByIntent(messages14d, "failure_report") >= 2
      ? `${countByIntent(messages14d, "failure_report")} failure reports in 14 days`
      : null,
  });

  conditions.push({
    id: "state_momentum_collapsed",
    description: "Momentum collapsed flag is active",
    met: input.state.flags.includes("momentum_collapsed"),
    weight: 0.20,
    evidence: input.state.flags.includes("momentum_collapsed") ? `Momentum score: ${input.state.momentum}` : null,
  });

  const confidence = conditions.filter((c) => c.met).reduce((sum, c) => sum + c.weight, 0);
  conditions.filter((c) => c.met && c.evidence).forEach((c) => c.evidence && evidence.push(c.evidence));

  return {
    id: def.id,
    detected: confidence >= def.minConfidence,
    confidence: Math.min(confidence, 1),
    severity: computeSeverity(confidence, def, input.state),
    evidence,
    conditions,
    recommendation: def.recommendation,
  };
}

function detectExcuseLoop(input: DetectionInput): DetectionResult {
  const def = DEFINITIONS.excuse_loop;
  const conditions: TriggerCondition[] = [];
  const evidence: string[] = [];

  const messages21d = userMessagesInDays(input.userMessages, 21, input.now);
  const excuseCount  = countByIntent(messages21d, "excuse");
  const missCount    = countByIntent(messages21d, "failure_report");
  const categories   = detectExcuseCategories(messages21d);
  const uniqueCats   = categories.size;
  const commitCount  = countByIntent(messages21d, "commitment_made");
  const excuseToMissRatio = missCount > 0 ? excuseCount / missCount : 0;

  // Check if same commit-miss-excuse cycle repeats
  const cycleEvidence: string[] = [];
  let cycleCount = 0;
  const weeks = [0, 7, 14];
  for (const weekStart of weeks) {
    const weekMsgs = input.userMessages.filter((m) => {
      const age = daysSince(m.createdAt, input.now);
      return age >= weekStart && age < weekStart + 7;
    });
    const hasExcuse  = weekMsgs.some((m) => m.intent === "excuse");
    const hasMiss    = weekMsgs.some((m) => m.intent === "failure_report");
    const hasCommit  = weekMsgs.some((m) => m.intent === "commitment_made");
    if (hasExcuse && hasMiss) {
      cycleCount++;
      const weekLabel = weekStart === 0 ? "this week" : weekStart === 7 ? "last week" : "2 weeks ago";
      if (hasCommit) cycleEvidence.push(`${weekLabel}: commit→miss→excuse cycle`);
    }
  }

  conditions.push({
    id: "excuse_count_high",
    description: "5+ excuse messages in 21 days",
    met: excuseCount >= 5,
    weight: 0.45,
    evidence: excuseCount >= 5 ? `${excuseCount} excuse messages in 21 days` : null,
  });

  conditions.push({
    id: "excuse_count_medium",
    description: "3–4 excuse messages in 21 days",
    met: excuseCount >= 3 && excuseCount < 5,
    weight: 0.30,
    evidence: excuseCount >= 3 && excuseCount < 5 ? `${excuseCount} excuse messages in 21 days` : null,
  });

  conditions.push({
    id: "multiple_categories",
    description: "Excuses span 3+ different categories",
    met: uniqueCats >= 3,
    weight: 0.25,
    evidence: uniqueCats >= 3
      ? `Excuse categories: ${[...categories.keys()].join(", ")}`
      : null,
  });

  conditions.push({
    id: "commit_then_miss",
    description: "High commitment count but also high miss count",
    met: commitCount >= 2 && missCount >= commitCount,
    weight: 0.25,
    evidence: commitCount >= 2 && missCount >= commitCount
      ? `Committed ${commitCount}×, missed ${missCount}× in 21 days`
      : null,
  });

  conditions.push({
    id: "cycle_repeats",
    description: "Commit→miss→excuse cycle in 2+ separate weeks",
    met: cycleCount >= 2,
    weight: 0.30,
    evidence: cycleCount >= 2 ? cycleEvidence.join("; ") : null,
  });

  conditions.push({
    id: "low_consistency",
    description: "Consistency score below 35",
    met: input.state.consistency < 35,
    weight: 0.20,
    evidence: input.state.consistency < 35 ? `Consistency score: ${input.state.consistency}` : null,
  });

  const confidence = conditions.filter((c) => c.met).reduce((sum, c) => sum + c.weight, 0);
  conditions.filter((c) => c.met && c.evidence).forEach((c) => c.evidence && evidence.push(c.evidence));

  return {
    id: def.id,
    detected: confidence >= def.minConfidence,
    confidence: Math.min(confidence, 1),
    severity: computeSeverity(confidence, def, input.state),
    evidence,
    conditions,
    recommendation: def.recommendation,
  };
}

function detectOverplanning(input: DetectionInput): DetectionResult {
  const def = DEFINITIONS.overplanning;
  const conditions: TriggerCondition[] = [];
  const evidence: string[] = [];

  const messages21d  = userMessagesInDays(input.userMessages, 21, input.now);
  const planRequests = countByIntent(messages21d, "plan_request");
  const statusUpdates = countByIntent(messages21d, "status_update") + countByIntent(messages21d, "progress_report");
  const planToStatusRatio = statusUpdates > 0 ? planRequests / statusUpdates : planRequests;

  const activeGoalsWithNoUpdates = input.goals.filter((g) => {
    if (g.status !== "active") return false;
    const agedays = daysSince(g.createdAt, input.now);
    if (agedays < 7) return false;
    // If no status update mentioning this goal in past week
    const recentMentions = messages21d.filter(
      (m) => m.text.toLowerCase().includes(g.title.toLowerCase().slice(0, 15))
    ).length;
    return recentMentions === 0;
  });

  const multiplePlans = input.userMessages.filter((m) =>
    /\b(new plan|updated plan|revised plan|changed (my |the )?plan|different (approach|strategy|plan))\b/i.test(m.text)
  ).length;

  conditions.push({
    id: "plan_status_ratio",
    description: "Plan requests greatly outnumber status updates (>= 3:1)",
    met: planToStatusRatio >= 3 && planRequests >= 3,
    weight: 0.45,
    evidence: planToStatusRatio >= 3 && planRequests >= 3
      ? `${planRequests} plan requests vs ${statusUpdates} status updates (${planToStatusRatio.toFixed(1)}:1)`
      : null,
  });

  conditions.push({
    id: "frequent_plan_requests",
    description: "4+ plan requests in 21 days",
    met: planRequests >= 4,
    weight: 0.30,
    evidence: planRequests >= 4 ? `${planRequests} plan requests in 21 days` : null,
  });

  conditions.push({
    id: "goals_no_updates",
    description: "Active goals with no progress updates",
    met: activeGoalsWithNoUpdates.length >= 1,
    weight: 0.30,
    evidence: activeGoalsWithNoUpdates.length >= 1
      ? `${activeGoalsWithNoUpdates.length} active goal(s) with no recent updates`
      : null,
  });

  conditions.push({
    id: "multiple_plan_switches",
    description: "Mentions new/revised plans 2+ times",
    met: multiplePlans >= 2,
    weight: 0.25,
    evidence: multiplePlans >= 2 ? `${multiplePlans} references to plan changes` : null,
  });

  conditions.push({
    id: "zero_completions",
    description: "No completion reports despite active planning",
    met: planRequests >= 2 && countByIntent(messages21d, "progress_report") === 0,
    weight: 0.20,
    evidence: planRequests >= 2 && countByIntent(messages21d, "progress_report") === 0
      ? "0 completion/progress reports alongside active planning"
      : null,
  });

  const confidence = conditions.filter((c) => c.met).reduce((sum, c) => sum + c.weight, 0);
  conditions.filter((c) => c.met && c.evidence).forEach((c) => c.evidence && evidence.push(c.evidence));

  return {
    id: def.id,
    detected: confidence >= def.minConfidence,
    confidence: Math.min(confidence, 1),
    severity: computeSeverity(confidence, def, input.state),
    evidence,
    conditions,
    recommendation: def.recommendation,
  };
}

function detectTutorialHell(input: DetectionInput): DetectionResult {
  const def = DEFINITIONS.tutorial_hell;
  const conditions: TriggerCondition[] = [];
  const evidence: string[] = [];

  const messages30d = userMessagesInDays(input.userMessages, 30, input.now);
  const tutorialMentions  = matchCount(messages30d, TUTORIAL_HELL_PATTERNS);
  const practicalUpdates  = messages30d.filter((m) =>
    /\b(built|created|made|wrote|solved|completed|finished (the|a|my) (project|app|solution|challenge|problem)|submitted|deployed|shipped)\b/i.test(m.text)
  ).length;

  // Study/coding goal but no practical output
  const hasLearningGoal = input.goals.some((g) =>
    /\b(learn|study|dsa|coding|course|master|understand|programming)\b/i.test(g.title)
  );
  const oldLearningGoal = input.goals.find((g) =>
    /\b(learn|study|dsa|coding|course|master|understand|programming)\b/i.test(g.title) &&
    daysSince(g.createdAt, input.now) >= 21
  );

  const "afterIFinish" = messages30d.filter((m) =>
    /\b(after (i finish|completing|this course|i'm done).{0,50}(i'?ll? (start|begin|practice|build|do)))\b/i.test(m.text)
  ).length;

  conditions.push({
    id: "tutorial_mentions_high",
    description: "4+ messages about watching/completing courses without output",
    met: tutorialMentions >= 4,
    weight: 0.40,
    evidence: tutorialMentions >= 4 ? `${tutorialMentions} course/tutorial consumption messages in 30 days` : null,
  });

  conditions.push({
    id: "tutorial_mentions_medium",
    description: "2–3 messages about watching/completing courses",
    met: tutorialMentions >= 2 && tutorialMentions < 4,
    weight: 0.25,
    evidence: tutorialMentions >= 2 && tutorialMentions < 4 ? `${tutorialMentions} course/tutorial messages in 30 days` : null,
  });

  conditions.push({
    id: "no_practical_output",
    description: "Learning goal active but no practical completion reported",
    met: hasLearningGoal && practicalUpdates === 0,
    weight: 0.35,
    evidence: hasLearningGoal && practicalUpdates === 0
      ? "Active learning goal with 0 practical build/solve completions reported"
      : null,
  });

  conditions.push({
    id: "after_i_finish_language",
    description: "'After I finish X, I'll start Y' deferral pattern",
    met: afterIFinish >= 2,
    weight: 0.30,
    evidence: afterIFinish >= 2 ? `${afterIFinish} 'after I finish X' deferrals in 30 days` : null,
  });

  conditions.push({
    id: "old_learning_goal_no_output",
    description: "Learning goal > 21 days old with no project/output",
    met: !!oldLearningGoal && practicalUpdates === 0,
    weight: 0.25,
    evidence: oldLearningGoal && practicalUpdates === 0
      ? `'${oldLearningGoal.title}' goal is ${daysSince(oldLearningGoal.createdAt, input.now)} days old, 0 output`
      : null,
  });

  const confidence = conditions.filter((c) => c.met).reduce((sum, c) => sum + c.weight, 0);
  conditions.filter((c) => c.met && c.evidence).forEach((c) => c.evidence && evidence.push(c.evidence));

  return {
    id: def.id,
    detected: confidence >= def.minConfidence,
    confidence: Math.min(confidence, 1),
    severity: computeSeverity(confidence, def, input.state),
    evidence,
    conditions,
    recommendation: def.recommendation,
  };
}

function detectPerfectionism(input: DetectionInput): DetectionResult {
  const def = DEFINITIONS.perfectionism;
  const conditions: TriggerCondition[] = [];
  const evidence: string[] = [];

  const messages21d = userMessagesInDays(input.userMessages, 21, input.now);
  const perfMatches = matchCount(messages21d, PERFECTIONISM_PATTERNS);
  const planRequests = countByIntent(messages21d, "plan_request");
  const statusUpdates = countByIntent(messages21d, "status_update") + countByIntent(messages21d, "progress_report");

  const goalsNeverStarted = input.goals.filter((g) => {
    if (g.status !== "active") return false;
    const age = daysSince(g.createdAt, input.now);
    if (age < 14) return false;
    const mentions = messages21d.filter(
      (m) => m.intent === "status_update" || m.intent === "progress_report"
    ).length;
    return mentions === 0;
  });

  conditions.push({
    id: "delay_language_high",
    description: "3+ messages with 'not ready / once I / waiting until' language",
    met: perfMatches >= 3,
    weight: 0.45,
    evidence: perfMatches >= 3 ? `${perfMatches} perfectionist-delay messages in 21 days` : null,
  });

  conditions.push({
    id: "delay_language_medium",
    description: "1–2 messages with perfectionist-delay language",
    met: perfMatches >= 1 && perfMatches < 3,
    weight: 0.25,
    evidence: perfMatches >= 1 && perfMatches < 3 ? `${perfMatches} perfectionist-delay messages in 21 days` : null,
  });

  conditions.push({
    id: "plan_no_execution",
    description: "Plan requests without execution: ratio >= 3:1",
    met: planRequests >= 2 && statusUpdates === 0,
    weight: 0.35,
    evidence: planRequests >= 2 && statusUpdates === 0
      ? `${planRequests} plan requests, 0 execution reports`
      : null,
  });

  conditions.push({
    id: "goal_never_started",
    description: "Active goal > 14 days with zero execution",
    met: goalsNeverStarted.length >= 1,
    weight: 0.30,
    evidence: goalsNeverStarted.length >= 1
      ? `${goalsNeverStarted.length} goal(s) not started despite being 14+ days old`
      : null,
  });

  conditions.push({
    id: "low_discipline",
    description: "Discipline score below 35",
    met: input.state.discipline < 35,
    weight: 0.15,
    evidence: input.state.discipline < 35 ? `Discipline score: ${input.state.discipline}` : null,
  });

  const confidence = conditions.filter((c) => c.met).reduce((sum, c) => sum + c.weight, 0);
  conditions.filter((c) => c.met && c.evidence).forEach((c) => c.evidence && evidence.push(c.evidence));

  return {
    id: def.id,
    detected: confidence >= def.minConfidence,
    confidence: Math.min(confidence, 1),
    severity: computeSeverity(confidence, def, input.state),
    evidence,
    conditions,
    recommendation: def.recommendation,
  };
}

function detectRestartCycle(input: DetectionInput): DetectionResult {
  const def = DEFINITIONS.restart_cycle;
  const conditions: TriggerCondition[] = [];
  const evidence: string[] = [];

  const messages30d    = userMessagesInDays(input.userMessages, 30, input.now);
  const restartMatches = matchCount(messages30d, RESTART_CYCLE_PATTERNS);

  const abandonedGoals  = input.goals.filter((g) => g.status === "abandoned").length;
  const completedGoals  = input.goals.filter((g) => g.status === "completed").length;
  const totalGoals      = input.goals.length;

  // Same goal title set more than once (normalize to first 20 chars)
  const goalTitles = input.goals.map((g) => g.title.toLowerCase().slice(0, 20).trim());
  const uniqueTitles = new Set(goalTitles);
  const duplicateGoals = goalTitles.length - uniqueTitles.size;

  // Average lifetime of abandoned goals
  const avgAbandonDays = (() => {
    const abandoned = input.goals.filter((g) => g.status === "abandoned");
    if (abandoned.length === 0) return null;
    const avg = abandoned.reduce((sum, g) => sum + daysSince(g.createdAt, g.updatedAt), 0) / abandoned.length;
    return avg;
  })();

  conditions.push({
    id: "restart_language",
    description: "2+ 'starting fresh / reset / from scratch' messages",
    met: restartMatches >= 2,
    weight: 0.45,
    evidence: restartMatches >= 2 ? `${restartMatches} restart-language messages in 30 days` : null,
  });

  conditions.push({
    id: "more_abandoned_than_completed",
    description: "Abandoned goals outnumber completed goals",
    met: abandonedGoals >= 2 && abandonedGoals >= completedGoals,
    weight: 0.35,
    evidence: abandonedGoals >= 2 && abandonedGoals >= completedGoals
      ? `${abandonedGoals} goals abandoned vs ${completedGoals} completed`
      : null,
  });

  conditions.push({
    id: "duplicate_goals",
    description: "Same goal set 2+ times",
    met: duplicateGoals >= 1,
    weight: 0.35,
    evidence: duplicateGoals >= 1 ? `${duplicateGoals} goal(s) appear multiple times (same goal reset)` : null,
  });

  conditions.push({
    id: "quick_abandonment",
    description: "Average goal lifetime before abandonment < 10 days",
    met: avgAbandonDays !== null && avgAbandonDays < 10,
    weight: 0.25,
    evidence: avgAbandonDays !== null && avgAbandonDays < 10
      ? `Average goal abandoned after ${avgAbandonDays.toFixed(1)} days`
      : null,
  });

  conditions.push({
    id: "high_goal_churn",
    description: "3+ goals set with low completion rate",
    met: totalGoals >= 3 && (completedGoals / Math.max(totalGoals, 1)) < 0.2,
    weight: 0.20,
    evidence: totalGoals >= 3 && (completedGoals / Math.max(totalGoals, 1)) < 0.2
      ? `${totalGoals} goals set, ${completedGoals} completed (${Math.round((completedGoals / totalGoals) * 100)}% rate)`
      : null,
  });

  const confidence = conditions.filter((c) => c.met).reduce((sum, c) => sum + c.weight, 0);
  conditions.filter((c) => c.met && c.evidence).forEach((c) => c.evidence && evidence.push(c.evidence));

  return {
    id: def.id,
    detected: confidence >= def.minConfidence,
    confidence: Math.min(confidence, 1),
    severity: computeSeverity(confidence, def, input.state),
    evidence,
    conditions,
    recommendation: def.recommendation,
  };
}

function detectBurnout(input: DetectionInput): DetectionResult {
  const def = DEFINITIONS.burnout;
  const conditions: TriggerCondition[] = [];
  const evidence: string[] = [];

  const messages14d = userMessagesInDays(input.userMessages, 14, input.now);
  const burnoutLang  = messages14d.filter((m) =>
    /\b(can'?t (anymore|do this|keep going|function|even)|completely (done|over it|exhausted|drained)|i give (up|in)|what'?s the point)\b/i.test(m.text)
  ).length;

  const energyConstraintMessages = messages14d.filter((m) =>
    /\b(burnout|burnt? out|exhausted|no energy|drained|so tired|can'?t (function|even|cope))\b/i.test(m.text)
  ).length;

  conditions.push({
    id: "burnout_risk_critical",
    description: "burnoutRisk score above 80",
    met: input.state.burnoutRisk > 80,
    weight: 0.55,
    evidence: input.state.burnoutRisk > 80 ? `burnoutRisk: ${input.state.burnoutRisk}` : null,
  });

  conditions.push({
    id: "burnout_risk_high",
    description: "burnoutRisk score 65–80",
    met: input.state.burnoutRisk >= 65 && input.state.burnoutRisk <= 80,
    weight: 0.35,
    evidence: input.state.burnoutRisk >= 65 && input.state.burnoutRisk <= 80 ? `burnoutRisk: ${input.state.burnoutRisk}` : null,
  });

  conditions.push({
    id: "high_stress",
    description: "Stress score above 70",
    met: input.state.stress > 70,
    weight: 0.25,
    evidence: input.state.stress > 70 ? `Stress score: ${input.state.stress}` : null,
  });

  conditions.push({
    id: "consecutive_misses",
    description: "4+ consecutive missed commitments",
    met: input.state.consecutiveMisses >= 4,
    weight: 0.25,
    evidence: input.state.consecutiveMisses >= 4 ? `${input.state.consecutiveMisses} consecutive misses` : null,
  });

  conditions.push({
    id: "burnout_language",
    description: "2+ burnout-language messages in 14 days",
    met: burnoutLang >= 2,
    weight: 0.25,
    evidence: burnoutLang >= 2 ? `${burnoutLang} burnout-language messages` : null,
  });

  conditions.push({
    id: "energy_constraint_messages",
    description: "3+ energy/exhaustion constraint messages",
    met: energyConstraintMessages >= 3,
    weight: 0.20,
    evidence: energyConstraintMessages >= 3 ? `${energyConstraintMessages} energy/exhaustion messages in 14 days` : null,
  });

  conditions.push({
    id: "state_flag_burnout",
    description: "burnout_risk_high or burnout_risk_critical flag active",
    met: input.state.flags.includes("burnout_risk_high") || input.state.flags.includes("burnout_risk_critical"),
    weight: 0.20,
    evidence: input.state.flags.includes("burnout_risk_critical")
      ? "State flag: burnout_risk_critical"
      : input.state.flags.includes("burnout_risk_high")
      ? "State flag: burnout_risk_high"
      : null,
  });

  const confidence = conditions.filter((c) => c.met).reduce((sum, c) => sum + c.weight, 0);
  conditions.filter((c) => c.met && c.evidence).forEach((c) => c.evidence && evidence.push(c.evidence));

  return {
    id: def.id,
    detected: confidence >= def.minConfidence,
    confidence: Math.min(confidence, 1),
    severity: computeSeverity(confidence, def, input.state),
    evidence,
    conditions,
    recommendation: def.recommendation,
  };
}

function detectAllOrNothing(input: DetectionInput): DetectionResult {
  const def = DEFINITIONS.all_or_nothing;
  const conditions: TriggerCondition[] = [];
  const evidence: string[] = [];

  const messages21d  = userMessagesInDays(input.userMessages, 21, input.now);
  const aonMatches   = matchCount(messages21d, ALL_OR_NOTHING_PATTERNS);
  const restartAfterFailure = (() => {
    let count = 0;
    for (let i = 0; i < messages21d.length - 1; i++) {
      const curr = messages21d[i];
      const next = messages21d[i + 1];
      if (!curr || !next) continue;
      const currIsFailure = curr.intent === "failure_report";
      const nextIsRestart = next.intent === "goal_set" &&
        matchesAny(next.text, RESTART_CYCLE_PATTERNS);
      const sameDay = daysSince(curr.createdAt, next.createdAt) < 2;
      if (currIsFailure && nextIsRestart && sameDay) count++;
    }
    return count;
  })();

  const catastrophizeCount = messages21d.filter((m) =>
    /\b(completely|totally|entirely|absolutely|utterly)\b.{0,20}\b(failed|given up|ruined|destroyed|lost|over)\b/i.test(m.text)
  ).length;

  conditions.push({
    id: "aon_language",
    description: "2+ all-or-nothing language messages",
    met: aonMatches >= 2,
    weight: 0.45,
    evidence: aonMatches >= 2 ? `${aonMatches} all-or-nothing messages in 21 days` : null,
  });

  conditions.push({
    id: "aon_language_single",
    description: "1 all-or-nothing language message",
    met: aonMatches === 1,
    weight: 0.25,
    evidence: aonMatches === 1 ? "All-or-nothing language detected" : null,
  });

  conditions.push({
    id: "restart_after_failure",
    description: "Requests restart within 48h of failure report",
    met: restartAfterFailure >= 1,
    weight: 0.40,
    evidence: restartAfterFailure >= 1
      ? `${restartAfterFailure} restart request(s) immediately following failure reports`
      : null,
  });

  conditions.push({
    id: "catastrophizing",
    description: "Uses extreme/absolute language for minor setbacks",
    met: catastrophizeCount >= 2,
    weight: 0.25,
    evidence: catastrophizeCount >= 2
      ? `${catastrophizeCount} catastrophizing messages (completely failed/totally ruined)`
      : null,
  });

  conditions.push({
    id: "low_consistency_high_starts",
    description: "Multiple goal sets but low consistency (pattern of starting/stopping)",
    met: input.state.consistency < 40 && countByIntent(messages21d, "goal_set") >= 3,
    weight: 0.20,
    evidence: input.state.consistency < 40 && countByIntent(messages21d, "goal_set") >= 3
      ? `${countByIntent(messages21d, "goal_set")} goal sets with consistency score ${input.state.consistency}`
      : null,
  });

  const confidence = conditions.filter((c) => c.met).reduce((sum, c) => sum + c.weight, 0);
  conditions.filter((c) => c.met && c.evidence).forEach((c) => c.evidence && evidence.push(c.evidence));

  return {
    id: def.id,
    detected: confidence >= def.minConfidence,
    confidence: Math.min(confidence, 1),
    severity: computeSeverity(confidence, def, input.state),
    evidence,
    conditions,
    recommendation: def.recommendation,
  };
}

function detectSubjectAvoidance(input: DetectionInput): DetectionResult {
  const def = DEFINITIONS.subject_avoidance;
  const conditions: TriggerCondition[] = [];
  const evidence: string[] = [];

  const messages21d = userMessagesInDays(input.userMessages, 21, input.now);

  // Find goals that are old enough to have updates but have none
  const avoidedGoals = input.goals.filter((g) => {
    if (g.status !== "active") return false;
    const age = daysSince(g.createdAt, input.now);
    if (age < 14) return false;

    // Look for any mention of this goal's domain in recent messages
    const goalKeywords = g.title
      .toLowerCase()
      .replace(/[^\w\s]/g, "")
      .split(/\s+/)
      .filter((w) => w.length >= 4);

    const mentionCount = messages21d.filter((m) =>
      goalKeywords.some((kw) => m.text.toLowerCase().includes(kw))
    ).length;

    return mentionCount === 0;
  });

  // Check if user is active in OTHER domains (engaged but selectively absent)
  const totalRecentMessages = messages21d.length;
  const hasOtherEngagement = totalRecentMessages >= 5;

  // Detect topic absence: goal exists but no status_update about it
  const statusUpdatesTotal = countByIntent(messages21d, "status_update") + countByIntent(messages21d, "progress_report");
  const goalsWithMissingUpdates = input.goals.filter((g) => {
    if (g.status !== "active" || daysSince(g.createdAt, input.now) < 14) return false;
    return true;
  });

  conditions.push({
    id: "active_goal_no_mention",
    description: "Active goal (14+ days) with 0 mentions in last 21 days",
    met: avoidedGoals.length >= 1,
    weight: 0.50,
    evidence: avoidedGoals.length >= 1
      ? `${avoidedGoals.length} goal(s) not mentioned in 21 days: "${avoidedGoals[0]?.title ?? ""}"`
      : null,
  });

  conditions.push({
    id: "active_in_other_areas",
    description: "User is active overall (not just absent)",
    met: hasOtherEngagement,
    weight: 0.20,
    evidence: hasOtherEngagement ? `${totalRecentMessages} total messages in 21 days` : null,
  });

  conditions.push({
    id: "no_progress_on_old_goals",
    description: "0 progress reports despite having old active goals",
    met: goalsWithMissingUpdates.length >= 1 && statusUpdatesTotal === 0,
    weight: 0.30,
    evidence: goalsWithMissingUpdates.length >= 1 && statusUpdatesTotal === 0
      ? `${goalsWithMissingUpdates.length} active goal(s) with 0 progress reports`
      : null,
  });

  conditions.push({
    id: "multiple_avoided_goals",
    description: "2+ goals systematically avoided",
    met: avoidedGoals.length >= 2,
    weight: 0.20,
    evidence: avoidedGoals.length >= 2
      ? `${avoidedGoals.length} goals avoided: ${avoidedGoals.slice(0, 2).map((g) => `"${g.title}"`).join(", ")}`
      : null,
  });

  const confidence = conditions.filter((c) => c.met).reduce((sum, c) => sum + c.weight, 0);
  conditions.filter((c) => c.met && c.evidence).forEach((c) => c.evidence && evidence.push(c.evidence));

  return {
    id: def.id,
    detected: confidence >= def.minConfidence,
    confidence: Math.min(confidence, 1),
    severity: computeSeverity(confidence, def, input.state),
    evidence,
    conditions,
    recommendation: def.recommendation,
  };
}

function detectComparisonTrap(input: DetectionInput): DetectionResult {
  const def = DEFINITIONS.comparison_trap;
  const conditions: TriggerCondition[] = [];
  const evidence: string[] = [];

  const messages21d      = userMessagesInDays(input.userMessages, 21, input.now);
  const comparisonCount  = matchCount(messages21d, COMPARISON_PATTERNS);
  const discouragedAfterComparison = messages21d.filter((m, i) => {
    const hasCmp = matchesAny(m.text, COMPARISON_PATTERNS);
    if (!hasCmp) return false;
    const nextMsg = messages21d[i + 1];
    return nextMsg && ["discouraged", "frustrated", "guilty"].includes(nextMsg.emotion ?? "");
  }).length;

  // Detect unrealistic goal timelines (very short horizon goals set after comparison)
  const shortHorizonGoals = input.goals.filter((g) => {
    const age = daysSince(g.createdAt, input.now);
    if (age > 21) return false;
    return /\b(in|within|by) (1|2|3|4|5|6|7|8|9|10|14|30) (days?|weeks?)\b/i.test(g.title);
  });

  const socialPressureMessages = messages21d.filter((m) =>
    /\b(behind|falling behind|catching up|catch up|everyone|others?|batchmates?|classmates?|peers?)\b/i.test(m.text)
  ).length;

  conditions.push({
    id: "comparison_language_high",
    description: "3+ comparison messages in 21 days",
    met: comparisonCount >= 3,
    weight: 0.50,
    evidence: comparisonCount >= 3 ? `${comparisonCount} comparison messages in 21 days` : null,
  });

  conditions.push({
    id: "comparison_language_medium",
    description: "1–2 comparison messages in 21 days",
    met: comparisonCount >= 1 && comparisonCount < 3,
    weight: 0.25,
    evidence: comparisonCount >= 1 && comparisonCount < 3 ? `${comparisonCount} comparison message(s) in 21 days` : null,
  });

  conditions.push({
    id: "discouragement_after_comparison",
    description: "Discouragement follows comparison in conversation",
    met: discouragedAfterComparison >= 1,
    weight: 0.35,
    evidence: discouragedAfterComparison >= 1
      ? `${discouragedAfterComparison} instance(s) of discouragement following comparison`
      : null,
  });

  conditions.push({
    id: "social_pressure_language",
    description: "4+ messages with 'behind / catching up / everyone ahead' language",
    met: socialPressureMessages >= 4,
    weight: 0.25,
    evidence: socialPressureMessages >= 4
      ? `${socialPressureMessages} 'falling behind' / social pressure messages`
      : null,
  });

  conditions.push({
    id: "unrealistic_timeline_goal",
    description: "Short-deadline goal set after comparison (catching-up timeline)",
    met: shortHorizonGoals.length >= 1,
    weight: 0.25,
    evidence: shortHorizonGoals.length >= 1
      ? `${shortHorizonGoals.length} unrealistically short goal timeline(s) set recently`
      : null,
  });

  conditions.push({
    id: "low_confidence_with_comparison",
    description: "Low confidence score co-occurring with comparison pattern",
    met: comparisonCount >= 1 && input.state.confidence < 45,
    weight: 0.20,
    evidence: comparisonCount >= 1 && input.state.confidence < 45
      ? `Confidence score ${input.state.confidence} with active comparison pattern`
      : null,
  });

  const confidence = conditions.filter((c) => c.met).reduce((sum, c) => sum + c.weight, 0);
  conditions.filter((c) => c.met && c.evidence).forEach((c) => c.evidence && evidence.push(c.evidence));

  return {
    id: def.id,
    detected: confidence >= def.minConfidence,
    confidence: Math.min(confidence, 1),
    severity: computeSeverity(confidence, def, input.state),
    evidence,
    conditions,
    recommendation: def.recommendation,
  };
}

// ── Persistence ───────────────────────────────────────────────────────────────

async function persistDetectedPatterns(
  userId: string,
  results: DetectionResult[],
  now: Date
): Promise<void> {
  const toUpsert = results.filter((r) => r.detected);
  if (toUpsert.length === 0) return;

  await prisma.$transaction(
    toUpsert.map((r) => {
      const payload = JSON.stringify({
        severity:     r.severity,
        confidence:   r.confidence,
        evidence:     r.evidence,
        updatedAt:    now.toISOString(),
        occurrences:  1,
      });

      return prisma.memoryFact.upsert({
        where: {
          // Prisma doesn't have unique on (userId, type, key) — use findFirst workaround
          // We treat this as a create-or-skip; the load step above re-reads current state
          id: `pattern_${userId}_${r.id}`,
        },
        update: { value: payload, confidence: r.confidence, updatedAt: now },
        create: {
          id: `pattern_${userId}_${r.id}`,
          userId,
          type: "detected_pattern",
          key: r.id,
          value: payload,
          confidence: r.confidence,
        },
      });
    })
  );
}

// ── Data loading ──────────────────────────────────────────────────────────────

async function loadDetectionInput(
  platformChatId: string,
  now: Date
): Promise<DetectionInput | null> {
  const user = await prisma.messengerUser.findUnique({
    where: {
      platform_platformChatId: { platform: "telegram", platformChatId },
    },
    select: {
      id: true,
      createdAt: true,
      messages: {
        orderBy: { createdAt: "desc" },
        take: 250,
        select: {
          role: true,
          text: true,
          intent: true,
          emotion: true,
          createdAt: true,
        },
      },
      goals: {
        orderBy: { createdAt: "desc" },
        select: {
          title: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      memories: {
        where: { type: "detected_pattern" },
        select: {
          id: true,
          key: true,
          value: true,
          confidence: true,
          createdAt: true,
        },
      },
    },
  });

  if (!user) return null;

  const state = await getMentorState(platformChatId);

  const previousPatterns: StoredPattern[] = user.memories.map((m) => {
    let parsed: { severity?: string; occurrences?: number } = {};
    try { parsed = JSON.parse(m.value); } catch { /* ignore */ }
    return {
      id: m.key,
      confidence: m.confidence,
      severity: parsed.severity ?? "emerging",
      firstSeenAt: m.createdAt,
      occurrences: parsed.occurrences ?? 1,
    };
  });

  const allMessages = user.messages as RawMessage[];
  const userMessages = allMessages.filter((m) => m.role === "user");

  return {
    userId: user.id,
    platformChatId,
    userMessages,
    allMessages,
    goals: user.goals,
    state,
    previousPatterns,
    daysSinceFirstMessage: Math.floor(
      (now.getTime() - user.createdAt.getTime()) / 86_400_000
    ),
    now,
  };
}

// ── Build final PatternAnalysis output ────────────────────────────────────────

function buildAnalysis(
  results: DetectionResult[],
  detected: DetectionResult[],
  state: MentorState,
  now: Date
): PatternAnalysis {
  const patterns: DetectedPattern[] = detected.map((r) => ({
    type: PATTERN_TYPE_MAP[r.id],
    severity: r.severity,
    occurrences: 1,
    firstDetectedAt: now,
    lastSeenAt: now,
    evidence: r.evidence,
    confidenceScore: parseFloat(r.confidence.toFixed(3)),
    recommendation: r.recommendation,
  }));

  const dominant = detected.sort((a, b) => b.confidence - a.confidence)[0] ?? null;

  // Risk score: weighted average of detected pattern confidences
  const riskScore =
    detected.length === 0
      ? 0
      : Math.round(
          (detected.reduce((sum, r) => sum + r.confidence * 100, 0) / detected.length) *
            (1 + (detected.length - 1) * 0.1) // more patterns = higher risk
        );

  const positivePatterns: string[] = [];
  if (state.streakDays >= 7)   positivePatterns.push(`Active streak: ${state.streakDays} days`);
  if (state.consistency >= 65) positivePatterns.push(`Strong consistency: ${state.consistency}/100`);
  if (state.momentum    >= 65) positivePatterns.push(`Building momentum: ${state.momentum}/100`);
  if (state.discipline  >= 65) positivePatterns.push(`High discipline: ${state.discipline}/100`);

  const insights: string[] = detected.map(
    (r) => `${DEFINITIONS[r.id].name} detected (confidence: ${(r.confidence * 100).toFixed(0)}%): ${r.evidence[0] ?? "see evidence"}`
  );

  return {
    patterns,
    dominantPattern: dominant
      ? patterns.find((p) => p.type === PATTERN_TYPE_MAP[dominant.id]) ?? null
      : null,
    riskScore: Math.min(riskScore, 100),
    positivePatterns,
    insights,
  };
}

function emptyAnalysis(): PatternAnalysis {
  return {
    patterns: [],
    dominantPattern: null,
    riskScore: 0,
    positivePatterns: [],
    insights: [],
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Primary entry point — detects all 11 patterns for a user.
 * Reads message history, goals, and current state.
 * Persists detected patterns for trend tracking.
 * Returns PatternAnalysis for use by the mentor-decision-engine.
 */
export async function detectPatterns(platformChatId: string): Promise<PatternAnalysis> {
  const now = new Date();
  const input = await loadDetectionInput(platformChatId, now);
  if (!input) return emptyAnalysis();

  // Need at least 3 days of history to detect patterns meaningfully
  if (input.daysSinceFirstMessage < 3 && input.userMessages.length < 5) {
    return emptyAnalysis();
  }

  const results: DetectionResult[] = [
    detectGhosting(input),
    detectMotivationCrash(input),
    detectExcuseLoop(input),
    detectOverplanning(input),
    detectTutorialHell(input),
    detectPerfectionism(input),
    detectRestartCycle(input),
    detectBurnout(input),
    detectAllOrNothing(input),
    detectSubjectAvoidance(input),
    detectComparisonTrap(input),
  ];

  const detected = results.filter(
    (r) => r.detected && r.confidence >= DEFINITIONS[r.id].minConfidence
  );

  if (detected.length > 0) {
    await persistDetectedPatterns(input.userId, detected, now).catch((err) =>
      console.error("[PATTERN] Failed to persist patterns:", err)
    );
  }

  console.log(
    `[PATTERN] ${platformChatId}: checked 11 patterns, detected ${detected.length} ` +
    `(${detected.map((r) => `${DEFINITIONS[r.id].name}:${(r.confidence * 100).toFixed(0)}%`).join(", ") || "none"})`
  );

  return buildAnalysis(results, detected, input.state, now);
}

/**
 * Pure detection — no DB reads or writes.
 * Used in tests and when input is already loaded.
 */
export function detectPatternsFromInput(input: DetectionInput): PatternAnalysis {
  const results: DetectionResult[] = [
    detectGhosting(input),
    detectMotivationCrash(input),
    detectExcuseLoop(input),
    detectOverplanning(input),
    detectTutorialHell(input),
    detectPerfectionism(input),
    detectRestartCycle(input),
    detectBurnout(input),
    detectAllOrNothing(input),
    detectSubjectAvoidance(input),
    detectComparisonTrap(input),
  ];

  const detected = results.filter(
    (r) => r.detected && r.confidence >= DEFINITIONS[r.id].minConfidence
  );

  return buildAnalysis(results, detected, input.state, input.now);
}

/**
 * Returns the definition metadata (name, description, examples) for a given pattern.
 * Used by the mentor-decision-engine to construct confrontation messages.
 */
export function getPatternDefinition(id: PatternId): PatternDefinition {
  return DEFINITIONS[id];
}

/**
 * Returns all pattern definitions — used by the LLM layer to understand
 * which patterns to reference when explaining behaviour.
 */
export function getAllPatternDefinitions(): PatternDefinition[] {
  return Object.values(DEFINITIONS);
}
