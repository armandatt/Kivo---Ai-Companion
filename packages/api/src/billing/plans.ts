// ─── Kivo's plans ─────────────────────────────────────────────────────────────
// What each plan is called, costs and includes, in one place: the landing
// page's pricing, the account's billing page and checkout all read it, so
// none of them can say something the others do not.
//
// These are launch settings, not commercial constants: the price, the trial
// and whether a plan can be bought are read here, and the provider's product
// ids live server-side (billing config), never in this file. A plan that is
// not `enabled` is shown as coming and cannot be bought.

export type PlanKey = "free" | "plus_monthly" | "pro_monthly" | "pro_annual";
export type BillingInterval = "month" | "year";
// What a plan entitles: the allowances of billing/accounting/rules.ts.
export type Tier = "free" | "plus" | "pro";
export type Currency = "USD" | "INR";

export interface PlanDefinition {
  key:         PlanKey;
  name:        string;
  tier:        Tier;
  // In the currency's smallest unit (cents, paise). 0 for Free.
  priceMinor:  number;
  // Each plan is sold in one currency only; no conversion is shown anywhere.
  currency:    Currency;
  interval:    BillingInterval | null;
  // Days of Pro an eligible new account gets before paying; 0 for none.
  trialDays:   number;
  enabled:     boolean;
  tagline:     string;
  // Only what the product does: every line here must be true of the plan.
  features:    string[];
}

// Every line must be true of the plan. The allowances are the launch
// configuration (billing/accounting/rules.ts ALLOWANCES); they apply once usage
// enforcement is on (USAGE_ACCOUNTING=enforce), which must go live with this copy.
const FREE_FEATURES = [
  "Today with Nova, your daily flow and your task board",
  "Focus sessions, Notes, Knowledge and the Knowledge Map",
  "Progress and Learning DNA",
  "150 Nova credits a month, on the web, Telegram and the extension",
  "10 browser-agent tasks a month",
  "ChatGPT and Claude: 2,000 tool calls, then 100 reads a month",
  "500 MB for images and attachments",
];

export const PLANS: Record<PlanKey, PlanDefinition> = {
  free: {
    key: "free", name: "Free", tier: "free", priceMinor: 0, currency: "USD", interval: null, trialDays: 0, enabled: true,
    tagline: "Everything you need to plan, study and keep notes.",
    features: FREE_FEATURES,
  },
  // Sold in rupees. Purchasable only once its Polar product is configured
  // (POLAR_PRODUCT_PLUS_MONTHLY) and the INR route has been verified.
  plus_monthly: {
    key: "plus_monthly", name: "Plus", tier: "plus", priceMinor: 29_900, currency: "INR", interval: "month", trialDays: 0, enabled: true,
    tagline: "For connecting Kivo to ChatGPT and Claude, with Nova most days.",
    features: [
      "Everything in Free",
      "1,000 Nova credits a month",
      "40 browser-agent tasks a month",
      "ChatGPT and Claude with no fixed limit (fair use)",
      "2 GB for images and attachments",
    ],
  },
  pro_monthly: {
    key: "pro_monthly", name: "Pro", tier: "pro", priceMinor: 1_000, currency: "USD", interval: "month", trialDays: 7, enabled: true,
    tagline: "For students who lean on Nova every day.",
    features: [
      "Everything in Plus",
      "3,500 Nova credits a month",
      "120 browser-agent tasks a month",
      "15 GB for images and attachments",
      "Seven days free to start, with no card needed",
    ],
  },
  // Not on sale, and its price is not shown while it is not (components/pricing.tsx).
  // When sold, it grants Pro's monthly allowances month by month, never a year at once.
  pro_annual: {
    key: "pro_annual", name: "Pro yearly", tier: "pro", priceMinor: 7_500, currency: "USD", interval: "year", trialDays: 7, enabled: false,
    tagline: "Pro for the whole year, for less.",
    features: [
      "Everything in Pro",
      "Billed once a year; allowances renew monthly",
    ],
  },
};

export const PAID_PLANS: PlanKey[] = ["plus_monthly", "pro_monthly", "pro_annual"];

export const tierOfPlan = (key: string | null | undefined): Tier => (key && key in PLANS ? PLANS[key as PlanKey].tier : "free");

// "$10", "₹299": whole units, or two decimals only when there are some.
export function formatPrice(plan: Pick<PlanDefinition, "priceMinor" | "currency">): string {
  const units = plan.priceMinor / 100;
  const symbol = plan.currency === "INR" ? "₹" : "$";
  const locale = plan.currency === "INR" ? "en-IN" : "en-US";
  return `${symbol}${units.toLocaleString(locale, units % 1 === 0 ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function intervalLabel(plan: Pick<PlanDefinition, "interval">): string {
  return plan.interval === "month" ? "/month" : plan.interval === "year" ? "/year" : "forever";
}
