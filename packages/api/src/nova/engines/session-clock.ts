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
// limits the session is closed as "abandoned": it stops holding back Nova's
// messages, and none of the time it sat open is recorded as studied.
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
  const countedMinutes = Math.min(Math.floor(study / 60), planned);

  if (session.status === "paused" && session.pausedAt) {
    const paused = now.getTime() - session.pausedAt.getTime();
    if (Number.isFinite(paused) && paused >= ABANDON_PAUSED_MINUTES * 60_000) return { reason: "paused_too_long", countedMinutes };
  }
  if (study >= (planned + ABANDON_GRACE_MINUTES) * 60) return { reason: "ran_past_plan", countedMinutes };
  return null;
}
