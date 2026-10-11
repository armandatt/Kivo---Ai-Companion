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
// A check-in the learner asked for at a time is good for this long after it.
// A tick that runs late (a restart, a sleeping host) still delivers it inside
// the window; after that it has expired and is not sent late.
export const CHECKIN_WINDOW_MINUTES = 180;

const RANK: Record<ProactiveType, number> = {
  exam_countdown: 4, missed_plan_recovery: 3, review_due: 2, daily_checkin: 1, daily_nudge: 1,
};

// Reasons that ask the learner to study now. An exam countdown informs; these
// press, so they yield to more.
const PRESSURE: ReadonlySet<ProactiveType> = new Set<ProactiveType>(["review_due", "missed_plan_recovery", "daily_nudge", "daily_checkin"]);

export interface StudyWindow {
  from:  number;   // local hour, inclusive
  to:    number;   // local hour, exclusive
  // learning_dna: where their counted sessions actually fall (supported or
  // stronger). stated: what they said in setup. default: neither is known.
  // chosen: the check-in time they picked; `checkinMinute` on the facts holds
  // it to the minute and is what the gates use.
  basis: "learning_dna" | "stated" | "default" | "chosen";
}

export interface ProactiveFacts {
  localDay:   string;        // YYYY-MM-DD, learner's timezone
  localHour:  number;
  // Minutes past the hour (0–59). Only a chosen check-in time needs it.
  localMinute?: number;
  // The daily check-in time the learner chose, as minutes after local
  // midnight. null or absent: they chose none, and the study window decides.
  checkinMinute?: number | null;
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
  // They have written to Nova since today's check-in time came round: the
  // conversation the check-in would open is already happening.
  messagedSinceCheckin?: boolean;
  // Proactive messages already delivered (or possibly delivered) today.
  sentToday:         Array<{ type: string; at: Date }>;
  lastSentAt:        Date | null;
  // What is limiting the learner right now, by category. Only circumstances
  // that will pass (an illness, a bad week, a family matter). A standing
  // arrangement (a job, a commute, a chronic condition) shapes the plan; it
  // is not a reason for Nova to stay silent for months.
  realityCategories: string[];
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
  // The message may inform but must not ask them to study: no recommended
  // block, no Start button. An exam date reaching someone who has said
  // something is in the way this week.
  informOnly: boolean;
  // Why nothing (or not everything) went out. For logs, never for storage.
  suppressed: Array<{ type: ProactiveType | "all"; reason: string }>;
}

const inWindow = (hour: number, w: { from: number; to: number }) => hour >= w.from && hour < w.to;

export function isQuietHour(hour: number): boolean {
  return hour >= QUIET_FROM_HOUR || hour < QUIET_UNTIL_HOUR;
}

// ── The chosen check-in time ──────────────────────────────────────────────────
// "HH:MM" as the learner entered it, to minutes after midnight. null: not a time.
export function parseCheckinTime(raw: string | null | undefined): number | null {
  if (typeof raw !== "string") return null;
  const parts = raw.trim().split(":");
  if (parts.length < 2 || parts.length > 3) return null;
  const [h, m] = [parts[0]!, parts[1]!];
  const digits = (s: string) => s.length >= 1 && s.length <= 2 && [...s].every(ch => ch >= "0" && ch <= "9");
  if (!digits(h) || !digits(m)) return null;
  const hour = Number(h), minute = Number(m);
  return hour <= 23 && minute <= 59 ? hour * 60 + minute : null;
}

const hasCheckin = (f: ProactiveFacts): f is ProactiveFacts & { checkinMinute: number } =>
  typeof f.checkinMinute === "number";

// Whether today's chosen check-in is due and has not expired. The window
// never runs past midnight, so one local day holds one check-in.
export function inCheckinWindow(f: ProactiveFacts): boolean {
  if (!hasCheckin(f)) return false;
  const minute = f.localHour * 60 + (f.localMinute ?? 0);
  return minute >= f.checkinMinute && minute < Math.min(f.checkinMinute + CHECKIN_WINDOW_MINUTES, 24 * 60);
}

// When the messages that ask the learner to study may go out: from the time
// they chose, if they chose one; else their study window.
const inPressureWindow = (f: ProactiveFacts): boolean => (hasCheckin(f) ? inCheckinWindow(f) : inWindow(f.localHour, f.window));

