// ─── Rate-limit policies: the one table ──────────────────────────────────────
// Every protected request is checked against a named policy from this file,
// never against a number written in a route. A policy says, per dimension,
// how many requests a window allows, how many operations may run at once,
// whether a limiter outage refuses the request, and why the numbers are what
// they are. docs/RATE_LIMITS.md has the same table with the evidence.
//
// Rate limits are not allowances. A monthly allowance (billing/accounting,
// rules.ts) is how much a plan may use in a period; a rate limit is how fast,
// and how much at once. Nothing here reads or changes an allowance, and a
// request a rate limit admits still goes through its allowance.
//
// Dimensions:
//   user    the Kivo account (`user:<id>`, else `learner:<chat>`), the same
//           key on the web, the extension, Telegram and every MCP client
//   ip      the client address, only when it is known to be true (identity.ts)
//   client  one credential: an OAuth client, an MCP grant, an extension
//   task    one browser-agent task
//   global  everyone together: the emergency ceiling for a kind of work
//
// `legacy`: a limit that was already enforced before Phase 5 (most of them
// per process, in memory). It stays enforced whatever RATE_LIMITS_MODE says,
// now in Postgres. Everything else starts in shadow and is turned on by
// RATE_LIMITS_MODE / RATE_LIMITS_ENFORCE (controls.ts).

export type Category =
  | "exempt" | "auth" | "oauth" | "read" | "write" | "ai" | "agent" | "mcp"
  | "upload" | "import" | "export" | "billing" | "webhook";

export type Dimension = "user" | "ip" | "client" | "task" | "global";
export const DIMENSIONS: readonly Dimension[] = ["user", "ip", "client", "task", "global"];

export interface Window { limit: number; windowMs: number; legacy?: boolean }

export interface Concurrency {
  user?: number;      // at once per account (scaled by plan when planScaled)
  global?: number;    // at once for everyone
  ttlMs: number;      // a slot not given back by then is free again (crash recovery)
}

export interface Policy {
  id: string;
  category: Category;
  user?: Window[];
  ip?: Window[];
  client?: Window[];
  task?: Window[];
  global?: Window[];
  concurrency?: Concurrency;
  /** User windows and user concurrency grow with the plan (TIER_FACTOR). */
  planScaled?: boolean;
  /** When the limiter cannot answer: "open" admits (logged), "closed" refuses with 503. */
  failure: "open" | "closed";
  /** Every window and the concurrency of this policy predate Phase 5 (see above). */
  legacy?: boolean;
  why: string;
}

export type Tier = "free" | "plus" | "pro";
export const TIER_FACTOR: Readonly<Record<Tier, number>> = { free: 1, plus: 1.5, pro: 2 };

const SECOND = 1_000, MINUTE = 60 * SECOND, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
const per = (limit: number, windowMs: number, legacy?: boolean): Window => (legacy ? { limit, windowMs, legacy } : { limit, windowMs });

// The browser agent's own bounds (nova/product/agent-ticket.ts): a ticket
// lives AGENT_TASK_TTL_MS and allows AGENT_TASK_STEPS steps. Repeated here as
// numbers so this file stays free of imports; held by policies.test.ts.
export const AGENT_TASK_TTL_MS = 45 * MINUTE;
export const AGENT_TASK_STEPS = 40;

// ── Production evidence (AiUsageEvent, 30 days to 24 Nov 2026, 33 accounts) ──
// AI requests per account: peak 14 a minute and 91 an hour (browser-agent
// steps); every other feature peaked at 1–6 a minute. All AI calls together:
// peak 17 a minute. Limits below sit at 2× or more of the busiest account.

