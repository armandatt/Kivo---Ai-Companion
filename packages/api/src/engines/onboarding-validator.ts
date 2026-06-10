import { generateOpenAIText } from "../services/openai.service";

// ── Gibberish detection — pure regex, no LLM ─────────────────────────────────
// Catches keyboard mashing, random consonant strings, and repeated chars.
// Returns false for anything plausible — false negatives are fine here because
// the LLM classifier downstream handles edge cases.

export function detectGibberish(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (t.length < 4) return false;

  const letters = t.replace(/[^a-z]/g, "");
  if (letters.length === 0) return false;

  // All letters, no vowels, 5+ chars — pure consonant mash (e.g. "fsfgv", "sdbfjsdbf")
  if (letters.length >= 5 && !/[aeiou]/.test(letters)) return true;

  // Very low vowel density (< 10%) across 8+ letters
  if (letters.length >= 8) {
    const vowelCount = (letters.match(/[aeiou]/g) ?? []).length;
    if (vowelCount / letters.length < 0.10) return true;
  }

  // Repeated single character (e.g. "aaaaaaa", "zzzzz")
  if (/^(.)\1{4,}$/.test(t)) return true;

  return false;
}

// ── LLM classifier — Layer 2.5 ────────────────────────────────────────────────
// Only runs when the per-step parser returns isUnknown and detectGibberish is
// false. Uses gpt-4o-mini (fast + cheap) with a single-word output constraint.

export type InvalidAnswerClass =
  | "question"    // user is asking about the step or the system
  | "off_topic"   // user talking about something unrelated
  | "insult"      // rude, hostile, or abusive reply
  | "gibberish"   // random characters / nonsense (fallback when regex missed it)
  | "uncertain";  // might be attempting an answer but is unclear

const VALID_CLASSES = new Set<string>(["question", "off_topic", "insult", "gibberish", "uncertain"]);

export async function classifyInvalidAnswer(
  text: string,
  stepQuestion: string,
): Promise<InvalidAnswerClass> {
  try {
    const raw = await generateOpenAIText({
      model:             "gpt-4o-mini",
      maxOutputTokens:   10,
      systemInstruction:
        "Classify why a user's reply failed to answer an onboarding question.\n" +
        "Reply ONLY one word:\n" +
        "question  — user is asking about the question or the app\n" +
        "off_topic — user is talking about something unrelated\n" +
        "insult    — user is being rude, hostile, or abusive\n" +
        "gibberish — random characters, nonsense, keyboard mashing\n" +
        "uncertain — user might be attempting an answer but is unclear",
      prompt:
        `Question: "${stepQuestion.slice(0, 120)}"\nUser replied: "${text.slice(0, 120)}"`,
    });
    const label = raw.trim().toLowerCase().split(/\s/)[0] ?? "";
    return VALID_CLASSES.has(label) ? (label as InvalidAnswerClass) : "uncertain";
  } catch {
    return "uncertain";
  }
}

// ── Re-ask message builder ────────────────────────────────────────────────────
// Inside onboarding: no roasting, no sarcasm. One firm sentence + repeat the question.

export function buildInvalidAnswerReply(
  cls: InvalidAnswerClass,
  stepQuestion: string,
): string {
  const prefixes: Record<InvalidAnswerClass, string> = {
    question:  "I'll cover that after setup. Right now I need this answer:",
    off_topic: "Let's stay on track.",
    insult:    "I need a real answer for this one.",
    gibberish: "I need a real answer for this one.",
    uncertain: "Not sure what you mean — try being more specific.",
  };
  return `${prefixes[cls]}\n\n${stepQuestion}`;
}
