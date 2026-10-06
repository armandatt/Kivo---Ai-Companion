// ─── Proactive decision ───────────────────────────────────────────────────────
// Whether Nova messages a learner who has not written, and about what.
// Pure: no DB, no LLM, no clock of its own. The cron gathers the facts; the
// Response Brain words whatever this approves; the outbox delivers it.
//
//   1. generateCandidates   every reason that holds right now
//   2. applyGates           what must be true before Nova speaks at all,
//                           then what must be true for each reason
//   3. pick                 the most important reason left
//
// All candidates are produced before any gate runs, so a blocked reason never
// hides a valid one. Silence is the default outcome: most ticks approve
// nothing.

import type { ProactiveType } from "../types/proactive.types";

export const MAX_PER_DAY        = 2;
export const MIN_GAP_HOURS      = 4;
export const QUIET_FROM_HOUR    = 23;   // local, inclusive
export const QUIET_UNTIL_HOUR   = 7;    // local, exclusive
export const EXAM_WITHIN_DAYS   = 3;
export const EXAM_WINDOW        = { from: 9, to: 21 };
export const RECOVERY_MIN_DAYS  = 2;
export const RECOVERY_MAX_DAYS  = 7;
export const RECENT_MESSAGE_MINUTES = 30;

const RANK: Record<ProactiveType, number> = {
  exam_countdown: 4, missed_plan_recovery: 3, review_due: 2, daily_nudge: 1,
};

// Reasons that ask the learner to study now. An exam countdown informs; these
// press, so they yield to more.
const PRESSURE: ReadonlySet<ProactiveType> = new Set<ProactiveType>(["review_due", "missed_plan_recovery", "daily_nudge"]);

export interface StudyWindow {
  from:  number;   // local hour, inclusive
  to:    number;   // local hour, exclusive
  // learning_dna: where their counted sessions actually fall (supported or
  // stronger). stated: what they said in setup. default: neither is known.
  basis: "learning_dna" | "stated" | "default";
}

export interface ProactiveFacts {
  localDay:   string;        // YYYY-MM-DD, learner's timezone
  localHour:  number;
  window:     StudyWindow;
  studiedToday:         boolean;
  daysSinceLastSession: number | null;   // in local calendar days; null: never studied
  lastSessionDay:       string | null;
  exams:      Array<{ id: string; title: string; daysUntil: number }>;   // local calendar days
  reviewDueCount: number;
  hasPlan:    boolean;       // the Planning Engine has something to recommend
}

export interface ProactiveGates {
  proactiveEnabled:  boolean;
  paused:            boolean;   // "Not today"
  undeliverable:     boolean;   // Telegram refused the last delivery
  hasTimezone:       boolean;
  activeSession:     boolean;
  messagedRecently:  boolean;
  // Proactive messages already delivered (or possibly delivered) today.
  sentToday:         Array<{ type: string; at: Date }>;
  lastSentAt:        Date | null;
  realityCategories: string[];  // active reality, by category
  now:               Date;
}

export interface ProactiveCandidate {
  type:          ProactiveType;
  // The logical occurrence. One per key is ever sent, whatever the number of
  // ticks, restarts or instances.
  occurrenceKey: string;
  reason:        string;
  examId?:       string;
}

export interface ProactiveDecision {
  chosen:     ProactiveCandidate | null;
  // Why nothing (or not everything) went out. For logs, never for storage.
  suppressed: Array<{ type: ProactiveType | "all"; reason: string }>;
}

const inWindow = (hour: number, w: { from: number; to: number }) => hour >= w.from && hour < w.to;

export function isQuietHour(hour: number): boolean {
  return hour >= QUIET_FROM_HOUR || hour < QUIET_UNTIL_HOUR;
}

export function generateCandidates(f: ProactiveFacts): ProactiveCandidate[] {
  const out: ProactiveCandidate[] = [];

  const exam = [...f.exams].filter(e => e.daysUntil >= 0 && e.daysUntil <= EXAM_WITHIN_DAYS).sort((a, b) => a.daysUntil - b.daysUntil)[0];
  if (exam) {
    out.push({
      type: "exam_countdown", occurrenceKey: `exam:${exam.id}:${f.localDay}`, examId: exam.id,
      reason: `${exam.title} ${exam.daysUntil === 0 ? "is today" : exam.daysUntil === 1 ? "is tomorrow" : `in ${exam.daysUntil} days`}`,
    });
  }
  if (
    f.daysSinceLastSession !== null && f.lastSessionDay !== null &&
    f.daysSinceLastSession >= RECOVERY_MIN_DAYS && f.daysSinceLastSession <= RECOVERY_MAX_DAYS && f.hasPlan
  ) {
    // Keyed by the last day they studied: one message per lapse, not per day.
    out.push({
      type: "missed_plan_recovery", occurrenceKey: `recovery:${f.lastSessionDay}`,
      reason: `no session for ${f.daysSinceLastSession} days`,
    });
  }
  if (f.reviewDueCount > 0) {
    out.push({
      type: "review_due", occurrenceKey: `review:${f.localDay}`,
      reason: `${f.reviewDueCount} topic${f.reviewDueCount === 1 ? "" : "s"} due for review`,
    });
  }
  if (!f.studiedToday && f.hasPlan) {
    out.push({ type: "daily_nudge", occurrenceKey: `nudge:${f.localDay}`, reason: "usual study time, nothing done yet today" });
  }
  return out;
}

