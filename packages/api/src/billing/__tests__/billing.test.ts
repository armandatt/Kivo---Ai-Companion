// Billing rules that need no database: who has Pro, how a provider event
// changes a subscription row, which plans can be bought, and the allowances.

import { deriveAccess, trialEligible, type SubscriptionRow } from "../access";
import { decideSync, type ProviderSubscription } from "../subscription-sync";
import { planForProduct, providerConfig, purchasable, trialDays, graceDays } from "../config";
import { allowanceFor } from "../limits";
import { PLANS, formatPrice, intervalLabel } from "../plans";

const DAY = 86_400_000;
const NOW = new Date("2026-11-10T12:00:00Z");
const at = (days: number) => new Date(NOW.getTime() + days * DAY);
const sub = (over: Partial<SubscriptionRow> = {}): SubscriptionRow => ({ planKey: "pro_monthly", status: "active", currentPeriodEnd: at(20), cancelAtPeriodEnd: false, endedAt: null, ...over });
const access = (s: SubscriptionRow | null, trial: { startedAt: Date; endsAt: Date } | null = null, now = NOW) => deriveAccess({ subscription: s, trial, now, graceDays: 3 });

describe("who has Pro", () => {
  it("Free: no subscription, no trial", () => {
    expect(access(null)).toEqual({ plan: "free", source: "free", planKey: null, until: null });
  });

  it("active and trialing subscriptions are Pro until the period ends", () => {
    expect(access(sub())).toMatchObject({ plan: "pro", source: "subscription", planKey: "pro_monthly", until: at(20) });
    expect(access(sub({ status: "trialing" }))).toMatchObject({ plan: "pro", source: "subscription" });
  });

  it("an active period that ended without a renewal event keeps Pro only for the grace, then Free", () => {
    expect(access(sub({ currentPeriodEnd: at(-1) }))).toMatchObject({ plan: "pro", source: "grace", until: at(2) });
    expect(access(sub({ currentPeriodEnd: at(-4) })).plan).toBe("free");
  });

  it("set to cancel at the period end: no grace after it, since no renewal is coming", () => {
    expect(access(sub({ cancelAtPeriodEnd: true, currentPeriodEnd: at(2) }))).toMatchObject({ plan: "pro", until: at(2) });
    expect(access(sub({ cancelAtPeriodEnd: true, currentPeriodEnd: at(-1) })).plan).toBe("free");
  });

  it("cancelled at period end: Pro until then, then Free", () => {
    expect(access(sub({ status: "canceled", cancelAtPeriodEnd: true, currentPeriodEnd: at(5) }))).toMatchObject({ plan: "pro", until: at(5) });
    expect(access(sub({ status: "canceled", cancelAtPeriodEnd: true, currentPeriodEnd: at(-1) })).plan).toBe("free");
  });

  it("past due: a grace of three days after the period, then Free", () => {
    expect(access(sub({ status: "past_due", currentPeriodEnd: at(-2) }))).toMatchObject({ plan: "pro", source: "grace", until: at(1) });
    expect(access(sub({ status: "past_due", currentPeriodEnd: at(-3.5) })).plan).toBe("free");
    expect(access(sub({ status: "unpaid", currentPeriodEnd: at(-1) })).source).toBe("grace");
  });

  it("revoked, incomplete, paused, ended or an unknown plan are Free", () => {
    for (const status of ["revoked", "incomplete", "incomplete_expired", "paused", "something_new"]) {
      expect(access(sub({ status })).plan).toBe("free");
    }
    expect(access(sub({ endedAt: at(-1) })).plan).toBe("free");
    expect(access(sub({ planKey: "free" })).plan).toBe("free");
    expect(access(sub({ planKey: "enterprise" })).plan).toBe("free");
  });

  it("Kio's trial is Pro until it ends, not before it starts, and not after", () => {
    const trial = { startedAt: at(-2), endsAt: at(5) };
    expect(access(null, trial)).toMatchObject({ plan: "pro", source: "trial", until: at(5) });
    expect(access(null, { startedAt: at(-8), endsAt: at(-1) }).plan).toBe("free");
    expect(access(null, { startedAt: at(1), endsAt: at(8) }).plan).toBe("free");
  });

  it("a subscription outranks a trial; an ended one gives way to a running trial", () => {
    expect(access(sub(), { startedAt: at(-1), endsAt: at(6) }).source).toBe("subscription");
    expect(access(sub({ status: "revoked" }), { startedAt: at(-1), endsAt: at(6) }).source).toBe("trial");
  });

  it("the trial is offered once, and never to an account that has subscribed", () => {
    expect(trialEligible({ subscription: null, trial: null })).toBe(true);
    expect(trialEligible({ subscription: null, trial: { startedAt: at(-30), endsAt: at(-23) } })).toBe(false);
    expect(trialEligible({ subscription: sub({ status: "revoked" }), trial: null })).toBe(false);
  });
});

