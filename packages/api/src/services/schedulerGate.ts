// ─── Whether the scheduled jobs run here, and how often cleanup runs (pure) ───
// Used by apps/api/lib/internal-checkin-scheduler.ts and checkin-cron.ts.

// Whether this process may run the scheduled jobs.
//
// Production (`next start`, NODE_ENV=production) runs them unless
// DISABLE_INTERNAL_CHECKIN_CRON=true. Anything else (`next dev`, a script)
// runs them only when ENABLE_INTERNAL_CHECKIN_CRON=true: a laptop's .env can
// hold the production database and the production bot token, and a dev
// server ticking against them sends real messages to real learners and
// keeps the production database awake. DISABLE wins everywhere.
export function schedulerEnabled(env: Record<string, string | undefined> = process.env): { enabled: boolean; reason: string } {
  if (env.DISABLE_INTERNAL_CHECKIN_CRON === "true") return { enabled: false, reason: "DISABLE_INTERNAL_CHECKIN_CRON=true" };
  if (env.NODE_ENV === "production") return { enabled: true, reason: "production" };
  if (env.ENABLE_INTERNAL_CHECKIN_CRON === "true") return { enabled: true, reason: "ENABLE_INTERNAL_CHECKIN_CRON=true" };
  return { enabled: false, reason: "not production (set ENABLE_INTERNAL_CHECKIN_CRON=true to run it)" };
}

// The retention purges (webhook dedup rows, old prompts, legacy decision
// rows) delete rows days old, so once an hour is plenty; every five minutes
// was three or four DELETEs a tick for nothing. The first call always says
// yes, so a fresh process cleans up at once. Process memory, and only paces
// cleanup: a restart runs it early, a clock that went backwards runs it, and
// nothing depends on it being exact.
export const HOUSEKEEPING_EVERY_MS = 60 * 60 * 1000;

export function createHousekeepingGate(everyMs = HOUSEKEEPING_EVERY_MS): (now: Date) => boolean {
  let last: number | null = null;
  return (now: Date) => {
    const t = now.getTime();
    if (last !== null && t >= last && t - last < everyMs) return false;
    last = t;
    return true;
  };
}
