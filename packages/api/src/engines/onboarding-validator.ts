import { generateOpenAIText } from "../services/openai.service";

// ── Answer types — Layer 2.5 ──────────────────────────────────────────────────
// DATA types: what a user's message contains (valid for some step)
// BEHAVIORAL types: why a user's message failed to answer (invalid everywhere)

export type AnswerType =
  | "GOAL_ANSWER"          // fitness goal (muscle, strength, fat loss…)
  | "BODY_STATS"           // weight and/or height numbers
  | "TRAINING_TIME"        // time of day for training
  | "TRAINING_FREQUENCY"   // days per week or training split
  | "EXPERIENCE_LEVEL"     // beginner / intermediate / advanced
  | "LIFTS"                // squat / bench / deadlift numbers
  | "PROTEIN"              // protein intake in grams
  | "INJURY"               // injury description or body part
  | "NAME"                 // a person's name or nickname
  | "QUESTION"             // user asking about the question or the app
  | "INSULT"               // rude, hostile, or abusive
  | "GENERAL_CHAT"         // generic conversational message
  | "OFF_TOPIC"            // unrelated topic
  | "GIBBERISH"            // random characters, nonsense
  | "UNCERTAIN"            // unclear attempt at an answer
  | "SKIP_REQUEST";        // explicit skip / idk / pass

// Kept for backward-compatibility — prefer AnswerType in new code.
export type InvalidAnswerClass = "question" | "off_topic" | "insult" | "gibberish" | "uncertain";

export interface AnswerClassification {
  answerType:          AnswerType;
  confidence:          number;
  extractedValue:      string | null;  // informational only — do not use for state mutation
  validForCurrentStep: boolean;
}

// ── Step context — feeds LLM classifier so it knows what's expected ───────────
const STEP_CONTEXT: Record<string, { expectedType: AnswerType; description: string }> = {
  name:         { expectedType: "NAME",               description: "user's first name or nickname" },
  goal:         { expectedType: "GOAL_ANSWER",        description: "fitness goal: muscle, strength, fat loss, general fitness, or athletic performance" },
  body_stats:   { expectedType: "BODY_STATS",         description: "bodyweight (kg or lbs) and/or height (cm or feet/inches)" },
  experience:   { expectedType: "EXPERIENCE_LEVEL",   description: "training experience: beginner, intermediate, or advanced, or years/months of training" },
  lifts:        { expectedType: "LIFTS",              description: "squat, bench, deadlift numbers in kg or lbs" },
  days:         { expectedType: "TRAINING_FREQUENCY", description: "number of training days per week (1-7)" },
  split:        { expectedType: "TRAINING_FREQUENCY", description: "training split (PPL, Upper/Lower, Full Body) or a request to build one" },
  gym_time:     { expectedType: "TRAINING_TIME",      description: "time of day for training (6pm, morning, 18:00)" },
  protein:      { expectedType: "PROTEIN",            description: "daily protein intake in grams, or 'not tracking'" },
  injury:       { expectedType: "INJURY",             description: "injury description, body part to avoid, or 'none'" },
};

// ── Gibberish detection — pure regex, zero LLM cost ──────────────────────────
// False negatives are fine — the LLM classifier handles edge cases.
export function detectGibberish(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (t.length < 4) return false;

  const letters = t.replace(/[^a-z]/g, "");
  if (letters.length === 0) return false;

  // Pure consonant string (5+ letters, no vowels)
  if (letters.length >= 5 && !/[aeiou]/.test(letters)) return true;

  // Very low vowel density (<10%) across 8+ letters
  if (letters.length >= 8) {
    const vowelCount = (letters.match(/[aeiou]/g) ?? []).length;
    if (vowelCount / letters.length < 0.10) return true;
  }

  // Repeated single character (e.g. "aaaaaaa", "zzzzz")
  if (/^(.)\1{4,}$/.test(t)) return true;

  return false;
}

