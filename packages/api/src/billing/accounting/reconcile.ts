// ─── Reservations left open: settled from what is on record ──────────────────
// Runs with the scheduler's hourly housekeeping (apps/api/lib/checkin-cron.ts)
// and from the shadow report script. A reservation is stale once past its
// expiry (rules.ts RESERVATION_TTL_MS): its process stopped (a crash, a
// deploy), or the work never told the ledger how it ended.
//   Nova credits   the interaction's usage events say what happened: a call
//                  succeeded → commit its measured cost in credits (the
//                  learner got work done before the interruption); none →
//                  refund (`stale_no_usage`).
//   browser tasks  still reserved at expiry means no step completed: refund
//                  (`no_meaningful_work`), keeping any cost already recorded.
//   anything else  refund (`stale`).

import { interactionUsage } from "../usage-events";
import { reconcileStale, type StaleDecision, type StaleReservation } from "./ledger";
import { creditRateVersion, creditsFor } from "./rules";
import { purgeRateLimits } from "./limiter";
import { accountingMode } from "./targets";

export async function decideStale(r: StaleReservation): Promise<StaleDecision> {
  if (r.product === "nova_credits" && r.ref) {
    const u = await interactionUsage(r.ref);
    if (u.succeeded > 0) {
      const units = u.unknown > 0 ? Math.max(creditsFor(u.succeededCostMicros), r.reservedUnits) : creditsFor(u.succeededCostMicros);
      return { commit: units, costMicros: u.costMicros, reason: "reconciled_after_interruption" };
    }
    return { refund: true, costMicros: u.costMicros, reason: "stale_no_usage" };
  }
  if (r.product === "browser_tasks") return { refund: true, reason: "no_meaningful_work" };
  return { refund: true, reason: "stale" };
}

export async function reconcileUsage(now = new Date()): Promise<{ committed: number; refunded: number; skipped: number; rateVersion: string } | null> {
  if (accountingMode() === "off") return null;
  const out = await reconcileStale(now, decideStale);
  // Rate-limit windows that ended over a day ago.
  await purgeRateLimits(now).catch(() => 0);
  if (out.committed + out.refunded + out.skipped > 0) {
    console.log(JSON.stringify({ layer: "usage_accounting", event: "reconciled", ...out }));
  }
  return { ...out, rateVersion: creditRateVersion() };
}
