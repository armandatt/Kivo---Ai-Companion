// ─── The decision: may this request go ahead? ────────────────────────────────
// `checkRate` counts one request (or `weight` units: a batch's items, an
// upload's megabytes) against every window of a policy the caller has a
// subject for, in one round trip, and decides:
//   1. an incident switch (KIVO_DISABLE) → 503 disabled, nothing counted;
//   2. any window over its limit that is enforced → 429 with Retry-After;
//      over but only observed (shadow) → logged as would_refuse, admitted;
//   3. the limiter failed → 503 when the policy is "closed" and any of its
//      limits is enforced, otherwise admitted and logged.
// `acquireSlot` does the same for a concurrency limit and returns `release`,
// which the caller runs in `finally` (safe to run twice).
//
// No billing, usage reservation or learner data is read or written here, so
// a refusal never leaves one half done: callers check before they reserve.

import { disabled, enforces, rateLimitMode } from "./controls";
import { effectivePolicy, scaledConcurrency, scaledLimit, type Dimension, type Policy, type Tier, type Window } from "./policies";
import { postgresStore, retryAfter, type CounterHit, type CounterStore } from "./store";
import { postgresLeases, type LeaseStore } from "./leases";
import { observe } from "./observe";

export interface Who {
  user?: string | null;     // accountSubject(usageKey) or credentialSubject(token)
  ip?: string | null;       // clientAddress(headers).subject
  client?: string | null;   // safeSubject("client", grantId / clientId / connectionId)
  task?: string | null;     // safeSubject("task", taskId)
  tier?: Tier | null;       // for plan-scaled policies; null counts as Free
  authenticated?: boolean;
}

export type Refusal =
  | { allowed: false; kind: "rate_limited"; status: 429; policy: string; dimension: Dimension | "concurrency"; retryAfterSeconds: number }
  | { allowed: false; kind: "disabled"; status: 503; policy: string; retryAfterSeconds: number }
  | { allowed: false; kind: "unavailable"; status: 503; policy: string; retryAfterSeconds: number };
export type Decision = { allowed: true; observedOnly?: string[] } | Refusal;

export interface EngineDeps { store?: CounterStore; leases?: LeaseStore; env?: NodeJS.ProcessEnv; now?: Date }

const GLOBAL = "global:all";
const subjectFor = (who: Who, d: Dimension): string | null =>
  d === "global" ? GLOBAL : (who[d] ?? null);

// The window's length is part of the key: a policy with a minute and an hour
// window would otherwise share a row whenever both buckets start together.
export const counterKey = (policy: string, d: Dimension, windowMs: number, subject: string) => `rl.${policy}.${d}.${Math.round(windowMs / 1000)}s:${subject}`;
export const leaseKey = (policy: string, which: "user" | "global", subject: string) => `rl.${policy}.conc-${which}:${subject}`;

function policyOf(id: string, env: NodeJS.ProcessEnv): Policy {
  const p = effectivePolicy(id, env);
  if (!p) throw new Error(`Unknown rate-limit policy: ${id}`);
  return p;
}

const enforcedWindow = (p: Policy, w: Window, env: NodeJS.ProcessEnv) => Boolean(p.legacy || w.legacy) || enforces(p, env);

export async function checkRate(policyId: string, who: Who, opts: EngineDeps & { weight?: number } = {}): Promise<Decision> {
  const env = opts.env ?? process.env, store = opts.store ?? postgresStore, now = opts.now ?? new Date();
  const p = policyOf(policyId, env);
  if (disabled(p, env)) {
    observe({ event: "disabled", policy: p, subject: who.user ?? who.ip ?? null, authenticated: who.authenticated }, store, now);
    return { allowed: false, kind: "disabled", status: 503, policy: p.id, retryAfterSeconds: 300 };
  }
  const mode = rateLimitMode(env);
  const weight = Math.max(1, Math.ceil(opts.weight ?? 1));
  const plan: Array<{ d: Dimension; w: Window; subject: string; hit: CounterHit; enforced: boolean }> = [];
  for (const d of ["user", "ip", "client", "task", "global"] as const) {
    const subject = subjectFor(who, d);
    if (!subject) continue;
    for (const w of p[d] ?? []) {
      const enforced = enforcedWindow(p, w, env);
      if (mode === "off" && !enforced) continue;
      plan.push({ d, w, subject, enforced, hit: { key: counterKey(p.id, d, w.windowMs, subject), windowMs: w.windowMs, weight } });
    }
  }
  if (plan.length === 0) return { allowed: true };

  let results;
  try {
    results = await store.hit(plan.map(x => x.hit), now);
  } catch (err) {
    const anyEnforced = plan.some(x => x.enforced);
    const refuse = p.failure === "closed" && anyEnforced;
    observe({ event: refuse ? "unavailable" : "fault", policy: p, detail: (err as Error).name, authenticated: who.authenticated }, null, now);
    return refuse ? { allowed: false, kind: "unavailable", status: 503, policy: p.id, retryAfterSeconds: 5 } : { allowed: true };
  }

  let refusal: Refusal | null = null;
  const observedOnly: string[] = [];
  plan.forEach((x, i) => {
    const r = results[i]!;
    const limit = scaledLimit(p, x.d, x.w, who.tier ?? null);
    if (r.estimate <= limit) return;
    const wait = retryAfter(limit, r.current, r.previous, x.w.windowMs, now);
    if (x.enforced) {
      if (!refusal || wait > refusal.retryAfterSeconds) refusal = { allowed: false, kind: "rate_limited", status: 429, policy: p.id, dimension: x.d, retryAfterSeconds: wait };
    } else {
      observedOnly.push(`${x.d}/${x.w.windowMs}`);
      observe({ event: "would_refuse", policy: p, dimension: x.d, subject: x.subject, authenticated: who.authenticated, retryAfterSeconds: wait }, store, now);
    }
  });
  if (refusal) {
    const r = refusal as Refusal & { dimension: Dimension };
    observe({ event: "refused", policy: p, dimension: r.dimension, subject: subjectFor(who, r.dimension), authenticated: who.authenticated, retryAfterSeconds: r.retryAfterSeconds }, store, now);
    return r;
  }
  return observedOnly.length ? { allowed: true, observedOnly } : { allowed: true };
}

