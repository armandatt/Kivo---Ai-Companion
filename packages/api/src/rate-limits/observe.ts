// ─── What the limits did: log lines and counters ─────────────────────────────
// Events: refused (a limit refused), would_refuse (a limit in shadow would
// have), fault (the limiter could not answer), unavailable (that fault
// refused the request), disabled (an incident switch), read_only,
// saturated (a concurrency limit was full), would_saturate (in shadow),
// expired (leases recovered from a holder that never gave them back).
//
// Logs: one JSON line `{"layer":"rate_limit",…}` per event, at most one a
// minute for the same policy, dimension, subject and event; the rest are
// counted into the next line (`repeats`). Never a token, cookie, prompt,
// note, file or raw address: subjects are account ids or keyed hashes.
//
// Counters: aggregated in this process and written at most once every
// FLUSH_MS as hourly rows in RateLimitWindow (`rl.obs.<event>.<policy>.<dim>:obs:hour`),
// kept 14 days. Their number is bounded by policies × dimensions × events ×
// hours, whatever the traffic, so watching an attack cannot become one.
// scripts/rateLimitReport.ts reads them.

import type { Dimension, Policy } from "./policies";
import type { CounterStore } from "./store";

export type RateEvent =
  | "refused" | "would_refuse" | "fault" | "unavailable" | "disabled" | "read_only"
  | "saturated" | "would_saturate" | "expired";

export const OBS_WINDOW_MS = 60 * 60_000;
export const OBS_KEEP_MS = 13 * 24 * 60 * 60_000;
const FLUSH_MS = 10_000;
const LOG_EVERY_MS = 60_000;

const pending = new Map<string, number>();
const lastLog = new Map<string, { at: number; repeats: number }>();
let lastFlush = 0;

export function obsKey(event: RateEvent, policy: string, dim: Dimension | "concurrency" | "policy") {
  return `rl.obs.${event}.${policy}.${dim}:obs:hour`;
}

export interface ObserveInput {
  event: RateEvent;
  policy: Pick<Policy, "id" | "category">;
  dimension?: Dimension | "concurrency" | "policy";
  subject?: string | null;
  authenticated?: boolean;
  retryAfterSeconds?: number;
  detail?: string;
}

export function observe(e: ObserveInput, store: CounterStore | null, now = new Date()): void {
  const dim = e.dimension ?? "policy";
  const t = now.getTime();
  const id = `${e.event}|${e.policy.id}|${dim}|${e.subject ?? "-"}`;
  const seen = lastLog.get(id);
  if (!seen || t - seen.at >= LOG_EVERY_MS) {
    console.warn(JSON.stringify({
      layer: "rate_limit", event: e.event, policy: e.policy.id, category: e.policy.category, dimension: dim,
      subject: e.subject ?? null, authenticated: e.authenticated ?? null,
      retryAfterSeconds: e.retryAfterSeconds ?? null, detail: e.detail ?? null, repeats: seen?.repeats ?? 0,
    }));
    lastLog.set(id, { at: t, repeats: 0 });
    if (lastLog.size > 10_000) for (const [k, v] of lastLog) if (t - v.at >= LOG_EVERY_MS) lastLog.delete(k);
  } else {
    seen.repeats++;
  }
  const key = obsKey(e.event, e.policy.id, dim);
  pending.set(key, (pending.get(key) ?? 0) + 1);
  if (store && t - lastFlush >= FLUSH_MS) void flushObservations(store, now);
}

export async function flushObservations(store: CounterStore, now = new Date()): Promise<void> {
  lastFlush = now.getTime();
  if (pending.size === 0) return;
  const hits = [...pending].map(([key, weight]) => ({ key, windowMs: OBS_WINDOW_MS, weight, keepMs: OBS_KEEP_MS }));
  pending.clear();
  try { await store.hit(hits, now); }
  catch (err) { console.error(JSON.stringify({ layer: "rate_limit", event: "observe_flush_failed", error: (err as Error).name })); }
}

/** For tests. */
export function resetObservations() { pending.clear(); lastLog.clear(); lastFlush = 0; }
export function pendingObservations(): ReadonlyMap<string, number> { return pending; }
