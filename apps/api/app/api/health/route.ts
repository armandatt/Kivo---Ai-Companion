import { schedulerStatus, startInternalCheckinScheduler } from "../../../lib/internal-checkin-scheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Liveness, and whether this process is the one running the scheduled jobs.
// No secrets and no learner data: the build's commit, the scheduler's state
// and its last tick.
export async function GET() {
  startInternalCheckinScheduler();
  // Which commit this process was built from (Render sets RENDER_GIT_COMMIT).
  // The web app deploys by itself on every merge and this API does not, so
  // this is how to tell whether the API is behind.
  const commit = (process.env.RENDER_GIT_COMMIT ?? "").slice(0, 12) || null;
  return Response.json({ ok: true, commit, scheduler: schedulerStatus() });
}
