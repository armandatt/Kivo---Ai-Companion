import { timingSafeEqual } from "node:crypto";
import { runCheckinCron } from "../../../lib/checkin-cron";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/checkin runs one scheduler tick by hand. Nothing in the deployed
// system calls it: the scheduler is a timer inside this process and calls
// runCheckinCron directly (lib/internal-checkin-scheduler.ts).
//
// A tick reads every learner and may send messages, so it is not something
// anyone on the internet should be able to start. When CRON_SECRET is set the
// caller must send "Authorization: Bearer <CRON_SECRET>" (the header Vercel
// Cron sends by itself). In production with no CRON_SECRET the endpoint is
// closed. Outside production it stays open, for local use.
function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const given    = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(req: Request) {
  if (!authorized(req)) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const result = await runCheckinCron();

  if (!result.ok) {
    return Response.json(result, { status: 500 });
  }

  return Response.json(result);
}
