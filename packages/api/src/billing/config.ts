// ─── Billing configuration ────────────────────────────────────────────────────
// Everything billing reads from the environment, read here and nowhere else.
// Secrets never leave the server: nothing in this file is imported by the web
// app, the extension or Telegram replies.
//
//   POLAR_ACCESS_TOKEN          organization access token (server only)
//   POLAR_WEBHOOK_SECRET        the webhook endpoint's signing secret
//   POLAR_SERVER                "sandbox" | "production"; anything else is refused
//   POLAR_PRODUCT_PRO_MONTHLY   the provider's product id for each plan
//   POLAR_PRODUCT_PRO_ANNUAL
//   BILLING_ANNUAL_ENABLED      "true" to sell the yearly plan (off by default)
//   BILLING_TRIAL_DAYS          days of Kio's free trial (default: the plan's)
//   BILLING_GRACE_DAYS          days a past-due subscription keeps Pro (default 3)
//   NEXT_PUBLIC_APP_URL         where checkout and the portal send people back
//
// Sandbox and production use different tokens, secrets and product ids; the
// server setting says which, so a sandbox product id is never sent to
// production or the other way round.

import { PLANS, PAID_PLANS, type PlanKey } from "./plans";

export type PolarServer = "sandbox" | "production";

type Env = Record<string, string | undefined>;

export interface ProviderConfig {
  server:        PolarServer;
  accessToken:   string;
  webhookSecret: string;
  products:      Partial<Record<PlanKey, string>>;
  appUrl:        string;
}

// The provider's settings, or why there are none. Checkout and the portal are
// unavailable without them; the rest of billing (Free, trials) still works.
export function providerConfig(env: Env = process.env): { ok: true; config: ProviderConfig } | { ok: false; missing: string[] } {
  const missing: string[] = [];
  const server = env.POLAR_SERVER?.trim();
  if (server !== "sandbox" && server !== "production") missing.push("POLAR_SERVER (sandbox or production)");
  const accessToken = env.POLAR_ACCESS_TOKEN?.trim() ?? "";
  if (!accessToken) missing.push("POLAR_ACCESS_TOKEN");
  const webhookSecret = env.POLAR_WEBHOOK_SECRET?.trim() ?? "";
  if (!webhookSecret) missing.push("POLAR_WEBHOOK_SECRET");
  const products: Partial<Record<PlanKey, string>> = {};
  const monthly = env.POLAR_PRODUCT_PRO_MONTHLY?.trim();
  const annual  = env.POLAR_PRODUCT_PRO_ANNUAL?.trim();
  if (monthly) products.pro_monthly = monthly; else missing.push("POLAR_PRODUCT_PRO_MONTHLY");
  if (annual) products.pro_annual = annual;
  if (missing.length > 0) return { ok: false, missing };
  return { ok: true, config: { server: server as PolarServer, accessToken, webhookSecret, products, appUrl: appUrl(env) } };
}

export function appUrl(env: Env = process.env): string {
  return (env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").trim().replace(/\/+$/, "");
}

// Whether a plan can be bought now: enabled in plans.ts (the yearly plan also
// needs BILLING_ANNUAL_ENABLED) and given a product id.
export function purchasable(plan: PlanKey, config: Pick<ProviderConfig, "products">, env: Env = process.env): boolean {
  if (!PAID_PLANS.includes(plan)) return false;
  const enabled = plan === "pro_annual" ? env.BILLING_ANNUAL_ENABLED === "true" : PLANS[plan].enabled;
  return enabled && Boolean(config.products[plan]);
}

// The plan a provider product is. null: not one of Kio's, so it grants nothing.
export function planForProduct(productId: string, config: Pick<ProviderConfig, "products">): PlanKey | null {
  for (const [plan, id] of Object.entries(config.products)) if (id === productId) return plan as PlanKey;
  return null;
}

export function trialDays(env: Env = process.env): number {
  const n = Number(env.BILLING_TRIAL_DAYS);
  return Number.isInteger(n) && n >= 0 && n <= 30 ? n : PLANS.pro_monthly.trialDays;
}

export function graceDays(env: Env = process.env): number {
  const n = Number(env.BILLING_GRACE_DAYS);
  return Number.isInteger(n) && n >= 0 && n <= 14 ? n : 3;
}
