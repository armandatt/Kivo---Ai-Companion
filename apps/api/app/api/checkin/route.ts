import { runCheckinCron } from "../../../lib/checkin-cron";

export const runtime = "nodejs";

export async function GET() {
  const result = await runCheckinCron();

  if (!result.ok) {
    return Response.json(result, { status: 500 });
  }

  return Response.json(result);
}