// Quiet hours protect the learner from a time Nova picked. A time the learner
// picked is theirs: a 6:30 check-in is sent at 6:30.
export const isQuietFor = (f: ProactiveFacts): boolean => isQuietHour(f.localHour) && !inCheckinWindow(f);

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
  if (hasCheckin(f)) {
    // The check-in they asked for. It does not wait for a plan: a learner
    // with nothing planned yet is the one who most needs to be asked.
    if (!f.studiedToday) {
      out.push({ type: "daily_checkin", occurrenceKey: `checkin:${f.localDay}`, reason: "the daily check-in time they chose, nothing done yet today" });
    }
  } else if (!f.studiedToday && f.hasPlan) {
    out.push({ type: "daily_nudge", occurrenceKey: `nudge:${f.localDay}`, reason: "usual study time, nothing done yet today" });
  }
  return out;
}

// Gates that silence everything, in the order they are cheapest to explain.
export function globalBlock(g: ProactiveGates, f: ProactiveFacts): string | null {
  if (!g.proactiveEnabled) return "proactive_disabled";
  if (g.undeliverable)     return "chat_undeliverable";
  if (!g.hasTimezone)      return "timezone_unknown";
  if (g.paused)            return "paused_by_learner";
  if (isQuietFor(f))       return "quiet_hours";
  if (g.activeSession)     return "session_running";
  if (g.messagedRecently)  return "learner_active_in_chat";
  if (g.sentToday.length >= MAX_PER_DAY) return "daily_cap";
  if (g.lastSentAt && g.now.getTime() - g.lastSentAt.getTime() < MIN_GAP_HOURS * 3_600_000) return "too_soon_after_last";
  // Illness or injury: Nova says nothing first, whatever is due.
  if (g.realityCategories.some(c => c === "health" || c === "injury")) return "health_constraint";
  // Grief, burnout, a hard stretch: the same. An exam being near does not
  // make it the moment to bring up studying.
  if (g.realityCategories.includes("emotional")) return "emotional_constraint";
  return null;
}

function candidateBlock(c: ProactiveCandidate, f: ProactiveFacts, g: ProactiveGates): string | null {
  if (c.type === "exam_countdown") {
    if (!inWindow(f.localHour, EXAM_WINDOW)) return "outside_window";
    if (g.sentToday.some(s => s.type === "exam_countdown")) return "already_sent_today";
    return null;
  }
  if (!inPressureWindow(f)) return "outside_window";
  // Something real is in the way (a family matter, a trip): no study pressure.
  if (g.realityCategories.includes("life_constraint")) return "reality_constraint";
  if (f.studiedToday) return "studied_today";
  // One push to study a day. A second reason does not earn a second message.
  if (g.sentToday.some(s => PRESSURE.has(s.type as ProactiveType))) return "already_nudged_today";
  if (c.type === "daily_checkin" && g.messagedSinceCheckin) return "learner_already_here";
  return null;
}

// Whether a message that was approved on an earlier tick, and not yet
// delivered, may still go out now. The same gates, asked again: a send that
// failed an hour ago is not owed to a learner who has since started studying,
// fallen ill or said "not today". null: it may. Otherwise, why not.
export function holdReason(type: ProactiveType, facts: ProactiveFacts, gates: ProactiveGates): string | null {
  return globalBlock(gates, facts) ?? candidateBlock({ type, occurrenceKey: "", reason: "" }, facts, gates);
}

// An exam date is information, so it still reaches a learner with a life
// constraint (a family matter, a work week). But only as information.
export function informOnly(type: ProactiveType, gates: ProactiveGates): boolean {
  return type === "exam_countdown" && gates.realityCategories.includes("life_constraint");
}

export function decideProactive(facts: ProactiveFacts, gates: ProactiveGates): ProactiveDecision {
  const candidates = generateCandidates(facts);
  if (candidates.length === 0) return { chosen: null, informOnly: false, suppressed: [] };

  const blocked = globalBlock(gates, facts);
  if (blocked) return { chosen: null, informOnly: false, suppressed: [{ type: "all", reason: blocked }] };

  const suppressed: ProactiveDecision["suppressed"] = [];
  const eligible = candidates.filter(c => {
    const why = candidateBlock(c, facts, gates);
    if (why) suppressed.push({ type: c.type, reason: why });
    return !why;
  });
  const chosen = [...eligible].sort((a, b) => RANK[b.type] - RANK[a.type])[0] ?? null;
  return { chosen, informOnly: chosen !== null && informOnly(chosen.type, gates), suppressed };
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
