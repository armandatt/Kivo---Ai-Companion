// ─── Usage accounting: the rules, pure ────────────────────────────────────────
// Four independent allowances, each with its own balance: Nova credits,
// browser-agent tasks, MCP calls (a lifetime allowance, then a monthly
// read-only one) and storage bytes. Nothing here touches the database; the
// ledger (ledger.ts) applies these rules. Held by __tests__/accounting-rules.test.ts.
//
// The launch configuration approved by the owner on 2026-11-22. Enforced only
// when USAGE_ACCOUNTING=enforce (targets.ts accountingMode); in shadow it is
// recorded, off it is not read. Every number can be changed without a code
// change through USAGE_ALLOWANCES / USAGE_FAIR_USE (JSON, see below), which
// also changes the version stamped on each ledger entry.

export type Product =
  | "nova_credits" | "browser_tasks" | "mcp_calls" | "mcp_read_only" | "storage_bytes"
  | "kivo_funded" | "system";

export const PRODUCTS: readonly Product[] = ["nova_credits", "browser_tasks", "mcp_calls", "mcp_read_only", "storage_bytes", "kivo_funded", "system"];

import type { Tier } from "../plans";
export type { Tier };

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

export const DEFAULT_ALLOWANCES: Record<Tier, TierAllowance> = {
  free: { novaCredits: 150,   browserTasks: 10,  mcpLifetime: 2_000, mcpReadOnly: 100,  storageBytes: 500 * MB },
  plus: { novaCredits: 1_000, browserTasks: 40,  mcpLifetime: null,  mcpReadOnly: null, storageBytes: 2 * GB },
  pro:  { novaCredits: 3_500, browserTasks: 120, mcpLifetime: null,  mcpReadOnly: null, storageBytes: 15 * GB },
};
const BASE_VERSION = "allowances@2026-11-22-launch";

type Env = Record<string, string | undefined>;
const nonNeg = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : undefined;

// USAGE_ALLOWANCES: a JSON object of per-tier overrides, e.g.
//   {"free":{"novaCredits":200},"pro":{"browserTasks":200}}
// A value that is not a non-negative number (or null for "no fixed quota"
// on the MCP fields) is ignored. An unreadable value is ignored as a whole.
export function allowances(env: Env = process.env): { table: Record<Tier, TierAllowance>; version: string } {
  const raw = env.USAGE_ALLOWANCES?.trim();
  if (!raw) return { table: DEFAULT_ALLOWANCES, version: BASE_VERSION };
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return { table: DEFAULT_ALLOWANCES, version: BASE_VERSION }; }
  const table = structuredClone(DEFAULT_ALLOWANCES);
  for (const tier of ["free", "plus", "pro"] as const) {
    const o = (parsed as Record<string, Record<string, unknown>> | null)?.[tier];
    if (!o || typeof o !== "object") continue;
    for (const k of ["novaCredits", "browserTasks", "storageBytes"] as const) { const v = nonNeg(o[k]); if (v !== undefined) table[tier][k] = v; }
    for (const k of ["mcpLifetime", "mcpReadOnly"] as const) {
      if (o[k] === null) table[tier][k] = null; else { const v = nonNeg(o[k]); if (v !== undefined) table[tier][k] = v; }
    }
  }
  const sig = JSON.stringify(table);
  let h = 0; for (let i = 0; i < sig.length; i++) h = (h * 31 + sig.charCodeAt(i)) | 0;
  return { table, version: `${BASE_VERSION}+env:${(h >>> 0).toString(16)}` };
}

// The table in effect (read at call time, so a change of env needs no deploy
// of code, only a restart where the host requires one).
export const ALLOWANCES: Record<Tier, TierAllowance> = new Proxy({} as Record<Tier, TierAllowance>, {
  get: (_t, tier: string) => allowances().table[tier as Tier],
});
export const allowanceVersion = () => allowances().version;
export const ALLOWANCE_VERSION = BASE_VERSION;

// ── Fair use and abuse limits ──
// Persistent (limiter.ts): they hold across restarts. Overridable with
// USAGE_FAIR_USE (JSON, same keys).
export interface FairUse {
  mcpCallsPerMinute:     number;   // per connection (grant)
  mcpCallsPerDay:        number;   // per account, every tier
  mcpItemsPerDay:        number;   // batch items per account
  browserStartsPer10Min: number;   // task starts per account
  browserOpenTasks:      number;   // tasks started and not yet finished, per account
  novaJobsPerMinute:     number;   // Build with Nova turns per account
}
export const DEFAULT_FAIR_USE: FairUse = {
  mcpCallsPerMinute: 120, mcpCallsPerDay: 5_000, mcpItemsPerDay: 5_000,
  browserStartsPer10Min: 8, browserOpenTasks: 3, novaJobsPerMinute: 8,
};
export function fairUse(env: Env = process.env): FairUse {
  const raw = env.USAGE_FAIR_USE?.trim();
  if (!raw) return DEFAULT_FAIR_USE;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const out = { ...DEFAULT_FAIR_USE };
    for (const k of Object.keys(out) as Array<keyof FairUse>) { const v = nonNeg(o[k]); if (v !== undefined && v > 0) out[k] = v; }
    return out;
  } catch { return DEFAULT_FAIR_USE; }
}

// ── Browser task cost target ──
// $0.03 a task (approved 2026-11-22): a target to measure against, never a
// reason to stop a running task. A task whose measured cost passes it is
// recorded and reported (report.ts browser.overTarget). BROWSER_TASK_COST_TARGET_MICROS overrides.
export function browserTaskCostTargetMicros(env: Env = process.env): number {
  const n = Number(env.BROWSER_TASK_COST_TARGET_MICROS);
  return Number.isInteger(n) && n > 0 ? n : 30_000;
}

export function limitFor(tier: Tier, product: Product): number | null {
  const a = allowances().table[tier];
  switch (product) {
    case "nova_credits":  return a.novaCredits;
    case "browser_tasks": return a.browserTasks;
    case "mcp_calls":     return a.mcpLifetime;
    case "mcp_read_only": return a.mcpReadOnly;
    case "storage_bytes": return a.storageBytes;
    default:              return null;
  }
}

// ── The tier ──
// The entitlement's tier (billing/access.ts: the plan behind a subscription,
// only; there is no trial of a paid tier).
export function tierFor(access: { tier: Tier }): Tier {
  return access.tier;
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
  prepared_plan: "kivo",            // the day plan Nova prepares at check-in (PR #113 B.3)
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
  const a = allowances().table[input.tier];
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
