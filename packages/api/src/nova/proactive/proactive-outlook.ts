// ─── Could a proactive tick send this learner anything? (pure) ────────────────
// The scheduler skips the database on a tick when nothing can be due
// (services/schedulerIdle.ts). For Nova that question is per learner: given
// what the last full tick learned about them, could a tick at moment t
// approve a message?
//
// Built from the same rules decideProactive applies, so it can only answer
// "no" where the decision would also say no whatever else is true:
//   - quiet hours (a time Nova picked), unless their own check-in time;
//   - an exam countdown only inside EXAM_WINDOW, only with an exam within
//     EXAM_WITHIN_DAYS, once a day;
//   - every other message (a push to study) only inside the pressure window
//     (their check-in window, else their study window), not after they
//     studied today, once a day;
//   - at most MAX_PER_DAY a day.
// A message approved earlier and not yet delivered is retried under the same
// gates (holdReason), so it is covered too. Anything not known is "yes":
// a learner the tick could not judge, a new local day, a window not yet
// read. Only states that change by a write (Nova turned off, the chat
// unreachable, no timezone, setup not finished) are "no" until then, and a
// write makes the scheduler run in full anyway.
//
// held by proactive-outlook.test.ts (decideProactive approving at t implies
// proactiveMayActAt says yes at t).

import { dayKey, localHour, localMinute } from "../engines/learner-calendar";
import {
  EXAM_WITHIN_DAYS, MAX_PER_DAY, inExamWindow, inPressureWindowAt, isPressureType, isQuietFor,
  type ProactiveFacts, type ProactiveGates,
} from "../decision/proactive-decision";

export interface ProactiveOutlook {
  // Nothing can change for this learner but by a write.
  stopped:       boolean;
  zone:          string | null;
  // The local day the rest was judged on.
  day:           string | null;
  checkinMinute: number | null;
  // Their study window; null: not read on that tick (decided before it).
  window:        { from: number; to: number } | null;
  examPossible:  boolean;   // an exam within EXAM_WITHIN_DAYS on `day`
  examDone:      boolean;   // the exam countdown already went today
  pressureDone:  boolean;   // a push to study already went today, or they studied
  capReached:    boolean;   // MAX_PER_DAY delivered today
}

export const STOPPED: ProactiveOutlook = {
  stopped: true, zone: null, day: null, checkinMinute: null, window: null,
  examPossible: false, examDone: false, pressureDone: false, capReached: false,
};

// Decided before the facts were read (quiet hours): only the clock is known.
export function earlyOutlook(zone: string, day: string, checkinMinute: number | null): ProactiveOutlook {
  return { stopped: false, zone, day, checkinMinute, window: null, examPossible: true, examDone: false, pressureDone: false, capReached: false };
}

// From the facts and gates the tick decided on.
export function outlookOf(facts: ProactiveFacts, gates: ProactiveGates, zone: string): ProactiveOutlook {
  return {
    stopped:       false,
    zone,
    day:           facts.localDay,
    checkinMinute: facts.checkinMinute ?? null,
    window:        { from: facts.window.from, to: facts.window.to },
    examPossible:  facts.exams.some(e => e.daysUntil >= 0 && e.daysUntil <= EXAM_WITHIN_DAYS),
    examDone:      gates.sentToday.some(s => s.type === "exam_countdown"),
    pressureDone:  facts.studiedToday || gates.sentToday.some(s => isPressureType(s.type)),
    capReached:    gates.sentToday.length >= MAX_PER_DAY,
  };
}

// null: the tick could not judge this learner (an error), so "yes".
export function proactiveMayActAt(outlook: ProactiveOutlook | null, t: Date): boolean {
  if (!outlook) return true;
  if (outlook.stopped || !outlook.zone) return false;
  const zone = outlook.zone;
  const clock = { localHour: localHour(t, zone), localMinute: localMinute(t, zone), checkinMinute: outlook.checkinMinute };
  if (isQuietFor(clock as ProactiveFacts)) return false;
  // A new local day: today's counts no longer apply and nothing is known.
  if (dayKey(t, zone) !== outlook.day) return true;
  if (outlook.capReached) return false;
  const exam = outlook.examPossible && !outlook.examDone && inExamWindow(clock.localHour);
  const pressure = !outlook.pressureDone
    && (outlook.window === null || inPressureWindowAt({ ...clock, window: { ...outlook.window, basis: "default" } }));
  return exam || pressure;
}