// ── LLM classifier — Layer 2.5 ───────────────────────────────────────────────
// Returns structured classification: answerType + whether valid for current step.
// Called when: parser returns isUnknown, or step-level validation (name, injury).
const VALID_ANSWER_TYPES = new Set<string>([
  "GOAL_ANSWER", "BODY_STATS", "TRAINING_TIME", "TRAINING_FREQUENCY",
  "EXPERIENCE_LEVEL", "LIFTS", "PROTEIN", "INJURY", "NAME",
  "QUESTION", "INSULT", "GENERAL_CHAT", "OFF_TOPIC", "GIBBERISH",
  "UNCERTAIN", "SKIP_REQUEST",
]);

export async function classifyAnswer(
  text:         string,
  stepId:       string,
  stepQuestion: string,
): Promise<AnswerClassification> {
  const ctx          = STEP_CONTEXT[stepId];
  const expectedType = ctx?.expectedType ?? "UNCERTAIN";
  const expectedDesc = ctx?.description  ?? stepId;

  try {
    const raw = await generateOpenAIText({
      model:             "gpt-4o-mini",
      maxOutputTokens:   80,
      systemInstruction:
        "You are an onboarding answer classifier. Return ONLY valid compact JSON, no extra text.\n" +
        'Schema: {"answerType":"...","confidence":0.0,"extractedValue":"...or null","validForCurrentStep":true}\n' +
        "answerType must be one of: GOAL_ANSWER BODY_STATS TRAINING_TIME TRAINING_FREQUENCY " +
        "EXPERIENCE_LEVEL LIFTS PROTEIN INJURY NAME QUESTION INSULT GENERAL_CHAT OFF_TOPIC " +
        "GIBBERISH UNCERTAIN SKIP_REQUEST",
      prompt:
        `Step: ${stepId}\n` +
        `Expects: ${expectedType} — ${expectedDesc}\n` +
        `Question shown: "${stepQuestion.slice(0, 120)}"\n` +
        `User replied: "${text.slice(0, 150)}"\n\n` +
        "Classify the reply. Set validForCurrentStep=true only if the reply directly answers this step's question.",
    });

    const jsonMatch = raw.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) return fallbackClassification(text);

    const p = JSON.parse(jsonMatch[0]) as Partial<AnswerClassification & { answerType: string }>;
    const answerType = VALID_ANSWER_TYPES.has(String(p.answerType))
      ? (p.answerType as AnswerType)
      : "UNCERTAIN";

    return {
      answerType,
      confidence:          typeof p.confidence === "number" ? Math.min(1, Math.max(0, p.confidence)) : 0.50,
      extractedValue:      typeof p.extractedValue === "string" ? p.extractedValue : null,
      validForCurrentStep: Boolean(p.validForCurrentStep),
    };
  } catch {
    return fallbackClassification(text);
  }
}

function fallbackClassification(text: string): AnswerClassification {
  return {
    answerType:          detectGibberish(text) ? "GIBBERISH" : "UNCERTAIN",
    confidence:          0.40,
    extractedValue:      null,
    validForCurrentStep: false,
  };
}

// ── Name validation gate ─────────────────────────────────────────────────────
// Catches profanity, insults, and conversational terms before they become names.
// Hard-coded for instant, zero-cost rejection of obvious cases.
const INVALID_NAME_LOWER = new Set([
  // Profanity
  "fuck", "fucking", "shit", "bitch", "ass", "dick", "cunt", "bastard",
  "fuck off", "piss off", "get lost",
  // Insults / rhetorical questions
  "are you stupid", "are you kidding", "are you serious", "wtf", "stfu",
  // Single-word conversational replies
  "why", "what", "how", "when", "where", "who",
  "ok", "okay", "sure", "fine", "yes", "no", "nah", "yeah", "yep", "nope",
  "bye", "hi", "hey", "hello", "thanks", "thank you",
  "lol", "omg", "idk", "none", "nothing",
  // Casual address terms that aren't names
  "bro", "dude", "man", "babe", "buddy", "mate", "pal", "sir", "boss", "dawg",
]);

const PROFANITY_RE = /\b(f+u+c+k|sh[i1]t|b[i1]+tch|a+s+hole|bastard|c+u+n+t)\b/i;

