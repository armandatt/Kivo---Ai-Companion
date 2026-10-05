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
  return Math.max(0, wall - session.totalPausedSeconds);
}
