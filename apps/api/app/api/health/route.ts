import { startInternalCheckinScheduler } from "../../../lib/internal-checkin-scheduler";

export const runtime = "nodejs";

export async function GET() {
  startInternalCheckinScheduler();
  return Response.json({ ok: true });
}
