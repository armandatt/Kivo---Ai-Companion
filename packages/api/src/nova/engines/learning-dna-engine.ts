// ─── Learning DNA Engine ──────────────────────────────────────────────────────
// How this learner actually studies, concluded only from finished, timed
// sessions and the learner's own "How did it go?" answers.
// Pure: no DB, no LLM. Owner of every Learning DNA conclusion: Progress,
// Planner and the page all read what this file computes; none recomputes it.
//
// The rules that keep one unusual day from becoming a belief:
//   - Evidence is the last 90 days of counted sessions. Older sessions leave
//     the window, so a belief nobody is renewing fades by itself.
//   - A typical value is a median with its middle half, never an average.
//   - Nothing is concluded from fewer than five sessions.
//   - "X works better than Y" needs four answered sessions on each side and
//     a lead of twenty points. Otherwise there is no conclusion.
//   - Every conclusion is checked against the most recent sessions. When
//     they disagree, the signal is marked as weakening.
//
// What is NOT here, because nothing on record supports it: distraction,
// burnout, preferred modalities, attention and energy. See NOT_TRACKED in
// product/learning-dna.ts.

import type { TopicMasteryState } from "../types/engine.types";
import type { SessionOutcome } from "../types/session.types";
import { dayKey, dayNumber, localHour, mondayOf, resolveTimezone } from "./learner-calendar";
import { normalizeTopicName } from "./topic-mastery-engine";

// ── Thresholds ────────────────────────────────────────────────────────────────

export const DNA_EVIDENCE_DAYS   = 90;
export const DNA_MAX_SESSIONS    = 60;
// Pieces of evidence behind a level.
export const DNA_EMERGING_AT     = 5;
export const DNA_SUPPORTED_AT    = 10;
export const DNA_STRONG_AT       = 20;
// A comparison ("this works better than that") is only as good as its
// smaller side.
export const DNA_MIN_PER_SIDE    = 4;
export const DNA_SIDE_SUPPORTED  = 8;
export const DNA_SIDE_STRONG     = 15;
export const DNA_LEAD            = 0.2;
// The latest sessions a conclusion is checked against, once there are at
// least as many older ones.
export const DNA_RECENT_SESSIONS = 8;
export const DNA_MIN_WEEKS       = 4;

export type DnaLevel = "unknown" | "emerging" | "supported" | "strong";
export const DNA_LEVEL_RANK: Record<DnaLevel, number> = { unknown: 0, emerging: 1, supported: 2, strong: 3 };

export type DnaSignalKey =
  | "typical_session"
  | "plan_follow_through"
  | "days_per_week"
  | "usual_study_window"
  | "best_session_size"
  | "best_study_window"
  | "revision_spacing"
  | "needs_more_retrieval";

export type DnaValue =
  | { kind: "minutes"; typical: number; low: number; high: number }
  | { kind: "percent_of_plan"; typical: number }
  | { kind: "days_per_week"; typical: number; low: number; high: number }
  | { kind: "window"; label: string; sessions: number; of: number }
  | { kind: "comparison"; label: string; wentWell: number; of: number; against: Array<{ label: string; wentWell: number; of: number }> }
  | { kind: "topics"; topics: Array<{ topicName: string; subjectName: string | null; struggled: number; answered: number; masteryPercent: number | null }> };

export interface DnaSignal {
  key:        DnaSignalKey;
  level:      DnaLevel;
  // Identity of the conclusion, coarse enough that noise does not change it.
  // null: no conclusion.
  valueKey:   string | null;
  valueLabel: string | null;
  value:      DnaValue | null;
  evidenceCount:  number;
  evidenceUnit:   "sessions" | "answered sessions" | "weeks" | "reviews";
  lastEvidenceAt: Date | null;
  // The most recent evidence disagrees with the conclusion.
  weakening:  boolean;
  recent:     string | null;      // what the recent evidence says, when weakening
  explanation: string;            // why Nova concludes this, or why it does not
}

// A counted session (study-session-engine.ts isCountedSession), as evidence.
export interface DnaSession {
  id:             string;
  startedAt:      Date;
  minutes:        number;
  plannedMinutes: number | null;
  subjectId:      string | null;
  topicName:      string | null;
  // The learner's own answer. null: not asked or not answered.
  outcome:        SessionOutcome | null;
}