export function validateName(text: string): { valid: boolean; reason: string } {
  const lower  = text.trim().toLowerCase();
  const simple = lower.replace(/[^a-z\s]/g, "").trim();

  if (INVALID_NAME_LOWER.has(lower) || INVALID_NAME_LOWER.has(simple)) {
    return { valid: false, reason: "conversational_or_insult" };
  }
  if (PROFANITY_RE.test(lower)) {
    return { valid: false, reason: "profanity" };
  }
  return { valid: true, reason: "ok" };
}

// ── Injury validation gate ────────────────────────────────────────────────────
// Fast reject for obvious non-injury text (no LLM needed for these cases).
// If this passes, the caller may still run classifyAnswer for edge cases.
const INVALID_INJURY_LOWER = new Set([
  "wtf", "bro", "dude", "why", "what", "ok", "okay", "lol", "idk",
  "hi", "hello", "are you stupid", "are you kidding", "stfu",
  "fuck", "shit", "bitch", "wtf is this",
]);

export function validateInjuryText(text: string): boolean {
  const lower = text.trim().toLowerCase();
  if (INVALID_INJURY_LOWER.has(lower)) return false;
  if (PROFANITY_RE.test(lower)) return false;
  return true;
}

// ── Re-ask message builder ────────────────────────────────────────────────────
// Builds the response shown when a user's answer is rejected at any step.
// Handles: invalid answer types, cross-step answers, question handling, skip on required.

// Human-readable hints for cross-step answers
const WRONG_STEP_HINTS: Partial<Record<AnswerType, string>> = {
  BODY_STATS:           "I'll ask about weight and height in a moment.",
  TRAINING_FREQUENCY:   "I'll ask about training days shortly.",
  LIFTS:                "I'll ask about your lifts after this.",
  PROTEIN:              "I'll ask about protein intake later.",
  INJURY:               "I'll ask about injuries at the end.",
  TRAINING_TIME:        "I'll ask about your gym time shortly.",
  EXPERIENCE_LEVEL:     "I'll ask about your experience level next.",
  GOAL_ANSWER:          "I'll ask about your goal shortly.",
  NAME:                 "I'll use your name once we get through setup.",
};

export function buildInvalidAnswerReply(
  cls:                      AnswerType | InvalidAnswerClass,
  stepQuestion:             string,
  contextExplanation?:      string,
  validAnswerButWrongStep?: AnswerType,
): string {
  // User gave a real data answer but for a different step
  if (validAnswerButWrongStep) {
    const hint = WRONG_STEP_HINTS[validAnswerButWrongStep] ?? "";
    return `${hint ? hint + " " : ""}Right now: ${stepQuestion}`;
  }

  // Question on a required step + context explanation → answer the question, then re-ask
  if ((cls === "QUESTION" || cls === "question") && contextExplanation) {
    return `${contextExplanation}\n\n${stepQuestion}`;
  }

  // Skip request on a required step + context explanation → explain why required, then re-ask
  if (cls === "SKIP_REQUEST" && contextExplanation) {
    return `${contextExplanation}\n\n${stepQuestion}`;
  }

  // Per-type prefixes — map both new AnswerType and old InvalidAnswerClass values
  const prefixes: Record<string, string> = {
    QUESTION:     "I'll explain more after setup.",
    INSULT:       "You can roast me after setup. Right now I need an actual answer.",
    GIBBERISH:    "I need a real answer for this one.",
    OFF_TOPIC:    "Let's stay on track.",
    GENERAL_CHAT: "Let's stay on track.",
    UNCERTAIN:    "Not sure what you mean — try being more specific.",
    SKIP_REQUEST: "This step is required. I need a real answer before moving on.",
    // Backward-compat lowercase variants
    question:     "I'll explain more after setup.",
    insult:       "You can roast me after setup. Right now I need an actual answer.",
    gibberish:    "I need a real answer for this one.",
    off_topic:    "Let's stay on track.",
    uncertain:    "Not sure what you mean — try being more specific.",
  };
  const prefix = prefixes[cls] ?? "Not sure what you mean — try being more specific.";
  return `${prefix}\n\n${stepQuestion}`;
}
