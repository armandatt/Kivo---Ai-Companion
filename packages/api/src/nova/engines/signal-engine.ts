// ─── Nova Signal Engine ───────────────────────────────────────────────────────
// SKILL.md §8.6 — deterministic structural signal extraction.
// Regex for patterns that are unambiguous without context.
// Starting a session is NOT one of them: it comes from an explicit command
// or from the Understanding Brain (see withEstablishedSignal).
// NEVER classifies emotion (Understanding Brain owns that).
// NEVER makes coaching decisions.
// NEVER decides what is remembered: a match is evidence (§11.7), and only
// the consolidation layer turns evidence into durable state.
// Owner: Signal Engine.

import type { AcademicState } from "../types/academic-state.types";
import type {
  DetectedSignal,
  SignalEngineOutput,
  SignalStateUpdate,
  SignalType,
} from "../types/engine.types";

// ── Structural signal patterns (regex only) ───────────────────────────────────
// Pattern = structural, unambiguous, context-independent.
// Anti-pattern §13: if a human needs context to classify it, regex won't.

const STUDY_REPORT_RE = /\b(finished|completed|done with|just did|reviewed|went through|covered|studied|read|practiced?)\b.{0,50}\b(chapter|section|topic|lecture|unit|module|page|problem|exercise|flashcard|notes?)\b/i;