export interface DnaEvidence {
  sessions: DnaSession[];           // counted, within the window
  topics:   TopicMasteryState[];
  subjects: Array<{ id: string; name: string }>;
  // The learner's stored timezone. null: unknown, and no claim about clock
  // time is made.
  timezone: string | null;
  firstCountedAt: Date | null;      // the learner's first counted session ever
  now:      Date;
}

// ── Statistics ────────────────────────────────────────────────────────────────

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const at = (sorted.length - 1) * p;
  const lo = Math.floor(at), hi = Math.ceil(at);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (at - lo);
}
const sortedNumbers = (values: number[]) => [...values].sort((a, b) => a - b);
const middle = (values: number[]) => {
  const s = sortedNumbers(values);
  return { median: Math.round(percentile(s, 0.5)), low: Math.round(percentile(s, 0.25)), high: Math.round(percentile(s, 0.75)) };
};

export function levelFor(evidence: number): DnaLevel {
  if (evidence >= DNA_STRONG_AT) return "strong";
  if (evidence >= DNA_SUPPORTED_AT) return "supported";
  if (evidence >= DNA_EMERGING_AT) return "emerging";
  return "unknown";
}
const capAt = (level: DnaLevel, cap: DnaLevel): DnaLevel => (DNA_LEVEL_RANK[level] > DNA_LEVEL_RANK[cap] ? cap : level);

const WENT_WELL: ReadonlySet<SessionOutcome> = new Set<SessionOutcome>(["good", "crushed_it"]);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// ── Buckets ───────────────────────────────────────────────────────────────────

interface Bucket { key: string; label: string }

export const SESSION_SIZES: Array<Bucket & { below: number }> = [
  { key: "short",    label: "10–24 minutes",      below: 25 },
  { key: "medium",   label: "25–44 minutes",      below: 45 },
  { key: "long",     label: "45–74 minutes",      below: 75 },
  { key: "extended", label: "75 minutes or more", below: Infinity },
];
const sizeOf = (minutes: number) => SESSION_SIZES.find(b => minutes < b.below)!;

export const STUDY_WINDOWS: Array<Bucket & { from: number; to: number }> = [
  { key: "late_night",    label: "Late night (midnight–5am)", from: 0,  to: 5 },
  { key: "early_morning", label: "Early morning (5–9am)",     from: 5,  to: 9 },
  { key: "morning",       label: "Morning (9am–noon)",        from: 9,  to: 12 },
  { key: "afternoon",     label: "Afternoon (noon–5pm)",      from: 12, to: 17 },
  { key: "evening",       label: "Evening (5–9pm)",           from: 17, to: 21 },
  { key: "night",         label: "Night (9pm–midnight)",      from: 21, to: 24 },
];
const windowOf = (hour: number) => STUDY_WINDOWS.find(w => hour >= w.from && hour < w.to)!;

export const REVIEW_GAPS: Array<Bucket & { below: number }> = [
  { key: "1-2",  label: "a day or two later", below: 3 },
  { key: "3-6",  label: "3–6 days later",     below: 7 },
  { key: "7-13", label: "1–2 weeks later",    below: 14 },
  { key: "14+",  label: "2 weeks or more later", below: Infinity },
];
const gapOf = (days: number) => REVIEW_GAPS.find(b => days < b.below)!;

// ── Comparison ────────────────────────────────────────────────────────────────
// "Did sessions of one kind go better than another?" answered from the
// learner's own answers. A side counts once it has four answered sessions;
// a winner needs a twenty-point lead over the runner-up.

interface Tally { bucket: Bucket; wentWell: number; of: number }
export type Comparison =
  | { status: "clear"; best: Tally; against: Tally[]; smallerSide: number }
  | { status: "no_difference"; sides: Tally[] }
  | { status: "too_few"; answered: number };