const LIST: Policy[] = [
  // ── Baseline: every API request, applied in apps/api/proxy.ts ──
  { id: "base.read", category: "read", failure: "open",
    user: [per(600, MINUTE)], ip: [per(300, MINUTE)], global: [per(30_000, MINUTE)],
    why: "Ten reads a second per account covers a dashboard opening several panels in several tabs; it only stops scripts." },
  { id: "base.write", category: "write", failure: "open",
    user: [per(240, MINUTE)], ip: [per(60, MINUTE)], global: [per(12_000, MINUTE)],
    why: "Autosave, drag and drop and ticks are frequent but small; four a second per account is far above a person." },
  { id: "base.ai", category: "ai", failure: "open",
    user: [per(60, MINUTE)], global: [per(1_200, MINUTE)],
    why: "A first line in front of the AI routes; the cost limits are the ai.* policies in the routes." },
  { id: "base.agent", category: "agent", failure: "open",
    user: [per(90, MINUTE)], global: [per(1_200, MINUTE)],
    why: "Agent steps peak at 14 a minute for one account; the step and task limits are agent.* in the routes." },
  { id: "base.mcp", category: "mcp", failure: "open",
    user: [per(300, MINUTE)], ip: [per(600, MINUTE)], global: [per(3_000, MINUTE)],
    why: "Per credential here; the account-wide MCP limit is mcp.account in the MCP route." },
  { id: "base.upload", category: "upload", failure: "open",
    user: [per(60, MINUTE)], global: [per(600, MINUTE)],
    why: "Images and files: one at a time from a person, bursts from a paste of several." },
  { id: "base.import", category: "import", failure: "open",
    user: [per(30, MINUTE)], global: [per(300, MINUTE)],
    why: "A .kivo preview and import are two requests; thirty a minute is far above a person." },
  { id: "base.export", category: "export", failure: "open",
    user: [per(20, MINUTE)], global: [per(300, MINUTE)],
    why: "An export reads a whole map; twenty a minute is far above a person." },
  { id: "base.auth", category: "auth", failure: "closed",
    ip: [per(60, 10 * MINUTE)], global: [per(1_200, MINUTE)],
    why: "Sign-in, sign-up and resets from one address. The per-address limits that protect an account stay in auth/throttle.ts." },
  { id: "base.oauth", category: "oauth", failure: "closed",
    ip: [per(120, MINUTE)], global: [per(1_200, MINUTE)],
    why: "OAuth discovery, registration and tokens for Kivo Connect clients." },
  { id: "base.billing", category: "billing", failure: "open",
    user: [per(60, MINUTE)], global: [per(1_200, MINUTE)],
    why: "Plan pages and checkout creation; never the provider's webhook, which is exempt." },
  { id: "base.webhook", category: "webhook", failure: "open",
    global: [per(6_000, MINUTE)],
    why: "Telegram's servers, one address for every chat: only a global ceiling. Each chat's own limits are in the Telegram channel store." },
  { id: "base.anonymous", category: "read", failure: "open",
    ip: [per(120, MINUTE)], global: [per(6_000, MINUTE)],
    why: "Requests with no session or credential that are not sign-in: discovery documents, public pages' data." },

  // ── AI: one account-wide budget across every AI feature and surface ──
  { id: "ai.account", category: "ai", failure: "closed", planScaled: true,
    user: [per(30, MINUTE), per(300, HOUR)], global: [per(600, MINUTE)],
    concurrency: { user: 3, global: 40, ttlMs: 3 * MINUTE },
    why: "Busiest real account: 14 AI requests a minute, 91 an hour. Three at once covers a tutor answer, a copilot reply and a capture filing together." },

  // ── AI features (each was a per-process limit; now per account, in Postgres) ──
  { id: "notes.tutor",       category: "ai", failure: "closed", legacy: true, user: [per(10, MINUTE)], why: "Each request is one model call (TUTOR_REQUESTS_PER_MINUTE)." },
  { id: "notes.edit",        category: "ai", failure: "closed", legacy: true, user: [per(10, MINUTE)], why: "Each request is one model call (EDIT_REQUESTS_PER_MINUTE)." },
  { id: "notes.assist",      category: "ai", failure: "closed", legacy: true, user: [per(6, MINUTE)],  why: "Each request is one model call (NOTE_ASSISTS_PER_MINUTE)." },
  { id: "notes.propose",     category: "ai", failure: "closed", legacy: true, user: [per(6, MINUTE)],  why: "Draft with Nova: one model call with up to three files." },
  { id: "notes.import",      category: "ai", failure: "closed", legacy: true, user: [per(4, MINUTE)],  why: "A PDF or image transcribed by the model." },
  { id: "papers.import",     category: "ai", failure: "closed", legacy: true, user: [per(6, MINUTE)],  why: "Fetches from the paper's source and may transcribe a PDF." },
  { id: "papers.preview",    category: "ai", failure: "closed", legacy: true, user: [per(12, MINUTE)], why: "Each preview asks the source's API." },
  { id: "notes.source-frame", category: "read", failure: "closed", legacy: true, user: [per(20, MINUTE)], why: "Each check fetches another site's headers." },
  { id: "subjects.propose",  category: "ai", failure: "closed", legacy: true, user: [per(4, MINUTE)],  why: "A study proposal is one main-tier call." },
  { id: "workspaces.propose", category: "ai", failure: "closed", legacy: true, user: [per(4, MINUTE)], why: "Create with Nova: one main-tier call." },
  { id: "day.copilot",       category: "ai", failure: "closed", legacy: true, user: [per(10, MINUTE)], why: "Today's Nova: one call per message." },
  { id: "builder.turn",      category: "ai", failure: "closed", legacy: true, user: [per(8, MINUTE)],  why: "Build with Nova: one call per turn (fairUse().novaJobsPerMinute)." },
  { id: "extension.ask",     category: "ai", failure: "closed", legacy: true, user: [per(8, MINUTE)],  why: "Ask Nova on a page: one call per question." },
  { id: "extension.intent",  category: "ai", failure: "closed", legacy: true, user: [per(20, MINUTE)], why: "A small-model reading of what the learner typed in the side panel." },
  { id: "captures.place",    category: "ai", failure: "closed", legacy: true, user: [per(40, MINUTE)], why: "Filing a passage: at most one small-model call." },
  { id: "resources.retry",   category: "ai", failure: "closed", legacy: true, user: [per(6, MINUTE)],  why: "Re-reading a saved page with the model." },

  // ── Browser agent ──
  { id: "agent.start", category: "agent", failure: "closed", legacy: true,
    user: [per(20, MINUTE)],
    why: "Starting a task (the route's former per-process limit)." },
  { id: "agent.tasks", category: "agent", failure: "closed", planScaled: true,
    user: [per(8, 10 * MINUTE)], global: [per(300, MINUTE)],
    concurrency: { user: 2, global: 25, ttlMs: 5 * MINUTE },
    why: "Task starts, and tasks running at once. Every step renews the task's slot; a task idle for five minutes (finished, closed, or waiting on the learner) frees it. A running task is never stopped by these: its steps go on." },
  { id: "agent.step", category: "agent", failure: "closed", legacy: true,
    user: [per(30, MINUTE)],
    why: "Each step is one model call; the busiest real task took 14 a minute." },
  { id: "agent.task-steps", category: "agent", failure: "closed", legacy: true,
    task: [per(AGENT_TASK_STEPS, AGENT_TASK_TTL_MS)],
    why: "The steps one ticket allows, counted here when the task's own record cannot say." },
  { id: "agent.workspace", category: "agent", failure: "closed", legacy: true,
    user: [per(30, MINUTE)],
    why: "Workspace reads during a task." },

  // ── Kivo Connect (MCP) ──
  { id: "mcp.grant", category: "mcp", failure: "closed", legacy: true,
    client: [per(120, MINUTE)],
    why: "Per connected assistant (the route's former per-process limit)." },
  { id: "mcp.account", category: "mcp", failure: "closed",
    user: [per(240, MINUTE), per(5_000, DAY)], global: [per(3_000, MINUTE)],
    why: "Every assistant an account connects shares this, so adding clients adds nothing. The day figure is fairUse().mcpCallsPerDay." },
  { id: "mcp.items", category: "mcp", failure: "closed",
    user: [per(600, 10 * MINUTE), per(5_000, DAY)],
    why: "A batch call counts each item it changes; the day figure is fairUse().mcpItemsPerDay." },
  { id: "mcp.write", category: "mcp", failure: "closed",
    concurrency: { user: 4, global: 60, ttlMs: MINUTE },
    why: "Writes running at once for one account, across all its assistants." },

  // ── OAuth and pairing (anonymous: by address) ──
  { id: "oauth.register", category: "oauth", failure: "closed",
    ip: [per(10, HOUR)], global: [per(30, MINUTE, true)],
    why: "Dynamic client registration. Thirty a minute for everyone was the former limit; ten an hour from one address is new." },
  { id: "oauth.token", category: "oauth", failure: "closed",
    client: [per(60, MINUTE, true)], ip: [per(120, MINUTE)],
    why: "Token exchange and refresh, per client (former limit) and per address." },
  { id: "extension.connect", category: "auth", failure: "closed",
    ip: [per(10, MINUTE, true)], global: [per(300, MINUTE)],
    why: "Guessing pairing codes. Was keyed on the first X-Forwarded-For value, which anyone can write; now on a trusted address." },

  // ── Uploads, captures and files ──
  { id: "notes.images", category: "upload", failure: "closed", legacy: true,
    user: [per(20, MINUTE)], why: "Image uploads into notes, each checked and stored." },
  { id: "upload.bytes", category: "upload", failure: "closed", planScaled: true,
    user: [per(200, HOUR)],
    why: "Megabytes uploaded an hour (weighted by size). Storage allowances still decide what may be kept." },
  { id: "notes.highlights", category: "write", failure: "open", legacy: true, user: [per(60, MINUTE)], why: "Highlights on a PDF, saved one by one as they are made." },
  { id: "captures", category: "write", failure: "open", legacy: true, user: [per(30, MINUTE)], why: "Passages into Drafts, from the web or the extension (one count)." },
  { id: "extension.notes", category: "write", failure: "open", legacy: true, user: [per(120, MINUTE)], why: "The extension's note list and appends." },

  // ── .kivo export and import ──
  { id: "portable.export", category: "export", failure: "closed",
    user: [per(10, MINUTE, true)], global: [per(120, MINUTE)],
    concurrency: { user: 1, global: 4, ttlMs: 2 * MINUTE },
    why: "An export reads a whole subject tree (or one note) with its images and files and builds a ZIP or PDF in memory: one at a time per account." },
  { id: "portable.import-preview", category: "import", failure: "closed",
    user: [per(20, MINUTE, true)], global: [per(240, MINUTE)],
    why: "Each preview unpacks and checks an upload (a .kivo map or note of up to 50 MB, or a PDF of up to 10 MB)." },
  { id: "portable.import", category: "import", failure: "closed",
    user: [per(6, MINUTE, true)], global: [per(60, MINUTE)],
    concurrency: { user: 1, global: 3, ttlMs: 15 * MINUTE },
    why: "An import writes through the map's writers in stages. One per account at once; a stopped one resumes under the same job." },

  // ── Ordinary writes with their own former limits ──
  // Marked legacy so it is enforced in every mode: each one is a real
  // Telegram message to the learner's own chat (the Telegram page's test).
  { id: "telegram.test",     category: "write", failure: "closed", legacy: true, user: [per(3, MINUTE), per(10, HOUR)], why: "A test message sent to the learner's Telegram chat." },
  { id: "day.flow",          category: "write", failure: "open", legacy: true, user: [per(60, MINUTE)], why: "Changes to Today's flow: drags, ticks, times." },
  { id: "workspaces.create", category: "write", failure: "open", legacy: true, user: [per(10, MINUTE)], why: "A workspace made from a template writes many rows." },
  { id: "builder.jobs", category: "ai", failure: "closed", planScaled: true,
    concurrency: { user: 2, global: 20, ttlMs: 10 * MINUTE },
    why: "Build with Nova jobs running at once per account. A job runs after its request returns; its slot is given back when it ends, or after ten minutes if the process died." },
  { id: "builder.edit",      category: "write", failure: "open", legacy: true, user: [per(60, MINUTE)], why: "Edits to a Build with Nova plan before it is applied." },
  { id: "builder.approve",   category: "write", failure: "open", legacy: true, user: [per(10, MINUTE)], why: "Applying a plan writes many rows." },

  // ── Billing ──
  { id: "billing.checkout", category: "billing", failure: "open",
    user: [per(10, HOUR)],
    why: "Each checkout is a call to the payment provider. Open on an outage: never stop someone paying." },
  { id: "billing.portal", category: "billing", failure: "open",
    user: [per(30, HOUR)],
    why: "Each portal link is a call to the payment provider." },
];

