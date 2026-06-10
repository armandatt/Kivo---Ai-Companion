import type { ScorableField } from "./user-state-engine";

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export type SignalType =
  | "stress"
  | "burnout"
  | "motivation"
  | "confidence"
  | "overwhelm"
  | "fear"
  | "self_doubt"
  | "consistency"
  | "excuse"
  | "commitment"
  | "achievement"
  | "identity_statement";

export type SignalValence = "positive" | "negative" | "neutral";

export interface DetectedSignal {
  type: SignalType;
  intensity: number;    // 0.0–1.0 after modifier application
  valence: SignalValence;
  confidence: number;   // 0.0–1.0
  evidence: string[];   // matched phrases from the original text
}

export interface StateUpdate {
  field: ScorableField;
  delta: number;        // positive or negative, already scaled by intensity
  reason: string;
  triggerSignal: SignalType;
  confidence: number;
}

export interface MemoryWrite {
  type: string;         // MemoryFact.type
  key: string;
  value: string;
  confidence: number;
  shouldUpsert: boolean;
}

export interface SignalEngineInput {
  text: string;
  now: Date;
}

export interface SignalEngineOutput {
  detectedSignals: DetectedSignal[];
  stateUpdates: StateUpdate[];
  memoryWrites: MemoryWrite[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// INTERNAL SPEC TYPES
// ═══════════════════════════════════════════════════════════════════════════════

type Tier = "strong" | "medium" | "weak";

interface PatternDef {
  re: RegExp;
  tier: Tier;
}

interface MemoryWriteSpec {
  memType: string;
  keyPrefix: string;
  minIntensity: number;
  shouldUpsert: boolean;
}

interface SignalSpec {
  type: SignalType;
  valence: SignalValence;
  patterns: PatternDef[];
  // State deltas at intensity=1.0, scaled proportionally on output
  stateDeltas: Partial<Record<ScorableField, number>>;
  memoryWrite?: MemoryWriteSpec;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODIFIER CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

const TIER_BASE: Record<Tier, number> = { strong: 0.88, medium: 0.62, weak: 0.38 };

const INTENSIFIER = /\b(really|very|extremely|super|so|absolutely|completely|totally|incredibly|genuinely|seriously|deeply|heavily|so much)\b/;
const DIMINISHER  = /\b(a bit|slightly|kind of|sort of|somewhat|a little|not (very|that|too)|barely|just a)\b/;
const NEGATION    = /\b(not|no longer|don.?t|doesn.?t|can.?t|never|stop(ped)?|no)\s*$/;

// ═══════════════════════════════════════════════════════════════════════════════
// SIGNAL SPECS  (12 signals)
// ═══════════════════════════════════════════════════════════════════════════════

const SIGNAL_SPECS: SignalSpec[] = [
  // ── stress ──────────────────────────────────────────────────────────────────
  {
    type: "stress",
    valence: "negative",
    patterns: [
      { re: /\b(incredibly|so|extremely|really) stressed\b/,                            tier: "strong" },
      { re: /\b(stressed out|under a lot of pressure|pressure is getting to me)\b/,      tier: "strong" },
      { re: /\b(stressed|stress(ing)?|feeling the pressure|really tense)\b/,             tier: "medium" },
      { re: /\b(bit stressed|slightly stressed|some pressure|tense lately)\b/,           tier: "weak"   },
    ],
    stateDeltas: { stress: 15, burnoutRisk: 8 },
  },

  // ── burnout ─────────────────────────────────────────────────────────────────
  {
    type: "burnout",
    valence: "negative",
    patterns: [
      { re: /\b(burned? out|burnt? out|complete(ly)? exhausted|can.?t function|nothing left in me)\b/, tier: "strong" },
      { re: /\b(running on empty|mentally exhausted|totally drained|done with (it|everything|this))\b/, tier: "strong" },
      { re: /\b(drained|no energy left|exhausted by (this|it|everything)|hitting a wall)\b/,           tier: "medium" },
      { re: /\b(worn out|feeling drained|low on energy)\b/,                                            tier: "weak"   },
    ],
    stateDeltas: { stress: 18, burnoutRisk: 25, motivation: -10 },
    memoryWrite: {
      memType:      "struggle",
      keyPrefix:    "burnout",
      minIntensity: 0.72,
      shouldUpsert: false,
    },
  },

  // ── motivation (positive) ───────────────────────────────────────────────────
  {
    type: "motivation",
    valence: "positive",
    patterns: [
      { re: /\b(super|really|incredibly|so) (motivated|pumped|fired up|excited|energized)\b/,   tier: "strong" },
      { re: /\b(can.?t wait|never been more (motivated|ready)|feel unstoppable|hype[d]?)\b/,    tier: "strong" },
      { re: /\b(motivated|pumped|fired up|excited|energized|ready to (go|crush|kill it))\b/,    tier: "medium" },
      { re: /\b(feeling good about (this|it)|willing to (try|push)|going to give it)\b/,        tier: "weak"   },
    ],
    stateDeltas: { motivation: 14, momentum: 8, burnoutRisk: -5 },
  },

  // ── confidence (positive) ───────────────────────────────────────────────────
  {
    type: "confidence",
    valence: "positive",
    patterns: [
      { re: /\b(totally|fully|absolutely|completely) (confident|sure|certain|ready)\b/,    tier: "strong" },
      { re: /\b(i know i can (do this|handle this|make it)|100% sure|no doubt)\b/,         tier: "strong" },
      { re: /\b(confident|believe in myself|i can do this|feeling strong|got this)\b/,     tier: "medium" },
      { re: /\b(think i can (manage|handle)|should be (okay|fine|good))\b/,               tier: "weak"   },
    ],
    stateDeltas: { confidence: 12, motivation: 4 },
  },

  // ── overwhelm ───────────────────────────────────────────────────────────────
  {
    type: "overwhelm",
    valence: "negative",
    patterns: [
      { re: /\b(completely overwhelmed|drowning in|can.?t handle everything|too much to handle)\b/, tier: "strong" },
      { re: /\b(everything at once|falling apart|can.?t keep up with everything)\b/,               tier: "strong" },
      { re: /\b(overwhelmed|too much (going on|on my plate)|can.?t handle)\b/,                     tier: "medium" },
      { re: /\b(a lot on my plate|lot going on|juggling too much)\b/,                              tier: "weak"   },
    ],
    stateDeltas: { stress: 18, burnoutRisk: 12, motivation: -6 },
  },

  // ── fear ────────────────────────────────────────────────────────────────────
  {
    type: "fear",
    valence: "negative",
    patterns: [
      { re: /\b(terrified|petrified|scared (to death|to fail|of failing)|deep fear)\b/,          tier: "strong" },
      { re: /\b(afraid of (failing|messing up|letting (you|myself|everyone) down))\b/,           tier: "strong" },
      { re: /\b(scared|afraid|fear (of|that)|worried about failing|nervous about (this|it))\b/,  tier: "medium" },
      { re: /\b(a bit scared|slightly worried|nervous|anxious about)\b/,                         tier: "weak"   },
    ],
    stateDeltas: { stress: 10, confidence: -8 },
  },

  // ── self_doubt ──────────────────────────────────────────────────────────────
  {
    type: "self_doubt",
    valence: "negative",
    patterns: [
      { re: /\b(not cut out for (this|it)|maybe i.?m just not (good enough|capable|smart enough))\b/, tier: "strong" },
      { re: /\b(what if i.?m (just not|never going to be)|i.?ll never (be|make it|get there))\b/,     tier: "strong" },
      { re: /\b(doubt(ing)? myself|not sure i can|don.?t think i can|what if i fail)\b/,              tier: "medium" },
      { re: /\b(not sure i.?m (good enough|ready|capable)|questioning (myself|whether))\b/,          tier: "medium" },
      { re: /\b(maybe i.?m not|might not be able to|not confident (about|in))\b/,                    tier: "weak"   },
    ],
    stateDeltas: { confidence: -14, motivation: -7 },
  },

  // ── consistency (positive) ──────────────────────────────────────────────────
  {
    type: "consistency",
    valence: "positive",
    patterns: [
      { re: /\b(been (perfect|100%|every day|flawless) (this|the) (week|month))\b/,                tier: "strong" },
      { re: /\b(haven.?t missed (a single|one) (session|day|workout|class))\b/,                    tier: "strong" },
      { re: /\b(been (consistent|showing up|going every day|keeping up|on track))\b/,              tier: "medium" },
      { re: /\b(not missed (any|a) (session|day|workout)|keeping (the streak|going|it up))\b/,     tier: "medium" },
      { re: /\b(mostly (consistent|on track)|been (fairly|pretty) (consistent|regular))\b/,       tier: "weak"   },
    ],
    stateDeltas: { consistency: 10, momentum: 6 },
  },

  // ── consistency (negative) — own spec, same type, negative valence ──────────
  {
    type: "consistency",
    valence: "negative",
    patterns: [
      { re: /\b(keep (missing|skipping|avoiding)|never (consistent|stick to|follow through))\b/,   tier: "strong" },
      { re: /\b(been (really|so) (inconsistent|off track)|completely lost (my|the) streak)\b/,     tier: "strong" },
      { re: /\b(been (inconsistent|off track|missing|skipping)|losing (my streak|momentum))\b/,    tier: "medium" },
      { re: /\b(not been (consistent|as consistent|great)|slipping (up|on) (my|the))\b/,           tier: "weak"   },
    ],
    stateDeltas: { consistency: -8, discipline: -5 },
  },

  // ── excuse ───────────────────────────────────────────────────────────────────
  {
    type: "excuse",
    valence: "negative",
    patterns: [
      { re: /\b(couldn.?t (because|due to|since)|had (absolutely )?no choice but to miss)\b/,       tier: "strong" },
      { re: /\b(work (got|keeps getting) in the way|family (stuff|things?) (came up|happened))\b/,  tier: "medium" },
      { re: /\b(wasn.?t feeling it|life happened|got (busy|sidetracked)|things (came up|got crazy))\b/, tier: "medium" },
      { re: /\b(because i (was tired|had to|couldn.?t|wasn.?t able))\b/,                            tier: "medium" },
      { re: /\b(couldn.?t (really )?find (the )?time|been (too busy|too tired) (to|for))\b/,        tier: "weak"   },
    ],
    stateDeltas: { consistency: -5, discipline: -7 },
  },

  // ── commitment ───────────────────────────────────────────────────────────────
  {
    type: "commitment",
    valence: "positive",
    patterns: [
      { re: /\b(i (will definitely|commit to|promise( to)?)|no matter what (i.?ll|i will))\b/,      tier: "strong" },
      { re: /\b(i.?m (going to|committed to|dedicated to)|i.?ll (do|make sure|ensure))\b/,          tier: "medium" },
      { re: /\b(i plan to|planning (on|to)|going to make (sure|it happen))\b/,                      tier: "medium" },
      { re: /\b(i (should|think i.?ll) (try|start)|probably (going to|will))\b/,                    tier: "weak"   },
    ],
    stateDeltas: { motivation: 7, discipline: 5 },
    memoryWrite: {
      memType:      "promise",
      keyPrefix:    "commitment",
      minIntensity: 0.52,
      shouldUpsert: false,
    },
  },

  // ── achievement ─────────────────────────────────────────────────────────────
  {
    type: "achievement",
    valence: "positive",
    patterns: [
      { re: /\b(new (pr|pb|personal (record|best))|broke (my|a|the) (pr|pb|record|limit))\b/,    tier: "strong" },
      { re: /\b(finally (did it|made it|got (there|it)|finished)|crushed (it|my (goal|workout)))\b/, tier: "strong" },
      { re: /\b(hit (\d+[\s.]?kg|a (new|my)|my (target|goal))|completed (the|my|a))\b/,          tier: "medium" },
      { re: /\b(i (did|finished|accomplished|achieved|nailed|aced) (it|the|my|this))\b/,          tier: "medium" },
      { re: /\b(managed to (do|finish|complete|hit)|got (it done|through|there))\b/,             tier: "weak"   },
    ],
    stateDeltas: { motivation: 12, confidence: 10, momentum: 12 },
    memoryWrite: {
      memType:      "achievement",
      keyPrefix:    "achievement",
      minIntensity: 0.58,
      shouldUpsert: false,
    },
  },

  // ── identity_statement ───────────────────────────────────────────────────────
  {
    type: "identity_statement",
    valence: "positive",
    patterns: [
      { re: /\b(i.?m becoming a different person|this is who i am now|i.?ve changed)\b/,            tier: "strong" },
      { re: /\b(i am (now |someone who|the kind of person)|i.?m not that person anymore)\b/,        tier: "strong" },
      { re: /\b(i see myself (as|becoming)|becoming (someone|the person) who)\b/,                   tier: "medium" },
      { re: /\b(feel(ing)? like i.?m becoming|starting to (think of|see) myself (as|like))\b/,      tier: "medium" },
      { re: /\b(i.?ve (always been|never been|always wanted to be)|i.?m (finally|actually) becoming)\b/, tier: "weak" },
    ],
    stateDeltas: { motivation: 6, momentum: 5 },
    memoryWrite: {
      memType:      "identity_shift",
      keyPrefix:    "identity",
      minIntensity: 0.58,
      shouldUpsert: false,
    },
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// INTERNAL HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function r1(n: number): number {
  return parseFloat(n.toFixed(1));
}

function applyModifiers(base: number, textBefore: string): number | null {
  const ctx = textBefore.toLowerCase();

  // Negation suppresses the signal entirely
  if (NEGATION.test(ctx.trimEnd())) return null;

  let v = base;
  if (INTENSIFIER.test(ctx)) v = Math.min(1.0, v * 1.28);
  if (DIMINISHER.test(ctx))  v = v * 0.52;

  return Math.max(0.01, Math.min(1.0, v));
}

// Extracts the sentence (or up to 120 chars) that contains the match index
function extractSentence(text: string, matchIndex: number): string {
  const sentenceStart = Math.max(0, text.lastIndexOf(".", matchIndex - 1) + 1);
  const sentenceEnd   = text.indexOf(".", matchIndex);
  const raw = sentenceEnd === -1
    ? text.slice(sentenceStart)
    : text.slice(sentenceStart, sentenceEnd + 1);
  return raw.trim().slice(0, 120);
}

function makeKey(prefix: string, now: Date): string {
  const d = now;
  return `${prefix}_${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

// Returns true if the text contains a specific number or named exercise/activity —
// used to decide whether an achievement is worth writing to memory.
function isSpecificEnough(text: string): boolean {
  return /\d/.test(text) ||
    /\b(squat|bench|deadlift|press|pull.?up|chin.?up|row|run|ran|course|project|exam|session|workout|class|race|set|rep)\b/i.test(text);
}

// ═══════════════════════════════════════════════════════════════════════════════
// CORE DETECTION
// ═══════════════════════════════════════════════════════════════════════════════

function detectSignal(spec: SignalSpec, lower: string, original: string): DetectedSignal | null {
  let best: { intensity: number; evidence: string; matchIndex: number } | null = null;

  for (const { re, tier } of spec.patterns) {
    const m = re.exec(lower);
    if (!m) continue;

    const base      = TIER_BASE[tier];
    const before    = lower.slice(0, m.index);
    const intensity = applyModifiers(base, before);

    if (intensity === null) return null; // negation found
    if (best === null || intensity > best.intensity) {
      best = { intensity, evidence: m[0], matchIndex: m.index };
    }
  }

  if (!best || best.intensity < 0.10) return null;

  return {
    type:      spec.type,
    intensity: r1(best.intensity),
    valence:   spec.valence,
    confidence: r1(Math.min(0.95, best.intensity * 0.9 + 0.15)),
    evidence:  [best.evidence],
  };
}

// When two specs share the same type (consistency positive/negative), keep the
// one with the higher intensity. This resolves "been consistent but slipping up."
function deduplicateByType(signals: DetectedSignal[]): DetectedSignal[] {
  const byType = new Map<SignalType, DetectedSignal>();
  for (const s of signals) {
    const existing = byType.get(s.type);
    if (!existing || s.intensity > existing.intensity) {
      byType.set(s.type, s);
    }
  }
  return Array.from(byType.values());
}

// ═══════════════════════════════════════════════════════════════════════════════
// STATE UPDATE BUILDER
// ═══════════════════════════════════════════════════════════════════════════════

function buildStateUpdates(signals: DetectedSignal[], specs: SignalSpec[]): StateUpdate[] {
  // Build lookup: (type, valence) → spec for fast delta access
  const specIndex = new Map<string, SignalSpec>();
  for (const spec of specs) {
    specIndex.set(`${spec.type}:${spec.valence}`, spec);
  }

  const updates: StateUpdate[] = [];

  for (const signal of signals) {
    const spec = specIndex.get(`${signal.type}:${signal.valence}`);
    if (!spec) continue;

    for (const [rawField, rawDelta] of Object.entries(spec.stateDeltas) as Array<[ScorableField, number]>) {
      const scaled = r1(rawDelta * signal.intensity);
      if (scaled === 0) continue;

      updates.push({
        field:         rawField,
        delta:         scaled,
        reason:        `signal:${signal.type} intensity:${signal.intensity.toFixed(2)} evidence:"${signal.evidence[0]}"`,
        triggerSignal: signal.type,
        confidence:    signal.confidence,
      });
    }
  }

  return updates;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MEMORY WRITE BUILDER
// ═══════════════════════════════════════════════════════════════════════════════

function buildMemoryWrites(signals: DetectedSignal[], text: string, now: Date): MemoryWrite[] {
  const writes: MemoryWrite[] = [];

  for (const signal of signals) {
    const spec = SIGNAL_SPECS.find(s => s.type === signal.type && s.valence === signal.valence);
    if (!spec?.memoryWrite) continue;

    const mw = spec.memoryWrite;
    if (signal.intensity < mw.minIntensity) continue;

    // Additional guard for achievements: only write if the text is specific
    if (signal.type === "achievement" && !isSpecificEnough(text)) continue;

    // Find the sentence containing the evidence phrase for the value
    const evidenceIdx = text.toLowerCase().indexOf(signal.evidence[0]!);
    const sentence    = evidenceIdx >= 0
      ? extractSentence(text, evidenceIdx)
      : text.slice(0, 120).trim();

    writes.push({
      type:         mw.memType,
      key:          makeKey(mw.keyPrefix, now),
      value:        sentence,
      confidence:   signal.confidence,
      shouldUpsert: mw.shouldUpsert,
    });
  }

  return writes;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════════

export function extractSignals(input: SignalEngineInput): SignalEngineOutput {
  const lower    = input.text.toLowerCase();
  const original = input.text;

  const raw = SIGNAL_SPECS
    .map(spec => detectSignal(spec, lower, original))
    .filter((s): s is DetectedSignal => s !== null);

  const detectedSignals = deduplicateByType(raw)
    .sort((a, b) => b.intensity - a.intensity);

  const stateUpdates  = buildStateUpdates(detectedSignals, SIGNAL_SPECS);
  const memoryWrites  = buildMemoryWrites(detectedSignals, original, input.now);

  return { detectedSignals, stateUpdates, memoryWrites };
}
