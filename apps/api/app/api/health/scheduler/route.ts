import { schedulerStatus } from "../../../../lib/internal-checkin-scheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/health/scheduler
// Whether the scheduled jobs are actually running, as a status code a monitor
// can read. /api/health answers 200 whenever the process is up, which is what
// the host's own health check needs; a timer that has stopped ticking does
// not show there. This does:
//
//   200  ticking, or told not to tick (DISABLE_INTERNAL_CHECKIN_CRON)
//   503  not started, or running with no tick for more than three intervals
//
// It reports only. It starts nothing and runs no tick, so asking cannot send
// anything. No secrets and no learner data: the same fields as /api/health.
export async function GET() {
  const scheduler = schedulerStatus();
  const healthy = scheduler.state === "disabled" || (scheduler.state === "running" && !scheduler.stale);
  return Response.json({ ok: healthy, scheduler }, { status: healthy ? 200 : 503 });
}
