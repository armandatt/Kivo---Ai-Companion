// ─── Reply language ───────────────────────────────────────────────────────────
// Which language Nova words a reply in. It follows the learner: the language
// of the message being answered when the reading could tell, else the
// language of the last message of theirs that had one. Pure; the reading and
// the log are passed in.
//
// It changes wording only. What was decided, every topic and subject name,
// and every number are the same in both languages. Button labels are not
// translated: they are short English either way.

import type { ReplyLanguage } from "../types/understanding.types";

export type { ReplyLanguage };

// A reading that names a language always wins: writing in a language is the
// learner asking for it, in this conversation. One that names none keeps the
// last language only for a message too short to tell ("ok", "30", a topic
// name): it is a reply within that conversation. A message of a sentence or
// more that came back with no language is answered in the language the
// learner chose for Nova, or English, the default, when they chose none,
// rather than in whatever the previous message was in: the reading failed to
// label it, and carrying the last language over is how "How is my progress
// going?" was answered in Hinglish after a Hinglish message.
//
// The chosen language is also where a conversation starts: callers pass it
// as `last` when the log holds no language yet (loadReplyLanguage), and Nova
// uses it when it speaks first.
export const SENTENCE_WORDS = 4;
export function chooseLanguage(
  read: ReplyLanguage | null | undefined, last: ReplyLanguage, text?: string, preferred: ReplyLanguage | null = null,
): ReplyLanguage {
  if (read) return read;
  return text !== undefined && wordCount(text) >= SENTENCE_WORDS ? (preferred ?? "english") : last;
}

// Words with at least one letter: "8 pm" is one word, "30" none.
export function wordCount(text: string): number {
  let words = 0;
  for (const word of text.split(" ").join("\n").split("\n")) if ([...word].some(isLetter)) words++;
  return words;
}

// ── What the script itself says ───────────────────────────────────────────────
// A message written mostly in Devanagari is Hindi. That much needs no model
// and no word list: it is read off the letters, so it holds when the model is
// unavailable too. Roman-script Hindi is not decided here (the reading tells
// Hinglish from English), and a name or a profile is never consulted.
const DEVANAGARI = { from: 0x0900, to: 0x097f };
const isDevanagari = (ch: string) => { const code = ch.codePointAt(0)!; return code >= DEVANAGARI.from && code <= DEVANAGARI.to; };
const isLetter     = (ch: string) => ch.toLowerCase() !== ch.toUpperCase() || isDevanagari(ch);
export function scriptLanguage(text: string): ReplyLanguage | null {
  // Counted in words, not letters: English terms are long and Hindi's own
  // words are short, so letters would call "Mealy और Moore machines समझाओ"
  // English when its grammar is Hindi.
  let words = 0, devanagari = 0;
  for (const word of text.split(" ").join("\n").split("\n")) {
    const letters = [...word].filter(isLetter);
    if (letters.length === 0) continue;
    words++;
    if (letters.some(isDevanagari)) devanagari++;
  }
  // Two or more Hindi words making up over a third of the message, or a
  // message that is one Hindi word. An English sentence that quotes a Hindi
  // word or two is not Hindi.
  if (devanagari >= 2 && devanagari * 3 > words) return "hindi";
  return devanagari === 1 && words <= 2 ? "hindi" : null;
}

const LINES: Record<ReplyLanguage, string | null> = {
  english:  null,
  hindi:    "Language: Hindi. The student wrote in Devanagari, so reply in natural, everyday Hindi in Devanagari script, the way a student texts a friend, not formal or literary. Keep every topic name, subject name, exam title, command, number, duration and date exactly as given, in English letters and digits. Study words may stay English (exam, topic, session, review, plan, minutes).",
  hinglish: "Language: Hinglish. Write the way an Indian student texts a friend: Hindi in Roman letters mixed naturally with English. No Devanagari. Keep every topic name, subject name, exam title, number, duration and date exactly as given, in English. Study words stay English (exam, topic, session, review, plan, minutes). Do not translate word for word and do not sound formal.",
};

// One line for the Response Brain. null: nothing to add (English is its default).
export const languageLine = (language: ReplyLanguage): string | null => LINES[language];