export function compare(items: Array<{ bucket: Bucket; well: boolean }>): Comparison {
  const tallies = new Map<string, Tally>();
  for (const item of items) {
    const t = tallies.get(item.bucket.key) ?? { bucket: item.bucket, wentWell: 0, of: 0 };
    t.of++; if (item.well) t.wentWell++;
    tallies.set(item.bucket.key, t);
  }
  const rate  = (t: Tally) => t.wentWell / t.of;
  const sides = [...tallies.values()].filter(t => t.of >= DNA_MIN_PER_SIDE)
    .sort((a, b) => rate(b) - rate(a) || b.of - a.of || a.bucket.key.localeCompare(b.bucket.key));
  if (sides.length < 2) return { status: "too_few", answered: items.length };
  const [best, runnerUp] = sides as [Tally, Tally];
  // Compared in whole points, so a lead of exactly twenty counts.
  if (Math.round((rate(best) - rate(runnerUp)) * 100) < DNA_LEAD * 100) return { status: "no_difference", sides };
  return { status: "clear", best, against: sides.slice(1), smallerSide: Math.min(best.of, runnerUp.of) };
}

const sideLevel = (smaller: number): DnaLevel =>
  smaller >= DNA_SIDE_STRONG ? "strong" : smaller >= DNA_SIDE_SUPPORTED ? "supported" : "emerging";

function comparisonSignal(
  key:   DnaSignalKey,
  unit:  DnaSignal["evidenceUnit"],
  items: Array<{ bucket: Bucket; well: boolean; at: Date }>,   // oldest first
  words: { kind: string; too_few: string; none: string },
): DnaSignal {
  const lastEvidenceAt = items[items.length - 1]?.at ?? null;
  const base = { key, evidenceUnit: unit, lastEvidenceAt, weakening: false, recent: null };
  const result = compare(items);

  if (result.status === "too_few") {
    return { ...base, level: "unknown", valueKey: null, valueLabel: null, value: null, evidenceCount: result.answered, explanation: words.too_few };
  }
  if (result.status === "no_difference") {
    return {
      ...base, level: "unknown", valueKey: null, valueLabel: null, value: null,
      evidenceCount: result.sides.reduce((sum, t) => sum + t.of, 0),
      explanation: `${words.none} ${result.sides.map(t => `${t.wentWell} of ${t.of} went well ${words.kind} ${t.bucket.label}`).join("; ")}.`,
    };
  }

  const { best, against } = result;
  // Checked against the latest half of the evidence, once that half could
  // reach a conclusion of its own.
  const recentItems = items.length >= 4 * DNA_MIN_PER_SIDE ? items.slice(-Math.floor(items.length / 2)) : [];
  const recent      = recentItems.length > 0 ? compare(recentItems) : null;
  const disagrees   = recent?.status === "clear" && recent.best.bucket.key !== best.bucket.key ? recent.best : null;

  return {
    ...base,
    level:      sideLevel(result.smallerSide),
    valueKey:   best.bucket.key,
    valueLabel: best.bucket.label,
    value: {
      kind: "comparison", label: best.bucket.label, wentWell: best.wentWell, of: best.of,
      against: against.map(t => ({ label: t.bucket.label, wentWell: t.wentWell, of: t.of })),
    },
    evidenceCount: best.of + against.reduce((sum, t) => sum + t.of, 0),
    weakening: disagrees !== null,
    recent: disagrees ? `In your latest ${recentItems.length}, ${disagrees.bucket.label} went better: ${disagrees.wentWell} of ${disagrees.of}.` : null,
    explanation: `${best.wentWell} of ${best.of} went well ${words.kind} ${best.bucket.label}, against ${against.map(t => `${t.wentWell} of ${t.of} ${words.kind} ${t.bucket.label}`).join(" and ")}.`,
  };
}

// ── Signals ───────────────────────────────────────────────────────────────────

const unknown = (key: DnaSignalKey, unit: DnaSignal["evidenceUnit"], count: number, explanation: string, lastEvidenceAt: Date | null = null): DnaSignal =>
  ({ key, level: "unknown", valueKey: null, valueLabel: null, value: null, evidenceCount: count, evidenceUnit: unit, lastEvidenceAt, weakening: false, recent: null, explanation });

const needs = (have: number, what: string) =>
  `Nova needs ${plural(DNA_EMERGING_AT, what)} before it says anything here. It has ${have}.`;