export interface Slot { decision: Decision; release: () => Promise<void> }
const noRelease = async () => {};

/**
 * One slot of a policy's concurrency limit for `holder` (the operation's own
 * id, so a retry of the same operation reuses its slot). Run `release` when
 * the operation ends, success or failure; an operation that outlives the
 * policy's ttl should call `renew`.
 */
export async function acquireSlot(policyId: string, who: Who, holder: string, opts: EngineDeps = {}): Promise<Slot> {
  const env = opts.env ?? process.env, leases = opts.leases ?? postgresLeases, store = opts.store ?? postgresStore, now = opts.now ?? new Date();
  const p = policyOf(policyId, env);
  if (!p.concurrency) return { decision: { allowed: true }, release: noRelease };
  if (disabled(p, env)) {
    observe({ event: "disabled", policy: p, subject: who.user ?? null, authenticated: who.authenticated }, store, now);
    return { decision: { allowed: false, kind: "disabled", status: 503, policy: p.id, retryAfterSeconds: 300 }, release: noRelease };
  }
  const mode = rateLimitMode(env);
  const enforced = Boolean(p.legacy) || enforces(p, env);
  if (mode === "off" && !enforced) return { decision: { allowed: true }, release: noRelease };

  const wanted: Array<{ key: string; max: number; subject: string }> = [];
  const userMax = scaledConcurrency(p, "user", who.tier ?? null), globalMax = scaledConcurrency(p, "global", who.tier ?? null);
  if (userMax && who.user) wanted.push({ key: leaseKey(p.id, "user", who.user), max: userMax, subject: who.user });
  if (globalMax) wanted.push({ key: leaseKey(p.id, "global", GLOBAL), max: globalMax, subject: GLOBAL });
  if (wanted.length === 0) return { decision: { allowed: true }, release: noRelease };

  const taken: string[] = [];
  const release = async () => {
    for (const key of taken.splice(0)) {
      try { await leases.release(key, holder); }
      catch (err) { observe({ event: "fault", policy: p, dimension: "concurrency", detail: `release:${(err as Error).name}` }, null); }
    }
  };
  try {
    for (const w of wanted) {
      const r = await leases.acquire({ key: w.key, holder, max: w.max, ttlMs: p.concurrency.ttlMs }, now);
      if (r.expiredCleared > 0) observe({ event: "expired", policy: p, dimension: "concurrency", subject: w.subject, detail: String(r.expiredCleared) }, store, now);
      if (r.acquired) { taken.push(w.key); continue; }
      if (enforced) {
        await release();
        observe({ event: "saturated", policy: p, dimension: "concurrency", subject: w.subject, authenticated: who.authenticated }, store, now);
        const wait = w.subject === GLOBAL ? 30 : 15;
        return { decision: { allowed: false, kind: "rate_limited", status: 429, policy: p.id, dimension: "concurrency", retryAfterSeconds: wait }, release: noRelease };
      }
      observe({ event: "would_saturate", policy: p, dimension: "concurrency", subject: w.subject, authenticated: who.authenticated }, store, now);
    }
    return { decision: { allowed: true }, release };
  } catch (err) {
    await release();
    const refuse = p.failure === "closed" && enforced;
    observe({ event: refuse ? "unavailable" : "fault", policy: p, dimension: "concurrency", detail: (err as Error).name }, null, now);
    return { decision: refuse ? { allowed: false, kind: "unavailable", status: 503, policy: p.id, retryAfterSeconds: 5 } : { allowed: true }, release: noRelease };
  }
}

/** Keeps a long operation's slots: call before its ttl runs out. */
export async function renewSlot(policyId: string, who: Who, holder: string, opts: EngineDeps = {}): Promise<void> {
  const env = opts.env ?? process.env, leases = opts.leases ?? postgresLeases, now = opts.now ?? new Date();
  const p = policyOf(policyId, env);
  if (!p.concurrency) return;
  const keys = [who.user ? leaseKey(p.id, "user", who.user) : null, leaseKey(p.id, "global", GLOBAL)].filter((k): k is string => Boolean(k));
  for (const key of keys) { try { await leases.renew(key, holder, p.concurrency.ttlMs, now); } catch { /* the lease expires; nothing is lost */ } }
}

/** Releases a slot taken in an earlier request (an import job resumed or finished elsewhere). */
export async function releaseSlot(policyId: string, who: Who, holder: string, opts: EngineDeps = {}): Promise<void> {
  const env = opts.env ?? process.env, leases = opts.leases ?? postgresLeases;
  const p = policyOf(policyId, env);
  const keys = [who.user ? leaseKey(p.id, "user", who.user) : null, leaseKey(p.id, "global", GLOBAL)].filter((k): k is string => Boolean(k));
  for (const key of keys) { try { await leases.release(key, holder); } catch { /* expires by itself */ } }
}
