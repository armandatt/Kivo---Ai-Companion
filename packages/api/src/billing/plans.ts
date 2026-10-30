// ─── Kivo's plans ─────────────────────────────────────────────────────────────
// What each plan is called, costs and includes, in one place: the landing
// page's pricing, the account's billing page and checkout all read it, so
// none of them can say something the others do not.
//
// These are launch settings, not commercial constants: the price, the trial
// and whether a plan can be bought are read here, and the provider's product
// ids live server-side (billing config), never in this file. A plan that is
// not `enabled` is shown as coming and cannot be bought.

export type PlanKey = "free" | "pro_monthly" | "pro_annual";
export type BillingInterval = "month" | "year";

export interface PlanDefinition {
  key:         PlanKey;
  name:        string;
  // In the currency's smallest unit (cents for USD). 0 for Free.
  priceMinor:  number;
  currency:    "USD";
  interval:    BillingInterval | null;
  // Days of Pro an eligible new account gets before paying; 0 for none.
  trialDays:   number;
  enabled:     boolean;
  tagline:     string;
  // Only what the product does: every line here must be true of the plan.
  features:    string[];
}

const FREE_FEATURES = [
  "Today with Nova, your daily flow and your task board",
  "Focus sessions, with reviews when they are due",
  "Notes, Knowledge and the Knowledge Map",
  "Progress and Learning DNA",
  "Nova on the web and on Telegram, within a daily allowance",
];

export const PLANS: Record<PlanKey, PlanDefinition> = {
  free: {
    key: "free", name: "Free", priceMinor: 0, currency: "USD", interval: null, trialDays: 0, enabled: true,
    tagline: "Everything you need to plan, study and keep notes.",
    features: FREE_FEATURES,
  },
  pro_monthly: {
    key: "pro_monthly", name: "Pro", priceMinor: 1_000, currency: "USD", interval: "month", trialDays: 7, enabled: true,
    tagline: "For students who lean on Nova every day.",
    features: [
      "Everything in Free",
      "A much larger daily Nova allowance, on the web and Telegram",
      "Ask Nova about your notes and saved pages as often as you need",
      "Seven days of Pro free to start, with no card needed",
    ],
  },
  // Not on sale, and its price is not shown while it is not (components/pricing.tsx).
  // 7_500 keeps the old discount against the monthly price; no one has set it yet.
  pro_annual: {
    key: "pro_annual", name: "Pro yearly", priceMinor: 7_500, currency: "USD", interval: "year", trialDays: 7, enabled: false,
    tagline: "Pro for the whole year, for less.",
    features: [
      "Everything in Pro",
      "Billed once a year",
    ],
  },
};

export const PAID_PLANS: PlanKey[] = ["pro_monthly", "pro_annual"];

// "$10" / "$1,000": whole dollars, or cents only when there are some.
export function formatPrice(plan: Pick<PlanDefinition, "priceMinor" | "currency">): string {
  const dollars = plan.priceMinor / 100;
  return `$${dollars.toLocaleString("en-US", dollars % 1 === 0 ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function intervalLabel(plan: Pick<PlanDefinition, "interval">): string {
  return plan.interval === "month" ? "/month" : plan.interval === "year" ? "/year" : "forever";
}