function typicalSession(sessions: DnaSession[]): DnaSignal {
  const n = sessions.length;
  const last = sessions[n - 1]?.startedAt ?? null;
  if (n < DNA_EMERGING_AT) return unknown("typical_session", "sessions", n, needs(n, "finished session"), last);

  const { median, low, high } = middle(sessions.map(s => s.minutes));
  // Lengths all over the place: there is a middle, but it is not a habit.
  const scattered = high > 2 * low;

  let weakening = false, recent: string | null = null;
  if (n >= 2 * DNA_RECENT_SESSIONS) {
    const older  = middle(sessions.slice(0, -DNA_RECENT_SESSIONS).map(s => s.minutes));
    const latest = middle(sessions.slice(-DNA_RECENT_SESSIONS).map(s => s.minutes)).median;
    if ((latest < older.low || latest > older.high) && Math.abs(latest - older.median) >= 10) {
      weakening = true;
      recent = `Your last ${DNA_RECENT_SESSIONS} sessions ran about ${latest} minutes, ${latest < older.median ? "shorter" : "longer"} than the ${older.median} before them.`;
    }
  }

  return {
    key: "typical_session",
    level: scattered ? capAt(levelFor(n), "emerging") : levelFor(n),
    valueKey: sizeOf(median).key,
    valueLabel: `About ${median} minutes`,
    value: { kind: "minutes", typical: median, low, high },
    evidenceCount: n, evidenceUnit: "sessions", lastEvidenceAt: last,
    weakening, recent,
    explanation: scattered
      ? `Your last ${n} sessions vary a lot: the middle half ran anywhere from ${low} to ${high} minutes, so ${median} is a midpoint more than a habit.`
      : `The middle half of your last ${n} sessions ran ${low} to ${high} minutes. The one in the middle was ${median}.`,
  };
}

// Study time against the length the session was started with.
export function planFollowThrough(sessions: DnaSession[]): DnaSignal {
  const planned = sessions.filter(s => s.plannedMinutes !== null && s.plannedMinutes > 0);
  const n = planned.length;
  const last = planned[n - 1]?.startedAt ?? null;
  if (n < DNA_EMERGING_AT) return unknown("plan_follow_through", "sessions", n, needs(n, "session started with a planned length"), last);

  const ratios  = planned.map(s => s.minutes / s.plannedMinutes!);
  const typical = Math.round(percentile(sortedNumbers(ratios), 0.5) * 100);
  const reached = ratios.filter(r => r >= 0.9).length;
  const band    = typical >= 110 ? "over" : typical >= 90 ? "on" : typical >= 60 ? "under" : "well_under";
  const label   = { over: "You usually run past the planned length", on: "You usually finish the planned length", under: "You usually stop before the planned length", well_under: "You usually stop well before the planned length" }[band];

  let weakening = false, recent: string | null = null;
  if (n >= 2 * DNA_RECENT_SESSIONS) {
    const latest = ratios.slice(-DNA_RECENT_SESSIONS);
    const older  = ratios.slice(0, -DNA_RECENT_SESSIONS);
    const lm = Math.round(percentile(sortedNumbers(latest), 0.5) * 100), om = Math.round(percentile(sortedNumbers(older), 0.5) * 100);
    if (Math.abs(lm - om) >= 25) { weakening = true; recent = `Your last ${DNA_RECENT_SESSIONS} planned sessions ran about ${lm}% of the plan, against ${om}% before.`; }
  }

  return {
    key: "plan_follow_through", level: levelFor(n), valueKey: band, valueLabel: label,
    value: { kind: "percent_of_plan", typical },
    evidenceCount: n, evidenceUnit: "sessions", lastEvidenceAt: last, weakening, recent,
    explanation: `In ${reached} of your last ${n} sessions that had a planned length, you studied at least 90% of it. The typical one ran ${typical}% of the plan.`,
  };
}