const STUDY_SKIP_RE = /\b(didn'?t\s+study|skipped?\s+(?:a\s+|the\s+)?(studying|class|lecture|session)|missed?\s+(?:a\s+|the\s+)?(class|lecture|session|study)|haven'?t\s+studied|no\s+studying|couldn'?t\s+study|failed\s+to\s+study)\b/i;

const COMMITMENT_RE = /\b(i'?ll|i\s+will|i'm\s+going\s+to|planning\s+to|going\s+to)\b.{0,60}\b(study|review|practice|do|finish|complete|start|work\s+on)\b/i;

const EXCUSE_RE = /\b(too\s+busy|been\s+busy|no\s+time|didn'?t\s+have\s+time|was\s+tired|got\s+distracted|things\s+came\s+up|something\s+came\s+up|work\s+was\s+(hectic|crazy|insane)|couldn'?t\s+focus|next\s+week|start\s+fresh|start\s+monday|after\s+(this|the)\s+(exam|test|week|project))\b/i;

const ACHIEVEMENT_RE = /\b(passed|aced|got\s+an?\s+[a-b]|scored?\s+\d+|finished\s+all|completed\s+everything|hit\s+my\s+target|nailed\s+it|understood|finally\s+get\s+it|it\s+(clicked|makes?\s+sense\s+now))\b/i;

const MASTERY_CLAIM_RE = /\b(i\s+(think|feel|know)\s+i\s+(know|understand|get)\s|pretty\s+(confident|comfortable|solid)\s+(on|with|about)|feel\s+(ready|prepared|good)\s+(for|about|on))\b/i;

const AVOIDANCE_RE = /\b(keep\s+avoiding|procrastinat|can'?t\s+(bring\s+myself|make\s+myself|start)|putting\s+it\s+off|keep\s+delaying|dreading|hate\s+(studying|revising|practicing))\b/i;

const COMEBACK_RE = /\b(back\s+(to\s+(studying|it)|on\s+track)|getting\s+back|returning\s+to|resuming|picking\s+(up|it\s+up)\s+again|trying\s+again)\b/i;

const BURNOUT_BEHAVIORAL_RE = /\b(exhausted|burned?\s+out|can'?t\s+(keep|continue|go\s+on)|nothing\s+left|going\s+through\s+the\s+motions|what'?s\s+the\s+point|don'?t\s+(even\s+)?care\s+anymore|sick\s+of\s+(studying|this)|i\s+hate\s+studying)\b/i;

const CONSISTENCY_POSITIVE_RE = /\b(every\s+day|daily|consistently|on\s+track|sticking\s+to|keeping\s+up|didn'?t\s+miss\s+a\s+day|streak)\b/i;

const BREAK_REQUEST_RE = /\b(need\s+a\s+break|taking\s+a\s+break|want\s+a\s+break|going\s+to\s+take\s+a\s+break|break\s+time|need\s+to\s+rest|need\s+to\s+stop|stepping\s+away|need\s+to\s+step\s+away|pausing\s+(my\s+)?(session|studying))\b/i;

const DISTRACTION_RE = /\b(distracted|can'?t\s+(concentrate|focus)|mind\s+(is\s+)?wandering|lost\s+(my\s+)?focus|keep\s+getting\s+distracted|spacing\s+out|can'?t\s+pay\s+attention|losing\s+focus|zoning\s+out)\b/i;

// ── Intensity modifiers ───────────────────────────────────────────────────────

function computeIntensity(text: string, basePattern: RegExp): number {
  const match = text.match(basePattern);
  if (!match) return 0;
  const intensifiers = /\b(really|very|extremely|completely|totally|absolutely|so\s+much|quite|pretty)\b/i;
  const negators = /\b(a\s+bit|slightly|kind\s+of|sort\s+of|maybe|possibly)\b/i;
  if (intensifiers.test(text)) return Math.min(1.0, 0.9);
  if (negators.test(text)) return 0.5;
  return 0.75;
}

// ── State delta tables ────────────────────────────────────────────────────────

const SIGNAL_STATE_DELTAS: Record<SignalType, Partial<Record<keyof import("../types/academic-state.types").AcademicScores, number>>> = {
  study_report:       { engagement: +8,  momentum: +6,  planAdherence: +5,  burnoutRisk: -3  },
  study_skip:         { engagement: -6,  momentum: -5,  planAdherence: -4                    },
  session_start:      { engagement: +5,  momentum: +4                                         },
  break_request:      { engagement: -2,  momentum: -1,  burnoutRisk: +3                       },
  distraction:        { engagement: -4,  momentum: -3,  burnoutRisk: +5                       },
  commitment:         { engagement: +4,  momentum: +3                                         },
  excuse:             { engagement: -3,  momentum: -4,  planAdherence: -5,  confidence: -2   },
  achievement:        { engagement: +10, momentum: +8,  confidence: +6,     burnoutRisk: -4  },
  mastery_claim:      { confidence: +5                                                        },
  topic_struggle:     { confidence: -4                                                        },
  avoidance:          { engagement: -5,  momentum: -4,  planAdherence: -3                    },
  consistency:        { engagement: +5,  momentum: +7,  planAdherence: +4                    },
  burnout_behavioral: { burnoutRisk: +15, engagement: -8, momentum: -10                      },
  comeback:           { engagement: +6,  momentum: +4                                        },
};

// ── Core extraction ───────────────────────────────────────────────────────────

interface SignalDefinition {
  type:     SignalType;
  pattern:  RegExp;
  valence:  "positive" | "negative" | "neutral";
}

const SIGNAL_DEFINITIONS: SignalDefinition[] = [
  { type: "study_report",       pattern: STUDY_REPORT_RE,         valence: "positive" },
  { type: "study_skip",         pattern: STUDY_SKIP_RE,           valence: "negative" },
  { type: "break_request",      pattern: BREAK_REQUEST_RE,        valence: "neutral"  },
  { type: "distraction",        pattern: DISTRACTION_RE,          valence: "negative" },
  { type: "commitment",         pattern: COMMITMENT_RE,           valence: "positive" },
  { type: "excuse",             pattern: EXCUSE_RE,               valence: "negative" },
  { type: "achievement",        pattern: ACHIEVEMENT_RE,          valence: "positive" },
  { type: "mastery_claim",      pattern: MASTERY_CLAIM_RE,        valence: "neutral"  },
  { type: "avoidance",          pattern: AVOIDANCE_RE,            valence: "negative" },
  { type: "comeback",           pattern: COMEBACK_RE,             valence: "positive" },
  { type: "burnout_behavioral", pattern: BURNOUT_BEHAVIORAL_RE,   valence: "negative" },
  { type: "consistency",        pattern: CONSISTENCY_POSITIVE_RE, valence: "positive" },
];

// ── Established events ────────────────────────────────────────────────────────
// Some signals are not read off the message text at all. "The student is
// starting a session" is either an explicit command (protocol) or a judgement
// about what a sentence means (Understanding Brain). Once one of those has
// established the event, it is added here so every downstream consumer sees
// one uniform signal list. This function never looks at message text.

export type EstablishedBy = "command" | "understanding";

const ESTABLISHED_VALENCE: Partial<Record<SignalType, DetectedSignal["valence"]>> = {
  study_skip: "negative", excuse: "negative", mastery_claim: "neutral", topic_struggle: "negative",
};

export function withEstablishedSignal(
  output: SignalEngineOutput,
  type:   SignalType,
  source: EstablishedBy,
): SignalEngineOutput {
  const existing = output.detectedSignals.find(s => s.type === type);
  if (existing) {
    // The wording also matched. Keep the match's intensity, but record that
    // the event is established independently of it.
    if (existing.evidence === "command" || existing.evidence === "understanding") return output;
    return {
      ...output,
      detectedSignals: output.detectedSignals.map(s => s === existing ? { ...s, evidence: source } : s),
    };
  }

  const signal: DetectedSignal = {
    type,
    intensity:  0.75,
    valence:    ESTABLISHED_VALENCE[type] ?? "positive",
    confidence: source === "command" ? 1.0 : 0.85,
    evidence:   source,
  };
  const stateUpdates: SignalStateUpdate[] = (
    Object.entries(SIGNAL_STATE_DELTAS[type]) as Array<[keyof AcademicScores, number]>
  ).map(([field, raw]) => ({
    field,
    delta:         parseFloat((raw * signal.intensity).toFixed(1)),
    reason:        `established:${type} by:${source}`,
    triggerSignal: type,
  }));

  return {
    detectedSignals: [...output.detectedSignals, signal],
    stateUpdates:    [...output.stateUpdates, ...stateUpdates],
  };
}

export function extractSignals(
  text: string,
  state: AcademicState,
): SignalEngineOutput {
  const detectedSignals: DetectedSignal[] = [];
  const stateUpdates:   SignalStateUpdate[] = [];

  for (const def of SIGNAL_DEFINITIONS) {
    if (!def.pattern.test(text)) continue;

    const intensity = computeIntensity(text, def.pattern);
    const evidence  = text.match(def.pattern)?.[0] ?? "";

    const signal: DetectedSignal = {
      type:       def.type,
      intensity,
      valence:    def.valence,
      confidence: intensity > 0.8 ? 0.90 : 0.75,
      evidence,
    };
    detectedSignals.push(signal);

    // State deltas scaled by intensity
    const deltas = SIGNAL_STATE_DELTAS[def.type];
    for (const [field, raw] of Object.entries(deltas) as Array<[keyof AcademicScores, number]>) {
      const scaled = parseFloat((raw * Math.max(0.4, intensity)).toFixed(1));
      if (scaled !== 0) {
        stateUpdates.push({
          field,
          delta:         scaled,
          reason:        `signal:${def.type} intensity:${intensity.toFixed(2)}`,
          triggerSignal: def.type,
        });
      }
    }
  }

  // Consistency bonus: study_report with no skip/excuse this turn → extra adherence
  const hasReport = detectedSignals.some(s => s.type === "study_report");
  const hasMiss   = detectedSignals.some(s => s.type === "study_skip" || s.type === "excuse");
  if (hasReport && !hasMiss) {
    stateUpdates.push({
      field:         "planAdherence",
      delta:         +3,
      reason:        "clean_report:no_miss_this_turn",
      triggerSignal: "study_report",
    });
  }

  return { detectedSignals, stateUpdates };
}

// Needed for the import in engine.types.ts to resolve correctly at runtime
type AcademicScores = import("../types/academic-state.types").AcademicScores;
