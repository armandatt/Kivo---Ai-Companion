import { prisma } from "@repo/db/client";
import { addToShortTerm } from "../services/memory.service";
import {
  parseMessage,
  IntentType,
  isAffirmative,
  isNegative,
  isModificationRequest,
  type ParseContext,
} from "./parsing-engine-v2";
import {
  detectGibberish,
  classifyInvalidAnswer,
  buildInvalidAnswerReply,
  type InvalidAnswerClass,
} from "./onboarding-validator";

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export type StepId =
  | "name" | "goal" | "body_stats" | "experience" | "lifts"
  | "days" | "split" | "confirm_split" | "gym_time"
  | "protein" | "injury" | "review";

export interface ParseResult {
  confidence: number;
  extractedValue: string | null;
  normalizedValue: string | null;
  parserReason: string;
  isSkip: boolean;
  isUnknown: boolean;
  requiresVerification: boolean;
}

interface PendingVerification {
  step: StepId;
  proposedValue: string;   // display text shown in the verification question
  canonicalValue: string;  // Bug 4: value that actually gets stored on confirm
  originalInput: string;
  storageKey: string;
  confirmQuestion: string;
}

interface GeneratedSplit {
  splitType: string;
  displayText: string;
  splitDaysJson: string;
}

interface AuditEntry {
  step: StepId;
  rawAnswer: string;
  normalizedAnswer: string | null;
  confidence: number;
  storedValue: string | null;
  nextStep: StepId | null;
  action: "stored" | "verification_requested" | "skipped" | "unknown_stored" | "loop_prevented" | "resumed" | "split_generated" | "split_confirmed";
  ts: number;
}