function daysPerWeek(e: DnaEvidence): DnaSignal {
  const zone  = resolveTimezone(e.timezone);
  const dayOf = (d: Date) => dayNumber(dayKey(d, zone));
  const last  = e.sessions[e.sessions.length - 1]?.startedAt ?? null;
  const none  = (weeks: number) => unknown("days_per_week", "weeks", weeks,
    `Nova needs ${DNA_MIN_WEEKS} finished weeks since your first session before it describes a weekly rhythm. It has ${weeks}.`, last);
  if (!e.firstCountedAt) return none(0);
  // Weeks with nothing in them describe an absence, not a rhythm.
  if (e.sessions.length < DNA_EMERGING_AT) return unknown("days_per_week", "weeks", 0, needs(e.sessions.length, "finished session"), last);

  // Finished weeks only, and never the week the learner started in unless
  // they started on its Monday.
  const firstDay   = dayOf(e.firstCountedAt);
  const firstWeek  = mondayOf(firstDay) === firstDay ? firstDay : mondayOf(firstDay) + 7;
  const thisWeek   = mondayOf(dayOf(e.now));
  const windowFrom = mondayOf(dayOf(new Date(e.now.getTime() - DNA_EVIDENCE_DAYS * 86_400_000))) + 7;
  const starts: number[] = [];
  for (let w = Math.max(firstWeek, windowFrom); w < thisWeek; w += 7) starts.push(w);
  const weeks = starts.slice(-8);
  if (weeks.length < DNA_MIN_WEEKS) return none(weeks.length);

  const days   = new Set(e.sessions.map(s => dayOf(s.startedAt)));
  const counts = weeks.map(w => Array.from({ length: 7 }, (_, i) => w + i).filter(d => days.has(d)).length);
  const { median, low, high } = middle(counts);
  const uneven = high - low >= 3;
  const level: DnaLevel = weeks.length >= 8 ? "strong" : weeks.length >= 6 ? "supported" : "emerging";

  let weakening = false, recent: string | null = null;
  if (weeks.length >= 6) {
    const latest = middle(counts.slice(-3)).median, older = middle(counts.slice(0, -3)).median;
    if (Math.abs(latest - older) >= 2) {
      weakening = true;
      recent = `Your last 3 weeks had about ${plural(latest, "study day")} each, ${latest > older ? "up" : "down"} from ${older} before.`;
    }
  }

  return {
    key: "days_per_week", level: uneven ? capAt(level, "emerging") : level,
    valueKey: String(median), valueLabel: `${plural(median, "day")} a week`,
    value: { kind: "days_per_week", typical: median, low, high },
    evidenceCount: weeks.length, evidenceUnit: "weeks", lastEvidenceAt: last, weakening, recent,
    explanation: uneven
      ? `Over your last ${weeks.length} finished weeks you studied on anything from ${low} to ${high} days. ${median} is the middle, not a routine.`
      : `Over your last ${weeks.length} finished weeks you studied on ${low === high ? plural(low, "day") : `${low} to ${high} days`} in a typical week.`,
  };
}

const NO_TIMEZONE = "Nova doesn't know your timezone, so it makes no claim about the time of day you study.";

function usualStudyWindow(e: DnaEvidence): DnaSignal {
  const n = e.sessions.length;
  const last = e.sessions[n - 1]?.startedAt ?? null;
  if (!e.timezone) return unknown("usual_study_window", "sessions", n, NO_TIMEZONE, last);
  if (n < DNA_EMERGING_AT) return unknown("usual_study_window", "sessions", n, needs(n, "finished session"), last);

  const top = (sessions: DnaSession[]) => {
    const counts = new Map<string, number>();
    for (const s of sessions) { const w = windowOf(localHour(s.startedAt, e.timezone!)); counts.set(w.key, (counts.get(w.key) ?? 0) + 1); }
    const [key, count] = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]!;
    return { window: STUDY_WINDOWS.find(w => w.key === key)!, count };
  };
  const { window, count } = top(e.sessions);
  // A usual time is where at least half of the sessions start.
  if (count * 2 < n) {
    return unknown("usual_study_window", "sessions", n, `Your last ${n} sessions are spread across the day. No part of it holds half of them.`, last);
  }

  let weakening = false, recent: string | null = null;
  if (n >= 2 * DNA_RECENT_SESSIONS) {
    const latest = top(e.sessions.slice(-DNA_RECENT_SESSIONS));
    if (latest.window.key !== window.key && latest.count * 2 > DNA_RECENT_SESSIONS) {
      weakening = true;
      recent = `${latest.count} of your last ${DNA_RECENT_SESSIONS} sessions started in the ${latest.window.label.toLowerCase()}.`;
    }
  }

  return {
    key: "usual_study_window", level: levelFor(n), valueKey: window.key, valueLabel: window.label,
    value: { kind: "window", label: window.label, sessions: count, of: n },
    evidenceCount: n, evidenceUnit: "sessions", lastEvidenceAt: last, weakening, recent,
    explanation: `${count} of your last ${n} sessions started in this part of the day.`,
  };
}

