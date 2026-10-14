// ─── Lengths of time in a worded reply ────────────────────────────────────────
// The Response Brain words; it does not decide how long anyone studies. A
// length of time it states ("spend twenty minutes on it") must be one Nova
// gave it: in the context, the prompt, or the learner's own message. One that
// is not there was made up, and a made-up length read as Nova's advice is a
// recommendation nobody decided.
//
// This finds the lengths of time a reply states and removes each sentence
// that states one it was not given. Pure, and written with character checks
// only (no pattern matching on the learner's words: it reads Nova's own
// output, and only for numbers followed by a unit of time).

// A reply that had nothing left once its made-up lengths were taken out.
export const UNGROUNDED_REPLY_FALLBACK = "Today's plan has what to study next and for how long, fitted to the time you have.";

const ONES: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const MINUTE_UNITS = new Set(["min", "mins", "minute", "minutes", "m"]);
const HOUR_UNITS   = new Set(["h", "hr", "hrs", "hour", "hours"]);

const isDigit  = (c: string) => c >= "0" && c <= "9";
const isLetter = (c: string) => (c >= "a" && c <= "z");

// Lower-case words and whole numbers, in order. "25-minute" is two words,
// "twenty-five" two words, "1.5" is "1", ".", "5" and is not read as a length.
function words(text: string): string[] {
  const out: string[] = [];
  let cur = "";
  const flush = () => { if (cur) { out.push(cur); cur = ""; } };
  for (const ch of text.toLowerCase()) {
    if (isLetter(ch)) { if (cur && isDigit(cur[0]!)) flush(); cur += ch; }
    else if (isDigit(ch)) { if (cur && !isDigit(cur[0]!)) flush(); cur += ch; }
    else if (ch === ".") { flush(); out.push("."); }
    else flush();
  }
  flush();
  return out;
}

// A number starting at word i: digits, or number words ("twenty five",
// "half an"), with how many words it took. null: no number there.
function numberAt(ws: string[], i: number): { value: number; used: number } | null {
  const w = ws[i];
  if (w === undefined) return null;
  if (isDigit(w[0]!)) return ws[i + 1] === "." ? null : { value: Number(w), used: 1 };
  if (w === "half" && (ws[i + 1] === "an" || ws[i + 1] === "a")) return { value: 0.5, used: 2 };
  if (w in TENS) {
    const next = ws[i + 1];
    if (next !== undefined && next in ONES && next !== "a" && next !== "an" && ONES[next]! < 10) return { value: TENS[w]! + ONES[next]!, used: 2 };
    return { value: TENS[w]!, used: 1 };
  }
  if (w in ONES) return { value: ONES[w]!, used: 1 };
  return null;
}

// Every length of time a text states, in minutes.
export function statedDurations(text: string): number[] {
  const ws = words(text);
  const out: number[] = [];
  for (let i = 0; i < ws.length; i++) {
    const n = numberAt(ws, i);
    if (!n) continue;
    const unit = ws[i + n.used];
    if (unit && MINUTE_UNITS.has(unit) && !(unit === "m" && n.value === 1)) out.push(n.value);
    else if (unit && HOUR_UNITS.has(unit)) out.push(n.value * 60);
    else continue;
    i += n.used;
  }
  return out;
}

// The lengths of time a text gives, in minutes: "25min", "45 minutes",
// "2 hours", and "1 h 30 min" as 90. Only a number with a unit of time is a
// length: a score of 25 or "3 topics" grounds nothing.
function givenDurations(text: string): Set<number> {
  const out = new Set<number>(statedDurations(text));
  // "1 h 30 min" is 90.
  const ds = statedDurations(text);
  for (let i = 0; i + 1 < ds.length; i++) if (ds[i]! % 60 === 0 && ds[i + 1]! < 60) out.add(ds[i]! + ds[i + 1]!);
  return out;
}

function sentences(reply: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < reply.length; i++) {
    const ch = reply[i]!;
    cur += ch;
    const next = reply[i + 1];
    if (ch === "\n" || ((ch === "." || ch === "!" || ch === "?") && (next === undefined || next === " " || next === "\n"))) {
      out.push(cur); cur = "";
    }
  }
  if (cur) out.push(cur);
  return out;
}

export interface GroundedReply {
  reply:   string;
  // The sentences taken out, each stating a length of time it was not given.
  removed: string[];
}

// `told` is everything the model was given: the context, the prompt and the
// learner's message.
export function groundDurations(reply: string, told: string): GroundedReply {
  const given = givenDurations(told);
  const kept: string[] = [];
  const removed: string[] = [];
  for (const s of sentences(reply)) {
    const made = statedDurations(s).filter(d => !given.has(d));
    if (made.length > 0) removed.push(s.trim()); else kept.push(s);
  }
  if (removed.length === 0) return { reply, removed };
  const rest = kept.join("").trim();
  return { reply: rest.length > 0 ? rest : UNGROUNDED_REPLY_FALLBACK, removed };
}

// ─── Topics a worded reply recommends ─────────────────────────────────────────
// What the learner studies next is decided by code and is in the context
// (static layer rule 13). The Response Brain also returns, in `recommends`,
// the name of every topic, chapter, concept or resource its reply suggests
// they study or do next. A name there that Nova was not given (the context,
// the prompt or the learner's own message) was chosen by the model: every
// sentence that names it is taken out. This checks what the model declares;
// a name it recommends without declaring is held back by rule 13 alone.

// Lower case, single spaces, punctuation between words dropped. A full stop
// stays only inside a word ("node.js"), so a sentence's own does not stick to
// its last word.
const isWordChar = (c: string) => isLetter(c) || isDigit(c) || c > "\u007f" || c === "+" || c === "#" || c === "'" || c === "-" || c === "/";
function plain(text: string): string {
  const lower = text.toLowerCase();
  let out = "";
  let space = false;
  for (let i = 0; i < lower.length; i++) {
    const ch = lower[i]!;
    const word = isWordChar(ch) || (ch === "." && i > 0 && isWordChar(lower[i - 1]!) && i + 1 < lower.length && isWordChar(lower[i + 1]!));
    if (word) { if (space && out) out += " "; out += ch; space = false; }
    else space = true;
  }
  return out;
}

// The same, each word without a plural "s", so "deadlock" in a reply is the
// "Deadlocks" Nova gave it. Spaces at both ends, for whole-word matching.
function key(text: string): string {
  const ws = plain(text).split(" ").filter(Boolean).map(w => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
  return ` ${ws.join(" ")} `;
}

export interface GroundedTopics extends GroundedReply {
  // The recommended names that were not given.
  ungrounded: string[];
}

export function groundTopics(reply: string, recommends: readonly string[] | undefined, told: string): GroundedTopics {
  const given = key(told);
  const ungrounded = (recommends ?? [])
    .map(name => key(name))
    .filter((name, i, all) => name.trim().length > 0 && all.indexOf(name) === i)
    .filter(name => !given.includes(name));
  if (ungrounded.length === 0) return { reply, removed: [], ungrounded: [] };
  const kept: string[] = [];
  const removed: string[] = [];
  for (const s of sentences(reply)) {
    const words = key(s);
    if (ungrounded.some(name => words.includes(name))) removed.push(s.trim()); else kept.push(s);
  }
  const names = ungrounded.map(n => n.trim());
  if (removed.length === 0) return { reply, removed, ungrounded: names };
  const rest = kept.join("").trim();
  return { reply: rest.length > 0 ? rest : UNGROUNDED_REPLY_FALLBACK, removed, ungrounded: names };
}
