// ─── Language wording ─────────────────────────────────────────────────────────
// Says a reply Nova's code already wrote, in the learner's language. It is
// expression only: the plain text is the whole content, and nothing may be
// added to it or left out. One small-model call, and the reply does not
// depend on it: when the model is unavailable, or what comes back does not
// carry the same numbers, the plain text goes out as it was written.

import { generateOpenAIText } from "../../services/openai.service";
import { languageLine, type ReplyLanguage } from "../interaction/language";

// Rewording is a courtesy. If it has not come back by now, the reply goes
// out as code wrote it.
export const LANGUAGE_DEADLINE_MS = 5_000;

const DIGITS = "0123456789";

// Every run of digits in a text, in order of appearance, sorted. Two texts
// that state the same figures have the same list.
export function figuresIn(text: string): string[] {
  const found: string[] = [];
  let run = "";
  for (const ch of text) {
    if (DIGITS.includes(ch)) { run += ch; continue; }
    if (run) { found.push(run); run = ""; }
  }
  if (run) found.push(run);
  return found.sort();
}

const DEVANAGARI_START = 0x0900;
const DEVANAGARI_END   = 0x097f;
const hasDevanagari = (text: string) => {
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code >= DEVANAGARI_START && code <= DEVANAGARI_END) return true;
  }
  return false;
};

// Whether a rendering may replace the text it was made from: the same
// figures, Roman script, and not grown into something else.
export function faithful(plain: string, rendered: string): boolean {
  if (!rendered.trim()) return false;
  if (hasDevanagari(rendered)) return false;
  if (rendered.length > plain.length * 2 + 80) return false;
  const a = figuresIn(plain);
  const b = figuresIn(rendered);
  return a.length === b.length && a.every((n, i) => n === b[i]);
}

const SYSTEM = [
  "You reword one message from Nova, a study mentor, for a student. You are given the message in English.",
  "Say exactly what it says: every fact, every name and every figure, and nothing that is not in it. Do not add advice, encouragement, questions, greetings or emoji. Do not drop a line.",
  "Keep the line breaks. Keep anything that starts with a slash (like /today) exactly as written. Keep numbers as digits.",
  "When Nova speaks of itself, prefer forms that are not gendered.",
  "Return only the reworded message. No quotes, no labels, no JSON.",
].join("\n");

export async function sayInLanguage(
  input: { text: string; language: ReplyLanguage },
  // Test seam; production calls the model.
  generate?: typeof generateOpenAIText,
): Promise<{ text: string; rendered: boolean }> {
  const plain = { text: input.text, rendered: false };
  const line  = languageLine(input.language);
  if (!line || !input.text.trim()) return plain;
  try {
    const request = { model: "gpt-4o-mini", systemInstruction: `${SYSTEM}\n${line}`, prompt: input.text, maxOutputTokens: 400, deadlineMs: LANGUAGE_DEADLINE_MS };
    const raw  = generate ? await generate(request) : await generateOpenAIText(request);
    const text = raw.trim();
    return faithful(input.text, text) ? { text, rendered: true } : plain;
  } catch (err) {
    console.error("[nova:language] wording failed, sending the plain text:", (err as Error).message);
    return plain;
  }
}
