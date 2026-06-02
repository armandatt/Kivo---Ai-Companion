import { prisma } from "@repo/db/client";
import type { ConversationAnalysis, EmotionType, ConstraintType } from "../types/mentor.types";
import type { UserStateFlag } from "../types/state.types";

// ── Internal state flag (more granular than UserStateFlag) ───────────────────

export type StateFlag =
  | "high_stress"
  | "burnout_risk_high"
  | "burnout_risk_critical"
  | "low_capacity"
  | "low_motivation"
  | "low_confidence"
  | "streak_at_risk"
  | "streak_broken"
  | "momentum_building"
  | "momentum_collapsed"
  | "consistency_strong"
  | "consistency_collapsed"
  | "overcommitted"
  | "comeback"
  | "peak_performance"
  | "first_week"
  | "returning_after_gap"
  | "avoidance_pattern_active"
  | "disengaged";

// ── Scores (0-100) ────────────────────────────────────────────────────────────

export type ScorableField =
  | "motivation"
  | "consistency"
  | "stress"
  | "confidence"
  | "discipline"
  | "momentum"
  | "burnoutRisk";

export interface MentorScores {
  motivation: number;    // drive, desire to act
  consistency: number;   // track record of following through
  stress: number;        // current load (higher = worse)
  confidence: number;    // belief in own ability
  discipline: number;    // structured self-control
  momentum: number;      // recent trajectory
  burnoutRisk: number;   // risk of dropout (higher = worse)
  capacity: number;      // derived: available bandwidth right now
}

export interface MentorState extends MentorScores {
  streakDays: number;
  longestStreak: number;
  consecutiveMisses: number;
  totalCommitmentsMade: number;
  totalCommitmentsKept: number;
  lastUpdatedAt: Date;
  lastActivityAt: Date | null;
  daysSinceFirstSession: number;
  flags: StateFlag[];
  momentum7dTrend: number[];
  version: number;
}

// ── Commitment event ──────────────────────────────────────────────────────────

export type CommitmentOutcome = "kept" | "missed" | "excused" | "partial";

export interface CommitmentEvent {
  outcome: CommitmentOutcome;
  isConsecutiveMiss: boolean;
  streakBroken: boolean;
  streakMilestone: number | null;
}

// ── Update input/output ───────────────────────────────────────────────────────

export interface StateUpdateInput {
  analysis: ConversationAnalysis;
  commitmentEvent?: CommitmentEvent;
}

export interface StateDeltaEntry {
  field: ScorableField;
  delta: number;
  reason: string;
  trigger:
    | "emotion_signal"
    | "intent_signal"
    | "commitment_language"
    | "constraint_detected"
    | "urgency_signal"
    | "commitment_outcome"
    | "streak_milestone"
    | "streak_growth"
    | "streak_break"
    | "consecutive_failure"
    | "burnout_signal"
    | "pattern_detection"
    | "decay";
}

