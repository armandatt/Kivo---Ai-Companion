// ─── Coaching preferences: the onboarding questions (v2) ──────────────────────
// Three questions about how the learner wants to be helped: how things are
// explained, what happens when they get something wrong, and how much is laid
// out at once. The fourth onboarding question, how hard to be pushed, is the
// accountability answer (UserProfile.accountabilityStyle) and is not here.
//
// These replace the four IPIP statements of kivo-signal-v1 for new accounts.
// The difference: v1 asked how someone "is" and inferred how to coach them;
// these ask how they want to be helped, so nothing is inferred. Each answer
// maps to one fixed behavioural line. No score, no band, no trait name, and
// none of it reaches a decision: it shapes wording only, and the learner can
// change it in Settings at any time.
//
// Deterministic. Pure, no imports, so the web app renders from it.

export const STYLE_VERSION = "kivo-style-v2";

export type StyleDimension = "explanation" | "feedback" | "pacing";
export const STYLE_DIMENSIONS: readonly StyleDimension[] = ["explanation", "feedback", "pacing"];

export interface StyleOption { value: string; label: string; hint: string; line: string }
export interface StyleQuestion { id: StyleDimension; question: string; options: readonly StyleOption[] }

// Order is the order shown. Each option is distinct in what Nova does, not
// only in its words: no two options of a question produce the same line.
export const STYLE_QUESTIONS: readonly StyleQuestion[] = [
  {
    id: "explanation",
    question: "When Nova explains something new, what helps you most?",
    options: [
      { value: "big_picture",   label: "The big picture first", hint: "Why it matters and where it fits, then the details.",
        line: "Asked for the big picture first: say why it matters and where it fits before the details." },
      { value: "step_by_step",  label: "Step by step",          hint: "One small piece at a time, in order.",
        line: "Asked for explanations step by step: one small piece at a time, in order." },
      { value: "example_first", label: "An example first",      hint: "One worked example, then the idea behind it.",
        line: "Asked for a worked example before the general idea." },
    ],
  },
  {
    id: "feedback",
    question: "When you get something wrong, what should Nova do?",
    options: [
      { value: "direct", label: "Tell me straight", hint: "Say exactly what's wrong and how to fix it.",
        line: "When they get something wrong, say plainly what is wrong and how to fix it." },
      { value: "hint",   label: "Give me a hint",   hint: "Point me the right way and let me fix it myself.",
        line: "When they get something wrong, give a hint first and let them try again before giving the answer." },
    ],
  },
  {
    id: "pacing",
    question: "When there's a lot to do, how should Nova lay it out?",
    options: [
      { value: "one_thing",    label: "One thing at a time", hint: "Just the next step, nothing else yet.",
        line: "Give one next step at a time rather than a list." },
      { value: "full_picture", label: "The whole list",      hint: "Everything in order, so I can plan around it.",
        line: "When there is a lot to do, lay out the whole list in order before the first step." },
    ],
  },
];

// The two accountability answers, as stored on UserProfile.accountabilityStyle.
export const ACCOUNTABILITY_OPTIONS: ReadonlyArray<{ value: "soft" | "hard"; label: string; hint: string }> = [
  { value: "soft", label: "Gentle nudges", hint: "Remind me kindly. I'll get there." },
  { value: "hard", label: "Hold me to it", hint: "Be firm when I slip. I asked for it." },
];
export const ACCOUNTABILITY_QUESTION = "When you fall behind, how should Nova respond?";

export type StyleAnswers = Record<StyleDimension, string>;

export type StyleValidation =
  | { ok: true; answers: StyleAnswers }
  | { ok: false; errors: string[] };

// A complete set of known answers, or nothing. Like the v1 signal, there is
// no partial preference: an incomplete set is refused whole.
export function validateStyleAnswers(input: unknown): StyleValidation {
  if (input == null || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, errors: ["answers must be an object of question id to option"] };
  }
  const raw = input as Record<string, unknown>;
  const errors: string[] = [];
  for (const key of Object.keys(raw)) {
    if (!(STYLE_DIMENSIONS as readonly string[]).includes(key)) errors.push(`unknown question: ${key}`);
  }
  const answers = {} as StyleAnswers;
  for (const q of STYLE_QUESTIONS) {
    const value = raw[q.id];
    if (typeof value !== "string" || !q.options.some(o => o.value === value)) {
      errors.push(`missing or unknown answer: ${q.id}`);
      continue;
    }
    answers[q.id] = value;
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, answers };
}

// What is stored as the derived record: the same choices under the version.
// There is nothing to score.
export interface StatedStyle { version: typeof STYLE_VERSION; choices: StyleAnswers }

export function statedStyle(answers: StyleAnswers): StatedStyle {
  return { version: STYLE_VERSION, choices: { ...answers } };
}

// A stored record read back; null for anything that is not a v2 record.
export function parseStatedStyle(value: unknown): StatedStyle | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return null;
  const stored = value as { version?: unknown; choices?: unknown };
  if (stored.version !== STYLE_VERSION) return null;
  const checked = validateStyleAnswers(stored.choices);
  return checked.ok ? statedStyle(checked.answers) : null;
}

export const STATED_STYLE_HEADER =
  "How this learner asked to be helped (their own answers, which they can change in Settings). " +
  "A starting preference only: if a message asks for something different, do what the message asks. " +
  "It shapes wording, never what to recommend or how hard to push. Use it silently; never mention it:";

// One line per question, in the order asked.
export function describeStatedStyle(style: StatedStyle | null | undefined): string[] {
  if (!style) return [];
  return STYLE_QUESTIONS
    .map(q => q.options.find(o => o.value === style.choices[q.id])?.line)
    .filter((line): line is string => typeof line === "string");
}