// Gates that silence everything, in the order they are cheapest to explain.
export function globalBlock(g: ProactiveGates, localHour: number): string | null {
  if (!g.proactiveEnabled) return "proactive_disabled";
  if (g.undeliverable)     return "chat_undeliverable";
  if (!g.hasTimezone)      return "timezone_unknown";
  if (g.paused)            return "paused_by_learner";
  if (isQuietHour(localHour)) return "quiet_hours";
  if (g.activeSession)     return "session_running";
  if (g.messagedRecently)  return "learner_active_in_chat";
  if (g.sentToday.length >= MAX_PER_DAY) return "daily_cap";
  if (g.lastSentAt && g.now.getTime() - g.lastSentAt.getTime() < MIN_GAP_HOURS * 3_600_000) return "too_soon_after_last";
  // Illness or injury: Nova says nothing first, whatever is due.
  if (g.realityCategories.some(c => c === "health" || c === "injury")) return "health_constraint";
  return null;
}

function candidateBlock(c: ProactiveCandidate, f: ProactiveFacts, g: ProactiveGates): string | null {
  if (c.type === "exam_countdown") {
    if (!inWindow(f.localHour, EXAM_WINDOW)) return "outside_window";
    if (g.sentToday.some(s => s.type === "exam_countdown")) return "already_sent_today";
    return null;
  }
  if (!inWindow(f.localHour, f.window)) return "outside_window";
  // Something real is in the way (a family matter, a loss): no study pressure.
  if (g.realityCategories.some(r => r === "emotional" || r === "life_constraint")) return "reality_constraint";
  if (f.studiedToday) return "studied_today";
  // One push to study a day. A second reason does not earn a second message.
  if (g.sentToday.some(s => PRESSURE.has(s.type as ProactiveType))) return "already_nudged_today";
  return null;
}

// Whether a message that was approved on an earlier tick, and not yet
// delivered, may still go out now. The same gates, asked again: a send that
// failed an hour ago is not owed to a learner who has since started studying,
// fallen ill or said "not today". null: it may. Otherwise, why not.
export function holdReason(type: ProactiveType, facts: ProactiveFacts, gates: ProactiveGates): string | null {
  return globalBlock(gates, facts.localHour) ?? candidateBlock({ type, occurrenceKey: "", reason: "" }, facts, gates);
}

export function decideProactive(facts: ProactiveFacts, gates: ProactiveGates): ProactiveDecision {
  const candidates = generateCandidates(facts);
  if (candidates.length === 0) return { chosen: null, suppressed: [] };

  const blocked = globalBlock(gates, facts.localHour);
  if (blocked) return { chosen: null, suppressed: [{ type: "all", reason: blocked }] };

  const suppressed: ProactiveDecision["suppressed"] = [];
  const eligible = candidates.filter(c => {
    const why = candidateBlock(c, facts, gates);
    if (why) suppressed.push({ type: c.type, reason: why });
    return !why;
  });
  const chosen = [...eligible].sort((a, b) => RANK[b.type] - RANK[a.type])[0] ?? null;
  return { chosen, suppressed };
}

// ── When the learner usually studies ──────────────────────────────────────────

const STATED_WINDOWS: Record<string, { from: number; to: number }> = {
  morning: { from: 9, to: 12 }, afternoon: { from: 14, to: 17 }, evening: { from: 18, to: 21 }, night: { from: 21, to: 23 },
};
export const DEFAULT_WINDOW = { from: 17, to: 20 };
export const WINDOW_HOURS   = 3;

// Their sessions, if enough of them agree; else what they said; else a
// default that claims nothing about them.
export function studyWindow(input: {
  dnaWindow: { from: number; to: number } | null;   // only when the signal is supported or stronger
  statedPreference: string | null;
}): StudyWindow {
  if (input.dnaWindow) {
    return { from: input.dnaWindow.from, to: Math.min(input.dnaWindow.to, input.dnaWindow.from + WINDOW_HOURS), basis: "learning_dna" };
  }
  const stated = STATED_WINDOWS[(input.statedPreference ?? "").trim().toLowerCase()];
  return stated ? { ...stated, basis: "stated" } : { ...DEFAULT_WINDOW, basis: "default" };
}