// ── Provider events → the subscription row ──
const record = (over: Partial<ProviderSubscription> = {}): ProviderSubscription => ({
  id: "sub_1", status: "active", created_at: "2026-11-01T00:00:00Z", modified_at: "2026-11-05T00:00:00Z",
  product_id: "prod_monthly", customer_id: "cus_1", currency: "inr", recurring_interval: "month",
  current_period_start: "2026-11-01T00:00:00Z", current_period_end: "2026-12-01T00:00:00Z",
  cancel_at_period_end: false, canceled_at: null, ended_at: null, customer: { external_id: "user_1" }, metadata: {},
  ...over,
});
const decide = (incoming: ProviderSubscription, stored: { providerSubscriptionId: string; providerModifiedAt: Date; status: string } | null = null, eventType = "subscription.updated", planKey: "pro_monthly" | null = "pro_monthly") =>
  decideSync({ incoming, eventType, planKey, stored, now: NOW });

describe("a provider event and the account's row", () => {
  it("applies a Kio subscription to the account named as the external customer", () => {
    const d = decide(record());
    expect(d.action).toBe("apply");
    if (d.action === "apply") {
      expect(d.data).toMatchObject({ userId: "user_1", planKey: "pro_monthly", status: "active", providerSubscriptionId: "sub_1", cancelAtPeriodEnd: false });
      expect(d.data.currentPeriodEnd).toEqual(new Date("2026-12-01T00:00:00Z"));
      expect(d.data.providerModifiedAt).toEqual(new Date("2026-11-05T00:00:00Z"));
    }
  });

  it("falls back to the account id in the metadata, and ignores a record with neither", () => {
    expect(decide(record({ customer: { external_id: null }, metadata: { kivo_user_id: "user_2" } }))).toMatchObject({ action: "apply", data: { userId: "user_2" } });
    expect(decide(record({ customer: null, metadata: {} }))).toEqual({ action: "ignore", reason: "no_account" });
  });

  it("ignores another seller's product: it grants nothing", () => {
    expect(decide(record(), null, "subscription.updated", null)).toEqual({ action: "ignore", reason: "not_kio_product" });
  });

  it("a late, older version of the same subscription changes nothing; the same version again is harmless", () => {
    const stored = { providerSubscriptionId: "sub_1", providerModifiedAt: new Date("2026-11-06T00:00:00Z"), status: "canceled" };
    expect(decide(record({ modified_at: "2026-11-05T00:00:00Z" }), stored)).toEqual({ action: "ignore", reason: "stale" });
    expect(decide(record({ modified_at: "2026-11-06T00:00:00Z", status: "canceled" }), stored).action).toBe("apply");
  });

  it("out of order: created arrives after active, and the newer state wins", () => {
    const active = decide(record({ status: "active", modified_at: "2026-11-05T00:00:10Z" }));
    expect(active.action).toBe("apply");
    const stored = { providerSubscriptionId: "sub_1", providerModifiedAt: new Date("2026-11-05T00:00:10Z"), status: "active" };
    expect(decide(record({ status: "incomplete", modified_at: "2026-11-05T00:00:00Z" }), stored, "subscription.created")).toEqual({ action: "ignore", reason: "stale" });
  });

  it("revoked ends access now, whatever the period says", () => {
    const d = decide(record({ status: "canceled", ended_at: null }), null, "subscription.revoked");
    expect(d).toMatchObject({ action: "apply", data: { status: "revoked" } });
    if (d.action === "apply") expect(d.data.endedAt).toEqual(NOW);
  });

  it("an old subscription's late event never replaces one paying for Pro now; a new purchase replaces an ended one", () => {
    const live = { providerSubscriptionId: "sub_new", providerModifiedAt: new Date("2026-11-01T00:00:00Z"), status: "active" };
    expect(decide(record({ id: "sub_old", status: "canceled", modified_at: "2026-11-09T00:00:00Z" }), live)).toEqual({ action: "ignore", reason: "superseded" });
    const ended = { providerSubscriptionId: "sub_old", providerModifiedAt: new Date("2026-11-09T00:00:00Z"), status: "revoked" };
    expect(decide(record({ id: "sub_new", status: "active", modified_at: "2026-11-02T00:00:00Z" }), ended)).toMatchObject({ action: "apply", data: { providerSubscriptionId: "sub_new" } });
  });
});

