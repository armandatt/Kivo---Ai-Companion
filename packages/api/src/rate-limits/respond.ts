// ─── How a refusal is said ───────────────────────────────────────────────────
// One shape for every HTTP route, readable by every page and the extension:
//   429 { ok: false, success: false, error: "rate_limited", scope, temporary: true, retryAfterSeconds, message }
//   503 { ok: false, success: false, error: "temporarily_unavailable", reason: "paused" | "limiter_unavailable", … }
// with Retry-After. `error: "rate_limited"` is what every page already reads
// for a 429; a used-up allowance stays `allowance_used` (billing/metered.ts),
// so the two are never confused. No limit, count or window is disclosed.
// MCP gets the same facts as a JSON-RPC error (`mcpError`).

import { POLICIES } from "./policies";
import type { Refusal } from "./engine";

export interface HttpRefusal { status: number; headers: Record<string, string>; body: Record<string, unknown> }

const wait = (s: number) => s < 90 ? `${s} second${s === 1 ? "" : "s"}` : `${Math.ceil(s / 60)} minutes`;

export function scopeOf(r: Refusal): "account" | "address" | "connection" | "task" | "service" {
  if (r.kind !== "rate_limited") return "service";
  switch (r.dimension) {
    case "user": case "concurrency": return "account";
    case "ip": return "address";
    case "client": return "connection";
    case "task": return "task";
    default: return "service";
  }
}

export function refusalMessage(r: Refusal): string {
  if (r.kind === "disabled") return "This part of Kivo is paused for a little while. Nothing you did caused it, and nothing was changed. Please try again later.";
  if (r.kind === "unavailable") return "Kivo couldn't check this request just now. Nothing was changed. Try again in a few seconds.";
  const category = POLICIES[r.policy]?.category;
  if (r.dimension === "concurrency") {
    return category === "agent" ? "Nova is already running as many browser tasks as it can for you. Let one finish, then start this again."
      : category === "import" ? "A map is still being imported. Wait for it to finish, then try again."
      : category === "export" ? "A map is still being exported. Wait for it to finish, then try again."
      : "Nova is still working on your other requests. Wait for one to finish, then try again; what you typed is still here.";
  }
  if (r.dimension === "global") return `Kivo is very busy right now. Try again in ${wait(r.retryAfterSeconds)}; nothing was changed.`;
  if (category === "ai" || category === "agent") return `That's a lot of requests to Nova at once. Try again in ${wait(r.retryAfterSeconds)}; what you typed is still here.`;
  if (category === "auth") return `Too many tries. Wait ${wait(r.retryAfterSeconds)} and try again.`;
  return `That's a lot at once. Try again in ${wait(r.retryAfterSeconds)}.`;
}

export function httpRefusal(r: Refusal): HttpRefusal {
  const headers = { "Retry-After": String(r.retryAfterSeconds), "Cache-Control": "no-store" };
  const message = refusalMessage(r);
  if (r.kind === "rate_limited") {
    return { status: 429, headers, body: { ok: false, success: false, error: "rate_limited", scope: scopeOf(r), temporary: true, retryAfterSeconds: r.retryAfterSeconds, message } };
  }
  return {
    status: 503, headers,
    body: { ok: false, success: false, error: "temporarily_unavailable", reason: r.kind === "disabled" ? "paused" : "limiter_unavailable", temporary: true, retryAfterSeconds: r.retryAfterSeconds, message },
  };
}

/** A JSON-RPC error for MCP: -32000 with the same facts in `data`. */
export function mcpError(r: Refusal, id: string | number | null = null) {
  const h = httpRefusal(r);
  return {
    status: h.status, headers: h.headers,
    body: { jsonrpc: "2.0", id, error: { code: -32000, message: h.body.message as string, data: { error: h.body.error, scope: h.body.scope ?? "service", retryAfterSeconds: r.retryAfterSeconds, temporary: true } } },
  };
}
