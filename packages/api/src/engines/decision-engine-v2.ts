import type { ConversationAnalysis } from "../types/mentor.types";
import type { PatternAnalysis } from "../types/pattern.types";
import type { MentorState } from "./user-state-engine";
import type { MemoryFact } from "../types/memory.types";
import type { GymTimeContext } from "../services/gymTimeContext.service";
import type { PatternReport } from "../services/gymPatternDetector.service";
import { DecisionTone, DecisionUrgency } from "./mentor-decision-engine";

// ═══════════════════════════════════════════════════════════════════════════════
// INTERVENTION TAXONOMY
// Named CoachIntervention to avoid collision with InterventionType in pattern.types.ts
// ═══════════════════════════════════════════════════════════════════════════════

export enum CoachIntervention {
  EMPATHIZE            = "EMPATHIZE",
  CHALLENGE            = "CHALLENGE",
  ACCOUNTABILITY       = "ACCOUNTABILITY",
  REFOCUS              = "REFOCUS",
  CLARIFY              = "CLARIFY",
  PROBLEM_SOLVE        = "PROBLEM_SOLVE",
  REDUCE_FRICTION      = "REDUCE_FRICTION",
  REINFORCE_IDENTITY   = "REINFORCE_IDENTITY",
  SURFACE_BREAKTHROUGH = "SURFACE_BREAKTHROUGH",
  SURFACE_COMMITMENT   = "SURFACE_COMMITMENT",
  SURFACE_PROMISE      = "SURFACE_PROMISE",
  CELEBRATE_WIN        = "CELEBRATE_WIN",
  REFRAME_FAILURE      = "REFRAME_FAILURE",
  PREVENT_SPIRAL       = "PREVENT_SPIRAL",
  PREVENT_BURNOUT      = "PREVENT_BURNOUT",
  MOMENTUM_PUSH        = "MOMENTUM_PUSH",
  CONSISTENCY_CHECK    = "CONSISTENCY_CHECK",
  GOAL_ALIGNMENT       = "GOAL_ALIGNMENT",
  PRIORITY_RESET       = "PRIORITY_RESET",
}

// ═══════════════════════════════════════════════════════════════════════════════
// I/O TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface DecisionV2Input {
  message:          string;
  analysis:         ConversationAnalysis;
  state:            MentorState;
  relevantMemories: MemoryFact[];      // pre-ranked by Memory Retrieval V2
  goals:            string[];
  gymContext:       GymTimeContext | null;
  patternReport:    PatternReport | null;   // gym-specific patterns (Rex only)
  behaviorPatterns: PatternAnalysis | null; // cross-domain behavior patterns
  isFirstSession:   boolean;
  personaType:      string;
}

export interface ScoreBreakdown {
  signal:  number;   // 0–1  how strongly do current signals indicate this intervention
  memory:  number;   // 0–1  how much do retrieved memories support it
  state:   number;   // 0–1  how much does current MentorState indicate it
  goal:    number;   // 0–1  how much does it serve active goals
  pattern: number;   // 0–1  how much do detected behavior patterns support it
}

export interface CandidateScore {
  intervention: CoachIntervention;
  score:        number;
  breakdown:    ScoreBreakdown;
}

// Gate applied before any recommendation-type intervention.
export interface RecommendationGate {
  level:       "LOW" | "MEDIUM" | "HIGH";
  score:       number;
  missingInfo: string[];
}

