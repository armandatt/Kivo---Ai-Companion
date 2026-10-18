// ─── Who has Pro, and why ─────────────────────────────────────────────────────
// The one rule for an account's access, from its subscription row (the
// provider's state, as webhooks reported it) and its trial row. Pure: the
// rows and the time are passed in, so every state is tested on its own
// (__tests__/access.test.ts). Every surface asks this, through
// entitlements.ts; nothing else decides it, and no browser flag is read.
//
//   active, trialing (provider)        Pro, until the period ends
//   canceled, ending at period end     Pro until then, then Free
//   past_due, unpaid                   Pro for a short grace after the
//                                      period ended, then Free
//   revoked, incomplete, expired,
//   paused, or anything unknown         Free
//   Kivo's own trial, not yet over     Pro until it ends
//   none of the above                  Free
//
// Losing Pro changes allowances only: nothing a learner made is touched.

import type { PlanKey } from "./plans";

export type AccessPlan = "free" | "pro";

export interface SubscriptionRow {
  planKey:            string;
  status:             string;
  currentPeriodEnd:   Date | null;
  cancelAtPeriodEnd:  boolean;
  endedAt:            Date | null;
}

export interface TrialRow { startedAt: Date; endsAt: Date }

export type AccessSource = "subscription" | "grace" | "trial" | "free";

export interface Access {
  plan:    AccessPlan;
  source:  AccessSource;
  // The paid plan behind Pro, when there is one.
  planKey: PlanKey | null;
  // When Pro ends unless something changes (a renewal, a payment). null: no end known.
  until:   Date | null;
}

const DAY = 86_400_000;
const PRO_STATUSES = new Set(["active", "trialing"]);
const GRACE_STATUSES = new Set(["past_due", "unpaid"]);
const PAID_KEYS = new Set<string>(["pro_monthly", "pro_annual"]);

export function deriveAccess(input: {
  subscription: SubscriptionRow | null;
  trial:        TrialRow | null;
  now:          Date;
  graceDays:    number;
}): Access {
  const { subscription: sub, trial, now, graceDays } = input;
  const t = now.getTime();

  if (sub && PAID_KEYS.has(sub.planKey) && !sub.endedAt) {
    const planKey = sub.planKey as PlanKey;
    const end = sub.currentPeriodEnd?.getTime() ?? null;
    if (PRO_STATUSES.has(sub.status)) {
      // A period that has ended without the provider saying it renewed is
      // not trusted for long: the grace covers a late renewal event.
      if (end === null || t < end) return { plan: "pro", source: "subscription", planKey, until: sub.currentPeriodEnd };
      if (t < end + graceDays * DAY) return { plan: "pro", source: "grace", planKey, until: new Date(end + graceDays * DAY) };
    }
    if (sub.status === "canceled" && end !== null && t < end) {
      return { plan: "pro", source: "subscription", planKey, until: sub.currentPeriodEnd };
    }
    if (GRACE_STATUSES.has(sub.status) && end !== null && t < end + graceDays * DAY) {
      return { plan: "pro", source: "grace", planKey, until: new Date(end + graceDays * DAY) };
    }
  }

  if (trial && t >= trial.startedAt.getTime() && t < trial.endsAt.getTime()) {
    return { plan: "pro", source: "trial", planKey: null, until: trial.endsAt };
  }
  return { plan: "free", source: "free", planKey: null, until: null };
}

// The trial is for new accounts: one that has had a trial, or has ever had a
// subscription (paying now or not), is not offered another.
export function trialEligible(input: { subscription: SubscriptionRow | null; trial: TrialRow | null }): boolean {
  return input.trial === null && input.subscription === null;
}