// ── Configuration ──
describe("which plans can be bought", () => {
  const env = { POLAR_SERVER: "sandbox", POLAR_ACCESS_TOKEN: "tok", POLAR_WEBHOOK_SECRET: "whsec_x", POLAR_PRODUCT_PRO_MONTHLY: "prod_monthly", POLAR_PRODUCT_PRO_ANNUAL: "prod_annual", NEXT_PUBLIC_APP_URL: "https://www.thekio.in/" };

  it("reads the provider's settings, and says what is missing", () => {
    const cfg = providerConfig(env);
    expect(cfg.ok && cfg.config).toMatchObject({ server: "sandbox", appUrl: "https://www.thekio.in", products: { pro_monthly: "prod_monthly", pro_annual: "prod_annual" } });
    const bad = providerConfig({ POLAR_SERVER: "live" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.missing).toEqual(expect.arrayContaining(["POLAR_SERVER (sandbox or production)", "POLAR_ACCESS_TOKEN", "POLAR_WEBHOOK_SECRET", "POLAR_PRODUCT_PRO_MONTHLY"]));
  });

  it("only Kio's paid plans with a product; the yearly plan only when switched on", () => {
    const cfg = { products: { pro_monthly: "prod_monthly", pro_annual: "prod_annual" } };
    expect(purchasable("pro_monthly", cfg, env)).toBe(true);
    expect(purchasable("pro_annual", cfg, env)).toBe(false);
    expect(purchasable("pro_annual", cfg, { ...env, BILLING_ANNUAL_ENABLED: "true" })).toBe(true);
    expect(purchasable("free", cfg, env)).toBe(false);
    expect(purchasable("pro_monthly", { products: {} }, env)).toBe(false);
  });

  it("maps a provider product back to a plan, and nothing else", () => {
    const cfg = { products: { pro_monthly: "prod_monthly" } };
    expect(planForProduct("prod_monthly", cfg)).toBe("pro_monthly");
    expect(planForProduct("prod_someone_else", cfg)).toBeNull();
  });

  it("trial and grace days are bounded", () => {
    expect(trialDays({})).toBe(7);
    expect(trialDays({ BILLING_TRIAL_DAYS: "14" })).toBe(14);
    expect(trialDays({ BILLING_TRIAL_DAYS: "999" })).toBe(7);
    expect(graceDays({})).toBe(3);
    expect(graceDays({ BILLING_GRACE_DAYS: "-1" })).toBe(3);
  });
});

describe("allowances and prices", () => {
  it("Free keeps today's 150 a day; Pro gets four times as much; both configurable", () => {
    expect(allowanceFor("free", {})).toEqual({ dailyRequests: 150, telegramFactor: 1 });
    expect(allowanceFor("pro", {})).toEqual({ dailyRequests: 600, telegramFactor: 4 });
    expect(allowanceFor("free", { BILLING_FREE_DAILY_AI: "40" }).dailyRequests).toBe(40);
    expect(allowanceFor("pro", { BILLING_FREE_DAILY_AI: "40", BILLING_PRO_DAILY_AI: "400" })).toEqual({ dailyRequests: 400, telegramFactor: 10 });
    expect(allowanceFor("free", { BILLING_FREE_DAILY_AI: "nonsense" }).dailyRequests).toBe(150);
  });

  it("prices read as rupees", () => {
    expect(formatPrice(PLANS.free)).toBe("₹0");
    expect(formatPrice(PLANS.pro_monthly)).toBe("₹199");
    expect(formatPrice(PLANS.pro_annual)).toBe("₹1,499");
    expect(intervalLabel(PLANS.pro_monthly)).toBe("/month");
    expect(PLANS.pro_annual.enabled).toBe(false);
  });
});
