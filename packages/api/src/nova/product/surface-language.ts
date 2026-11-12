// ─── The learner's language on Nova's product surfaces ───────────────────────
// One rule for every surface that calls the model directly and writes words
// for the learner: the note editor and tutor, Today's Nova, the study
// proposal, Build with Nova. The chat path (Telegram and the web's Nova box)
// chooses its language in interaction/language.ts; this is the same choice for
// replies that are one JSON object.
//
// The language the learner chose (onboarding or Settings) is a standing
// constraint, not a hint: a Hinglish learner is answered in Hinglish for the
// whole reply, every turn, however much English their message carries
// (technical terms are English in Hinglish too). Found 12 Nov: these surfaces
// were given no language at all and always answered in English, while chat
// answered in Hinglish, so Nova seemed to switch at random. Only an explicit
// request in their own words ("reply in English") changes it, and that is the
// model's to read from the message and the conversation.

import { loadVoicePreferences } from "../adapters/account-preferences-adapter";
import type { ReplyLanguage } from "../types/understanding.types";

export type { ReplyLanguage };

// The language they chose, or null (none chosen, or it could not be read).
export async function loadChosenLanguage(platformChatId: string | null | undefined): Promise<ReplyLanguage | null> {
  if (!platformChatId) return null;
  try { return (await loadVoicePreferences(platformChatId)).language; } catch { return null; }
}

// `content`: what else the reply writes. "note" — text that goes into the
// learner's note keeps the note's own language; only Nova's words to them
// follow the rule.
export function surfaceLanguageLine(chosen: ReplyLanguage | null, opts: { content?: "note" } = {}): string {
  const note = opts.content === "note"
    ? " Text you write INTO THE NOTE (replacements, insertions) keeps the note's own language and style; only your words to the learner (summary, why, question) follow this rule."
    : "";
  const keep = "Keep technical terms, code, formulas, names of subjects, topics, files and people, numbers and dates exactly as they are, in English; do not invent Hindi for technical words.";
  const explicit = "Change language only if the learner explicitly asks you to (\"reply in English\", \"Hinglish mein bolo\"), and keep to what they asked for from then on in this conversation.";
  if (chosen === "hinglish") {
    return `LANGUAGE: Hinglish, the learner's chosen language. Write every sentence meant for them in natural Hinglish (Hindi in Roman letters mixed with English, the way an Indian student texts a friend), from the first sentence to the last, every turn, even when their message is mostly English. No Devanagari, nothing formal. ${keep} ${explicit}${note}`;
  }
  if (chosen === "hindi") {
    return `LANGUAGE: Hindi, the learner's chosen language. Write every sentence meant for them in everyday Hindi in the script their messages use (Devanagari unless they write in Roman letters), every turn. ${keep} ${explicit}${note}`;
  }
  return `LANGUAGE: English, unless the learner writes to you in Hinglish (Hindi in Roman letters) or Hindi; then answer in that, for the whole reply. ${keep}${note}`;
}