const answered = (sessions: DnaSession[]) => sessions.filter(s => s.outcome !== null);
const TOO_FEW_ANSWERS = (what: string) =>
  `Nova compares how sessions went, from your "How did it go?" answers. It needs ${DNA_MIN_PER_SIDE} answered sessions ${what} before it compares them.`;

function bestSessionSize(e: DnaEvidence): DnaSignal {
  return comparisonSignal("best_session_size", "answered sessions",
    answered(e.sessions).map(s => ({ bucket: sizeOf(s.minutes), well: WENT_WELL.has(s.outcome!), at: s.startedAt })),
    { kind: "at", too_few: TOO_FEW_ANSWERS("in each of two length ranges"), none: "No session length stands out:" });
}

function bestStudyWindow(e: DnaEvidence): DnaSignal {
  const items = answered(e.sessions);
  if (!e.timezone) return unknown("best_study_window", "answered sessions", items.length, NO_TIMEZONE, items[items.length - 1]?.startedAt ?? null);
  return comparisonSignal("best_study_window", "answered sessions",
    items.map(s => ({ bucket: windowOf(localHour(s.startedAt, e.timezone!)), well: WENT_WELL.has(s.outcome!), at: s.startedAt })),
    { kind: "in the", too_few: TOO_FEW_ANSWERS("in each of two parts of the day"), none: "No time of day stands out:" });
}

const topicKey = (s: { subjectId: string | null; topicName: string | null }) =>
  s.subjectId && s.topicName ? `${s.subjectId}|${normalizeTopicName(s.topicName).toLowerCase()}` : null;

function byTopic(sessions: DnaSession[]): Map<string, DnaSession[]> {
  const map = new Map<string, DnaSession[]>();
  for (const s of sessions) {
    const key = topicKey(s);
    if (key) map.set(key, [...(map.get(key) ?? []), s]);
  }
  return map;
}

// How a session went, against how long it had been since the last session
// on the same topic.
function revisionSpacing(e: DnaEvidence): DnaSignal {
  const zone  = resolveTimezone(e.timezone);
  const dayOf = (d: Date) => dayNumber(dayKey(d, zone));
  const items: Array<{ bucket: Bucket; well: boolean; at: Date }> = [];
  for (const sessions of byTopic(e.sessions).values()) {
    for (let i = 1; i < sessions.length; i++) {
      const gap = dayOf(sessions[i]!.startedAt) - dayOf(sessions[i - 1]!.startedAt);
      const outcome = sessions[i]!.outcome;
      if (gap >= 1 && outcome) items.push({ bucket: gapOf(gap), well: WENT_WELL.has(outcome), at: sessions[i]!.startedAt });
    }
  }
  items.sort((a, b) => a.at.getTime() - b.at.getTime());
  return comparisonSignal("revision_spacing", "reviews", items, {
    kind: "when you came back",
    too_few: `Nova compares how a topic went when you came back to it sooner or later. It needs ${DNA_MIN_PER_SIDE} answered return visits at each of two gaps.`,
    none: "No gap between visits stands out:",
  });
}

// Topics the learner keeps struggling with, by their own answers. A topic
// leaves the list once its last two sessions went well.
export const RETRIEVAL_MIN_ANSWERS   = 3;
export const RETRIEVAL_MIN_STRUGGLES = 2;
const RETRIEVAL_TOPIC_LIMIT = 5;

