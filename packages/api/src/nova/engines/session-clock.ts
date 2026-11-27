// ─── Session clock ────────────────────────────────────────────────────────────
// How long a study session has actually run. Pure: no DB, no LLM.
// The one definition of study time: every reader (session context, execution
// report, Home, the focus screen) and every writer (resume, end) uses it.
// Owner: Study Session Engine.

export interface SessionClock {
  startedAt:          Date;
  status:             string;        // "in_progress" | "paused"
  pausedAt:           Date | null;
  totalPausedSeconds: number;
}

// Rows written before totalPausedSeconds existed carry whole minutes only.
export function pausedSecondsOf(row: { totalPausedSeconds: number; totalPausedMinutes: number }): number {
  return Math.max(row.totalPausedSeconds, row.totalPausedMinutes * 60);
}

// Length of a pause that started at pausedAt and ends now.
export function pauseLengthSeconds(pausedAt: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - pausedAt.getTime()) / 1000));
}

// Study time so far. Finished pauses are subtracted; while paused the clock
// stands at the moment of the pause.
export function sessionElapsedSeconds(session: SessionClock, now: Date): number {
  const until = session.status === "paused" && session.pausedAt ? session.pausedAt : now;
  const wall  = Math.floor((until.getTime() - session.startedAt.getTime()) / 1000);
  const study = wall - session.totalPausedSeconds;
  // A timestamp that is not a time yields no study time, never a number made up.
  return Number.isFinite(study) ? Math.max(0, study) : 0;
}

// ── A session nobody came back to ─────────────────────────────────────────────
// A timer left running, or paused and forgotten, is not study. Past these
// limits the session is closed: it stops holding back Nova's messages, and
// none of the time it sat open is recorded as studied.
//
// How it is closed depends on why (sessionClosure below). A paused session is
// one the learner stopped themselves: the time on its clock was studied, so
// it is SAVED as a completed session with that time, never dropped (bug batch
// 28 Nov, item 1). A timer left running past its plan is closed as
// "abandoned", uncounted, as before.
//
//   running   study time reaches the planned length plus the grace period
//   paused    one pause lasts ABANDON_PAUSED_MINUTES, however little was studied
//
// A session started with no length is judged against the fallback. That is a
// limit for cleaning up, not a claim that anyone studied for that long. One
// started with no time limit by choice (planned 0, Today's "No time limit")
// is held to ABANDON_UNTIMED_MINUTES: the learner asked not to be timed, and
// only a session nobody has touched for that long is a forgotten one.
//
// The limits are for sessions nobody is attending. They are not a maximum: a
// learner who ends a session themselves, while it is still open, ends it as a
// session with all of its study time (persistence/nova-persistence.ts).

export const ABANDON_GRACE_MINUTES            = 30;
export const ABANDON_FALLBACK_PLANNED_MINUTES = 60;
export const ABANDON_PAUSED_MINUTES           = 120;
export const ABANDON_UNTIMED_MINUTES          = 360;
export const ABANDONED_STATUS                 = "abandoned";

export interface Abandonment {
  reason:         "ran_past_plan" | "paused_too_long";
  // What is kept as the session's length: the study time on its clock, never
  // more than the planned length (or the fallback).
  countedMinutes: number;
  // The study time on its clock, whole minutes, with no cap: what a paused
  // session is saved with (the clock stopped at the pause).
  studiedMinutes: number;
  // The length it was held to (abandonmentPlanMinutes).
  plannedMinutes: number;
}

// The marker kept on a session saved by the sweep (executionReport.autoClosed),
// so the learner can be told and the session told apart from one they ended.
export const AUTO_SAVED_PAUSED = "paused_too_long";

// Owner decision, 28 Nov (PR #113 B.1): a timer left running past its plan is
// saved too, with the time on its clock. When it ran more than
// CONFIRM_OVER_PLAN_MINUTES past the plan, that time is not believed yet: the
// session is kept as "unconfirmed" (in none of Progress's numbers) until the
// learner confirms or trims it (confirmSessionTime).
export const CONFIRM_OVER_PLAN_MINUTES = 120;
export const UNCONFIRMED_STATUS = "unconfirmed";
export const AUTO_SAVED_RUNNING = "ran_past_plan";

export type SessionClosure =
  | { status: "completed"; durationMinutes: number; autoClosed: typeof AUTO_SAVED_PAUSED | typeof AUTO_SAVED_RUNNING }
  | { status: typeof UNCONFIRMED_STATUS; durationMinutes: number; autoClosed: typeof AUTO_SAVED_RUNNING };

// Whether `studied` minutes on a plan of `planned` is too far past it to count unasked.
export const needsTimeConfirm = (studied: number, planned: number) => studied - planned > CONFIRM_OVER_PLAN_MINUTES;

// What a session past its limit becomes. Paused: saved, with the time studied
// up to the pause. Left running: saved with the time on its clock, or kept
// unconfirmed when that is more than two hours past the plan. Nothing is
// abandoned any more; Progress still leaves out anything under ten minutes.
export function sessionClosure(verdict: Abandonment): SessionClosure {
  if (verdict.reason === "paused_too_long") return { status: "completed", durationMinutes: verdict.studiedMinutes, autoClosed: AUTO_SAVED_PAUSED };
  return needsTimeConfirm(verdict.studiedMinutes, verdict.plannedMinutes)
    ? { status: UNCONFIRMED_STATUS, durationMinutes: verdict.studiedMinutes, autoClosed: AUTO_SAVED_RUNNING }
    : { status: "completed", durationMinutes: verdict.studiedMinutes, autoClosed: AUTO_SAVED_RUNNING };
}

// The length a session is held to. A missing or unusable plan is the fallback.
export function abandonmentPlanMinutes(plannedDurationMinutes: number | null | undefined): number {
  if (plannedDurationMinutes === 0) return ABANDON_UNTIMED_MINUTES;
  return typeof plannedDurationMinutes === "number" && Number.isFinite(plannedDurationMinutes) && plannedDurationMinutes > 0
    ? plannedDurationMinutes
    : ABANDON_FALLBACK_PLANNED_MINUTES;
}

// null: the session is still a session. Only an open one can be abandoned.
export function sessionAbandonment(
  session: SessionClock & { plannedDurationMinutes: number | null },
  now:     Date,
): Abandonment | null {
  if (session.status !== "in_progress" && session.status !== "paused") return null;

  const planned = abandonmentPlanMinutes(session.plannedDurationMinutes);
  const study   = sessionElapsedSeconds(session, now);
  const studiedMinutes = Math.floor(study / 60);
  const countedMinutes = Math.min(studiedMinutes, planned);

  if (session.status === "paused" && session.pausedAt) {
    const paused = now.getTime() - session.pausedAt.getTime();
    if (Number.isFinite(paused) && paused >= ABANDON_PAUSED_MINUTES * 60_000) return { reason: "paused_too_long", countedMinutes, studiedMinutes, plannedMinutes: planned };
  }
  if (study >= (planned + ABANDON_GRACE_MINUTES) * 60) return { reason: "ran_past_plan", countedMinutes, studiedMinutes, plannedMinutes: planned };
  return null;
}
