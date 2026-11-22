// ─── Usage accounting: the rules, pure ────────────────────────────────────────
// Four independent allowances, each with its own balance: Nova credits,
// browser-agent tasks, MCP calls (a lifetime allowance, then a monthly
// read-only one) and storage bytes. Nothing here touches the database; the
// ledger (ledger.ts) applies these rules. Held by __tests__/accounting-rules.test.ts.
//
// Phase 1 is shadow accounting: the numbers below are the approved initial
// targets (master brief, 2026-11-22), recorded beside today's daily meter
// (billing/usage.ts), which alone still decides what a learner may do. No
// price, plan or production limit is read from here yet.

export type Product =
  | "nova_credits" | "browser_tasks" | "mcp_calls" | "mcp_read_only" | "storage_bytes"
  | "kivo_funded" | "system";

export const PRODUCTS: readonly Product[] = ["nova_credits", "browser_tasks", "mcp_calls", "mcp_read_only", "storage_bytes", "kivo_funded", "system"];

export type Tier = "free" | "plus" | "pro";

// ── Allowances ──
// null: no fixed quota (fair-use and abuse limits still apply).
export interface TierAllowance {
  novaCredits:     number;
  browserTasks:    number;
  mcpLifetime:     number | null;
  mcpReadOnly:     number | null;
  storageBytes:    number;
}

const MB = 1_000_000, GB = 1_000_000_000;

// Versioned: a ledger entry names the table that priced it, so a later change
// never rewrites what was recorded under an earlier one.
export const ALLOWANCE_VERSION = "allowances@2026-11-22-approved-targets";
export const ALLOWANCES: Record<Tier, TierAllowance> = {
  free: { novaCredits: 150,   browserTasks: 10,  mcpLifetime: 2_000, mcpReadOnly: 100,  storageBytes: 500 * MB },
  plus: { novaCredits: 1_000, browserTasks: 40,  mcpLifetime: null,  mcpReadOnly: null, storageBytes: 2 * GB },
  pro:  { novaCredits: 3_500, browserTasks: 200, mcpLifetime: null,  mcpReadOnly: null, storageBytes: 15 * GB },
};

export function limitFor(tier: Tier, product: Product): number | null {
  const a = ALLOWANCES[tier];
  switch (product) {
    case "nova_credits":  return a.novaCredits;
    case "browser_tasks": return a.browserTasks;
    case "mcp_calls":     return a.mcpLifetime;
    case "mcp_read_only": return a.mcpReadOnly;
    case "storage_bytes": return a.storageBytes;
    default:              return null;
  }
}

// ── The shadow tier ──
// From the account's current access (billing/access.ts) without changing it:
// Kivo's own trial grants Plus allowances (master brief §8); a paid or grace
// subscription is Pro (the only paid plan sold today); anything else Free.
export function shadowTier(access: { plan: "free" | "pro"; source: "subscription" | "grace" | "trial" | "free" }): Tier {
  if (access.source === "trial") return "plus";
  if (access.plan === "pro") return "pro";
  return "free";
}

// ── Periods ──
// Monthly allowances run by calendar month in UTC until subscriptions anchor
// them (Phase 6: a paid period starts on the subscription's monthly
// anniversary, so an annual plan is granted month by month). `anchorDay`
// (1–28) is that anniversary; omitted, the 1st.
export interface Period { key: string; start: Date | null; end: Date | null }

export const LIFETIME: Period = { key: "lifetime", start: null, end: null };
export const CURRENT: Period = { key: "current", start: null, end: null };

export function monthlyPeriod(now: Date, anchorDay = 1): Period {
  const day = Math.min(28, Math.max(1, Math.floor(anchorDay)));
  let y = now.getUTCFullYear(), m = now.getUTCMonth();
  if (now.getUTCDate() < day) { m -= 1; if (m < 0) { m = 11; y -= 1; } }
  const start = new Date(Date.UTC(y, m, day));
  const end = new Date(Date.UTC(m === 11 ? y + 1 : y, (m + 1) % 12, day));
  const ym = `${y}-${String(m + 1).padStart(2, "0")}`;
  return { key: day === 1 ? ym : `${ym}-${String(day).padStart(2, "0")}`, start, end };
}