function needsMoreRetrieval(e: DnaEvidence): DnaSignal {
  const subjectName = new Map(e.subjects.map(s => [s.id, s.name]));
  const subjectId   = new Map(e.subjects.map(s => [s.name, s.id]));
  const mastery     = new Map(e.topics.map(t => [topicKey({ subjectId: subjectId.get(t.subjectName) ?? null, topicName: t.topicName }), t]));
  const allAnswered = answered(e.sessions);

  const flagged = [...byTopic(allAnswered).entries()].flatMap(([key, sessions]) => {
    const outcomes  = sessions.map(s => s.outcome!);
    const struggled = outcomes.filter(o => o === "struggled").length;
    const lastTwo   = outcomes.slice(-2);
    if (outcomes.length < RETRIEVAL_MIN_ANSWERS || struggled < RETRIEVAL_MIN_STRUGGLES) return [];
    if (lastTwo.every(o => WENT_WELL.has(o))) return [];                       // recovered
    if (struggled / outcomes.length < 0.4 && !lastTwo.every(o => o === "struggled")) return [];
    const latest = sessions[sessions.length - 1]!;
    const state  = mastery.get(key) ?? null;
    return [{
      key, at: latest.startedAt,
      topicName: state?.topicName ?? latest.topicName!, subjectName: subjectName.get(latest.subjectId!) ?? null,
      struggled, answered: outcomes.length,
      masteryPercent: state && state.reviewCount > 0 ? Math.round(state.masteryProbability * 100) : null,
    }];
  }).sort((a, b) => b.struggled - a.struggled || b.answered - a.answered || a.topicName.localeCompare(b.topicName));

  if (flagged.length === 0) {
    const last = allAnswered[allAnswered.length - 1]?.startedAt ?? null;
    return unknown("needs_more_retrieval", "answered sessions", allAnswered.length,
      allAnswered.length >= DNA_EMERGING_AT
        ? "No topic shows repeated struggle in your recent answers."
        : `Nova flags a topic only after ${RETRIEVAL_MIN_ANSWERS} answered sessions on it with ${RETRIEVAL_MIN_STRUGGLES} of them "Struggled". Nothing has reached that.`,
      last);
  }

  const shown = flagged.slice(0, RETRIEVAL_TOPIC_LIMIT);
  const most  = Math.max(...flagged.map(t => t.answered));
  return {
    key: "needs_more_retrieval",
    level: most >= 8 ? "strong" : most >= 5 ? "supported" : "emerging",
    valueKey: flagged.map(t => t.key).sort().join(","),
    valueLabel: shown.map(t => t.topicName).join(", "),
    value: { kind: "topics", topics: shown.map(({ topicName, subjectName, struggled, answered, masteryPercent }) => ({ topicName, subjectName, struggled, answered, masteryPercent })) },
    evidenceCount: flagged.reduce((sum, t) => sum + t.answered, 0), evidenceUnit: "answered sessions",
    lastEvidenceAt: new Date(Math.max(...flagged.map(t => t.at.getTime()))),
    weakening: false, recent: null,
    explanation: shown.map(t => `${t.topicName}: "Struggled" in ${t.struggled} of ${plural(t.answered, "answered session")}`).join(". ") + ".",
  };
}

// ── The engine ────────────────────────────────────────────────────────────────

export function computeLearningDna(evidence: DnaEvidence): DnaSignal[] {
  const from = evidence.now.getTime() - DNA_EVIDENCE_DAYS * 86_400_000;
  const sessions = evidence.sessions
    .filter(s => s.startedAt.getTime() >= from && s.startedAt.getTime() <= evidence.now.getTime())
    .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
    .slice(-DNA_MAX_SESSIONS);
  const e = { ...evidence, sessions };
  return [
    typicalSession(sessions),
    planFollowThrough(sessions),
    daysPerWeek(e),
    usualStudyWindow(e),
    bestSessionSize(e),
    bestStudyWindow(e),
    revisionSpacing(e),
    needsMoreRetrieval(e),
  ];
}

// ── Remembering what was concluded ────────────────────────────────────────────
// The conclusions are recomputed from sessions every time. This is only the
// bookkeeping that lets Nova say "since when" and "it used to be": one entry
// per signal, advanced each time a session ends.

