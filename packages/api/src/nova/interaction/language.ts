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

export function chooseLanguage(read: ReplyLanguage | null | undefined, last: ReplyLanguage): ReplyLanguage {
  return read ?? last;
}

const LINES: Record<ReplyLanguage, string | null> = {
  english:  null,
  hinglish: "Language: Hinglish. Write the way an Indian student texts a friend: Hindi in Roman letters mixed naturally with English. No Devanagari. Keep every topic name, subject name, exam title, number, duration and date exactly as given, in English. Study words stay English (exam, topic, session, review, plan, minutes). Do not translate word for word and do not sound formal.",
};

// One line for the Response Brain. null: nothing to add (English is its default).
export const languageLine = (language: ReplyLanguage): string | null => LINES[language];