interface OnboardingState {
  userId: string;
  currentStep: StepId;
  answers: Record<string, string>;
  pendingVerification: PendingVerification | null;
  pendingGeneratedSplit: GeneratedSplit | null;
  pendingPartialSplit: { days: string[] } | null;  // Bug 2: accumulates split days
  repeatCounts: Record<string, number>;
  startedAt: number;
  lastActivityAt: number;
  completedAt: number | null;
  resumedAt: number | null;
  auditLog: AuditEntry[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// ANSWER NORMALIZER
// Maps every known fuzzy input to a canonical signal.
// ═══════════════════════════════════════════════════════════════════════════════

const SKIP_SIGNALS = new Set([
  "idk", "i don't know", "i dont know", "idontknow", "don't know", "dont know",
  "not sure", "unsure", "no idea", "not sure yet", "no clue",
  "k", "skip", "pass", "next", "whatever", "doesnt matter", "doesn't matter",
  "either way", "you decide", "up to you", "your call", "up to rex",
]);

const NOT_TRACKING_SIGNALS = new Set([
  "not tracking", "no tracking", "dont track", "don't track",
  "not measuring", "not counting", "no idea about macros",
  "can't track", "cant track", "not monitored", "no macros",
  "nope", "no i don't", "i don't", "i dont", "none",
]);

const BUILD_SPLIT_SIGNALS = new Set([
  "build one", "build me one", "create one", "create a split",
  "generate one", "generate a split", "make one", "make one for me",
  "make a split", "build a split", "you pick", "you choose",
  "you decide", "pick for me", "i don't have one", "i dont have one",
  "don't have a split", "dont have a split", "no split", "no idea",
  "help me build", "build it", "you build it", "random", "winging it",
  "no plan", "haven't thought about it", "haven't thought",
]);

const YES_SIGNALS = new Set([
  "yes", "yeah", "yep", "yup", "ya", "y", "correct", "right",
  "exactly", "that's right", "thats right", "that is right",
  "confirm", "confirmed", "sure", "ok", "okay", "ок",
  "sounds good", "looks good", "good", "perfect", "great", "fine",
  "works", "works for me", "that works", "i'm good", "im good",
]);

const NO_SIGNALS = new Set([
  "no", "nope", "nah", "n", "incorrect", "wrong", "negative",
  "that's not right", "thats not right", "not right", "not correct",
  "change it", "adjust", "modify",
]);

const NONE_INJURY_SIGNALS = new Set([
  "none", "no", "nothing", "n/a", "na", "nah", "no injuries",
  "no injury", "all clear", "all good", "healthy", "not injured",
  "injury free", "clean", "fine",
]);

// Bug 5: detect Hinglish text at the split step — stay on step, show language notice
const HINGLISH_MARKERS = /\b(bhai|yaar|arre|arrey|kyu|kyun|kha\s+raha|kha\s+liya|dimag|bana\s+(na|do|de|le)|banana\s+hai|theek\s+hai|accha|acha|nahi|nhi|matlab|zyada|thoda|zaroor|samjha|samjhe|wala|wali|hoga|hoge|lagta|lagti)\b/i;
const DEVANAGARI       = /[ऀ-ॿ]/;  // Devanagari Unicode block (script-level detection)

export function normalize(text: string): {
  isSkip: boolean;
  isNotTracking: boolean;
  isBuildSplit: boolean;
  isYes: boolean;
  isNo: boolean;
  isNoneInjury: boolean;
  cleaned: string;
} {
  const lower = text.toLowerCase().trim();
  const stripped = lower.replace(/[^\w\s']/g, "").trim();

  return {
    isSkip:        SKIP_SIGNALS.has(lower) || SKIP_SIGNALS.has(stripped),
    isNotTracking: NOT_TRACKING_SIGNALS.has(lower) || NOT_TRACKING_SIGNALS.has(stripped),
    isBuildSplit:  BUILD_SPLIT_SIGNALS.has(lower) || BUILD_SPLIT_SIGNALS.has(stripped)
                   || /\b(build|generate|create|make)\s+(one|it|me one|a split|my split)\b/.test(lower)
                   || /\b(you\s+(pick|choose|decide|build))\b/.test(lower),
    // NOTE: isYes/isNo are kept ONLY as a fallback safety layer for
    // classifyConfirmation() below. Do not use these directly for
    // confirmation/rejection decisions — they require an exact string match
    // and miss natural phrasing like "good with this" or "looks good".
    isYes:         YES_SIGNALS.has(lower) || YES_SIGNALS.has(stripped),
    isNo:          NO_SIGNALS.has(lower) || NO_SIGNALS.has(stripped),
    isNoneInjury:  NONE_INJURY_SIGNALS.has(lower) || NONE_INJURY_SIGNALS.has(stripped),
    cleaned:       lower,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIRMATION CLASSIFIER — backed by Parsing Engine V2
//
// Single source of truth for "is this reply a confirmation, a rejection, or a
// modification request?" used by confirm_split, pendingVerification, and the
// review step. Parsing Engine V2's CONFIRMATION / SESSION_CONFIRMATION /
// REJECTION intents (and its isAffirmative/isNegative regexes) are checked
// first; the legacy YES_SIGNALS/NO_SIGNALS exact-match sets are only a final
// fallback safety net.
// ═══════════════════════════════════════════════════════════════════════════════

export type ConfirmationClass = "yes" | "no" | "modify" | "unclear";

export function classifyConfirmation(text: string, lastQuestion: string): ConfirmationClass {
  // Modification requests ("swap chest and back", "change it") take priority
  // — these are actionable regardless of how V2 classifies the rest of the text.
  if (isModificationRequest(text)) return "modify";

  // Parsing Engine V2 — primary classifier. The last assistant message is
  // passed so Q_GENERAL_YES_NO_RE-style disambiguation kicks in (onboarding
  // questions all end in "?").
  const ctx: ParseContext = { recentMessages: [{ role: "assistant", text: lastQuestion }] };
  const v2 = parseMessage(text, ctx);
  const top = v2.intents[0];
  if (top && !top.requiresClarification && top.confidence >= 0.60) {
    if (top.type === IntentType.CONFIRMATION || top.type === IntentType.SESSION_CONFIRMATION) return "yes";
    if (top.type === IntentType.REJECTION) return "no";
  }

  // Direct affirmative/negative regexes — covers phrasing parseMessage's
  // conversation-state disambiguation doesn't reach.
  if (isAffirmative(text)) return "yes";
  if (isNegative(text)) return "no";

  // Legacy exact-match sets — fallback safety layer only.
  const n = normalize(text);
  if (n.isYes) return "yes";
  if (n.isNo) return "no";

  return "unclear";
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIDENCE LAYER — per-step parsers
// ═══════════════════════════════════════════════════════════════════════════════

function skip(reason = "skip_signal"): ParseResult {
  return { confidence: 0.95, extractedValue: null, normalizedValue: null, parserReason: reason, isSkip: true, isUnknown: false, requiresVerification: false };
}

function unknown(reason = "ambiguous"): ParseResult {
  return { confidence: 0.40, extractedValue: null, normalizedValue: null, parserReason: reason, isSkip: false, isUnknown: true, requiresVerification: false };
}

function hit(value: string, norm: string, reason: string, conf: number, verify = false): ParseResult {
  return { confidence: conf, extractedValue: value, normalizedValue: norm, parserReason: reason, isSkip: false, isUnknown: false, requiresVerification: verify };
}

// ── name ─────────────────────────────────────────────────────────────────────

export function parseName(text: string): ParseResult {
  const n = normalize(text);
  if (n.isSkip) return skip();
  // A question mark at the end means this is a question, not a name
  if (text.trim().endsWith("?")) return unknown("question_detected");
  const t = text.trim();
  if (/^[A-Za-z][a-zA-Z'\-\s]{1,28}$/.test(t)) {
    const cap = t.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
    return hit(cap, cap, "name_format", 0.92);
  }
  if (t.length >= 2 && t.length <= 30 && !/[\d@/]/.test(t)) {
    return hit(t, t, "possible_name", 0.65, true);
  }
  return unknown("not_name_like");
}

// ── goal ─────────────────────────────────────────────────────────────────────

const GOAL_MAP: Array<{ keys: string[]; canonical: string; display: string }> = [
  { keys: ["muscle", "build", "bulk", "size", "hypertrophy", "mass", "gain", "bigger", "gains"], canonical: "muscle", display: "Build muscle" },
  { keys: ["strength", "strong", "power", "powerlifting", "lift more", "1rm", "stronger"],        canonical: "strength", display: "Build strength" },
  { keys: ["fat", "weight loss", "lean", "cut", "cutting", "lose", "shred", "slim", "tone"],      canonical: "fat_loss", display: "Lose fat / cut" },
  // general_fitness must come before athletic_performance — "general fitness" contains "fitness"
  // which would incorrectly match athletic_performance if checked first.
  { keys: ["healthy", "general", "active", "stay fit", "maintain", "overall"],                    canonical: "general_fitness", display: "General fitness" },
  { keys: ["athletic", "performance", "sport", "endurance", "fitness"],                           canonical: "athletic_performance", display: "Athletic performance" },
  { keys: ["recomp", "recomposition", "body recomp"],                                             canonical: "recomposition", display: "Body recomposition" },
];

export function parseGoal(text: string): ParseResult {
  const n = normalize(text);
  if (n.isSkip) return skip();
  const lower = text.toLowerCase();
  for (const g of GOAL_MAP) {
    if (g.keys.some(k => lower.includes(k))) {
      return hit(g.canonical, g.display, "goal_keyword", 0.88);
    }
  }
  return unknown("goal_not_recognized");
}

// ── body_stats (bodyweight + height) ─────────────────────────────────────────

export function parseBodyStats(text: string): ParseResult {
  const n = normalize(text);
  if (n.isSkip) return skip();
  const lower = text.toLowerCase();

  let bw: number | null = null;
  let ht: number | null = null;

  // Bodyweight: kg or lbs
  const kgM = lower.match(/(\d+(?:\.\d+)?)\s*kg/);
  if (kgM) bw = parseFloat(kgM[1]!);
  else {
    const lbM = lower.match(/(\d+(?:\.\d+)?)\s*(?:lbs?|pounds?)/);
    if (lbM) bw = Math.round(parseFloat(lbM[1]!) * 0.453592);
    else {
      // bare number in bodyweight range
      const bare = text.trim().match(/^(\d+(?:\.\d+)?)$/);
      if (bare) { const v = parseFloat(bare[1]!); if (v >= 30 && v <= 300) bw = v; }
    }
  }

  // Height: cm or feet/inches
  const cmM = lower.match(/(\d{2,3})\s*cm/);
  if (cmM) ht = parseInt(cmM[1]!);
  else {
    const ftIn = lower.match(/(\d)\s*['"ft\s]+\s*(\d{1,2})/);
    if (ftIn) ht = Math.round(parseInt(ftIn[1]!) * 30.48 + parseInt(ftIn[2]!) * 2.54);
  }

  if (bw === null && ht === null) return unknown("no_body_stats");

  const parts: string[] = [];
  if (bw !== null) parts.push(`bw:${Math.round(bw)}`);
  if (ht !== null) parts.push(`ht:${ht}`);
  const encoded = parts.join("|");

  return hit(encoded, encoded, "body_stats_parsed", bw !== null && ht !== null ? 0.92 : 0.70, bw === null || ht === null);
}

// ── experience ────────────────────────────────────────────────────────────────

export function parseExperience(text: string): ParseResult {
  const n = normalize(text);
  if (n.isSkip) return skip("experience_skipped_assume_intermediate");
  const lower = text.toLowerCase();

  const yearMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:yr|year|years)/);
  if (yearMatch) {
    const yrs = parseFloat(yearMatch[1]!);
    const canonical = yrs < 1.5 ? "beginner" : yrs < 3.5 ? "intermediate" : "advanced";
    return hit(canonical, canonical, `years_${yrs}`, 0.92);
  }
  const monthMatch = lower.match(/(\d+)\s*(?:mo|month|months)/);
  if (monthMatch) {
    const mos = parseInt(monthMatch[1]!);
    const canonical = mos < 8 ? "beginner" : mos < 24 ? "intermediate" : "advanced";
    return hit(canonical, canonical, `months_${mos}`, 0.90);
  }

  if (/\b(beginner|new|just started|newbie|fresh|never|first time|starting)\b/.test(lower))
    return hit("beginner", "beginner", "keyword", 0.90);
  if (/\b(intermediate|couple|1-3|few years|some time|been going|going for)\b/.test(lower))
    return hit("intermediate", "intermediate", "keyword", 0.85);
  if (/\b(advanced|veteran|long time|experienced|3\+|4\+|5\+ years)\b/.test(lower))
    return hit("advanced", "advanced", "keyword", 0.90);

  return unknown("experience_vague");
}

// ── lifts (squat / bench / deadlift) ─────────────────────────────────────────

export function parseLifts(text: string): ParseResult {
  const n = normalize(text);
  if (n.isSkip) return skip("lifts_skipped");

  const extract = (pattern: RegExp) => {
    const m = pattern.exec(text.toLowerCase());
    return m ? Math.round(parseFloat(m[1]!) * (m[2] && /lb/i.test(m[2]) ? 0.453592 : 1)) : null;
  };

  const squat = extract(/squat[^\d]*(\d+(?:\.\d+)?)\s*(kg|lb)?/i)
             ?? extract(/s[:\s]+(\d+(?:\.\d+)?)\s*(kg|lb)?/i);
  const bench = extract(/bench[^\d]*(\d+(?:\.\d+)?)\s*(kg|lb)?/i)
             ?? extract(/b[:\s]+(\d+(?:\.\d+)?)\s*(kg|lb)?/i);
  const dl    = extract(/dead[^\d]*(\d+(?:\.\d+)?)\s*(kg|lb)?/i)
             ?? extract(/dl?[:\s]+(\d+(?:\.\d+)?)\s*(kg|lb)?/i);

  // Plain bare numbers: first three numbers in the text assumed squat/bench/deadlift
  const bare = [...text.matchAll(/\b(\d+(?:\.\d+)?)\b/g)].map(m => parseFloat(m[1]!));
  const [b0 = null, b1 = null, b2 = null] = bare;

  const sq = squat ?? b0;
  const bn = bench ?? b1;
  const dd = dl    ?? b2;

  if (sq === null && bn === null && dd === null) return unknown("no_lift_numbers");

  const parts: string[] = [];
  if (sq) parts.push(`squat:${sq}`);
  if (bn) parts.push(`bench:${bn}`);
  if (dd) parts.push(`deadlift:${dd}`);

  const conf = (sq !== null && bn !== null && dd !== null) ? 0.88 : 0.65;
  const verify = conf < 0.80;
  return hit(parts.join("|"), parts.join("|"), "lifts_parsed", conf, verify);
}

// ── days ─────────────────────────────────────────────────────────────────────

const WORD_NUMS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };

export function parseDays(text: string): ParseResult {
  const n = normalize(text);
  if (n.isSkip) return skip("days_skipped_default_4");
  const lower = text.toLowerCase().trim();

  const digits = lower.match(/\b([1-7])\b/);
  if (digits) return hit(digits[1]!, digits[1]!, "digit", 0.96);

  for (const [word, num] of Object.entries(WORD_NUMS)) {
    if (lower.includes(word)) return hit(String(num), String(num), "word_number", 0.90);
  }

  return unknown("days_not_found");
}

// ── gym_time ─────────────────────────────────────────────────────────────────

export function parseGymTime(text: string): ParseResult {
  const n = normalize(text);
  if (n.isSkip) return skip("gym_time_skipped_default_18:00");
  const lower = text.toLowerCase();

  const hhmm = lower.match(/\b(\d{1,2}):(\d{2})\b/);
  if (hhmm) {
    const h = parseInt(hhmm[1]!), m = parseInt(hhmm[2]!);
    if (h <= 23 && m <= 59) return hit(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`, "", "hhmm", 0.96);
  }

  const ampm = lower.match(/\b(\d{1,2})\s*(am|pm)\b/);
  if (ampm) {
    const h = parseInt(ampm[1]!);
    const pm = ampm[2] === "pm";
    const h24 = pm && h !== 12 ? h + 12 : !pm && h === 12 ? 0 : h;
    return hit(`${String(h24).padStart(2, "0")}:00`, "", "ampm", 0.93);
  }

  if (/\b(early morning|5am|6am)\b/.test(lower))   return hit("06:00", "", "early_morning", 0.72);
  if (/\bmorning\b/.test(lower))                    return hit("08:00", "", "morning", 0.68, true);
  if (/\b(after work|afternoon)\b/.test(lower))     return hit("18:00", "", "after_work", 0.75);
  if (/\bevening\b/.test(lower))                    return hit("18:00", "", "evening", 0.72);
  if (/\bnight\b/.test(lower))                      return hit("20:00", "", "night", 0.72);

  return unknown("time_not_found");
}

// ── protein ───────────────────────────────────────────────────────────────────

export function parseProtein(text: string): ParseResult {
  const n = normalize(text);
  if (n.isSkip || n.isNotTracking)
    return hit("not_tracking", "not_tracking", "explicit_not_tracking", 0.97);

  const lower = text.toLowerCase();

  // Approximate qualifiers must be checked BEFORE the bare-number match so
  // "about 100g" returns requiresVerification=true instead of falling through
  // to the direct match and losing the approximate flag.
  if (/\b(about|around|roughly|approximately|probably|maybe)\b/.test(lower)) {
    const approx = lower.match(/(?:about|around|roughly|approximately|probably|maybe)\s*(\d+)/);
    if (approx) {
      const g = parseInt(approx[1]!);
      if (g >= 20 && g <= 600) return hit(String(g), `~${g}g`, "protein_approximate", 0.80, true);
    }
  }

  const numMatch = lower.match(/(\d+)\s*g?/);
  if (numMatch) {
    const g = parseInt(numMatch[1]!);
    if (g >= 20 && g <= 600) return hit(String(g), `${g}g`, "protein_grams", 0.93);
    if (g < 20)  return hit("not_tracking", "not_tracking", "number_too_low_assumed_not_tracking", 0.70);
  }

  return hit("not_tracking", "not_tracking", "no_protein_number_found", 0.85);
}

// ── injury ────────────────────────────────────────────────────────────────────

export function parseInjury(text: string): ParseResult {
  const n = normalize(text);
  if (n.isSkip || n.isNoneInjury)
    return hit("none", "none", "no_injury", 0.97);

  const t = text.trim();
  if (t.length >= 3 && t.length <= 300)
    return hit(t, t, "injury_text", 0.90);

  return hit("none", "none", "empty_injury_treated_as_none", 0.80);
}

// ── split ─────────────────────────────────────────────────────────────────────

const KNOWN_SPLITS: Array<{ keys: string[]; canonical: string; label: string }> = [
  { keys: ["ppl", "push pull legs", "push/pull/legs", "push, pull, legs"],  canonical: "PPL",         label: "Push/Pull/Legs" },
  { keys: ["upper lower", "upper/lower", "u/l", "4 day"],                   canonical: "Upper/Lower", label: "Upper/Lower" },
  { keys: ["full body", "fullbody", "full-body", "total body"],              canonical: "Full Body",   label: "Full Body" },
  { keys: ["bro", "chest day", "arm day", "body part"],                     canonical: "Bro Split",   label: "Bro Split" },
  { keys: ["push day", "pull day", "leg day"],                               canonical: "PPL",         label: "Push/Pull/Legs" },
];

export function parseSplit(text: string): ParseResult {
  const n = normalize(text);
  if (n.isSkip || n.isBuildSplit) {
    return { confidence: 0.97, extractedValue: "BUILD", normalizedValue: "BUILD", parserReason: "build_signal", isSkip: false, isUnknown: false, requiresVerification: false };
  }

  const lower = text.toLowerCase();
  for (const s of KNOWN_SPLITS) {
    if (s.keys.some(k => lower.includes(k)))
      return hit(s.canonical, s.label, "known_split", 0.92);
  }

  // Partial muscle group parse
  const partial = parsePartialSplit(lower);
  if (partial) {
    return hit(partial.canonical, partial.displayText, "partial_split_parsed", 0.72, true);
  }

  // Could be a custom split described in words — accept it
  if (text.trim().length >= 3)
    return hit(text.trim(), text.trim(), "custom_split_text", 0.60, true);

  return unknown("split_not_understood");
}

// ═══════════════════════════════════════════════════════════════════════════════
// PARTIAL SPLIT PARSER
// Handles: "back quad glutes", "shoulder tri", "chest", "push pull legs"
// ═══════════════════════════════════════════════════════════════════════════════

interface PartialSplitResult {
  canonical: string;
  displayText: string;
  dayMap: Record<string, string[]>;
}

const MUSCLE_ALIASES: Array<{ names: string[]; canonical: string; category: "push" | "pull" | "legs" | "other" }> = [
  { names: ["chest", "pec", "pecs"],              canonical: "Chest",      category: "push" },
  { names: ["tricep", "triceps"],                 canonical: "Triceps",    category: "push" },
  { names: ["shoulder", "delt", "delts", "shoulders"], canonical: "Shoulders", category: "push" },
  { names: ["back", "lat", "lats"],               canonical: "Back",       category: "pull" },
  { names: ["bicep", "biceps"],                   canonical: "Biceps",     category: "pull" },
  { names: ["quad", "quads"],                     canonical: "Quads",      category: "legs" },
  { names: ["ham", "hamstring", "hamstrings"],    canonical: "Hamstrings", category: "legs" },
  { names: ["glute", "glutes", "butt"],           canonical: "Glutes",     category: "legs" },
  { names: ["calf", "calves"],                    canonical: "Calves",     category: "legs" },
  { names: ["leg", "legs"],                       canonical: "Legs",       category: "legs" },
  { names: ["trap", "traps"],                     canonical: "Traps",      category: "pull" },
  { names: ["abs", "core", "abdominal"],          canonical: "Core",       category: "other" },
];

function parsePartialSplit(lower: string): PartialSplitResult | null {
  const found: string[] = [];
  for (const m of MUSCLE_ALIASES) {
    if (m.names.some(n => new RegExp(`\\b${n}\\b`).test(lower))) found.push(m.canonical);
  }
  if (found.length === 0) return null;

  const categories = MUSCLE_ALIASES
    .filter(m => found.includes(m.canonical))
    .map(m => m.category);

  const hasPush = categories.includes("push");
  const hasPull = categories.includes("pull");
  const hasLegs = categories.includes("legs");

  let canonical = "Custom";
  if (hasPush && hasPull && hasLegs) canonical = "PPL";
  else if (hasPull && hasLegs)       canonical = "Custom";   // Bug 1: mixed pull+legs
  else if (hasPush && hasLegs)       canonical = "Custom";   // Bug 1: mixed push+legs
  else if (hasPush && hasPull)       canonical = "Upper/Lower";
  else if (hasPush)                  canonical = "Push";
  else if (hasPull)                  canonical = "Pull";
  else if (hasLegs)                  canonical = "Legs";

  return {
    canonical,
    displayText: found.join(", "),
    dayMap: {},
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SPLIT GENERATOR
// Deterministic — no LLM. Generates from days + goal.
// ═══════════════════════════════════════════════════════════════════════════════

interface GeneratedSplitOutput {
  splitType: string;
  lines: string[];
  splitDaysJson: string;
}

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function generateSplit(days: number, goal: string): GeneratedSplitOutput {
  const isStrength = goal === "strength";
  const isFat      = goal === "fat_loss";

  if (days <= 2) {
    const map = days === 1
      ? [["Full Body"]]
      : [["Full Body A"], ["Full Body B"]];
    return format(map, "Full Body", days);
  }

  if (days === 3) {
    if (isStrength) return format([["Squat"], ["Bench / Press"], ["Deadlift / Back"]], "Strength", 3);
    return format([["Push (Chest, Shoulders, Triceps)"], ["Pull (Back, Biceps)"], ["Legs (Quads, Hamstrings, Glutes)"]], "PPL", 3);
  }

  if (days === 4) {
    if (isStrength) return format([["Lower (Squat focus)"], ["Upper (Bench focus)"], ["Lower (Deadlift focus)"], ["Upper (OHP / Row focus)"]], "Upper/Lower", 4);
    return format([["Upper (Chest, Back, Shoulders)"], ["Lower (Quads, Hamstrings, Glutes)"], ["Upper (Back, Chest, Arms)"], ["Lower (Quads, Hamstrings, Glutes, Calves)"]], "Upper/Lower", 4);
  }

  if (days === 5) {
    return format([
      ["Push (Chest, Shoulders, Triceps)"],
      ["Pull (Back, Biceps)"],
      ["Legs (Quads, Hamstrings, Glutes)"],
      ["Upper (Chest, Back, Arms)"],
      ["Lower (Quads, Hamstrings, Glutes, Calves)"],
    ], "PPL + Upper/Lower", 5);
  }

  if (days === 6) {
    return format([
      ["Push (Chest, Shoulders, Triceps)"],
      ["Pull (Back, Biceps)"],
      ["Legs (Quads, Hamstrings, Glutes)"],
      ["Push (Chest, Shoulders, Triceps)"],
      ["Pull (Back, Biceps, Traps)"],
      ["Legs (Quads, Hamstrings, Glutes, Calves)"],
    ], "PPL ×2", 6);
  }

  // 7 days
  return format([
    ["Push (Chest, Shoulders, Triceps)"], ["Pull (Back, Biceps)"], ["Legs"],
    ["Rest"], ["Upper (Full)"], ["Lower (Full)"], ["Rest / Cardio"],
  ], "PPL + Rest", 7);
}

function format(daySlots: string[][], splitType: string, days: number): GeneratedSplitOutput {
  const lines: string[] = [];
  const splitDays: string[] = [];

  daySlots.slice(0, days).forEach((muscles, i) => {
    const label = muscles[0]!;
    lines.push(`${DAY_NAMES[i]} — ${label}`);
    splitDays.push(label);
  });

  return { splitType, lines, splitDaysJson: JSON.stringify(splitDays) };
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP DEFINITIONS — state machine
// nextStep is ALWAYS explicit. No LLM determines routing.
// ═══════════════════════════════════════════════════════════════════════════════

interface StepDef {
  id: StepId;
  question: (answers: Record<string, string>) => string;
  parser: (text: string) => ParseResult;
  confidenceThreshold: number;
  // What to do when user says skip/idk
  skipBehavior: "advance_with_null" | "advance_with_default" | "advance_unknown";
  skipDefault?: string;
  // How many times to show this question before force-advancing
  repeatLimit: number;
  // nextStep: always static (no dynamic routing through LLM)
  nextStep: StepId;
  // Used in verification message
  verifyMessage: (proposed: string) => string;
  // Which IntakeAnswers keys to write on store
  storageKeys: (value: string) => Record<string, string>;
}

const STEPS: Record<StepId, StepDef> = {
  name: {
    id: "name",
    question: () => `What's your name? I'll use this to track your progress.`,
    parser: parseName,
    confidenceThreshold: 0.75,
    skipBehavior: "advance_with_default",
    skipDefault: "Athlete",
    repeatLimit: 2,
    nextStep: "goal",
    verifyMessage: v => `Just to confirm — your name is ${v}?`,
    storageKeys: v => ({ name: v }),
  },

  goal: {
    id: "goal",
    question: () => `What's your primary goal?\n\nMuscle · Strength · Fat loss · General fitness`,
    parser: parseGoal,
    confidenceThreshold: 0.70,
    skipBehavior: "advance_with_default",
    skipDefault: "muscle",
    repeatLimit: 2,
    nextStep: "body_stats",
    verifyMessage: v => `Your goal is ${v} — right?`,
    storageKeys: v => ({ gym_goal: v, gym_goal_raw: v }),
  },

  body_stats: {
    id: "body_stats",
    question: a => `Got it. What's your current bodyweight and height?\n\nExamples: "72kg, 178cm" or "158lbs, 5'10"${a.name && a.name !== "Athlete" ? ` (${a.name})` : ""}`,
    parser: parseBodyStats,
    confidenceThreshold: 0.65,
    skipBehavior: "advance_with_null",
    repeatLimit: 2,
    nextStep: "experience",
    verifyMessage: v => `I got: ${v.replace("|", ", ")} — looks right?`,
    storageKeys: v => {
      const parts = Object.fromEntries(v.split("|").map(p => {
        const [k, val] = p.split(":");
        return k === "bw" ? ["current_bodyweight_kg", val!] : ["height_cm", val!];
      }));
      return parts;
    },
  },

  experience: {
    id: "experience",
    question: () => `How long have you been lifting?\n\nBeginner (0–6 months) · Intermediate (6 mo–3 yr) · Advanced (3+ years)`,
    parser: parseExperience,
    confidenceThreshold: 0.70,
    skipBehavior: "advance_with_default",
    skipDefault: "intermediate",
    repeatLimit: 2,
    nextStep: "lifts",
    verifyMessage: v => `Classifying you as ${v} — correct?`,
    storageKeys: v => ({ training_experience: v }),
  },

  lifts: {
    id: "lifts",
    question: () => `What are your current lifts?\n\nSquat / Bench / Deadlift in kg (or just skip if you don't know yet).`,
    parser: parseLifts,
    confidenceThreshold: 0.75,
    skipBehavior: "advance_with_null",
    repeatLimit: 2,
    nextStep: "days",
    verifyMessage: v => `Lifts: ${v.split("|").join(", ")} — right?`,
    storageKeys: v => {
      const r: Record<string, string> = { lifts_raw: v };
      for (const p of v.split("|")) {
        const [k, val] = p.split(":");
        if (k === "squat")     r.squat_kg     = val!;
        if (k === "bench")     r.bench_kg     = val!;
        if (k === "deadlift")  r.deadlift_kg  = val!;
      }
      return r;
    },
  },

  days: {
    id: "days",
    question: () => `How many days per week can you train? (1–7)`,
    parser: parseDays,
    confidenceThreshold: 0.80,
    skipBehavior: "advance_with_default",
    skipDefault: "4",
    repeatLimit: 2,
    nextStep: "split",
    verifyMessage: v => `${v} days per week — correct?`,
    storageKeys: v => ({ available_training_days: v }),
  },

  split: {
    id: "split",
    question: a => {
      const d = a.available_training_days ?? "4";
      return `Do you have a training split, or should I build one?\n\nTell me your split, or type "build one" and I'll generate a ${d}-day plan for you.`;
    },
    parser: parseSplit,
    confidenceThreshold: 0.70,
    skipBehavior: "advance_with_default",
    // Bug 3: no skipDefault — skip always routes to generator, never stores "BUILD"
    repeatLimit: 2,
    nextStep: "gym_time",
    verifyMessage: v => `I understood your split as: ${v} — correct?`,
    // Bug 4: only store canonical; split_raw is set from originalInput in engine
    storageKeys: v => {
      if (v === "BUILD") throw new Error("[onboarding] BUILD sentinel must never be written to DB");
      return { current_split: v };
    },
  },

  confirm_split: {
    id: "confirm_split",
    question: a => `${a._pending_split_display ?? "Generated split"}\n\nGood with this, or want changes?`,
    // @dead-code: confirm_split is handled entirely by the dedicated block in
    // handleOnboardingV2 (which calls classifyConfirmation()) before this
    // generic parser path is ever reached. Kept only to satisfy StepDef.
    parser: () => unknown("dead_code_unused_parser"),
    confidenceThreshold: 0.80,
    skipBehavior: "advance_with_default",
    skipDefault: "yes",
    repeatLimit: 3,
    nextStep: "gym_time",
    verifyMessage: () => `Is the split above good to go?`,
    storageKeys: () => ({}),
  },

  gym_time: {
    id: "gym_time",
    question: () => `What time do you usually train?\n\nExamples: "6pm", "18:30", "morning"`,
    parser: parseGymTime,
    confidenceThreshold: 0.70,
    skipBehavior: "advance_with_default",
    skipDefault: "18:00",
    repeatLimit: 2,
    nextStep: "protein",
    verifyMessage: v => `You train around ${v} — right?`,
    storageKeys: v => ({ gym_session_time: v }),
  },

  protein: {
    id: "protein",
    question: () => `How much protein are you hitting daily? (grams)\n\nIf you're not tracking, just say "not tracking" — I'll set a target.`,
    parser: parseProtein,
    confidenceThreshold: 0.75,
    skipBehavior: "advance_with_default",
    skipDefault: "not_tracking",
    repeatLimit: 2,
    nextStep: "injury",
    verifyMessage: v => v === "not_tracking" ? `Not tracking protein currently — right?` : `You're hitting ~${v}g protein daily — correct?`,
    storageKeys: v => v === "not_tracking"
      ? { protein_raw: "not_tracking", protein_status: "not_tracking" }
      : { protein_raw: v, daily_protein_g: v, protein_status: "reported" },
  },

  injury: {
    id: "injury",
    question: () => `Any injuries or areas to avoid?\n\nIf none, just say "none" or "all good".`,
    parser: parseInjury,
    confidenceThreshold: 0.70,
    skipBehavior: "advance_with_default",
    skipDefault: "none",
    repeatLimit: 2,
    nextStep: "review",
    verifyMessage: v => v === "none" ? `No injuries to flag — correct?` : `Noting: "${v}" — right?`,
    storageKeys: v => ({ injury_notes: v }),
  },

  review: {
    id: "review",
    question: (a) => buildReviewCard(a),
    // @dead-code: review is handled entirely by the dedicated W6 block in
    // handleOnboardingV2 (which calls classifyConfirmation()) before this
    // generic parser path is ever reached. Kept only to satisfy StepDef.
    parser: () => unknown("dead_code_unused_parser"),
    confidenceThreshold: 0.75,
    skipBehavior: "advance_with_default",
    skipDefault: "confirmed",
    repeatLimit: 2,
    nextStep: "review",
    verifyMessage: () => `Just confirm with "yes" to finish, or "no" to restart.`,
    storageKeys: () => ({}),
  },
};

function buildReviewCard(a: Record<string, string>): string {
  const lines: string[] = [
    `Here's your profile — confirm to finish:`,
    ``,
    `Name: ${a.name ?? "—"}`,
    `Goal: ${a.gym_goal ?? "—"}`,
    `Bodyweight: ${a.current_bodyweight_kg ? `${a.current_bodyweight_kg}kg` : "—"}`,
    `Height: ${a.height_cm ? `${a.height_cm}cm` : "—"}`,
    `Experience: ${a.training_experience ?? "—"}`,
    `Training days: ${a.available_training_days ?? "—"}`,
    `Split: ${a.current_split ?? "—"}`,
    `Gym time: ${a.gym_session_time ?? "—"}`,
    `Protein: ${a.daily_protein_g ? `${a.daily_protein_g}g/day` : a.protein_status === "not_tracking" ? "not tracking" : "—"}`,
    `Injuries: ${a.injury_notes ?? "none"}`,
    ``,
    `Looks right? (yes / no)`,
  ];
  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUDIT LOGGER
// ═══════════════════════════════════════════════════════════════════════════════

function logEntry(state: OnboardingState, entry: AuditEntry): void {
  state.auditLog.push(entry);
  if (state.auditLog.length > 100) state.auditLog.shift(); // cap at 100 entries
}

// ═══════════════════════════════════════════════════════════════════════════════
// STATE PERSISTENCE
// ═══════════════════════════════════════════════════════════════════════════════

const FACT_TYPE = "onboarding_v2";
const FACT_KEY  = "active";

async function loadState(userId: string): Promise<OnboardingState | null> {
  const fact = await prisma.memoryFact.findFirst({
    where: { userId, type: FACT_TYPE, key: FACT_KEY, archivedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!fact) return null;
  try { return JSON.parse(fact.value) as OnboardingState; }
  catch { return null; }
}

async function saveState(userId: string, state: OnboardingState): Promise<void> {
  state.lastActivityAt = Date.now();
  const serialized = JSON.stringify(state);
  await prisma.memoryFact.upsert({
    where: { userId_type_key: { userId, type: FACT_TYPE, key: FACT_KEY } },
    update: { value: serialized, archivedAt: null },
    create: { userId, type: FACT_TYPE, key: FACT_KEY, value: serialized, confidence: 1.0 },
  });
}

function initState(userId: string): OnboardingState {
  return {
    userId,
    currentStep: "name",
    answers: {},
    pendingVerification: null,
    pendingGeneratedSplit: null,
    pendingPartialSplit: null,
    repeatCounts: {},
    startedAt: Date.now(),
    lastActivityAt: Date.now(),
    completedAt: null,
    resumedAt: null,
    auditLog: [],
  };
}

async function finalizeIntake(userId: string, platformChatId: string, state: OnboardingState): Promise<void> {
  const a = state.answers;
  await prisma.messengerUser.update({
    where: { id: userId },
    data: {
      intakeComplete: true,
      intakeStep:     "complete",
      intakeAnswers:  a as any,
      ...(a.gym_session_time ? { preferredCheckInTime: a.gym_session_time } : {}),
      ...(a.name ? { displayName: a.name } : {}),
    },
  });
  await prisma.memoryFact.updateMany({
    where: { userId, type: FACT_TYPE, key: FACT_KEY },
    data:  { archivedAt: new Date() },
  });

  // Write durable memory facts
  if (a.gym_goal)    await prisma.memoryFact.create({ data: { userId, type: "preference", key: "gym_goal",            value: a.gym_goal,   confidence: 0.95 } });
  if (a.injury_notes && a.injury_notes !== "none")
                     await prisma.memoryFact.create({ data: { userId, type: "preference", key: "injury_notes",         value: a.injury_notes, confidence: 0.90 } });
  if (a.training_experience)
                     await prisma.memoryFact.create({ data: { userId, type: "preference", key: "training_experience",  value: a.training_experience, confidence: 0.90 } });
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

export async function handleOnboardingV2(input: {
  platformChatId: string;
  text:           string;
  now?:           Date;
}): Promise<{ handled: boolean; reply: string }> {
  const { platformChatId, text } = input;

  const user = await prisma.messengerUser.findUnique({
    where:  { platform_platformChatId: { platform: "telegram", platformChatId } },
    select: { id: true, intakeComplete: true, intakeStep: true },
  });
  if (!user || user.intakeComplete) return { handled: false, reply: "" };

  const userId = user.id;

  await addToShortTerm(platformChatId, text, { role: "user", intent: "intake", emotion: "neutral" });

  let state = await loadState(userId);

  // ── Bug 6: Recovery — mark resumed, fall through to process message normally ──
  let resumePrefix = "";
  if (state) {
    const gapDays = (Date.now() - state.lastActivityAt) / 86_400_000;
    if (gapDays > 0.5 && state.completedAt === null) {
      state.resumedAt = Date.now();
      resumePrefix = `Welcome back — resuming ${state.currentStep} step.\n\n`;
      logEntry(state, {
        step: state.currentStep, rawAnswer: "(resumed)", normalizedAnswer: null,
        confidence: 1.0, storedValue: null, nextStep: state.currentStep, action: "resumed", ts: Date.now(),
      });
      // DO NOT return — process the actual message and prepend the resume note
    }
  }

  // ── First message: initialize ─────────────────────────────────────────────────
  if (!state) {
    state = initState(userId);
    const welcome = buildWelcomeMessage();
    await saveState(userId, state);
    await addToShortTerm(platformChatId, welcome, { role: "assistant", intent: "intake", emotion: "neutral" });
    return { handled: true, reply: welcome };
  }

  const stepDef   = STEPS[state.currentStep];
  const normalized = normalize(text);

  // ── Verification pending ──────────────────────────────────────────────────────
  if (state.pendingVerification) {
    const pv = state.pendingVerification;
    const verificationCls = classifyConfirmation(text, pv.confirmQuestion);

    if (verificationCls === "yes") {
      // Bug 4: use canonicalValue for storage; add split_raw from originalInput
      const keys = STEPS[pv.step].storageKeys(pv.canonicalValue);
      if (pv.step === "split") keys.split_raw = pv.originalInput;
      Object.assign(state.answers, keys);
      state.pendingVerification = null;

      const nextId = STEPS[pv.step].nextStep;
      logEntry(state, { step: pv.step, rawAnswer: pv.originalInput, normalizedAnswer: pv.canonicalValue, confidence: 0.95, storedValue: pv.canonicalValue, nextStep: nextId, action: "stored", ts: Date.now() });

      state.currentStep = nextId;
      const reply = resumePrefix + STEPS[nextId].question(state.answers);
      await saveState(userId, state);
      await addToShortTerm(platformChatId, reply, { role: "assistant", intent: "intake", emotion: "neutral" });
      return { handled: true, reply };
    }

    if (verificationCls === "no" || verificationCls === "modify") {
      state.pendingVerification = null;
      const reaskReply = resumePrefix + `No problem. ${STEPS[pv.step].question(state.answers)}`;
      await saveState(userId, state);
      await addToShortTerm(platformChatId, reaskReply, { role: "assistant", intent: "intake", emotion: "neutral" });
      return { handled: true, reply: reaskReply };
    }

    // New answer while verification pending — process as fresh answer for same step
    state.pendingVerification = null;
  }

  // ── Bug 2: Partial split accumulation ────────────────────────────────────────
  if (state.currentStep === "split" && state.pendingPartialSplit !== null) {
    const n = normalize(text);

    if (n.isBuildSplit || n.isSkip) {
      state.pendingPartialSplit = null;
      return await handleSplitGenerate(platformChatId, state, userId, resumePrefix);
    }

    if (/^(done|that.?s (all|it)|finished|complete|all days|those are all)$/i.test(text.toLowerCase())) {
      return await finalizePendingPartialSplit(platformChatId, state, userId, resumePrefix);
    }

    const partial  = parsePartialSplit(text.toLowerCase());
    const dayLabel = partial ? partial.displayText : text.trim().slice(0, 60);

    // W8: reject consecutive duplicate day descriptions
    if (state.pendingPartialSplit.days.at(-1) === dayLabel) {
      const collectedCount = state.pendingPartialSplit.days.length;
      const reply = resumePrefix + `Already have "${dayLabel}" as day ${collectedCount}. What's a different day ${collectedCount + 1}?`;
      await saveState(userId, state);
      await addToShortTerm(platformChatId, reply, { role: "assistant", intent: "intake", emotion: "neutral" });
      return { handled: true, reply };
    }

    state.pendingPartialSplit.days.push(dayLabel);

    const targetDays = parseInt(state.answers.available_training_days ?? "4") || 4;
    const collected  = state.pendingPartialSplit.days.length;

    if (collected >= targetDays) {
      return await finalizePendingPartialSplit(platformChatId, state, userId, resumePrefix);
    }

    const doneHint = collected >= 2 ? ` (or say "done" if that's your full split)` : "";
    const reply = resumePrefix + `Got day ${collected}: ${dayLabel}.\n\nWhat's day ${collected + 1}?${doneHint}`;
    await saveState(userId, state);
    await addToShortTerm(platformChatId, reply, { role: "assistant", intent: "intake", emotion: "neutral" });
    return { handled: true, reply };
  }

  // ── Split confirmation sub-flow ───────────────────────────────────────────────
  if (state.currentStep === "confirm_split") {
    const splitCls = classifyConfirmation(text, STEPS["confirm_split"].question(state.answers));

    if (splitCls === "yes") {
      // Bug 7: guard — split data must exist before advancing
      if (!state.pendingGeneratedSplit) {
        const reask = resumePrefix + STEPS["confirm_split"].question(state.answers);
        await saveState(userId, state);
        await addToShortTerm(platformChatId, reask, { role: "assistant", intent: "intake", emotion: "neutral" });
        return { handled: true, reply: reask };
      }
      const g = state.pendingGeneratedSplit;
      state.answers.current_split   = g.splitType;
      state.answers.split_raw       = "rex_built";
      state.answers.split_days_json = g.splitDaysJson;
      delete (state.answers as Record<string, string>)._pending_split_display;
      state.pendingGeneratedSplit = null;

      logEntry(state, { step: "confirm_split", rawAnswer: text, normalizedAnswer: "confirmed", confidence: 0.97, storedValue: g.splitType, nextStep: "gym_time", action: "split_confirmed", ts: Date.now() });

      state.currentStep = "gym_time";
      const reply = resumePrefix + STEPS["gym_time"].question(state.answers);
      await saveState(userId, state);
      await addToShortTerm(platformChatId, reply, { role: "assistant", intent: "intake", emotion: "neutral" });
      return { handled: true, reply };
    }

    // Bug 8: any modification/rejection request → back to split step, clear generated split
    if (splitCls === "modify" || splitCls === "no") {
      state.currentStep = "split";
      state.pendingGeneratedSplit = null;
      state.pendingPartialSplit   = null;
      delete (state.answers as Record<string, string>)._pending_split_display;
      const reaskReply = resumePrefix + `Okay — what split do you want? Tell me yours, or say "build one" for a new generated split.`;
      await saveState(userId, state);
      await addToShortTerm(platformChatId, reaskReply, { role: "assistant", intent: "intake", emotion: "neutral" });
      return { handled: true, reply: reaskReply };
    }

    // Bug 7: unknown/unrecognised at confirm_split — re-ask without advancing
    const reask = resumePrefix + STEPS["confirm_split"].question(state.answers);
    await saveState(userId, state);
    await addToShortTerm(platformChatId, reask, { role: "assistant", intent: "intake", emotion: "neutral" });
    return { handled: true, reply: reask };
  }

  // ── W6: Review step — finalize or restart ────────────────────────────────────
  // Dedicated block prevents review parser output from cycling back through
  // the generic high-confidence path which self-loops (nextStep = "review").
  if (state.currentStep === "review") {
    const reviewCls = classifyConfirmation(text, buildReviewCard(state.answers));

    if (reviewCls === "yes") {
      state.completedAt = Date.now();
      logEntry(state, { step: "review", rawAnswer: text, normalizedAnswer: "confirmed", confidence: 0.97, storedValue: "completed", nextStep: null, action: "stored", ts: Date.now() });
      await saveState(userId, state);  // W6: persist completedAt + final audit entry before archive
      await finalizeIntake(userId, platformChatId, state);
      const msg = resumePrefix + `You're all set${state.answers.name ? `, ${state.answers.name}` : ""}. Let's build something.`;
      await addToShortTerm(platformChatId, msg, { role: "assistant", intent: "intake", emotion: "neutral" });
      return { handled: true, reply: msg };
    }

    if (reviewCls === "no" || reviewCls === "modify") {
      // W6: clear answers but keep name so user doesn't re-type it
      const keptName = state.answers.name;
      state.answers = keptName ? { name: keptName } : {};
      state.currentStep = keptName ? "goal" : "name";
      state.pendingVerification   = null;
      state.pendingGeneratedSplit = null;
      state.pendingPartialSplit   = null;
      state.repeatCounts          = {};
      logEntry(state, { step: "review", rawAnswer: text, normalizedAnswer: "restart", confidence: 0.90, storedValue: null, nextStep: state.currentStep, action: "stored", ts: Date.now() });
      const reply = resumePrefix + `Starting over.\n\n${STEPS[state.currentStep].question(state.answers)}`;
      await saveState(userId, state);
      await addToShortTerm(platformChatId, reply, { role: "assistant", intent: "intake", emotion: "neutral" });
      return { handled: true, reply };
    }

    // Unknown input at review — re-show card with explicit cue
    const reask = resumePrefix + buildReviewCard(state.answers) + "\n\nType yes to confirm, or no to start over.";
    await saveState(userId, state);
    await addToShortTerm(platformChatId, reask, { role: "assistant", intent: "intake", emotion: "neutral" });
    return { handled: true, reply: reask };
  }

  // ── Bug 5: Hinglish guard (split step only, before parser and loop counter) ───
  if (state.currentStep === "split" && (HINGLISH_MARKERS.test(text) || DEVANAGARI.test(text))) {
    const reply = resumePrefix + `I couldn't understand that split description. Please use English during onboarding — Hinglish support will be added later.`;
    await saveState(userId, state);
    await addToShortTerm(platformChatId, reply, { role: "assistant", intent: "intake", emotion: "neutral" });
    return { handled: true, reply };
  }

  // ── Loop prevention ───────────────────────────────────────────────────────────
  const repeatKey = state.currentStep;
  state.repeatCounts[repeatKey] = (state.repeatCounts[repeatKey] ?? 0) + 1;

  if (state.repeatCounts[repeatKey]! > stepDef.repeatLimit) {
    // Bug 3: split loop prevention routes to generator, never stores BUILD
    if (state.currentStep === "split") {
      logEntry(state, { step: "split", rawAnswer: text, normalizedAnswer: null, confidence: 0, storedValue: null, nextStep: "confirm_split", action: "split_generated", ts: Date.now() });
      state.repeatCounts[repeatKey] = 0;
      return await handleSplitGenerate(platformChatId, state, userId, resumePrefix);
    }
    const defaultVal = stepDef.skipDefault ?? null;
    if (defaultVal) {
      const keys = stepDef.storageKeys(defaultVal);
      Object.assign(state.answers, keys);
    }
    logEntry(state, { step: state.currentStep, rawAnswer: text, normalizedAnswer: null, confidence: 0, storedValue: defaultVal, nextStep: stepDef.nextStep, action: "loop_prevented", ts: Date.now() });
    state.currentStep = stepDef.nextStep;
    state.repeatCounts[repeatKey] = 0;
    const reply = resumePrefix + STEPS[stepDef.nextStep].question(state.answers);
    await saveState(userId, state);
    await addToShortTerm(platformChatId, reply, { role: "assistant", intent: "intake", emotion: "neutral" });
    return { handled: true, reply };
  }

  // ── Parse the answer ──────────────────────────────────────────────────────────
  const parsed = stepDef.parser(text);

  // ── Skip: user deliberately chose to skip or said idk ────────────────────────
  // isSkip = true means the text matched a known skip signal (idk, skip, whatever…).
  // Advance with the step's default value — this is intentional user input.
  if (parsed.isSkip) {
    let stored: string | null = null;

    if (stepDef.skipBehavior === "advance_with_default" && stepDef.skipDefault) {
      stored = stepDef.skipDefault;
      const keys = stepDef.storageKeys(stored);
      Object.assign(state.answers, keys);
    } else if (stepDef.skipBehavior === "advance_unknown") {
      stored = "unknown";
      (state.answers as Record<string, string>)[`${state.currentStep}_status`] = "unknown";
    }

    logEntry(state, { step: state.currentStep, rawAnswer: text, normalizedAnswer: stored, confidence: parsed.confidence, storedValue: stored, nextStep: stepDef.nextStep, action: stored === null ? "skipped" : "unknown_stored", ts: Date.now() });

    // Split skip → generator; never stores BUILD (Bug 3)
    if (state.currentStep === "split") {
      return await handleSplitGenerate(platformChatId, state, userId, resumePrefix);
    }

    state.currentStep = stepDef.nextStep;
    state.repeatCounts[repeatKey] = 0;

    if (state.currentStep === "review") {
      return await handleReview(platformChatId, state, userId, resumePrefix);
    }

    const skipReply = resumePrefix + STEPS[state.currentStep].question(state.answers);
    await saveState(userId, state);
    await addToShortTerm(platformChatId, skipReply, { role: "assistant", intent: "intake", emotion: "neutral" });
    return { handled: true, reply: skipReply };
  }

  // ── Unknown: parser couldn't extract a valid answer — re-ask, do NOT advance ─
  // isUnknown = true when the text did not match any known pattern for this step.
  // This covers off-topic input, questions, insults, and gibberish.
  // The repeatCount was already incremented above; after repeatLimit attempts the
  // loop-prevention block above will force-advance with the default.
  if (parsed.isUnknown) {
    const isGibberish = detectGibberish(text);
    const cls: InvalidAnswerClass = isGibberish
      ? "gibberish"
      : await classifyInvalidAnswer(text, stepDef.question(state.answers));
    const invalidReply = resumePrefix + buildInvalidAnswerReply(cls, stepDef.question(state.answers));
    logEntry(state, { step: state.currentStep, rawAnswer: text, normalizedAnswer: null, confidence: parsed.confidence, storedValue: null, nextStep: null, action: "skipped", ts: Date.now() });
    await saveState(userId, state);
    await addToShortTerm(platformChatId, invalidReply, { role: "assistant", intent: "intake", emotion: "neutral" });
    return { handled: true, reply: invalidReply };
  }

  // ── Build split signal ────────────────────────────────────────────────────────
  if (state.currentStep === "split" && parsed.extractedValue === "BUILD") {
    logEntry(state, { step: "split", rawAnswer: text, normalizedAnswer: "BUILD", confidence: parsed.confidence, storedValue: null, nextStep: "confirm_split", action: "split_generated", ts: Date.now() });
    return await handleSplitGenerate(platformChatId, state, userId, resumePrefix);
  }

  // ── Bug 2: First partial muscle description → enter accumulation mode ─────────
  if (state.currentStep === "split" && parsed.parserReason === "partial_split_parsed") {
    const partial  = parsePartialSplit(text.toLowerCase());
    const dayLabel = partial ? partial.displayText : text.trim().slice(0, 60);
    state.pendingPartialSplit = { days: [dayLabel] };
    const targetDays = parseInt(state.answers.available_training_days ?? "4") || 4;
    const doneHint   = targetDays > 1 ? ` (or say "done" if that's your full split)` : "";
    logEntry(state, { step: "split", rawAnswer: text, normalizedAnswer: dayLabel, confidence: parsed.confidence, storedValue: null, nextStep: null, action: "verification_requested", ts: Date.now() });
    const reply = resumePrefix + `Got day 1: ${dayLabel}.\n\nWhat's day 2?${doneHint}`;
    await saveState(userId, state);
    await addToShortTerm(platformChatId, reply, { role: "assistant", intent: "intake", emotion: "neutral" });
    return { handled: true, reply };
  }

  // ── Low confidence → request verification ─────────────────────────────────────
  if (parsed.requiresVerification || parsed.confidence < stepDef.confidenceThreshold) {
    if (parsed.extractedValue) {
      // Bug 4: canonicalValue (for storage) separate from proposedValue (for display)
      state.pendingVerification = {
        step:           state.currentStep,
        proposedValue:  parsed.normalizedValue ?? parsed.extractedValue,
        canonicalValue: parsed.extractedValue,
        originalInput:  text,
        storageKey:     state.currentStep,
        confirmQuestion: stepDef.verifyMessage(parsed.normalizedValue ?? parsed.extractedValue),
      };
      logEntry(state, { step: state.currentStep, rawAnswer: text, normalizedAnswer: parsed.extractedValue, confidence: parsed.confidence, storedValue: null, nextStep: null, action: "verification_requested", ts: Date.now() });
      const reply = resumePrefix + stepDef.verifyMessage(parsed.normalizedValue ?? parsed.extractedValue);
      await saveState(userId, state);
      await addToShortTerm(platformChatId, reply, { role: "assistant", intent: "intake", emotion: "neutral" });
      return { handled: true, reply };
    }
    logEntry(state, { step: state.currentStep, rawAnswer: text, normalizedAnswer: null, confidence: parsed.confidence, storedValue: null, nextStep: stepDef.nextStep, action: "skipped", ts: Date.now() });
    state.currentStep = stepDef.nextStep;
    state.repeatCounts[repeatKey] = 0;
    const reply = resumePrefix + STEPS[state.currentStep].question(state.answers);
    await saveState(userId, state);
    await addToShortTerm(platformChatId, reply, { role: "assistant", intent: "intake", emotion: "neutral" });
    return { handled: true, reply };
  }

  // ── High confidence: store and advance ────────────────────────────────────────
  const keys = stepDef.storageKeys(parsed.extractedValue!);
  // Bug 4: for split step, also preserve raw user input
  if (state.currentStep === "split") keys.split_raw = text;
  Object.assign(state.answers, keys);
  state.repeatCounts[repeatKey] = 0;

  logEntry(state, { step: state.currentStep, rawAnswer: text, normalizedAnswer: parsed.normalizedValue, confidence: parsed.confidence, storedValue: parsed.extractedValue, nextStep: stepDef.nextStep, action: "stored", ts: Date.now() });

  state.currentStep = stepDef.nextStep;

  if (state.currentStep === "review") {
    return await handleReview(platformChatId, state, userId, resumePrefix);
  }

  const nextQ = resumePrefix + STEPS[state.currentStep].question(state.answers);
  await saveState(userId, state);
  await addToShortTerm(platformChatId, nextQ, { role: "assistant", intent: "intake", emotion: "neutral" });
  return { handled: true, reply: nextQ };
}

// ── Split generate sub-handler ────────────────────────────────────────────────

async function handleSplitGenerate(
  platformChatId: string,
  state: OnboardingState,
  userId: string,
  prefix = "",  // Bug 6: prepend resume note when returning after gap
): Promise<{ handled: true; reply: string }> {
  const days = parseInt(state.answers.available_training_days ?? "4") || 4;
  const goal = state.answers.gym_goal ?? "muscle";
  const gen  = generateSplit(days, goal);

  const inner       = `Here's your ${days}-day split:\n\n${gen.lines.join("\n")}\n\nGood with this, or want changes?`;
  const displayText = prefix + inner;
  // Store split content without the resume prefix so confirm_split re-display is clean
  state.pendingGeneratedSplit = { splitType: gen.splitType, displayText: inner, splitDaysJson: gen.splitDaysJson };
  state.answers._pending_split_display = inner;
  state.currentStep = "confirm_split";
  state.pendingPartialSplit = null;

  await saveState(userId, state);
  await addToShortTerm(platformChatId, displayText, { role: "assistant", intent: "intake", emotion: "neutral" });
  return { handled: true, reply: displayText };
}

// ── Partial split finalizer (Bug 2) ──────────────────────────────────────────

async function finalizePendingPartialSplit(
  platformChatId: string,
  state: OnboardingState,
  userId: string,
  prefix = "",
): Promise<{ handled: true; reply: string }> {
  const days = state.pendingPartialSplit!.days;
  state.pendingPartialSplit = null;

  const allText = days.join(" ").toLowerCase();
  const hasPush = /chest|push|shoulder|tricep|\btri\b/.test(allText);
  const hasPull = /\bback\b|pull|bicep|\bbi\b|\blat\b/.test(allText);
  const hasLegs = /\bleg\b|quad|glute|hamstring|\bham\b|calves|calf/.test(allText);

  let canonical = "Custom";
  if (hasPush && hasPull && hasLegs) canonical = "PPL";
  else if (hasPull && hasLegs)       canonical = "Custom";
  else if (hasPush && hasLegs)       canonical = "Custom";
  else if (hasPush && hasPull)       canonical = "Upper/Lower";

  const splitDaysJson = JSON.stringify(days);
  const dayLines      = days.map((d, i) => `Day ${i + 1}: ${d}`).join("\n");
  const inner         = `Here's what I got:\n\n${dayLines}\n\n(${canonical})\n\nLooks right?`;
  const displayText   = prefix + inner;

  state.pendingGeneratedSplit = { splitType: canonical, displayText: inner, splitDaysJson };
  state.answers._pending_split_display = inner;
  state.currentStep = "confirm_split";

  logEntry(state, { step: "split", rawAnswer: "(partial_accumulated)", normalizedAnswer: canonical, confidence: 0.80, storedValue: null, nextStep: "confirm_split", action: "split_generated", ts: Date.now() });

  await saveState(userId, state);
  await addToShortTerm(platformChatId, displayText, { role: "assistant", intent: "intake", emotion: "neutral" });
  return { handled: true, reply: displayText };
}

// ── Review sub-handler ────────────────────────────────────────────────────────

async function handleReview(
  platformChatId: string,
  state: OnboardingState,
  userId: string,
  prefix = "",  // Bug 6
): Promise<{ handled: true; reply: string }> {
  const card  = prefix + buildReviewCard(state.answers);
  state.currentStep = "review";
  await saveState(userId, state);
  await addToShortTerm(platformChatId, card, { role: "assistant", intent: "intake", emotion: "neutral" });
  return { handled: true, reply: card };
}

// ── Once confirmed at review ──────────────────────────────────────────────────
// @deprecated — REMOVE: never called from the webhook. The review + finalization
// path is handled entirely inside handleOnboardingV2 (W6 block). Kept only to
// avoid a compile break while the import is still live; delete once confirmed unused.

export async function confirmAndFinalizeOnboarding(
  platformChatId: string,
  text: string,
): Promise<{ handled: boolean; reply: string }> {
  const user = await prisma.messengerUser.findUnique({
    where:  { platform_platformChatId: { platform: "telegram", platformChatId } },
    select: { id: true, intakeStep: true },
  });
  if (!user || user.intakeStep !== "review") return { handled: false, reply: "" };

  const state = await loadState(user.id);
  if (!state || state.currentStep !== "review") return { handled: false, reply: "" };

  const n = normalize(text);
  if (!n.isYes) {
    // Re-show review card
    const reply = buildReviewCard(state.answers) + "\n\nType yes to confirm, or no to restart.";
    await addToShortTerm(platformChatId, reply, { role: "assistant", intent: "intake", emotion: "neutral" });
    return { handled: true, reply };
  }

  state.completedAt = Date.now();
  await finalizeIntake(user.id, platformChatId, state);

  const completionMsg = `You're all set, ${state.answers.name ?? "Athlete"}. I've got everything I need.\n\nLet's build something.`;
  await addToShortTerm(platformChatId, completionMsg, { role: "assistant", intent: "intake", emotion: "neutral" });
  return { handled: true, reply: completionMsg };
}

// ─── Welcome ──────────────────────────────────────────────────────────────────

function buildWelcomeMessage(): string {
  return [
    `I'm Rex.`,
    ``,
    `You don't need motivation. You need a plan that doesn't break when life does.`,
    ``,
    `I'm going to ask you 10 questions. Short answers are fine.`,
    ``,
    `First — what's your name?`,
  ].join("\n");
}

// ─── Public utility ────────────────────────────────────────────────────────────

export async function isV2Active(platformChatId: string): Promise<boolean> {
  const user = await prisma.messengerUser.findUnique({
    where:  { platform_platformChatId: { platform: "telegram", platformChatId } },
    select: { id: true, intakeStep: true, intakeComplete: true },
  });
  if (!user || user.intakeComplete) return false;
  if ((user.intakeStep ?? "not_started") === "not_started") return true;
  const state = await loadState(user.id);
  return state !== null;
}

export async function getAuditLog(platformChatId: string): Promise<AuditEntry[]> {
  const user = await prisma.messengerUser.findUnique({
    where:  { platform_platformChatId: { platform: "telegram", platformChatId } },
    select: { id: true },
  });
  if (!user) return [];
  const state = await loadState(user.id);
  return state?.auditLog ?? [];
}

/**
 * Called by fireMentorIntakeOpener (and any other pre-chat entry point) to
 * initialise V2 state and return the welcome message for sending.
 * This must be called INSTEAD of writing intakeStep = "ga_name" so that
 * subsequent messages route to V2, not V1.
 */
export async function initOnboardingV2(platformChatId: string): Promise<string> {
  const user = await prisma.messengerUser.findUnique({
    where:  { platform_platformChatId: { platform: "telegram", platformChatId } },
    select: { id: true },
  });
  if (!user) return buildWelcomeMessage();
  const existing = await loadState(user.id);
  if (existing) return buildWelcomeMessage(); // already initialised — idempotent
  const state = initState(user.id);
  await saveState(user.id, state);
  return buildWelcomeMessage();
}