export interface DecisionV2Output {
  primaryIntervention:   CoachIntervention;
  secondaryIntervention: CoachIntervention | null;
  confidence:            number;
  reasoning:             string;       // debug/logs — never shown to users
  supportingMemories:    MemoryFact[];
  supportingSignals:     string[];
  urgency:               DecisionUrgency;
  tone:                  DecisionTone;
  requiresQuestion:      boolean;
  contextHints:          string[];
  candidateScores:       CandidateScore[];
  recommendationGate:    RecommendationGate | null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SIGNAL EXTRACTION
// Derives a canonical set of signal tokens from message, analysis, and state.
// Callers downstream match against this set — no string parsing needed elsewhere.
// ═══════════════════════════════════════════════════════════════════════════════

const QUIT_RE             = /\bquit\b|\bgiving up\b|\bgive up\b|\bstop trying\b|\bdone with this\b|\bnot doing this\b|\bthinking of stopping\b|\bwalk away\b/i;
const BURNOUT_RE          = /burnout|burned out|exhausted|completely drained|worn out|too much|can.t keep|can.t do this anymore|no energy left/i;
const EXCUSE_RE           = /work got in the way|couldn.t find time|no time|things came up|too busy|life happened|travel got|schedule is/i;
const PROMISE_RE          = /\bpromise\b|\bpromised\b|\bcommitted\b|\bi said\b|\btold myself\b|\bswore\b|\bpledged\b|\bvowed\b/i;
const BREAKTHROUGH_RE     = /figured out|finally clicked|breakthrough|realized why|understand now|it clicked|makes sense now/i;
const STALL_RE            = /\bstalled?\b|\bstuck\b|\bplateau\b|not improving|no progress|been the same|hasn.t moved/i;
const COMEBACK_RE         = /\bback\b|\bcame back\b|\breturning\b|\btrying again\b|\bstarting again\b|\bback on track\b/i;
const CONSISTENCY_POS_RE  = /been consistent|keeping up|showing up|been good|on track|haven.t missed|every day|all week/i;
const SPIRAL_RE           = /everything is|nothing works|what.s the point|why bother|pointless|doesn.t matter|nothing matters/i;
const ACHIEVEMENT_RE      = /\bhit\b.*kg|personal record|\bpr\b|new best|crushed it|nailed it|finished.*goal|smashed|100kg|new record/i;
const TRAVEL_RE           = /travel(?:l?ing|l?ed)?|\btrip\b|\bvacation\b|\baway\b|visiting/i;
const NUTRITION_RE           = /protein|nutrition|diet|eating|food|calories|macros/i;
const PROGRAMMING_RE         = /program|split|routine|schedule|training plan|workout plan|approach/i;

// V2.1 coaching-quality signals
const ACTION_TAKEN_RE        = /did the session|trained today|did it|got it done|finished it|completed it|showed up|starting again|back and trained/i;
const COMPARISON_TRAP_RE     = /everyone is|everyone around me|others are ahead|behind everyone|compared to|everyone else|faster than me|progressing faster/i;
const NEED_RESET_RE          = /i need to reset|need a reset|need to reset|start over|need to rebuild/i;
const OVERCOMMITTED_RE       = /training \d+\s*days?|working \d+\s*hours?|no time left|too much going on|overloaded/i;
const PROACTIVE_OBSTACLE_RE  = /traveling next week|going away next|busy next week|schedule will change|going to be away/i;

export function extractSignals(
  message: string,
  analysis: ConversationAnalysis,
  state: MentorState,
): Set<string> {
  const s = new Set<string>();

  // ── Intent ─────────────────────────────────────────────────────────────────
  s.add(`intent:${analysis.intent}`);

  // ── Emotion ────────────────────────────────────────────────────────────────
  if (analysis.emotion.primary !== "neutral") s.add(`emotion:${analysis.emotion.primary}`);
  if (analysis.emotion.intensity >= 0.65)     s.add("emotion:high_intensity");

  // ── Analysis flags ─────────────────────────────────────────────────────────
  if (analysis.hasFailureReport) s.add("has_failure_report");
  if (analysis.hasExcuse)        s.add("has_excuse");

  // ── State bands ────────────────────────────────────────────────────────────
  if (state.burnoutRisk >= 70)      s.add("state:burnout_critical");
  else if (state.burnoutRisk >= 45) s.add("state:burnout_risk");
  if (state.motivation <= 30)       s.add("state:motivation_low");
  else if (state.motivation <= 50)  s.add("state:motivation_below_avg");
  if (state.motivation >= 70)       s.add("state:motivation_high");
  if (state.confidence <= 35)       s.add("state:confidence_low");
  if (state.confidence <= 50)       s.add("state:confidence_below_avg");
  if (state.consistency <= 30)      s.add("state:consistency_collapsed");
  else if (state.consistency <= 50) s.add("state:consistency_low");
  if (state.momentum <= 25)         s.add("state:momentum_collapsed");
  if (state.momentum >= 65)         s.add("state:momentum_high");
  if (state.streakDays >= 14)       s.add("state:streak_long");
  else if (state.streakDays >= 7)   s.add("state:streak_active");
  if (state.consecutiveMisses >= 3) s.add("state:multi_miss");
  else if (state.consecutiveMisses >= 1) s.add("state:miss");
  if (state.stress >= 70)           s.add("state:high_stress");
  else if (state.stress >= 50)      s.add("state:elevated_stress");

  // ── Message keywords ───────────────────────────────────────────────────────
  const msg = message.toLowerCase();
  if (QUIT_RE.test(msg))            s.add("keyword:quit");
  if (BURNOUT_RE.test(msg))         s.add("keyword:burnout");
  if (EXCUSE_RE.test(msg))          s.add("keyword:excuse");
  if (PROMISE_RE.test(msg))         s.add("keyword:promise");
  if (BREAKTHROUGH_RE.test(msg))    s.add("keyword:breakthrough");
  if (STALL_RE.test(msg))           s.add("keyword:stall");
  if (COMEBACK_RE.test(msg))        s.add("keyword:comeback");
  if (CONSISTENCY_POS_RE.test(msg)) s.add("keyword:consistency_positive");
  if (SPIRAL_RE.test(msg))          s.add("keyword:spiral");
  if (ACHIEVEMENT_RE.test(msg))     s.add("keyword:achievement");
  if (TRAVEL_RE.test(msg))            s.add("keyword:travel");
  if (NUTRITION_RE.test(msg))         s.add("keyword:nutrition");
  if (PROGRAMMING_RE.test(msg))       s.add("keyword:programming");

  // V2.1 coaching-quality signals
  if (COMEBACK_RE.test(msg) && ACTION_TAKEN_RE.test(msg)) s.add("keyword:comeback_action");
  if (COMPARISON_TRAP_RE.test(msg))    s.add("keyword:comparison_trap");
  if (NEED_RESET_RE.test(msg))         s.add("keyword:need_reset");
  if (OVERCOMMITTED_RE.test(msg))      s.add("keyword:overcommitted");
  if (PROACTIVE_OBSTACLE_RE.test(msg)) s.add("keyword:proactive_obstacle");

  return s;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCORING HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function clamp(n: number): number {
  return Math.max(0, Math.min(1, n));
}

// Returns the top matched signal weight, with a small corroboration bonus (+0.05)
// when a second independent signal also matches. Caps at 1.0.
function scoreSignals(present: Set<string>, weights: Record<string, number>): number {
  let top = 0, second = 0;
  for (const [sig, w] of Object.entries(weights)) {
    if (!present.has(sig)) continue;
    if (w >= top)   { second = top; top = w; }
    else if (w > second) second = w;
  }
  return Math.min(1.0, top + (second > 0 ? 0.05 : 0));
}

// Returns the highest weight of any memory whose type appears in the table.
function scoreMemoryTypes(
  memories: MemoryFact[],
  typeWeights: Partial<Record<string, number>>,
): number {
  let max = 0;
  for (const m of memories) {
    const w = typeWeights[m.type];
    if (w !== undefined && w > max) max = w;
  }
  return max;
}

function hasMemoryType(memories: MemoryFact[], types: string[]): boolean {
  return memories.some(m => types.includes(m.type));
}

const COMPOSITE_WEIGHTS = {
  signal: 0.30, memory: 0.25, state: 0.25, goal: 0.10, pattern: 0.10,
} as const;

// Used by empty-surface guards: an intervention that has nothing to surface returns 0.
const ZERO_BREAKDOWN: ScoreBreakdown = { signal: 0, memory: 0, state: 0, goal: 0, pattern: 0 };

function composite(b: ScoreBreakdown): number {
  return (
    b.signal  * COMPOSITE_WEIGHTS.signal  +
    b.memory  * COMPOSITE_WEIGHTS.memory  +
    b.state   * COMPOSITE_WEIGHTS.state   +
    b.goal    * COMPOSITE_WEIGHTS.goal    +
    b.pattern * COMPOSITE_WEIGHTS.pattern
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// INTERVENTION SCORERS
// Each scorer evaluates one intervention against all available signals.
// Returns a ScoreBreakdown where each dimension is 0–1.
// ═══════════════════════════════════════════════════════════════════════════════

type Scorer = (
  sig:   Set<string>,
  mem:   MemoryFact[],
  st:    MentorState,
  goals: string[],
  bPat:  PatternAnalysis | null,
  gPat:  PatternReport | null,
) => ScoreBreakdown;

const SCORERS: Record<CoachIntervention, Scorer> = {

  // ── PREVENT_BURNOUT ─────────────────────────────────────────────────────────
  // Hard override: when burnoutRisk >= 70, signal and state max out so PREVENT_BURNOUT
  // always beats competing interventions like PRIORITY_RESET that share similar signals.
  [CoachIntervention.PREVENT_BURNOUT]: (sig, mem, st) => {
    const critical = st.burnoutRisk >= 70;
    return {
      signal: critical ? 1.0 : scoreSignals(sig, {
        "state:burnout_critical":  1.00,
        "keyword:burnout":         0.85,
        "state:burnout_risk":      0.70,
        "emotion:overwhelmed":     0.65,
        "state:high_stress":       0.60,
        "emotion:stressed":        0.55,
        "intent:emotional_vent":   0.45,
      }),
      memory:  hasMemoryType(mem, ["struggle"]) ? 0.35 : 0,
      state:   critical ? 1.0 : clamp((st.burnoutRisk - 40) / 60),
      goal:    0,
      pattern: 0,
    };
  },

  // ── PREVENT_SPIRAL ──────────────────────────────────────────────────────────
  [CoachIntervention.PREVENT_SPIRAL]: (sig, mem, st, _, bPat) => ({
    signal: scoreSignals(sig, {
      "keyword:spiral":              0.95,
      "keyword:quit":                0.80,
      "emotion:discouraged":         0.65,
      "state:momentum_collapsed":    0.65,
      "state:consistency_collapsed": 0.60,
      "state:multi_miss":            0.60,
      "has_failure_report":          0.50,
    }),
    memory:  scoreMemoryTypes(mem, { struggle: 0.60, breakthrough: 0.40 }),
    state:   clamp((100 - (st.momentum + st.consistency) / 2) / 100 * 0.9),
    goal:    0,
    pattern: bPat ? (
      bPat.patterns.some(p =>
        p.type === "procrastination_spiral" || p.type === "goal_abandonment_cycle"
      ) ? 0.85 : bPat.riskScore >= 0.60 ? 0.50 : 0.15
    ) : 0,
  }),

  // ── SURFACE_PROMISE ─────────────────────────────────────────────────────────
  // Empty guard: a promise that doesn't exist cannot be surfaced.
  // State: only adds weight when a promise actually exists in memory, ensuring
  // SURFACE_PROMISE beats SURFACE_BREAKTHROUGH when both memories are present.
  [CoachIntervention.SURFACE_PROMISE]: (sig, mem, st) => {
    if (!hasMemoryType(mem, ["promise"])) return ZERO_BREAKDOWN;
    return ({
    signal: scoreSignals(sig, {
      "keyword:quit":          0.90,
      "keyword:promise":       0.90,
      "has_failure_report":    0.70,
      "has_excuse":            0.65,
      "keyword:excuse":        0.60,
      "emotion:avoidant":      0.60,
      "emotion:guilty":        0.55,
      "intent:failure_report": 0.70,
    }),
    memory:  scoreMemoryTypes(mem, { promise: 1.0, commitment: 0.50 }),
    state:   hasMemoryType(mem, ["promise"])
               ? clamp((100 - (st.motivation + st.confidence) / 2) / 100 * 0.60)
               : 0,
    goal:    0,
    pattern: 0,
  });},

  // ── SURFACE_BREAKTHROUGH ────────────────────────────────────────────────────
  // Empty guard: requires at least one surfaceable memory.
  // State: suppressed when a promise is present — the promise is more actionable.
  [CoachIntervention.SURFACE_BREAKTHROUGH]: (sig, mem, st) => {
    if (!hasMemoryType(mem, ["achievement", "breakthrough", "comeback"])) return ZERO_BREAKDOWN;
    return ({
    signal: scoreSignals(sig, {
      "keyword:quit":               0.80,
      "emotion:discouraged":        0.70,
      "state:confidence_low":       0.65,
      "state:motivation_low":       0.60,
      "has_failure_report":         0.55,
      "keyword:comeback":           0.60,
      "state:motivation_below_avg": 0.45,
    }),
    memory:  scoreMemoryTypes(mem, { achievement: 1.0, breakthrough: 0.90, comeback: 0.70 }),
    state:   hasMemoryType(mem, ["promise"])
               ? 0.10
               : clamp((100 - (st.motivation + st.confidence) / 2) / 100 * 0.8),
    goal:    0,
    pattern: 0,
  });},

  // ── SURFACE_COMMITMENT ──────────────────────────────────────────────────────
  // Empty guard: requires a commitment or promise in memory to surface.
  // When a promise also exists, defer to SURFACE_PROMISE (lower memory weight).
  // When multi_miss, defer to ACCOUNTABILITY (reduce state contribution).
  // Travel signal: pre-announcing a potential miss surfaces commitment.
  [CoachIntervention.SURFACE_COMMITMENT]: (sig, mem, st) => {
    if (!hasMemoryType(mem, ["commitment", "promise"])) return ZERO_BREAKDOWN;
    const hasPromise = hasMemoryType(mem, ["promise"]);
    const multiMiss  = sig.has("state:multi_miss");
    return {
      signal: scoreSignals(sig, {
        "has_failure_report":             0.75,
        "has_excuse":                     0.65,
        "intent:failure_report":          0.75,
        "intent:accountability_request":  0.60,
        "state:multi_miss":               0.65,
        "state:miss":                     0.50,
        "keyword:excuse":                 0.55,
        "keyword:travel":                 0.60,
      }),
      // Only defer to SURFACE_PROMISE when quit/failure signals are active.
      // For pre-announcement (travel, upcoming miss), commitment surfaces at full strength.
      memory:  hasPromise && (sig.has("keyword:quit") || sig.has("has_failure_report"))
                 ? scoreMemoryTypes(mem, { commitment: 0.60 })
                 : scoreMemoryTypes(mem, { commitment: 1.0, promise: 0.60 }),
      state:   hasMemoryType(mem, ["commitment", "promise"]) && !multiMiss
                 ? clamp((100 - st.consistency) / 100 * 0.60)
                 : hasMemoryType(mem, ["commitment", "promise"]) && multiMiss
                   ? clamp((100 - st.consistency) / 100 * 0.25)   // multi-miss → ACCOUNTABILITY leads
                   : 0,
      goal:    0,
      pattern: 0,
    };
  },

  // ── ACCOUNTABILITY ──────────────────────────────────────────────────────────
  [CoachIntervention.ACCOUNTABILITY]: (sig, mem, st, _, bPat) => ({
    signal: scoreSignals(sig, {
      "has_failure_report":             0.80,
      "state:multi_miss":               0.85,
      "intent:failure_report":          0.80,
      "intent:accountability_request":  0.75,
      "state:miss":                     0.60,
      "has_excuse":                     0.65,
      "state:consistency_collapsed":    0.75,
      "state:consistency_low":          0.55,
    }),
    memory:  scoreMemoryTypes(mem, { commitment: 0.60, promise: 0.60, struggle: 0.35 }),
    state:   clamp((100 - st.consistency) / 100 * 0.75),
    goal:    0,
    pattern: bPat ? (
      bPat.patterns.some(p => p.type === "excuse_cycling" || p.type === "consistency_collapse")
        ? 0.80 : 0.20
    ) : 0,
  }),

  // ── REFRAME_FAILURE ─────────────────────────────────────────────────────────
  [CoachIntervention.REFRAME_FAILURE]: (sig, mem, st) => ({
    signal: scoreSignals(sig, {
      "has_failure_report":    0.80,
      "emotion:discouraged":   0.70,
      "emotion:guilty":        0.65,
      "emotion:frustrated":    0.55,
      "intent:failure_report": 0.75,
      "state:confidence_low":  0.55,
    }),
    memory:  scoreMemoryTypes(mem, { struggle: 0.60, achievement: 0.55, breakthrough: 0.45 }),
    state:   clamp((100 - st.confidence) / 120),
    goal:    0,
    pattern: 0,
  }),

  // ── EMPATHIZE ───────────────────────────────────────────────────────────────
  [CoachIntervention.EMPATHIZE]: (sig, _mem, st) => ({
    signal: scoreSignals(sig, {
      "intent:emotional_vent":   0.90,
      "emotion:overwhelmed":     0.85,
      "emotion:stressed":        0.70,
      "emotion:discouraged":     0.60,
      "state:high_stress":       0.65,
      "emotion:high_intensity":  0.55,
      "keyword:burnout":         0.55,
      "state:burnout_risk":      0.45,
    }),
    memory:  0,
    state:   clamp(Math.max(st.stress, st.burnoutRisk * 0.8) / 100),
    goal:    0,
    pattern: 0,
  }),

  // ── CHALLENGE ───────────────────────────────────────────────────────────────
  [CoachIntervention.CHALLENGE]: (sig, _mem, st) => ({
    signal: scoreSignals(sig, {
      "has_excuse":            0.85,
      "keyword:excuse":        0.75,
      "emotion:avoidant":      0.65,
      "intent:failure_report": 0.50,  // excuse-in-disguise pattern
      "intent:plan_request":   0.45,
      "emotion:determined":    0.55,
      "state:motivation_high": 0.45,
    }),
    memory:  0,
    state:   st.burnoutRisk < 45 && st.motivation > 35
               ? clamp(st.motivation / 100 * 0.70)
               : 0,
    goal:    0,
    pattern: 0,
  }),

  // ── MOMENTUM_PUSH ───────────────────────────────────────────────────────────
  [CoachIntervention.MOMENTUM_PUSH]: (sig, mem, st) => ({
    signal: scoreSignals(sig, {
      "intent:progress_report":  0.80,
      "emotion:motivated":       0.80,
      "emotion:determined":      0.70,
      "keyword:achievement":     0.75,
      "state:streak_active":     0.65,
      "state:streak_long":       0.75,
      "state:momentum_high":     0.65,
      "keyword:consistency_positive":0.55,
    }),
    memory:  scoreMemoryTypes(mem, { achievement: 0.65, breakthrough: 0.45 }),
    state:   clamp((st.motivation + st.momentum - 80) / 100),
    goal:    0,
    pattern: 0,
  }),

  // ── CELEBRATE_WIN ───────────────────────────────────────────────────────────
  // emotion:proud is the definitive signal. Without it, state contribution shrinks
  // so MOMENTUM_PUSH wins for motivated/determined emotions on the same achievement.
  [CoachIntervention.CELEBRATE_WIN]: (sig, mem, st) => ({
    signal: scoreSignals(sig, {
      "emotion:proud":            1.00,
      "keyword:achievement":      0.85,
      "intent:progress_report":   0.70,
      "state:streak_long":        0.65,
      "state:streak_active":      0.50,
    }),
    memory:  scoreMemoryTypes(mem, { achievement: 0.80 }),
    state:   sig.has("emotion:proud")
               ? clamp(st.motivation / 100 * 0.85)
               : clamp(st.motivation / 100 * 0.40),
    goal:    0,
    pattern: 0,
  }),

  // ── REINFORCE_IDENTITY ──────────────────────────────────────────────────────
  [CoachIntervention.REINFORCE_IDENTITY]: (sig, mem, st) => ({
    signal: scoreSignals(sig, {
      "emotion:discouraged":        0.65,
      "keyword:quit":               0.60,
      "state:confidence_low":       0.65,
      "state:confidence_below_avg": 0.45,
      "state:motivation_low":       0.55,
      "intent:reflection":          0.55,
      "emotion:avoidant":           0.50,
    }),
    memory:  scoreMemoryTypes(mem, { anchor: 1.0, identity_shift: 0.90, comeback: 0.65 }),
    state:   clamp((100 - st.confidence) / 100 * 0.75),
    goal:    0,
    pattern: 0,
  }),

  // ── REFOCUS ─────────────────────────────────────────────────────────────────
  // FIX 9: REFOCUS is the healthy-state default for neutral/low-signal messages.
  // It now wins for status updates, check-in responses, and general neutral chat
  // when no stronger signal demands a different intervention.
  [CoachIntervention.REFOCUS]: (sig, _mem, _st, goals) => ({
    signal: scoreSignals(sig, {
      "intent:status_update":    0.65,
      "intent:check_in_response":0.65,
      "intent:reflection":       0.55,
      "intent:weekly_review":    0.60,
      "intent:general_chat":     0.55,
    }),
    memory:  0,
    state:   0,
    goal:    goals.length > 0 ? 0.55 : 0.15,
    pattern: 0,
  }),

  // ── CLARIFY ─────────────────────────────────────────────────────────────────
  [CoachIntervention.CLARIFY]: (sig, _mem, _st, goals) => ({
    signal: scoreSignals(sig, {
      "intent:goal_setting":   0.65,
      "intent:plan_request":   0.50,
      "intent:general_chat":   0.55,
    }),
    memory:  0,
    state:   0,
    goal:    goals.length === 0 ? 0.70 : 0.10,
    pattern: 0,
  }),

  // ── PROBLEM_SOLVE ───────────────────────────────────────────────────────────
  // Memory: preference/anchor facts indicate we know enough to diagnose the problem.
  [CoachIntervention.PROBLEM_SOLVE]: (sig, mem, _st, _goals, _bPat, gPat) => ({
    signal: scoreSignals(sig, {
      "keyword:stall":                  0.80,
      "keyword:programming":            0.70,
      "intent:plan_request":            0.55,
      "intent:accountability_request":  0.50,
      "intent:status_update":           0.40,
    }),
    memory:  scoreMemoryTypes(mem, { preference: 0.65, anchor: 0.45, detected_pattern: 0.55 }),
    state:   0,
    goal:    0,
    pattern: gPat?.stalledLifts.length ? 0.80 : 0,
  }),

  // ── REDUCE_FRICTION ─────────────────────────────────────────────────────────
  [CoachIntervention.REDUCE_FRICTION]: (sig, _mem, st) => ({
    signal: scoreSignals(sig, {
      "keyword:excuse":          0.70,
      "keyword:burnout":         0.60,
      "state:burnout_risk":      0.55,
      "emotion:overwhelmed":     0.55,
      "state:high_stress":       0.50,
      "intent:emotional_vent":   0.50,
      "keyword:travel":          0.55,
    }),
    memory:  0,
    state:   clamp((st.stress + st.burnoutRisk - 70) / 80),
    goal:    0,
    pattern: 0,
  }),

  // ── CONSISTENCY_CHECK ───────────────────────────────────────────────────────
  // State score only fires when there is explicit consistency evidence.
  // Removing intent:status_update prevents this from being a generic fallback.
  [CoachIntervention.CONSISTENCY_CHECK]: (sig, _mem, st) => {
    const hasConsistencyEvidence =
      sig.has("keyword:consistency_positive") ||
      sig.has("state:streak_active") ||
      sig.has("state:streak_long");
    return {
      signal: scoreSignals(sig, {
        "keyword:consistency_positive": 0.80,
        "intent:check_in_response":     0.65,
        "state:streak_active":          0.55,
        "state:streak_long":            0.65,
      }),
      memory:  0,
      state:   hasConsistencyEvidence ? clamp(st.consistency / 100 * 0.75) : 0,
      goal:    0,
      pattern: 0,
    };
  },

  // ── GOAL_ALIGNMENT ──────────────────────────────────────────────────────────
  [CoachIntervention.GOAL_ALIGNMENT]: (sig, _mem, _st, goals) => ({
    signal: scoreSignals(sig, {
      "intent:goal_setting":   0.70,
      "intent:weekly_review":  0.65,
      "intent:plan_request":   0.55,
      "intent:reflection":     0.45,
    }),
    memory:  0,
    state:   0,
    goal:    goals.length >= 2 ? 0.70 : goals.length === 1 ? 0.40 : 0.10,
    pattern: 0,
  }),

  // ── PRIORITY_RESET ──────────────────────────────────────────────────────────
  [CoachIntervention.PRIORITY_RESET]: (sig, _mem, st) => ({
    signal: scoreSignals(sig, {
      "state:burnout_critical":  0.90,
      "state:burnout_risk":      0.65,
      "emotion:overwhelmed":     0.75,
      "state:high_stress":       0.65,
      "intent:emotional_vent":   0.55,
      "state:elevated_stress":   0.45,
    }),
    memory:  0,
    state:   clamp((st.stress + st.burnoutRisk - 55) / 110),
    goal:    0,
    pattern: 0,
  }),
};

// ═══════════════════════════════════════════════════════════════════════════════
// RECOMMENDATION GATE
// Applied before recommendation-type interventions. If the engine lacks critical
// context for the target domain, it downgrades to CLARIFY (LOW) or signals a
// one-question gate (MEDIUM) before proceeding.
//
// Rules:
// • Never recommend exercises if current approach is unknown.
// • Never recommend programming changes if methodology is unknown.
// • Never recommend nutrition changes if current nutrition is unknown.
// • Only skip clarification when the answer already exists in memory or history.
// ═══════════════════════════════════════════════════════════════════════════════

const RECOMMENDATION_INTERVENTIONS = new Set<CoachIntervention>([
  CoachIntervention.PROBLEM_SOLVE,
  CoachIntervention.MOMENTUM_PUSH,
  CoachIntervention.GOAL_ALIGNMENT,
  CoachIntervention.CHALLENGE,
  CoachIntervention.PRIORITY_RESET,
]);

function computeRecommendationGate(input: DecisionV2Input): RecommendationGate {
  let score = 0;
  const missing: string[] = [];
  const mem = input.relevantMemories;

  // Goals present
  if (input.goals.length > 0) score += 0.20;
  else missing.push("no active goals known");

  // Workout / gym history
  if (input.patternReport !== null) score += 0.25;
  else if (input.gymContext !== null) score += 0.10;
  else if (input.analysis.domain === "fitness") missing.push("no workout history");

  // Preference or approach in memory
  const hasPref = mem.some(m =>
    ["preference","anchor","detected_pattern"].includes(m.type)
  );
  if (hasPref) score += 0.25;
  else missing.push("no preference or approach data in memory");

  // Not first session
  if (!input.isFirstSession) score += 0.15;
  else missing.push("first session — limited context");

  // Domain is clear
  if (input.analysis.domain !== "unknown") score += 0.15;
  else missing.push("domain unclear");

  const level: "LOW" | "MEDIUM" | "HIGH" =
    score >= 0.70 ? "HIGH" :
    score >= 0.40 ? "MEDIUM" :
    "LOW";

  return { level, score: parseFloat(score.toFixed(2)), missingInfo: missing };
}

// ═══════════════════════════════════════════════════════════════════════════════
// TONE RESOLVER
// Primary driver is the intervention type. Overridden by critical state conditions.
// ═══════════════════════════════════════════════════════════════════════════════

function resolveTone(
  intervention: CoachIntervention,
  state: MentorState,
  signals: Set<string>,
  tonePreference: "hard" | "soft" | "dynamic",
): DecisionTone {
  // State overrides always take priority
  if (state.burnoutRisk >= 70 || signals.has("state:burnout_critical")) return DecisionTone.GENTLE;
  if (state.stress >= 75 || signals.has("state:high_stress"))           return DecisionTone.SUPPORTIVE;

  let tone: DecisionTone;
  switch (intervention) {
    case CoachIntervention.PREVENT_BURNOUT:      tone = DecisionTone.GENTLE;     break;
    case CoachIntervention.PREVENT_SPIRAL:       tone = DecisionTone.SUPPORTIVE; break;
    case CoachIntervention.EMPATHIZE:            tone = DecisionTone.GENTLE;     break;
    case CoachIntervention.SURFACE_PROMISE:      tone = DecisionTone.FIRM;       break;
    case CoachIntervention.SURFACE_COMMITMENT:   tone = DecisionTone.FIRM;       break;
    case CoachIntervention.ACCOUNTABILITY:       tone = DecisionTone.FIRM;       break;
    case CoachIntervention.CHALLENGE:            tone = DecisionTone.HARD;       break;
    case CoachIntervention.MOMENTUM_PUSH:        tone = DecisionTone.FIRM;       break;
    case CoachIntervention.CELEBRATE_WIN:        tone = DecisionTone.SUPPORTIVE; break;
    case CoachIntervention.SURFACE_BREAKTHROUGH: tone = DecisionTone.SUPPORTIVE; break;
    case CoachIntervention.REINFORCE_IDENTITY:   tone = DecisionTone.SUPPORTIVE; break;
    case CoachIntervention.REFRAME_FAILURE:      tone = DecisionTone.SUPPORTIVE; break;
    case CoachIntervention.REDUCE_FRICTION:      tone = DecisionTone.SUPPORTIVE; break;
    case CoachIntervention.PRIORITY_RESET:       tone = DecisionTone.SUPPORTIVE; break;
    default:                                     tone = DecisionTone.STANDARD;
  }

  // User-level tone preference: hard caps minimum/maximum
  if (tonePreference === "hard") {
    if (tone === DecisionTone.GENTLE || tone === DecisionTone.SUPPORTIVE) tone = DecisionTone.STANDARD;
  } else if (tonePreference === "soft") {
    if (tone === DecisionTone.HARD) tone = DecisionTone.FIRM;
  }

  return tone;
}

// ═══════════════════════════════════════════════════════════════════════════════
// URGENCY RESOLVER
// ═══════════════════════════════════════════════════════════════════════════════

function resolveUrgency(
  intervention: CoachIntervention,
  state: MentorState,
): DecisionUrgency {
  if (state.burnoutRisk >= 70) return DecisionUrgency.CRITICAL;

  let urgency: DecisionUrgency;
  switch (intervention) {
    case CoachIntervention.PREVENT_BURNOUT:    urgency = DecisionUrgency.CRITICAL; break;
    case CoachIntervention.PREVENT_SPIRAL:     urgency = DecisionUrgency.HIGH;     break;
    case CoachIntervention.SURFACE_PROMISE:    urgency = DecisionUrgency.HIGH;     break;
    case CoachIntervention.CHALLENGE:          urgency = DecisionUrgency.HIGH;     break;
    case CoachIntervention.ACCOUNTABILITY:     urgency = DecisionUrgency.HIGH;     break;
    case CoachIntervention.MOMENTUM_PUSH:      urgency = DecisionUrgency.HIGH;     break;
    case CoachIntervention.SURFACE_COMMITMENT: urgency = DecisionUrgency.HIGH;     break;
    default:                                   urgency = DecisionUrgency.STANDARD;
  }

  // FIX 7: first-miss calibration — reliable users don't need HIGH urgency for a single miss.
  // Escalating a user with 65%+ consistency who missed once pushes them away, not forward.
  if (
    urgency === DecisionUrgency.HIGH &&
    state.consistency >= 65 &&
    state.consecutiveMisses <= 1 &&
    (intervention === CoachIntervention.ACCOUNTABILITY ||
     intervention === CoachIntervention.SURFACE_COMMITMENT)
  ) {
    return DecisionUrgency.STANDARD;
  }

  return urgency;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUPPORTING MEMORY SELECTOR
// Picks the memories most directly relevant to the chosen intervention.
// ═══════════════════════════════════════════════════════════════════════════════

const INTERVENTION_MEMORY_PRIORITY: Partial<Record<CoachIntervention, string[]>> = {
  [CoachIntervention.SURFACE_PROMISE]:      ["promise", "commitment"],
  [CoachIntervention.SURFACE_BREAKTHROUGH]: ["achievement", "breakthrough", "comeback"],
  [CoachIntervention.SURFACE_COMMITMENT]:   ["commitment", "promise"],
  [CoachIntervention.ACCOUNTABILITY]:       ["commitment", "promise", "struggle"],
  [CoachIntervention.REFRAME_FAILURE]:      ["achievement", "breakthrough", "struggle"],
  [CoachIntervention.PREVENT_SPIRAL]:       ["achievement", "breakthrough", "struggle"],
  [CoachIntervention.REINFORCE_IDENTITY]:   ["anchor", "identity_shift", "comeback"],
  [CoachIntervention.CHALLENGE]:            ["commitment", "promise"],
  [CoachIntervention.MOMENTUM_PUSH]:        ["achievement", "breakthrough"],
  [CoachIntervention.CELEBRATE_WIN]:        ["achievement"],
  [CoachIntervention.EMPATHIZE]:            ["struggle"],
  [CoachIntervention.PREVENT_BURNOUT]:      ["struggle"],
  [CoachIntervention.REFOCUS]:              ["goal"],
  [CoachIntervention.GOAL_ALIGNMENT]:       ["goal"],
  [CoachIntervention.PROBLEM_SOLVE]:        ["preference", "anchor"],
  [CoachIntervention.REDUCE_FRICTION]:      ["struggle"],
  [CoachIntervention.PRIORITY_RESET]:       ["struggle"],
};

function selectSupportingMemories(
  intervention: CoachIntervention,
  memories: MemoryFact[],
): MemoryFact[] {
  const types = INTERVENTION_MEMORY_PRIORITY[intervention];
  if (!types || types.length === 0) return [];
  return memories.filter(m => types.includes(m.type)).slice(0, 3);
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONTEXT HINTS BUILDER
// Compact strings fed into llm.ts contextHints — used as seed for natural references.
// ═══════════════════════════════════════════════════════════════════════════════

function buildContextHints(
  intervention: CoachIntervention,
  mems: MemoryFact[],
  state: MentorState,
  signals: Set<string>,
  gate: RecommendationGate | null,
): string[] {
  const hints: string[] = [];

  // Memory values first — these are the most specific
  for (const m of mems.slice(0, 3)) hints.push(m.value);

  // State facts
  if (state.consecutiveMisses >= 2) hints.push(`${state.consecutiveMisses} consecutive misses`);
  if (state.streakDays > 0)         hints.push(`${state.streakDays} day streak`);

  // Gate clarification hint (MEDIUM gate: one question prompt)
  if (gate?.level === "MEDIUM" && gate.missingInfo[0]) {
    hints.push(`clarify first: ${gate.missingInfo[0]}`);
  }

  // Remove duplicates (a memory value might repeat)
  const seen = new Set<string>();
  return hints.filter(h => { if (seen.has(h)) return false; seen.add(h); return true; }).slice(0, 6);
}

// ═══════════════════════════════════════════════════════════════════════════════
// REASONING BUILDER (debug only — never shown to users)
// ═══════════════════════════════════════════════════════════════════════════════

function buildReasoning(
  primary: CandidateScore,
  second: CandidateScore | null,
  signals: Set<string>,
  mems: MemoryFact[],
  gate: RecommendationGate | null,
): string {
  const bd = primary.breakdown;
  const sigList = [...signals]
    .filter(s => !s.startsWith("state:motivation_below") && !s.startsWith("state:confidence_below"))
    .slice(0, 5)
    .join(", ");
  const memTypes = mems.map(m => m.type).join(", ") || "none";

  let r = `${primary.intervention} (${primary.score.toFixed(3)}) `;
  r += `[sig=${bd.signal.toFixed(2)} mem=${bd.memory.toFixed(2)} st=${bd.state.toFixed(2)} goal=${bd.goal.toFixed(2)} pat=${bd.pattern.toFixed(2)}]`;
  r += ` | signals=[${sigList}] | mem=[${memTypes}]`;
  if (second && second.score > primary.score * 0.78) {
    r += ` | alt=${second.intervention} (${second.score.toFixed(3)})`;
  }
  if (gate) r += ` | rec_gate=${gate.level} (${gate.score.toFixed(2)})`;
  return r;
}

// ═══════════════════════════════════════════════════════════════════════════════
// INTERVENTIONS THAT ALWAYS NEED A QUESTION
// ═══════════════════════════════════════════════════════════════════════════════

const QUESTION_INTERVENTIONS = new Set<CoachIntervention>([
  CoachIntervention.CLARIFY,
  CoachIntervention.GOAL_ALIGNMENT,
  CoachIntervention.PROBLEM_SOLVE,
  CoachIntervention.REFRAME_FAILURE,
  CoachIntervention.CONSISTENCY_CHECK,
]);

// ═══════════════════════════════════════════════════════════════════════════════
// COACHING RULES (V2.1)
// Post-scoring multipliers and boosts applied before re-sorting.
// These handle coaching edge-cases the scoring formula cannot express alone:
// — comeback suppression (FIX 1)
// — defensive de-escalation (FIX 3)
// — explicit need signals (FIX 5)
// — comparison-trap detection (FIX 6)
// — proactive obstacle / travel pre-announcement (FIX 8)
// ═══════════════════════════════════════════════════════════════════════════════

function applyCoachingRules(
  candidates: CandidateScore[],
  signals: Set<string>,
): void {
  const adj = (inter: CoachIntervention, fn: (s: number) => number) => {
    const c = candidates.find(x => x.intervention === inter);
    if (c) c.score = Math.max(0, Math.min(1, fn(c.score)));
  };

  // FIX 1: comeback action — user returned AND took action → never penalise the return
  if (signals.has("keyword:comeback_action")) {
    adj(CoachIntervention.ACCOUNTABILITY,      s => s * 0.10);
    adj(CoachIntervention.SURFACE_COMMITMENT,  s => s * 0.60);
    adj(CoachIntervention.SURFACE_BREAKTHROUGH, s => s + 0.40);
    adj(CoachIntervention.CELEBRATE_WIN,        s => s + 0.30);
  }

  // FIX 3: defensive emotion → de-escalate before any challenge or commitment surfacing
  if (signals.has("emotion:defensive")) {
    adj(CoachIntervention.ACCOUNTABILITY,     s => s * 0.25);
    adj(CoachIntervention.SURFACE_COMMITMENT, s => s * 0.25);
    adj(CoachIntervention.SURFACE_PROMISE,    s => s * 0.25);
    adj(CoachIntervention.EMPATHIZE,          s => s + 0.30);
    adj(CoachIntervention.CLARIFY,            s => s + 0.20);
  }

  // FIX 5a: user explicitly named the reset need → PRIORITY_RESET leads
  if (signals.has("keyword:need_reset")) {
    adj(CoachIntervention.PRIORITY_RESET, s => s + 0.50);
  }

  // FIX 5b: objectively over-committed load → reduce friction first
  if (signals.has("keyword:overcommitted")) {
    adj(CoachIntervention.REDUCE_FRICTION, s => s + 0.50);
    adj(CoachIntervention.PRIORITY_RESET,  s => s + 0.40);
  }

  // FIX 6: comparison trap → anchor to own trajectory, not others' progress
  if (signals.has("keyword:comparison_trap")) {
    adj(CoachIntervention.REINFORCE_IDENTITY,    s => s + 0.50);
    adj(CoachIntervention.SURFACE_BREAKTHROUGH,  s => s * 0.75);
  }

  // FIX 8: proactive obstacle announcement → plan around it, don't punish transparency
  if (signals.has("keyword:proactive_obstacle")) {
    adj(CoachIntervention.REDUCE_FRICTION,    s => s + 0.45);
    adj(CoachIntervention.PROBLEM_SOLVE,      s => s + 0.25);
    adj(CoachIntervention.SURFACE_COMMITMENT, s => s * 0.60);
    adj(CoachIntervention.ACCOUNTABILITY,     s => s * 0.40);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════════

export function runDecisionV2(
  input: DecisionV2Input,
  tonePreference: "hard" | "soft" | "dynamic" = "dynamic",
): DecisionV2Output {
  const { message, analysis, state, relevantMemories, goals, patternReport, behaviorPatterns } = input;

  const signals = extractSignals(message, analysis, state);

  // Score every intervention
  const candidates: CandidateScore[] = (Object.keys(SCORERS) as CoachIntervention[]).map(type => {
    const breakdown = SCORERS[type](signals, relevantMemories, state, goals, behaviorPatterns, patternReport);
    return { intervention: type, score: parseFloat(composite(breakdown).toFixed(4)), breakdown };
  });

  candidates.sort((a, b) => b.score - a.score);

  // ── Coaching rules (V2.1) — post-scoring adjustments then re-sort ──────────
  applyCoachingRules(candidates, signals);
  candidates.sort((a, b) => b.score - a.score);

  let primary     = candidates[0]!;
  const rawSecond = candidates[1]!;

  // ── Recommendation gate ────────────────────────────────────────────────────
  // Evaluated FIRST for recommendation-type winners — gate handles the LOW/MEDIUM/HIGH
  // override logic. The safety net below does NOT touch recommendation types.
  let gate: RecommendationGate | null = null;
  if (RECOMMENDATION_INTERVENTIONS.has(primary.intervention)) {
    gate = computeRecommendationGate(input);
    if (gate.level === "LOW") {
      // Override to CLARIFY — we must understand before recommending
      primary = candidates.find(c => c.intervention === CoachIntervention.CLARIFY) ?? primary;
    }
    // MEDIUM: keep intervention, flag requires a question (handled via requiresQuestion + hint)
  }

  // ── FIX 4: low-confidence safety net (non-recommendation types only) ────────
  // When no intervention wins convincingly AND the winner isn't a recommendation type
  // (which has its own gate above), the engine should admit it needs more context.
  // • Neutral status check-in → REFOCUS (point to active goals)
  // • Uncertainty / problem statement → CLARIFY (ask first)
  const MIN_DECISION_CONFIDENCE = 0.35;
  const notYetOverridden = gate === null;   // gate already handled recommendation types
  if (notYetOverridden && primary.score < MIN_DECISION_CONFIDENCE) {
    const neutralStatus =
      (analysis.intent === "check_in_response" ||
       (analysis.intent === "status_update" && analysis.emotion.primary === "neutral")) &&
      !signals.has("keyword:stall") &&
      !signals.has("keyword:programming") &&
      !signals.has("keyword:nutrition");

    const fallbackType = neutralStatus
      ? CoachIntervention.REFOCUS
      : CoachIntervention.CLARIFY;

    primary = candidates.find(c => c.intervention === fallbackType) ?? primary;
  }

  const secondary = rawSecond.score > primary.score * 0.75 ? rawSecond : null;

  const supportingMems = selectSupportingMemories(primary.intervention, relevantMemories);
  const tone           = resolveTone(primary.intervention, state, signals, tonePreference);
  const urgency        = resolveUrgency(primary.intervention, state);
  const requiresQ      = QUESTION_INTERVENTIONS.has(primary.intervention)
                          || (gate?.level === "MEDIUM");
  const contextHints   = buildContextHints(primary.intervention, supportingMems, state, signals, gate);
  const reasoning      = buildReasoning(primary, secondary, signals, supportingMems, gate);

  return {
    primaryIntervention:   primary.intervention,
    secondaryIntervention: secondary?.intervention ?? null,
    confidence:            primary.score,
    reasoning,
    supportingMemories:    supportingMems,
    supportingSignals:     [...signals],
    urgency,
    tone,
    requiresQuestion:      requiresQ,
    contextHints,
    candidateScores:       candidates,
    recommendationGate:    gate,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// BRIDGE → MentorDecision
// Maps Decision Engine V2 output to the MentorDecision shape that llm.ts expects.
// Imported and called by the orchestrator only.
// ═══════════════════════════════════════════════════════════════════════════════

import {
  MentorAction,
  type MentorDecision,
  type BlockedAction,
} from "./mentor-decision-engine";

const INTERVENTION_MAP: Record<CoachIntervention, { action: MentorAction; subAction: string }> = {
  [CoachIntervention.EMPATHIZE]:           { action: MentorAction.ENCOURAGE,    subAction: "emotional_support" },
  [CoachIntervention.CHALLENGE]:           { action: MentorAction.CHALLENGE,    subAction: "all_or_nothing_reframe" },
  [CoachIntervention.ACCOUNTABILITY]:      { action: MentorAction.ACCOUNTABILITY, subAction: "consecutive_miss_escalation" },
  [CoachIntervention.REFOCUS]:             { action: MentorAction.REVIEW,       subAction: "status_update_acknowledged" },
  [CoachIntervention.CLARIFY]:             { action: MentorAction.ASK,          subAction: "vague_goal_clarification" },
  [CoachIntervention.PROBLEM_SOLVE]:       { action: MentorAction.TEACH,        subAction: "stuck_on_approach" },
  [CoachIntervention.REDUCE_FRICTION]:     { action: MentorAction.REDUCE_SCOPE, subAction: "stress_capacity_collapse" },
  [CoachIntervention.REINFORCE_IDENTITY]:  { action: MentorAction.REFLECT,      subAction: "comparison_trap_identity" },
  [CoachIntervention.SURFACE_BREAKTHROUGH]:{ action: MentorAction.ENCOURAGE,    subAction: "confidence_rebuild" },
  [CoachIntervention.SURFACE_COMMITMENT]:  { action: MentorAction.ACCOUNTABILITY, subAction: "failure_with_excuse" },
  [CoachIntervention.SURFACE_PROMISE]:     { action: MentorAction.ACCOUNTABILITY, subAction: "failure_with_excuse" },
  [CoachIntervention.CELEBRATE_WIN]:       { action: MentorAction.ENCOURAGE,    subAction: "goal_completion_debrief" },
  [CoachIntervention.REFRAME_FAILURE]:     { action: MentorAction.REFLECT,      subAction: "post_failure_self_inquiry" },
  [CoachIntervention.PREVENT_SPIRAL]:      { action: MentorAction.REDUCE_SCOPE, subAction: "burnout_pattern_confirmed" },
  [CoachIntervention.PREVENT_BURNOUT]:     { action: MentorAction.REDUCE_SCOPE, subAction: "burnout_critical" },
  [CoachIntervention.MOMENTUM_PUSH]:       { action: MentorAction.CHALLENGE,    subAction: "momentum_push" },
  [CoachIntervention.CONSISTENCY_CHECK]:   { action: MentorAction.ACCOUNTABILITY, subAction: "ghosting_response" },
  [CoachIntervention.GOAL_ALIGNMENT]:      { action: MentorAction.REVIEW,       subAction: "goal_completion_debrief" },
  [CoachIntervention.PRIORITY_RESET]:      { action: MentorAction.REDUCE_SCOPE, subAction: "stress_capacity_collapse" },
};

const TOKEN_BUDGET: Record<DecisionUrgency, number> = {
  [DecisionUrgency.CRITICAL]: 100,
  [DecisionUrgency.HIGH]:     140,
  [DecisionUrgency.STANDARD]: 120,
  [DecisionUrgency.LOW]:       80,
};

export function decisionV2ToMentorDecision(v2: DecisionV2Output): MentorDecision {
  const mapped = INTERVENTION_MAP[v2.primaryIntervention];
  return {
    action:           mapped.action,
    subAction:        mapped.subAction,
    urgency:          v2.urgency,
    tone:             v2.tone,
    requiresLLM:      true,
    tokenBudget:      TOKEN_BUDGET[v2.urgency],
    template:         null,
    ruleId:           `V2:${v2.primaryIntervention}`,
    reason:           v2.reasoning,
    confidence:       v2.confidence,
    contextHints:     v2.contextHints,
    decisionPath:     [
      v2.primaryIntervention,
      ...(v2.secondaryIntervention ? [v2.secondaryIntervention] : []),
    ],
    blockedActions:   [] as BlockedAction[],
    suppressFollowUp: v2.urgency === DecisionUrgency.LOW,
  };
}
