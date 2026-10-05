// ─── Personality signal: validation and scoring ───────────────────────────────
// Deterministic. No LLM, no I/O. Same answers always give the same signal.

import {
  SIGNAL_ITEMS,
  SIGNAL_SCALE_MAX,
  SIGNAL_SCALE_MIN,
  SIGNAL_VERSION,
  type SignalDimension,
} from "./signal-items";

// Raw answers: item id → 1..5, exactly as the user gave them.
export type SignalAnswers = Record<string, number>;

export type SignalBand = "low" | "mid" | "high";

// The derived signal. Kept separate from the raw answers everywhere it is stored.
export interface PersonalitySignal {
  version: string;
  // 0–100 per dimension, after reverse-scoring.
  scores:  Record<SignalDimension, number>;
  bands:   Record<SignalDimension, SignalBand>;
}

export type SignalValidation =
  | { ok: true;  answers: SignalAnswers }
  | { ok: false; errors: string[] };

// Accepts only a complete set of integer answers for the known items. A partial
// or malformed set is rejected whole: there is no partial signal.
export function validateSignalAnswers(input: unknown): SignalValidation {
  if (input == null || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, errors: ["answers must be an object of item id to 1-5"] };
  }

  const raw = input as Record<string, unknown>;
  const errors: string[] = [];
  const answers: SignalAnswers = {};
  const known = new Set(SIGNAL_ITEMS.map(item => item.id));

  for (const key of Object.keys(raw)) {
    if (!known.has(key)) errors.push(`unknown item: ${key}`);
  }

  for (const item of SIGNAL_ITEMS) {
    const value = raw[item.id];
    if (value === undefined || value === null) {
      errors.push(`missing answer: ${item.id}`);
      continue;
    }
    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < SIGNAL_SCALE_MIN ||
      value > SIGNAL_SCALE_MAX
    ) {
      errors.push(`invalid answer for ${item.id}: must be an integer ${SIGNAL_SCALE_MIN}-${SIGNAL_SCALE_MAX}`);
      continue;
    }
    answers[item.id] = value;
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, answers };
}

// 0–25 low, 50 mid, 75–100 high. With one item per dimension the only possible
// scores are 0, 25, 50, 75 and 100.
export function bandFor(score: number): SignalBand {
  if (score <= 25) return "low";
  if (score >= 75) return "high";
  return "mid";
}

// Call with answers that passed validateSignalAnswers.
export function scoreSignal(answers: SignalAnswers): PersonalitySignal {
  const scores = {} as Record<SignalDimension, number>;
  const bands  = {} as Record<SignalDimension, SignalBand>;

  for (const item of SIGNAL_ITEMS) {
    const given = answers[item.id];
    if (given === undefined) throw new Error(`scoreSignal: missing answer for ${item.id}`);

    const keyed = item.keyed === "-" ? SIGNAL_SCALE_MIN + SIGNAL_SCALE_MAX - given : given;
    const score = ((keyed - SIGNAL_SCALE_MIN) / (SIGNAL_SCALE_MAX - SIGNAL_SCALE_MIN)) * 100;

    scores[item.dimension] = score;
    bands[item.dimension]  = bandFor(score);
  }

  return { version: SIGNAL_VERSION, scores, bands };
}

// Reads a signal back from storage. Returns null for anything that is not a
// signal this code understands, so a future version never gets misread.
export function parseStoredSignal(value: unknown): PersonalitySignal | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return null;
  const stored = value as Partial<PersonalitySignal>;
  if (stored.version !== SIGNAL_VERSION) return null;
  if (!stored.scores || !stored.bands) return null;

  for (const item of SIGNAL_ITEMS) {
    const score = stored.scores[item.dimension];
    const band  = stored.bands[item.dimension];
    if (typeof score !== "number" || score < 0 || score > 100) return null;
    if (band !== "low" && band !== "mid" && band !== "high") return null;
  }
  return { version: stored.version, scores: stored.scores, bands: stored.bands };
}

// ── Prompt context ────────────────────────────────────────────────────────────
// What the model is allowed to see: how to work with this person, phrased as
// behaviour. Never trait names, never scores, never the raw answers. A "mid"
// band says nothing, so it produces no line.
//
// The lines describe HOW to deliver coaching (structure, sequencing, how much
// reasoning, what kind of question). None of them says how hard or how gently
// to push: that is the user's explicit accountability choice, and the signal
// must not restate or contradict it.

const STYLE_LINES: Record<SignalDimension, Partial<Record<SignalBand, string>>> = {
  routine: {
    low:  "Tends to benefit from external structure: give one concrete next step with a time attached.",
    high: "Already keeps a routine: build on their existing schedule rather than imposing a new one.",
  },
  sociability: {
    low:  "Usually keeps replies short and may not volunteer detail: ask one specific question, not an open-ended one.",
    high: "Opens up readily in conversation: a short back-and-forth works well.",
  },
  composure: {
    low:  "Things can pile up on them quickly: give one thing at a time rather than a list.",
    high: "Tends to take setbacks in stride: a miss can be noted once and moved past without dwelling on it.",
  },
  reflection: {
    low:  "Prefers doing over deliberating: lead with the action and keep the reasoning short.",
    high: "Likes to think things through: one line of reasoning behind an instruction helps it land.",
  },
};

export const OPERATING_STYLE_HEADER =
  "How this user tends to operate (self-reported at signup; a starting hypothesis only. " +
  "What they actually do outranks it, and it never changes their chosen accountability style). " +
  "Use it silently to shape how you coach. Never mention it, quote it, or tell the user how they described themselves:";

// A prompt carries at most this many lines.
export const MAX_OPERATING_STYLE_LINES = 3;

// Which lines are kept when more than the maximum apply, most useful first.
const STYLE_PRIORITY: readonly SignalDimension[] = ["routine", "composure", "reflection", "sociability"];

// Returns [] when the signal has nothing useful to say, and never more than
// MAX_OPERATING_STYLE_LINES lines.
export function describeOperatingStyle(signal: PersonalitySignal | null | undefined): string[] {
  if (!signal) return [];
  const lines: string[] = [];
  for (const dimension of STYLE_PRIORITY) {
    const line = STYLE_LINES[dimension][signal.bands[dimension]];
    if (line) lines.push(line);
  }
  return lines.slice(0, MAX_OPERATING_STYLE_LINES);
}
