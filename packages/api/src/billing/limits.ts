// ─── How much AI each plan gets ───────────────────────────────────────────────
// Daily allowances, counted per account across every surface (web, Telegram,
// the extension) in AiUsageDay. Configurable; the defaults are chosen so that
// introducing billing takes nothing away from anyone: Free keeps what every
// learner has today (Telegram's 150 readings a day, which the web now shares),
// and Pro gets four times as much.
//
//   BILLING_FREE_DAILY_AI   model requests a day on Free   (default 150)
//   BILLING_PRO_DAILY_AI    model requests a day on Pro    (default 600)
//
// Telegram keeps its own per-chat caps inside these (telegram/channel-store),
// raised for Pro by the same factor.

import type { AccessPlan } from "./access";

type Env = Record<string, string | undefined>;

export interface Allowance {
  dailyRequests: number;
  // Telegram's per-chat caps (telegram/channel-store.ts) are multiplied by this.
  telegramFactor: number;
}

const positive = (raw: string | undefined, fallback: number) => {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

export function allowanceFor(plan: AccessPlan, env: Env = process.env): Allowance {
  const free = positive(env.BILLING_FREE_DAILY_AI, 150);
  const pro  = positive(env.BILLING_PRO_DAILY_AI, 600);
  return plan === "pro"
    ? { dailyRequests: Math.max(pro, free), telegramFactor: Math.max(1, Math.round(pro / free)) }
    : { dailyRequests: free, telegramFactor: 1 };
}
