// ─── Operator controls: modes and emergency switches ─────────────────────────
// All read from the environment at call time, so a change on Render applies
// on the next request after the service restarts with it (no code change).
//
//   RATE_LIMITS_MODE     off | shadow (default) | enforce
//       off      only `legacy` limits run (they were enforced before Phase 5)
//       shadow   every limit is counted; new ones only log what they would refuse
//       enforce  every limit refuses
//   RATE_LIMITS_ENFORCE  while in shadow, enforce just these categories or
//                        policy ids: "ai,agent.tasks,mcp" (staged rollout)
//   KIVO_DISABLE         answer these categories or policy ids with 503 at
//                        once: "agent,import" (an incident switch). Never the
//                        sign-in routes or webhooks: see `disabled`.
//   KIVO_READ_ONLY       true: every change is refused with 503 except
//                        sign-in, OAuth and the webhooks; reads still work,
//                        and MCP answers read tools and refuses write tools
//
// A switch refuses before any work or reservation is made, so it never leaves
// a usage reservation or billing record half done.

import type { Category, Policy } from "./policies";

export type Mode = "off" | "shadow" | "enforce";

export function rateLimitMode(env: NodeJS.ProcessEnv = process.env): Mode {
  const v = (env.RATE_LIMITS_MODE ?? "").trim().toLowerCase();
  return v === "off" || v === "enforce" ? v : "shadow";
}

const list = (v: string | undefined) => new Set((v ?? "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean));

/** Whether a new (non-legacy) limit of this policy refuses, or only observes. */
export function enforces(p: Policy, env: NodeJS.ProcessEnv = process.env): boolean {
  const mode = rateLimitMode(env);
  if (mode === "enforce") return true;
  if (mode === "off") return false;
  const staged = list(env.RATE_LIMITS_ENFORCE);
  return staged.has(p.category) || staged.has(p.id.toLowerCase());
}

// Categories an incident switch never closes: signing in, the payment
// provider's and Telegram's webhooks (refusing those loses events, and the
// AI work behind Telegram has its own switch, `ai`), and health checks.
const NEVER_DISABLED: ReadonlySet<Category> = new Set(["exempt", "auth", "webhook"]);

export function disabled(p: Pick<Policy, "id" | "category">, env: NodeJS.ProcessEnv = process.env): boolean {
  if (NEVER_DISABLED.has(p.category)) return false;
  const off = list(env.KIVO_DISABLE);
  return off.has(p.category) || off.has(p.id.toLowerCase());
}

export function readOnly(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.KIVO_READ_ONLY ?? "").trim().toLowerCase() === "true";
}

/** In read-only mode, whether a request of this category and method is refused. */
export function refusedByReadOnly(category: Category, method: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!readOnly(env)) return false;
  // OAuth keeps assistants signed in; MCP is one POST route for reads and
  // writes alike, so its writes are refused per tool in the MCP route instead.
  if (NEVER_DISABLED.has(category) || category === "oauth" || category === "mcp") return false;
  const m = method.toUpperCase();
  return m !== "GET" && m !== "HEAD" && m !== "OPTIONS";
}
