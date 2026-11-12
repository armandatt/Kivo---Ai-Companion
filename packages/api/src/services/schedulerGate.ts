// ─── Whether the scheduled jobs run in this process (pure) ─────────────────────
// Used by apps/api/lib/internal-checkin-scheduler.ts.

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
