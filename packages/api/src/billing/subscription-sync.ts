// ─── From a provider event to the account's subscription row ─────────────────
// Pure: what a subscription record from the provider (a webhook payload, or
// the provider's own record fetched to be sure) means for the account's row.
// Webhooks can arrive twice, late or out of order, so the provider's
// modified time decides: a record older than the one already applied changes
// nothing, and applying the same record again gives the same row.

import type { PlanKey } from "./plans";

// The fields of the provider's subscription record that Kivo uses.
export interface ProviderSubscription {
  id:                   string;
  status:               string;
  created_at:           string;
  modified_at:          string | null;
  product_id:           string;
  customer_id:          string;
  currency:             string | null;
  recurring_interval:   string | null;
  current_period_start: string | null;
  current_period_end:   string | null;
  cancel_at_period_end: boolean;
  canceled_at:          string | null;
  ended_at:             string | null;
  past_due_at?:         string | null;
  customer?:            { external_id?: string | null } | null;
  metadata?:            Record<string, unknown> | null;
}

export interface StoredSubscription {
  providerSubscriptionId: string;
  providerModifiedAt:     Date;
  status:                 string;
}

// Statuses under which a subscription still pays for Pro (access.ts decides
// the details); used only to choose between two different subscriptions.
const LIVE = new Set(["active", "trialing", "past_due", "unpaid"]);

export interface SubscriptionData {
  userId:                 string;
  provider:               "polar";
  providerCustomerId:     string;
  providerSubscriptionId: string;
  planKey:                PlanKey;
  status:                 string;
  currency:               string | null;
  billingInterval:        string | null;
  currentPeriodStart:     Date | null;
  currentPeriodEnd:       Date | null;
  cancelAtPeriodEnd:      boolean;
  canceledAt:             Date | null;
  endedAt:                Date | null;
  pastDueAt:              Date | null;
  providerModifiedAt:     Date;
}

export type SyncDecision =
  | { action: "apply"; data: SubscriptionData }
  | { action: "ignore"; reason: "not_kivo_product" | "no_account" | "stale" | "superseded" };

const date = (s: string | null | undefined) => (s ? new Date(s) : null);

// The Kivo account a record belongs to: the external id Kivo gave the
// customer at checkout, else the account id Kivo put in the metadata.
export function accountOf(sub: Pick<ProviderSubscription, "customer" | "metadata">): string | null {
  const external = sub.customer?.external_id;
  if (typeof external === "string" && external) return external;
  const meta = sub.metadata?.kivo_user_id;
  return typeof meta === "string" && meta ? meta : null;
}

export function decideSync(input: {
  incoming:  ProviderSubscription;
  eventType: string;
  planKey:   PlanKey | null;            // the plan its product is, from config; null: not Kivo's
  stored:    StoredSubscription | null; // the account's row as it stands
  now:       Date;
}): SyncDecision {
  const { incoming, eventType, planKey, stored, now } = input;
  if (!planKey) return { action: "ignore", reason: "not_kivo_product" };
  const userId = accountOf(incoming);
  if (!userId) return { action: "ignore", reason: "no_account" };

  const modified = date(incoming.modified_at) ?? date(incoming.created_at) ?? now;
  // Revoked means access has ended now, whatever the period says.
  const revoked = eventType === "subscription.revoked";
  const incomingStatus = revoked ? "revoked" : incoming.status;

  if (stored && stored.providerSubscriptionId === incoming.id) {
    // The same subscription: only a newer version of it changes the row.
    if (stored.providerModifiedAt.getTime() > modified.getTime()) return { action: "ignore", reason: "stale" };
  } else if (stored && LIVE.has(stored.status) && !LIVE.has(incomingStatus)) {
    // Another subscription of the account's, ended or never started, never
    // replaces one that is paying for Pro now (a late event about an old one).
    return { action: "ignore", reason: "superseded" };
  }
  return {
    action: "apply",
    data: {
      userId,
      provider:               "polar",
      providerCustomerId:     incoming.customer_id,
      providerSubscriptionId: incoming.id,
      planKey,
      status:                 incomingStatus,
      currency:               incoming.currency ?? null,
      billingInterval:        incoming.recurring_interval ?? null,
      currentPeriodStart:     date(incoming.current_period_start),
      currentPeriodEnd:       date(incoming.current_period_end),
      cancelAtPeriodEnd:      incoming.cancel_at_period_end,
      canceledAt:             date(incoming.canceled_at),
      endedAt:                revoked ? (date(incoming.ended_at) ?? now) : date(incoming.ended_at),
      pastDueAt:              date(incoming.past_due_at ?? null),
      providerModifiedAt:     modified,
    },
  };
}
