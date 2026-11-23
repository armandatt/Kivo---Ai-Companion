// ─── Who has a paid plan, and why ─────────────────────────────────────────────
// The one rule for an account's access, from its subscription row (the
// provider's state, as verified webhooks reported it). Pure: the rows and the
// time are passed in, so every state is tested on its own
// (__tests__/billing.test.ts, accounting-rules.test.ts). Every surface asks
// this, through entitlements.ts; nothing else decides it, and no browser
// flag, success page or client state is read.
//
// Everyone is Free unless a verified payment says otherwise (owner decision,
// 2026-11-23): there is no free trial of a paid plan.
//
//   active (provider)                  its plan's tier, until the period ends
//                                      (+ a short grace for a late renewal event)
//   canceled, ending at period end     its tier until then, then Free
//   past_due, unpaid                   its tier for a short grace from when the
//                                      payment failed, then Free
//   trialing (the provider's trial),
//   revoked, incomplete, expired,
//   paused, or anything unknown        Free
//   Kivo's own trial row (legacy)      Free: kept for history, grants nothing
//   no subscription                    Free
//
// Losing a tier changes allowances only: nothing a learner made is touched.

import { PAID_PLANS, tierOfPlan, type PlanKey, type Tier } from "./plans";

// The legacy two-state answer (Free or paid-like access), still read by the
// daily meter's Telegram factor and older views. `tier` is the entitlement.
export type AccessPlan = "free" | "pro";

export interface SubscriptionRow {
  planKey:            string;
  status:             string;
  currentPeriodEnd:   Date | null;
  cancelAtPeriodEnd:  boolean;
  endedAt:            Date | null;
  // When the provider says the payment failed, and when it last changed the
  // record: the grace after a failed payment counts from these, never from a
  // period end the provider may already have moved forward.
  pastDueAt?:         Date | null;
  providerModifiedAt?: Date | null;
}

export interface TrialRow { startedAt: Date; endsAt: Date }

export type AccessSource = "subscription" | "grace" | "free";

export interface Access {
  plan:    AccessPlan;
  // What the account is entitled to: free, plus or pro (billing/accounting/rules.ts).
  tier:    Tier;
  source:  AccessSource;
  // The paid plan behind the tier, when there is one.
  planKey: PlanKey | null;
  // When the tier ends unless something changes (a renewal, a payment). null: no end known.
  until:   Date | null;
}

const DAY = 86_400_000;
// Only a paying subscription. The provider's own trial ("trialing") is never
// offered (checkout sends allow_trial: false) and grants nothing if it appears.
const PAID_STATUSES = new Set(["active"]);
const GRACE_STATUSES = new Set(["past_due", "unpaid"]);
const PAID_KEYS = new Set<string>(PAID_PLANS);
const legacy = (tier: Tier): AccessPlan => (tier === "free" ? "free" : "pro");

export function deriveAccess(input: {
  subscription: SubscriptionRow | null;
  // Kivo's legacy trial row: read for history only, it grants nothing.
  trial?:       TrialRow | null;
  now:          Date;
  graceDays:    number;
}): Access {
  const { subscription: sub, now, graceDays } = input;
  const t = now.getTime();
  const grace = graceDays * DAY;

  if (sub && PAID_KEYS.has(sub.planKey) && !sub.endedAt) {
    const planKey = sub.planKey as PlanKey;
    const tier = tierOfPlan(planKey);
    const plan = legacy(tier);
    const end = sub.currentPeriodEnd?.getTime() ?? null;
    if (PAID_STATUSES.has(sub.status)) {
      if (end === null || t < end) return { plan, tier, source: "subscription", planKey, until: sub.currentPeriodEnd };
      // A period that has ended without the provider saying it renewed: the
      // grace covers a late renewal event. Set to cancel at the period end:
      // there is no renewal to wait for.
      if (!sub.cancelAtPeriodEnd && t < end + grace) return { plan, tier, source: "grace", planKey, until: new Date(end + grace) };
    }
    if (sub.status === "canceled" && end !== null && t < end) {
      return { plan, tier, source: "subscription", planKey, until: sub.currentPeriodEnd };
    }
    if (GRACE_STATUSES.has(sub.status)) {
      // A failed payment keeps the tier for the grace only, counted from when
      // it failed: the provider's past-due time, else the earlier of the period
      // end and the time the provider changed the record. A period end the
      // provider has already moved into the future never extends it.
      const failedAt = sub.pastDueAt?.getTime()
        ?? Math.min(end ?? Number.POSITIVE_INFINITY, sub.providerModifiedAt?.getTime() ?? Number.POSITIVE_INFINITY);
      if (Number.isFinite(failedAt) && t < failedAt + grace) {
        return { plan, tier, source: "grace", planKey, until: new Date(failedAt + grace) };
      }
    }
  }
  return { plan: "free", tier: "free", source: "free", planKey: null, until: null };
}

// Kivo offers no trial of a paid plan (2026-11-23). Kept so older clients that
// read `trialEligible` are told no; the trial table and route remain only for
// history and are listed for removal in docs/BILLING.md.
export function trialEligible(_input: { subscription: SubscriptionRow | null; trial: TrialRow | null }): boolean {
  return false;
}