export const POLICIES: Readonly<Record<string, Policy>> = Object.freeze(Object.fromEntries(LIST.map(p => [p.id, p])));
export type PolicyId = string;

// ── Overrides without a deploy ──
// RATE_LIMITS_OVERRIDES='{"ai.account":{"user":[40,60000]},"base.read":{"global":[50000,60000]}}'
// replaces a dimension's windows ([limit, windowMs] pairs, flattened), or
// '{"agent.tasks":{"concurrency":{"user":3}}}'. Read at call time. Anything
// malformed is ignored and logged once.
let warned = "";
export function effectivePolicy(id: string, env: NodeJS.ProcessEnv = process.env): Policy | null {
  const base = POLICIES[id];
  if (!base) return null;
  const raw = env.RATE_LIMITS_OVERRIDES;
  if (!raw) return base;
  try {
    const all = JSON.parse(raw) as Record<string, Record<string, unknown>>;
    const o = all?.[id];
    if (!o || typeof o !== "object") return base;
    const out: Policy = { ...base };
    for (const d of DIMENSIONS) {
      const v = o[d];
      if (!Array.isArray(v) || v.length === 0 || v.length % 2 !== 0 || !v.every(n => Number.isInteger(n) && (n as number) > 0)) continue;
      const windows: Window[] = [];
      for (let i = 0; i < v.length; i += 2) windows.push({ limit: v[i] as number, windowMs: v[i + 1] as number });
      out[d] = windows;
    }
    const c = o.concurrency as Partial<Concurrency> | undefined;
    if (c && typeof c === "object" && base.concurrency) {
      const pos = (n: unknown) => Number.isInteger(n) && (n as number) > 0 ? n as number : undefined;
      out.concurrency = { ...base.concurrency, user: pos(c.user) ?? base.concurrency.user, global: pos(c.global) ?? base.concurrency.global };
    }
    return out;
  } catch {
    if (warned !== raw) { warned = raw; console.warn(JSON.stringify({ layer: "rate_limit", event: "overrides_unreadable" })); }
    return base;
  }
}

/** The limit a window gives this caller: plan-scaled user windows grow with the tier. */
export function scaledLimit(p: Policy, dim: Dimension, w: Window, tier: Tier | null): number {
  if (dim !== "user" || !p.planScaled || !tier) return w.limit;
  return Math.max(1, Math.floor(w.limit * TIER_FACTOR[tier]));
}

export function scaledConcurrency(p: Policy, which: "user" | "global", tier: Tier | null): number | null {
  const n = p.concurrency?.[which];
  if (!n) return null;
  if (which !== "user" || !p.planScaled || !tier) return n;
  return Math.max(1, Math.floor(n * TIER_FACTOR[tier]));
}