export interface StateUpdateResult {
  previous: MentorState;
  updated: MentorState;
  deltas: StateDeltaEntry[];
  newFlags: StateFlag[];
  resolvedFlags: StateFlag[];
  significantChange: boolean;
  summary: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SCORE_MIN = 0;
const SCORE_MAX = 100;

const BASELINE: Record<ScorableField, number> = {
  motivation: 55,
  consistency: 50,
  stress: 20,
  confidence: 60,
  discipline: 50,
  momentum: 50,
  burnoutRisk: 10,
};

// How many points each score decays toward baseline per inactive day
const DECAY_RATES: Record<ScorableField, number> = {
  motivation: 2.0,
  consistency: 1.0,
  stress: 4.0,       // stress naturally reduces with rest
  confidence: 1.0,
  discipline: 1.5,
  momentum: 6.0,     // momentum is highly time-sensitive
  burnoutRisk: 2.5,  // burnout reduces with inactivity
};

const STREAK_MILESTONES = [3, 7, 14, 21, 30, 60, 90] as const;

// Emotion → score deltas (applied at full intensity=1.0)
const EMOTION_DELTAS: Partial<Record<EmotionType, Partial<Record<ScorableField, number>>>> = {
  motivated:    { motivation: +12, confidence: +5,  burnoutRisk: -5  },
  determined:   { motivation: +10, discipline: +8,  stress: -5        },
  proud:        { confidence: +10, motivation: +8,  momentum: +10     },
  hopeful:      { motivation: +6,  confidence: +4                     },
  frustrated:   { stress: +8,      burnoutRisk: +5, motivation: -5   },
  overwhelmed:  { stress: +15,     burnoutRisk: +10, motivation: -8  },
  discouraged:  { confidence: -12, motivation: -10, momentum: -8     },
  avoidant:     { consistency: -5, discipline: -8,  momentum: -6     },
  defensive:    { stress: +5,      confidence: -5                     },
  guilty:       { motivation: -5,  confidence: -8                     },
  anxious:      { stress: +10,     burnoutRisk: +8                    },
  stressed:     { stress: +12,     burnoutRisk: +8, discipline: -5   },
  confused:     { motivation: -3                                       },
  neutral:      {},
};

// Constraint type → base stress delta and base capacity penalty (at moderate severity, not temporary)
const CONSTRAINT_STRESS: Record<ConstraintType, number> = {
  time:                  8,
  energy:               10,
  injury:                6,
  burnout:              20,
  work_pressure:        10,
  exam_season:          12,
  family_responsibility: 8,
  financial:             8,
  mental_health:        15,
  social_pressure:       6,
  environment:           5,
};

// Which constraints also raise burnoutRisk directly and by how much
const CONSTRAINT_BURNOUT_DELTA: Partial<Record<ConstraintType, number>> = {
  burnout:       25,
  mental_health: 15,
  energy:        10,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(value: number, min = SCORE_MIN, max = SCORE_MAX): number {
  return Math.max(min, Math.min(max, value));
}

function round1(n: number): number {
  return parseFloat(n.toFixed(1));
}

// ── Pure: conversation delta computation ─────────────────────────────────────

function computeConversationDeltas(
  analysis: ConversationAnalysis,
  current: MentorState
): StateDeltaEntry[] {
  const deltas: StateDeltaEntry[] = [];

  // ── Primary emotion ───────────────────────────────────────────────────────
  const emotionMap = EMOTION_DELTAS[analysis.emotion.primary];
  if (emotionMap) {
    const scale = Math.max(0.4, analysis.emotion.intensity);
    for (const [field, raw] of Object.entries(emotionMap) as Array<[ScorableField, number]>) {
      const delta = round1(raw * scale);
      if (delta !== 0) {
        deltas.push({
          field,
          delta,
          reason: `emotion:${analysis.emotion.primary} intensity:${analysis.emotion.intensity.toFixed(2)}`,
          trigger: "emotion_signal",
        });
      }
    }
  }

  // ── Secondary emotion (30% weight) ───────────────────────────────────────
  if (analysis.emotion.secondary && analysis.emotion.secondary !== analysis.emotion.primary) {
    const secMap = EMOTION_DELTAS[analysis.emotion.secondary];
    if (secMap) {
      for (const [field, raw] of Object.entries(secMap) as Array<[ScorableField, number]>) {
        const delta = round1(raw * 0.3);
        if (delta !== 0) {
          deltas.push({
            field,
            delta,
            reason: `secondary_emotion:${analysis.emotion.secondary}`,
            trigger: "emotion_signal",
          });
        }
      }
    }
  }

  // ── Intent signals ────────────────────────────────────────────────────────
  const INTENT_DELTAS: Partial<Record<string, Partial<Record<ScorableField, number>>>> = {
    goal_set:              { motivation: +8,  momentum: +5                         },
    commitment_made:       { motivation: +6,  discipline: +5                       },
    reflection:            { confidence: +4,  stress: -3                           },
    failure_report:        { consistency: -5, momentum: -5                         },
    excuse:                { consistency: -3, discipline: -5, confidence: -3       },
    progress_report:       { motivation: +4,  confidence: +3, momentum: +5         },
    status_update:         { motivation: +2                                         },
    accountability_request:{ discipline: +5,  motivation: +3                       },
    emotional_vent:        { stress: +8,      burnoutRisk: +5, motivation: -5     },
    plan_request:          { motivation: +3                                         },
    check_in_response:     { consistency: +2, discipline: +2                       },
  };

  const intentMap = INTENT_DELTAS[analysis.intent];
  if (intentMap) {
    for (const [field, delta] of Object.entries(intentMap) as Array<[ScorableField, number]>) {
      deltas.push({
        field,
        delta,
        reason: `intent:${analysis.intent}`,
        trigger: "intent_signal",
      });
    }
  }

  // ── Commitment language strength ──────────────────────────────────────────
  const { commitmentLevel, commitmentScore } = analysis;
  if (commitmentLevel === "very_high") {
    deltas.push({ field: "motivation", delta: +10, reason: `commitment_level:very_high score:${commitmentScore.toFixed(2)}`, trigger: "commitment_language" });
    deltas.push({ field: "discipline", delta: +8,  reason: `commitment_level:very_high`, trigger: "commitment_language" });
  } else if (commitmentLevel === "high") {
    deltas.push({ field: "motivation", delta: +6,  reason: `commitment_level:high`, trigger: "commitment_language" });
    deltas.push({ field: "discipline", delta: +4,  reason: `commitment_level:high`, trigger: "commitment_language" });
  } else if (commitmentLevel === "low") {
    deltas.push({ field: "discipline", delta: -3,  reason: `commitment_level:low`, trigger: "commitment_language" });
  } else if (commitmentLevel === "none" && analysis.hasCommitment === false && analysis.intent === "commitment_made") {
    // Detected commitment intent but language was weak — inconsistency signal
    deltas.push({ field: "confidence", delta: -2, reason: "weak_commitment_language", trigger: "commitment_language" });
  }

  // ── Constraint signals ────────────────────────────────────────────────────
  for (const constraint of analysis.constraints) {
    const severityFactor = constraint.severity === "severe" ? 1.5 : constraint.severity === "mild" ? 0.5 : 1.0;
    const temporaryFactor = constraint.isTemporary ? 0.65 : 1.0;
    const factor = round1(severityFactor * temporaryFactor);

    const stressDelta = round1(CONSTRAINT_STRESS[constraint.type] * factor);
    deltas.push({
      field: "stress",
      delta: stressDelta,
      reason: `constraint:${constraint.type} severity:${constraint.severity} temporary:${constraint.isTemporary}`,
      trigger: "constraint_detected",
    });

    const burnoutBase = CONSTRAINT_BURNOUT_DELTA[constraint.type];
    if (burnoutBase !== undefined) {
      deltas.push({
        field: "burnoutRisk",
        delta: round1(burnoutBase * factor),
        reason: `constraint:${constraint.type} burnout_signal`,
        trigger: "burnout_signal",
      });
    }
  }

  // ── Urgency signal ────────────────────────────────────────────────────────
  if (analysis.urgency >= 0.8) {
    deltas.push({ field: "stress",      delta: +10, reason: `urgency:${analysis.urgency.toFixed(2)}`, trigger: "urgency_signal" });
    deltas.push({ field: "burnoutRisk", delta: +5,  reason: `urgency:${analysis.urgency.toFixed(2)}`, trigger: "urgency_signal" });
  } else if (analysis.urgency >= 0.5) {
    deltas.push({ field: "stress",      delta: +5,  reason: `urgency:${analysis.urgency.toFixed(2)}`, trigger: "urgency_signal" });
  }

  // ── Repeated failure pattern ──────────────────────────────────────────────
  if (analysis.hasFailureReport && current.consecutiveMisses >= 2) {
    const multiplier = Math.min(current.consecutiveMisses, 5);
    deltas.push({
      field: "confidence",
      delta: round1(-(3 * multiplier)),
      reason: `repeated_failure:${current.consecutiveMisses}_consecutive`,
      trigger: "pattern_detection",
    });
    deltas.push({
      field: "momentum",
      delta: round1(-(4 * multiplier)),
      reason: `repeated_failure:${current.consecutiveMisses}_consecutive`,
      trigger: "pattern_detection",
    });
  }

  // ── Excuse cycling: low consistency + excuse = weak pattern ──────────────
  if (analysis.hasExcuse && current.consistency < 40) {
    deltas.push({
      field: "confidence",
      delta: -5,
      reason: "excuse_with_low_consistency:pattern_signal",
      trigger: "pattern_detection",
    });
  }

  return deltas;
}

// ── Pure: commitment event delta computation ──────────────────────────────────

function computeCommitmentDeltas(event: CommitmentEvent, current: MentorState): StateDeltaEntry[] {
  const deltas: StateDeltaEntry[] = [];

  if (event.outcome === "kept") {
    deltas.push({ field: "consistency", delta: +5,  reason: "commitment_kept", trigger: "commitment_outcome" });
    deltas.push({ field: "confidence",  delta: +3,  reason: "commitment_kept", trigger: "commitment_outcome" });
    deltas.push({ field: "discipline",  delta: +5,  reason: "commitment_kept", trigger: "commitment_outcome" });
    deltas.push({ field: "motivation",  delta: +4,  reason: "commitment_kept", trigger: "commitment_outcome" });
    deltas.push({ field: "burnoutRisk", delta: -3,  reason: "commitment_kept", trigger: "commitment_outcome" });
    deltas.push({ field: "stress",      delta: -3,  reason: "commitment_kept", trigger: "commitment_outcome" });

    // Streak milestone bonus
    if (event.streakMilestone !== null) {
      const bonus = event.streakMilestone >= 30 ? 20 : event.streakMilestone >= 14 ? 15 : 10;
      deltas.push({ field: "momentum",    delta: +bonus,              reason: `streak_milestone:${event.streakMilestone}_days`, trigger: "streak_milestone" });
      deltas.push({ field: "confidence",  delta: +round1(bonus * 0.5), reason: `streak_milestone:${event.streakMilestone}_days`, trigger: "streak_milestone" });
      deltas.push({ field: "motivation",  delta: +round1(bonus * 0.75),reason: `streak_milestone:${event.streakMilestone}_days`, trigger: "streak_milestone" });
    } else if (current.streakDays >= 3) {
      // Gradual momentum gain for building streak: +3 per 3 days, capped at +30
      const streakBonus = Math.min(Math.floor(current.streakDays / 3) * 3, 30);
      deltas.push({
        field: "momentum",
        delta: round1(streakBonus * 0.2), // incremental portion, not total
        reason: `streak_building:day_${current.streakDays + 1}`,
        trigger: "streak_growth",
      });
    }
  } else if (event.outcome === "missed") {
    deltas.push({ field: "consistency", delta: -10, reason: "commitment_missed", trigger: "commitment_outcome" });
    deltas.push({ field: "confidence",  delta: -5,  reason: "commitment_missed", trigger: "commitment_outcome" });
    deltas.push({ field: "discipline",  delta: -5,  reason: "commitment_missed", trigger: "commitment_outcome" });

    if (event.isConsecutiveMiss) {
      const n = Math.min(current.consecutiveMisses + 1, 5);
      deltas.push({ field: "confidence",  delta: -(4 * n), reason: `consecutive_miss:${n}`, trigger: "consecutive_failure" });
      deltas.push({ field: "motivation",  delta: -(3 * n), reason: `consecutive_miss:${n}`, trigger: "consecutive_failure" });
      deltas.push({ field: "momentum",    delta: -(5 * n), reason: `consecutive_miss:${n}`, trigger: "consecutive_failure" });
    }

    if (event.streakBroken) {
      deltas.push({ field: "momentum",   delta: -20, reason: "streak_broken",  trigger: "streak_break" });
      deltas.push({ field: "motivation", delta: -10, reason: "streak_broken",  trigger: "streak_break" });
    }

    // Burnout risk rises with sustained failure
    if (current.consecutiveMisses >= 2) {
      deltas.push({
        field: "burnoutRisk",
        delta: +15,
        reason: `burnout_signal:${current.consecutiveMisses + 1}_consecutive_misses`,
        trigger: "burnout_signal",
      });
    }
  } else if (event.outcome === "excused") {
    deltas.push({ field: "consistency", delta: -5, reason: "commitment_excused", trigger: "commitment_outcome" });
    deltas.push({ field: "discipline",  delta: -3, reason: "commitment_excused", trigger: "commitment_outcome" });
  } else if (event.outcome === "partial") {
    deltas.push({ field: "consistency", delta: +1, reason: "commitment_partial", trigger: "commitment_outcome" });
    deltas.push({ field: "confidence",  delta: +1, reason: "commitment_partial", trigger: "commitment_outcome" });
  }

  return deltas;
}

// ── Pure: time-based decay ────────────────────────────────────────────────────

function computeDecayDeltas(state: MentorState, daysSince: number): StateDeltaEntry[] {
  if (daysSince <= 0) return [];

  const effectiveDays = Math.min(daysSince, 30); // cap at 30 days
  const deltas: StateDeltaEntry[] = [];

  for (const field of Object.keys(DECAY_RATES) as ScorableField[]) {
    const current = state[field] as number;
    const baseline = BASELINE[field];
    const totalDecay = DECAY_RATES[field] * effectiveDays;

    let delta: number;
    if (current > baseline) {
      delta = -Math.min(totalDecay, current - baseline);
    } else if (current < baseline) {
      delta = Math.min(totalDecay, baseline - current);
    } else {
      continue;
    }

    delta = round1(delta);
    if (Math.abs(delta) < 0.1) continue;

    deltas.push({
      field,
      delta,
      reason: `time_decay:${round1(effectiveDays)}_days baseline:${baseline}`,
      trigger: "decay",
    });
  }

  return deltas;
}

// ── Pure: apply deltas to state ───────────────────────────────────────────────

function applyDeltas(state: MentorState, deltas: StateDeltaEntry[]): MentorState {
  const next = { ...state };

  for (const d of deltas) {
    const current = next[d.field] as number;
    (next as unknown as Record<ScorableField, number>)[d.field] = clamp(round1(current + d.delta));
  }

  return next;
}

// ── Pure: derived capacity score ──────────────────────────────────────────────

function recomputeCapacity(state: MentorState): number {
  // Stress and burnout drain capacity; motivation and momentum partially restore it
  const base =
    100
    - state.stress      * 0.40
    - state.burnoutRisk * 0.30
    + state.motivation  * 0.20
    + state.momentum    * 0.10
    - 20; // realistic baseline offset

  return clamp(Math.round(base));
}

// ── Pure: flag computation ────────────────────────────────────────────────────

function computeFlags(state: MentorState, previous: MentorState | null): StateFlag[] {
  const flags: StateFlag[] = [];

  if (state.stress      >= 70)  flags.push("high_stress");
  if (state.burnoutRisk >= 70)  flags.push("burnout_risk_high");
  if (state.burnoutRisk >= 85)  flags.push("burnout_risk_critical");
  if (state.capacity    <= 30)  flags.push("low_capacity");
  if (state.motivation  <= 30)  flags.push("low_motivation");
  if (state.confidence  <= 30)  flags.push("low_confidence");
  if (state.momentum    >= 70)  flags.push("momentum_building");
  if (state.momentum    <= 20)  flags.push("momentum_collapsed");
  if (state.consistency >= 75)  flags.push("consistency_strong");
  if (state.consistency <= 25)  flags.push("consistency_collapsed");
  if (state.capacity    <= 30 && state.stress >= 60) flags.push("overcommitted");
  if (state.daysSinceFirstSession <= 7) flags.push("first_week");

  if (state.streakDays > 0 && state.consecutiveMisses > 0) flags.push("streak_at_risk");
  if (state.streakDays === 0 && state.consecutiveMisses >= 1) flags.push("streak_broken");

  // Avoidance: low discipline + low consistency + consecutive misses
  if (state.discipline <= 35 && state.consistency <= 35 && state.consecutiveMisses >= 2) {
    flags.push("avoidance_pattern_active");
  }

  // Disengaged: very low momentum + no activity signal
  if (state.momentum <= 25 && state.motivation <= 35) {
    flags.push("disengaged");
  }

  // Returning after gap (requires previous state comparison)
  if (previous) {
    const wasGone = previous.momentum <= 25 || previous.flags.includes("disengaged");
    const nowActive = state.momentum > previous.momentum || state.motivation > previous.motivation;
    if (wasGone && nowActive && state.daysSinceFirstSession > 14) {
      flags.push("returning_after_gap");
    }

    // Comeback: was struggling, now improving
    const wasCollapsed =
      previous.flags.includes("momentum_collapsed") ||
      previous.flags.includes("consistency_collapsed") ||
      previous.consecutiveMisses >= 3;
    const isImproving =
      !flags.includes("momentum_collapsed") &&
      !flags.includes("consistency_collapsed") &&
      state.momentum > previous.momentum + 5;
    if (wasCollapsed && isImproving) flags.push("comeback");
  }

  // Peak performance: healthy across all dimensions
  if (
    state.motivation  >= 70 &&
    state.consistency >= 70 &&
    state.confidence  >= 70 &&
    state.momentum    >= 70 &&
    state.stress      <= 35 &&
    state.burnoutRisk <= 25
  ) {
    flags.push("peak_performance");
  }

  return flags;
}

// ── Pure: streak tracking ─────────────────────────────────────────────────────

function updateStreakCounters(
  state: MentorState,
  event: CommitmentEvent | undefined
): Pick<MentorState, "streakDays" | "longestStreak" | "consecutiveMisses" | "totalCommitmentsMade" | "totalCommitmentsKept"> {
  let { streakDays, longestStreak, consecutiveMisses, totalCommitmentsMade, totalCommitmentsKept } = state;

  if (!event) return { streakDays, longestStreak, consecutiveMisses, totalCommitmentsMade, totalCommitmentsKept };

  totalCommitmentsMade += 1;

  switch (event.outcome) {
    case "kept":
      streakDays       += 1;
      consecutiveMisses = 0;
      totalCommitmentsKept += 1;
      longestStreak    = Math.max(longestStreak, streakDays);
      break;

    case "missed":
      streakDays        = 0;
      consecutiveMisses += 1;
      break;

    case "excused":
      // Does not break streak, but does not extend it. Counts as a half-miss.
      consecutiveMisses = Math.max(0, consecutiveMisses + 1);
      break;

    case "partial":
      totalCommitmentsKept += 0.5;
      consecutiveMisses    = Math.max(0, consecutiveMisses - 1);
      break;
  }

  return { streakDays, longestStreak, consecutiveMisses, totalCommitmentsMade, totalCommitmentsKept };
}

function detectStreakMilestone(previousStreak: number, currentStreak: number): number | null {
  for (const milestone of STREAK_MILESTONES) {
    if (previousStreak < milestone && currentStreak >= milestone) return milestone;
  }
  return null;
}

// ── Pure: momentum trend ──────────────────────────────────────────────────────

function appendMomentumTrend(existing: number[], newValue: number): number[] {
  return [...existing, newValue].slice(-7);
}

// ── Pure: summary string ──────────────────────────────────────────────────────

function buildSummary(
  previous: MentorState,
  updated: MentorState,
  deltas: StateDeltaEntry[],
  newFlags: StateFlag[],
  resolvedFlags: StateFlag[]
): string {
  const notable = deltas
    .filter((d) => Math.abs(d.delta) >= 5 && d.trigger !== "decay")
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 4);

  const parts: string[] = [];

  for (const d of notable) {
    parts.push(`${d.field} ${d.delta > 0 ? "↑" : "↓"}${Math.abs(d.delta)} [${d.reason}]`);
  }

  if (newFlags.length > 0)     parts.push(`+flags: ${newFlags.join(", ")}`);
  if (resolvedFlags.length > 0) parts.push(`-flags: ${resolvedFlags.join(", ")}`);

  const scoreDiff =
    (updated.motivation - previous.motivation) +
    (updated.consistency - previous.consistency) -
    (updated.stress - previous.stress) +
    (updated.confidence - previous.confidence) +
    (updated.momentum - previous.momentum) -
    (updated.burnoutRisk - previous.burnoutRisk);

  const direction = scoreDiff > 5 ? "↑ improving" : scoreDiff < -5 ? "↓ declining" : "→ stable";
  parts.unshift(direction);

  return parts.join(" | ");
}

// ── DB persistence ────────────────────────────────────────────────────────────

async function loadMentorState(platformChatId: string): Promise<MentorState> {
  const user = await prisma.messengerUser.findUnique({
    where: {
      platform_platformChatId: { platform: "telegram", platformChatId },
    },
    select: {
      id: true,
      createdAt: true,
      memories: {
        where: { type: "mentor_state", key: "v1" },
        orderBy: { updatedAt: "desc" },
        take: 1,
        select: { value: true },
      },
    },
  });

  if (!user) return buildDefaultState();

  const raw = user.memories[0]?.value;
  if (!raw) {
    const daysSinceFirst = Math.floor(
      (Date.now() - user.createdAt.getTime()) / 86_400_000
    );
    return { ...buildDefaultState(), daysSinceFirstSession: daysSinceFirst };
  }

  try {
    return parseState(JSON.parse(raw) as Record<string, unknown>);
  } catch {
    return buildDefaultState();
  }
}

async function persistMentorState(platformChatId: string, state: MentorState): Promise<void> {
  const user = await prisma.messengerUser.findUnique({
    where: {
      platform_platformChatId: { platform: "telegram", platformChatId },
    },
    select: { id: true },
  });

  if (!user) return;

  const serialized = JSON.stringify({
    ...state,
    lastUpdatedAt: state.lastUpdatedAt.toISOString(),
    lastActivityAt: state.lastActivityAt?.toISOString() ?? null,
  });

  await prisma.$transaction([
    prisma.memoryFact.deleteMany({
      where: { userId: user.id, type: "mentor_state", key: "v1" },
    }),
    prisma.memoryFact.create({
      data: {
        userId: user.id,
        type: "mentor_state",
        key: "v1",
        value: serialized,
        confidence: 1.0,
      },
    }),
  ]);
}

function buildDefaultState(): MentorState {
  return {
    motivation:      BASELINE.motivation,
    consistency:     BASELINE.consistency,
    stress:          BASELINE.stress,
    confidence:      BASELINE.confidence,
    discipline:      BASELINE.discipline,
    momentum:        BASELINE.momentum,
    burnoutRisk:     BASELINE.burnoutRisk,
    capacity:        75,
    streakDays:           0,
    longestStreak:        0,
    consecutiveMisses:    0,
    totalCommitmentsMade: 0,
    totalCommitmentsKept: 0,
    lastUpdatedAt:   new Date(),
    lastActivityAt:  null,
    daysSinceFirstSession: 0,
    flags:           [],
    momentum7dTrend: [],
    version:         0,
  };
}

function parseState(raw: Record<string, unknown>): MentorState {
  const def = buildDefaultState();
  return {
    motivation:      toNum(raw.motivation,      def.motivation),
    consistency:     toNum(raw.consistency,     def.consistency),
    stress:          toNum(raw.stress,          def.stress),
    confidence:      toNum(raw.confidence,      def.confidence),
    discipline:      toNum(raw.discipline,      def.discipline),
    momentum:        toNum(raw.momentum,        def.momentum),
    burnoutRisk:     toNum(raw.burnoutRisk,     def.burnoutRisk),
    capacity:        toNum(raw.capacity,        def.capacity),
    streakDays:           toNum(raw.streakDays,           0),
    longestStreak:        toNum(raw.longestStreak,        0),
    consecutiveMisses:    toNum(raw.consecutiveMisses,    0),
    totalCommitmentsMade: toNum(raw.totalCommitmentsMade, 0),
    totalCommitmentsKept: toNum(raw.totalCommitmentsKept, 0),
    lastUpdatedAt:  raw.lastUpdatedAt  ? new Date(raw.lastUpdatedAt  as string) : new Date(),
    lastActivityAt: raw.lastActivityAt ? new Date(raw.lastActivityAt as string) : null,
    daysSinceFirstSession: toNum(raw.daysSinceFirstSession, 0),
    flags:           Array.isArray(raw.flags)            ? (raw.flags as StateFlag[])   : [],
    momentum7dTrend: Array.isArray(raw.momentum7dTrend)  ? (raw.momentum7dTrend as number[]) : [],
    version:         toNum(raw.version, 0),
  };
}

function toNum(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Primary update path — called after every conversation turn.
 * Reads state, applies decay + conversation signals + commitment event,
 * persists, and returns a full audit trail.
 */
export async function updateMentorState(
  platformChatId: string,
  input: StateUpdateInput
): Promise<StateUpdateResult> {
  const current = await loadMentorState(platformChatId);
  const previous = { ...current, flags: [...current.flags] };
  const now = new Date();

  const daysSinceUpdate = current.lastUpdatedAt
    ? Math.max(0, (now.getTime() - current.lastUpdatedAt.getTime()) / 86_400_000)
    : 0;

  const allDeltas: StateDeltaEntry[] = [];

  // 1. Time decay (minimum 6 hours before applying)
  if (daysSinceUpdate >= 0.25) {
    allDeltas.push(...computeDecayDeltas(current, daysSinceUpdate));
  }

  // 2. Conversation signals
  allDeltas.push(...computeConversationDeltas(input.analysis, current));

  // 3. Commitment event
  if (input.commitmentEvent) {
    allDeltas.push(...computeCommitmentDeltas(input.commitmentEvent, current));
  }

  // 4. Apply all deltas
  let updated = applyDeltas(current, allDeltas);

  // 5. Streak counters
  const streakSnapshot = updateStreakCounters(current, input.commitmentEvent);
  updated = { ...updated, ...streakSnapshot };

  // 6. Momentum trend
  updated.momentum7dTrend = appendMomentumTrend(current.momentum7dTrend, updated.momentum);

  // 7. Derived capacity (always recomputed, never directly set)
  updated.capacity = recomputeCapacity(updated);

  // 8. Days since first session
  if (current.lastActivityAt) {
    const gapDays = Math.floor((now.getTime() - current.lastActivityAt.getTime()) / 86_400_000);
    updated.daysSinceFirstSession = current.daysSinceFirstSession + gapDays;
  }

  // 9. Flags (need previous for comeback / returning detection)
  updated.flags = computeFlags(updated, previous);

  // 10. Meta
  updated.lastUpdatedAt  = now;
  updated.lastActivityAt = now;
  updated.version        = current.version + 1;

  // 11. Persist
  await persistMentorState(platformChatId, updated);

  const newFlags      = updated.flags.filter((f) => !previous.flags.includes(f));
  const resolvedFlags = previous.flags.filter((f) => !updated.flags.includes(f));
  const significantChange =
    newFlags.length > 0 ||
    resolvedFlags.length > 0 ||
    allDeltas.some((d) => Math.abs(d.delta) >= 5);

  return {
    previous,
    updated,
    deltas: allDeltas,
    newFlags,
    resolvedFlags,
    significantChange,
    summary: buildSummary(previous, updated, allDeltas, newFlags, resolvedFlags),
  };
}

/**
 * Read-only load — used by decision engine and check-in generator.
 */
export async function getMentorState(platformChatId: string): Promise<MentorState> {
  return loadMentorState(platformChatId);
}

/**
 * Pure computation — no DB access.
 * Used inside the pipeline to preview state changes before persisting.
 */
export function computeStatePreview(
  current: MentorState,
  input: StateUpdateInput
): { updated: MentorState; deltas: StateDeltaEntry[] } {
  const allDeltas: StateDeltaEntry[] = [
    ...computeConversationDeltas(input.analysis, current),
    ...(input.commitmentEvent ? computeCommitmentDeltas(input.commitmentEvent, current) : []),
  ];

  let updated = applyDeltas(current, allDeltas);
  updated.capacity = recomputeCapacity(updated);
  updated.flags    = computeFlags(updated, current);

  return { updated, deltas: allDeltas };
}

/**
 * Cron-driven daily decay — called when user has not messaged.
 * Does not save a memory turn; only decays scores toward baseline.
 */
export async function applyDailyDecay(platformChatId: string): Promise<StateUpdateResult> {
  const current = await loadMentorState(platformChatId);
  const previous = { ...current, flags: [...current.flags] };
  const now = new Date();

  const daysSince = current.lastUpdatedAt
    ? Math.max(0, (now.getTime() - current.lastUpdatedAt.getTime()) / 86_400_000)
    : 1;

  const decayDeltas = computeDecayDeltas(current, daysSince);
  let updated       = applyDeltas(current, decayDeltas);
  updated.capacity  = recomputeCapacity(updated);
  updated.flags     = computeFlags(updated, previous);
  updated.lastUpdatedAt = now;
  updated.version   = current.version + 1;

  await persistMentorState(platformChatId, updated);

  const newFlags      = updated.flags.filter((f) => !previous.flags.includes(f));
  const resolvedFlags = previous.flags.filter((f) => !updated.flags.includes(f));

  return {
    previous,
    updated,
    deltas: decayDeltas,
    newFlags,
    resolvedFlags,
    significantChange: decayDeltas.some((d) => Math.abs(d.delta) >= 5),
    summary: `decay over ${round1(daysSince)}d | capacity:${updated.capacity} stress:${updated.stress} burnout:${updated.burnoutRisk}`,
  };
}

/**
 * Detects streak milestone crossing for use when building CommitmentEvent.
 */
export function detectMilestone(previousStreak: number, currentStreak: number): number | null {
  return detectStreakMilestone(previousStreak, currentStreak);
}

/**
 * Bridges internal StateFlag → UserStateFlag (state.types.ts).
 * Used by the pipeline to populate UserState.flags.
 */
export function toUserStateFlags(state: MentorState): UserStateFlag[] {
  const map: Partial<Record<StateFlag, UserStateFlag>> = {
    high_stress:              "high_stress",
    low_capacity:             "low_capacity",
    streak_at_risk:           "streak_at_risk",
    streak_broken:            "streak_broken",
    overcommitted:            "overcommitted",
    consistency_collapsed:    "underperforming",
    momentum_collapsed:       "underperforming",
    low_motivation:           "underperforming",
    comeback:                 "comeback_momentum",
    peak_performance:         "peak_performance",
    avoidance_pattern_active: "avoidance_pattern_active",
    disengaged:               "disengaged",
    first_week:               "first_week",
    returning_after_gap:      "returning_after_gap",
  };

  const result: UserStateFlag[] = [];
  for (const flag of state.flags) {
    const mapped = map[flag];
    if (mapped && !result.includes(mapped)) result.push(mapped);
  }
  return result;
}
