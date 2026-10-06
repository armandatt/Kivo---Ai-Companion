import { schedulerStatus, startInternalCheckinScheduler } from "../../../lib/internal-checkin-scheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Liveness, and whether this process is the one running the scheduled jobs.
// No secrets and no learner data: the scheduler's state and its last tick.
export async function GET() {
  startInternalCheckinScheduler();
  return Response.json({ ok: true, scheduler: schedulerStatus() });
}