export interface DnaMemory {
  valueKey:      string | null;
  valueLabel:    string | null;
  level:         DnaLevel;
  since:         string;                       // when this conclusion was first reached
  levelSince:    string;
  previousLevel: DnaLevel | null;
  // The conclusion this one replaced.
  previous:      { label: string; until: string } | null;
}
export type DnaMemoryMap = Partial<Record<DnaSignalKey, DnaMemory>>;

export function advanceDnaMemory(stored: DnaMemoryMap, signals: DnaSignal[], now: Date): DnaMemoryMap {
  const at = now.toISOString();
  const next: DnaMemoryMap = {};
  for (const s of signals) {
    const was = stored[s.key];
    if (!was) {
      if (s.valueKey !== null) next[s.key] = { valueKey: s.valueKey, valueLabel: s.valueLabel, level: s.level, since: at, levelSince: at, previousLevel: null, previous: null };
      continue;
    }
    if (was.valueKey === s.valueKey) {
      // Same conclusion: keep its start, note a change of level.
      next[s.key] = was.level === s.level
        ? { ...was, valueLabel: s.valueLabel }
        : { ...was, valueLabel: s.valueLabel, level: s.level, levelSince: at, previousLevel: was.level };
      continue;
    }
    next[s.key] = {
      valueKey: s.valueKey, valueLabel: s.valueLabel, level: s.level, since: at, levelSince: at,
      previousLevel: was.level,
      previous: was.valueKey !== null && was.valueLabel ? { label: was.valueLabel, until: at } : was.previous,
    };
  }
  return next;
}

// ── The legacy columns ────────────────────────────────────────────────────────
// NovaLearningDNA's older columns, as functions of the signals above, so the
// table never holds a second opinion.

export function legacyDnaColumns(signals: DnaSignal[]): {
  optimalSessionMinutes: number | null;
  planAdherenceProfile:  string | null;
  dataPointCount:        number;
  confidence:            "low" | "medium" | "high";
} {
  const typical = signals.find(s => s.key === "typical_session");
  const plan    = signals.find(s => s.key === "plan_follow_through");
  return {
    optimalSessionMinutes: typical?.value?.kind === "minutes" ? typical.value.typical : null,
    planAdherenceProfile:  plan?.valueKey == null ? null
      : plan.valueKey === "over" || plan.valueKey === "on" ? "consistent"
      : plan.valueKey === "under" ? "variable" : "inconsistent",
    dataPointCount: typical?.evidenceCount ?? 0,
    confidence:     typical?.level === "strong" ? "high" : typical?.level === "supported" ? "medium" : "low",
  };
}

// ── Is the belief changing? ───────────────────────────────────────────────────

export type DnaTrend = "new" | "strengthening" | "steady" | "weakening" | "changed";
const NEW_FOR_DAYS     = 14;
const CHANGED_FOR_DAYS = 30;

export function trendOf(signal: DnaSignal, memory: DnaMemory | undefined, now: Date): { trend: DnaTrend | null; note: string | null } {
  if (signal.valueKey === null) return { trend: null, note: null };
  if (signal.weakening) return { trend: "weakening", note: signal.recent };
  // Memory of a different conclusion says nothing about this one.
  if (!memory || memory.valueKey !== signal.valueKey) return { trend: "steady", note: null };

  const daysSince = (iso: string) => (now.getTime() - new Date(iso).getTime()) / 86_400_000;
  if (memory.previous && daysSince(memory.since) <= CHANGED_FOR_DAYS) {
    return { trend: "changed", note: `This used to be "${memory.previous.label}".` };
  }
  if (memory.previousLevel && daysSince(memory.levelSince) <= NEW_FOR_DAYS) {
    const before = DNA_LEVEL_RANK[memory.previousLevel], after = DNA_LEVEL_RANK[signal.level];
    if (after > before && before > 0) return { trend: "strengthening", note: "More evidence stands behind this than two weeks ago." };
    if (after < before) return { trend: "weakening", note: "Less recent evidence stands behind this than before." };
  }
  if (!memory.previous && daysSince(memory.since) <= NEW_FOR_DAYS) return { trend: "new", note: "Nova has only recently had enough evidence to say this." };
  return { trend: "steady", note: null };
}