export function periodFor(product: Product, now: Date, anchorDay = 1): Period {
  if (product === "mcp_calls") return LIFETIME;
  if (product === "storage_bytes") return CURRENT;
  return monthlyPeriod(now, anchorDay);
}

// ── Nova credits from measured cost ──
// One credit = NOVA_CREDIT_MICROS of measured provider cost (micro-USD;
// default 1,000 = $0.001, the audited cost of a standard request). Rounded
// up, at least one for work that reached the model and succeeded. Versioned
// by its value, so a change of rate or of provider prices (pricing.ts)
// leaves earlier entries as they were.
export const DEFAULT_CREDIT_MICROS = 1_000;

export function creditMicros(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.NOVA_CREDIT_MICROS);
  return Number.isInteger(n) && n >= 100 && n <= 100_000 ? n : DEFAULT_CREDIT_MICROS;
}

export function creditRateVersion(micros = creditMicros()): string {
  return `credits@v1:${micros}micros:ceil:min1`;
}

export function creditsFor(costMicros: number, micros = creditMicros()): number {
  if (!Number.isFinite(costMicros) || costMicros <= 0) return 1;
  return Math.max(1, Math.ceil(costMicros / micros));
}

// What a reservation holds before the work runs: what this kind of request
// usually costs (production, 2026-11-03..22, P95), so a later enforcement
// keeps room for it. Settlement charges the measured cost, not this.
const RESERVE_ESTIMATE: Record<string, number> = {
  build_with_nova: 8, notes_tutor: 3, notes_editor: 3, notes_proposal: 2, notes_import: 6, paper_import: 6,
  create_with_nova: 4, subject_studio: 3,
};
export function reserveEstimate(feature: string): number {
  return RESERVE_ESTIMATE[feature] ?? 1;
}

// ── Who pays for a model call ──
// Every usage feature (services/llm-usage.ts USAGE_FEATURES) has exactly one
// class; a feature missing here is "nova" (the learner pays), never free.
//   nova      learner-initiated: counts on Nova credits
//   browser   the browser agent's steps: cost recorded on the task, not credits
//   kivo      Kivo-funded system operations (no allowance; capped elsewhere)
//   system    no learner behind it (Rex, unattributed)
export type FeatureClass = "nova" | "browser" | "kivo" | "system";

const FEATURE_CLASS: Record<string, FeatureClass> = {
  extension_agent: "browser",
  scheduled_nova_message: "kivo",   // proactive Telegram messages Nova decides to send
  capture_placement: "kivo",        // auto-filing a capture (small model)
  extension_intent: "kivo",         // routing a side-panel message to Ask or the agent
  saved_page_processing: "kivo",    // background reading of a saved page
  saved_page_retry: "kivo",
  rex: "system",
  other: "system",
};
export function featureClass(feature: string): FeatureClass {
  return FEATURE_CLASS[feature] ?? "nova";
}

// ── MCP in shadow ──
// Free: the first `mcpLifetime` calls are full access; after them, reads only,
// `mcpReadOnly` a month. Plus/Pro: no fixed quota. Every call counts on the
// lifetime balance whatever the tier (the lifetime counter never resets).
export type McpKind = "read" | "write";
export type McpRefusal = "mcp_lifetime_exhausted" | "mcp_read_only_allowance_exhausted";

export function mcpDecision(input: { tier: Tier; kind: McpKind; lifetimeBefore: number; readOnlyBefore: number }):
  { countReadOnly: boolean; refusal: McpRefusal | null } {
  const a = ALLOWANCES[input.tier];
  if (a.mcpLifetime === null || input.lifetimeBefore < a.mcpLifetime) return { countReadOnly: false, refusal: null };
  if (input.kind === "write") return { countReadOnly: false, refusal: "mcp_lifetime_exhausted" };
  const ro = a.mcpReadOnly ?? 0;
  return { countReadOnly: true, refusal: input.readOnlyBefore < ro ? null : "mcp_read_only_allowance_exhausted" };
}

// ── Reservations ──
// How long a reservation may stay open before reconciliation settles it.
export const RESERVATION_TTL_MS: Partial<Record<Product, number>> = {
  nova_credits: 15 * 60_000,       // a model job ends well within this (Build with Nova included)
  browser_tasks: 50 * 60_000,      // the agent ticket lives 45 minutes (agent-ticket.ts)
};
export const DEFAULT_RESERVATION_TTL_MS = 15 * 60_000;
