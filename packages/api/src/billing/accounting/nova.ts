// ─── Model work on the ledger: Nova credits, browser task cost, Kivo-funded ──
// Every interaction (services/llm-usage.ts startInteraction) hands its model
// calls here when it ends, and a call made under no interaction comes alone,
// so no model call is left off the ledger. Each call is classed by its
// feature (rules.ts featureClass):
//   nova     → Nova credits of the account it was for, from measured cost
//   browser  → the cost of the browser task it was a step of
//   kivo     → Kivo-funded cost, recorded against the account, no allowance
//   system   → no learner (Rex, unattributed)
//
// The policy for Nova credits, in one place:
//   - an entry point reserves before the work runs (reserveForInteraction);
//   - the work succeeded and a model call succeeded: commit the measured cost
//     of the successful calls, rounded up to credits (at least one); a call
//     the provider could not price (cost unknown) settles at no less than
//     what was reserved;
//   - the work failed (Kivo's fault or the provider's), or no call succeeded,
//     or no call was made (refused before execution): refund. The provider's
//     cost of any failed call is still recorded on the refund;
//   - automatic retries inside one call are one call: charged once;
//   - Telegram: one update is one interaction, so its reading, wording and
//     rewording are settled together, once;
//   - the same work asked again with the same idempotency key reserves
//     nothing new and settles nothing twice (settlement is guarded on state);
//   - a process that stops after reserving leaves the reservation to
//     reconciliation (reconcile.ts), which settles it from the usage events.

import type { InteractionEnd, LlmCallEvent, UsageContext } from "../../services/llm-usage";
import { currentUsageContext } from "../../services/llm-usage";
import { costOf } from "../pricing";
import { usageKeysFor } from "../usage-events";
import { entitlementForLearner } from "../entitlements";
import { addCost, commit, record, refund, reservationByRef, reserve } from "./ledger";
import { browserTaskCostTargetMicros, creditRateVersion, creditsFor, featureClass, reserveEstimate, type FeatureClass, type Tier } from "./rules";
import { accountingFault, accountingMode, enforcing, targetFor } from "./targets";

// How long an entry point waits for its reservation in shadow mode before
// letting the work start (the reservation still completes, and settlement
// waits for it). Enforcing, it waits for the answer: the reservation is the
// admission.
const RESERVE_WAIT_MS = 300;

export interface NovaRefusal {
  code:      "nova_allowance_exhausted";
  tier:      Tier;
  used:      number;
  limit:     number;
  resetsAt:  string | null;
}
export type NovaAdmission = { refused: null; reservationId: string | null } | { refused: NovaRefusal; reservationId: null };

async function reserveFor(accountKey: string, opts: { feature: string; estimate?: number; idempotencyKey: string; ref: string | null; enforce: boolean }): Promise<NovaAdmission> {
  const t = await targetFor(accountKey, "nova_credits");
  const r = await reserve(t, {
    units: opts.estimate ?? reserveEstimate(opts.feature), idempotencyKey: opts.idempotencyKey,
    feature: opts.feature, ref: opts.ref, rateVersion: creditRateVersion(), mode: opts.enforce ? "enforce" : "shadow",
  });
  if (r.ok) return { refused: null, reservationId: r.reservationId };
  return { refused: { code: "nova_allowance_exhausted", tier: t.tier, used: r.used, limit: r.limit, resetsAt: t.period.end?.toISOString() ?? null }, reservationId: null };
}

// Reserves Nova credits for the interaction now open, before its work runs.
// Only for learner-initiated Nova work; anything else is recorded when it
// ends. Shadow: never refuses and never blocks the work for long. Enforcing:
// answers whether the work may run. A fault in accounting allows it.
export async function reserveForInteraction(opts: { feature?: string; estimate?: number; idempotencyKey?: string } = {}): Promise<NovaAdmission> {
  const allowed: NovaAdmission = { refused: null, reservationId: null };
  if (accountingMode() === "off") return allowed;
  const ctx = currentUsageContext();
  const tally = ctx?.tally;
  if (!ctx || !tally || tally.reservation) return allowed;
  const feature = opts.feature ?? ctx.feature;
  if (featureClass(feature) !== "nova") return allowed;
  const enforce = enforcing("nova_credits");
  const held = (async (): Promise<NovaAdmission> => {
    const { subjectKey } = await usageKeysFor(ctx);
    if (subjectKey.startsWith("system:")) return allowed;
    return reserveFor(subjectKey, { feature, estimate: opts.estimate, idempotencyKey: opts.idempotencyKey ?? `interaction:${ctx.interactionId}`, ref: ctx.interactionId, enforce });
  })().catch((err): NovaAdmission => { accountingFault("nova.reserve", err); return allowed; });
  tally.reservation = held.then(a => a.reservationId);
  if (enforce) return held;
  await Promise.race([held, new Promise(resolve => setTimeout(resolve, RESERVE_WAIT_MS).unref?.())]);
  return allowed;
}

// Reserves Nova credits for work that will run later in an interaction of its
// own (a Build with Nova job, answered before it runs): the learner's account
// and an idempotency key for this request. The job adopts it
// (adoptReservation); work that never starts releases it.
export async function reserveNovaFor(platformChatId: string, opts: { feature: string; idempotencyKey: string; estimate?: number }): Promise<NovaAdmission> {
  const allowed: NovaAdmission = { refused: null, reservationId: null };
  if (accountingMode() === "off") return allowed;
  try {
    const ent = await entitlementForLearner(platformChatId);
    return await reserveFor(ent.usageKey, { feature: opts.feature, estimate: opts.estimate, idempotencyKey: opts.idempotencyKey, ref: null, enforce: enforcing("nova_credits") });
  } catch (err) {
    accountingFault("nova.reserve_for", err);
    return allowed;
  }
}

// The interaction now open settles this reservation when it ends.
export function adoptReservation(reservationId: string | null): void {
  const tally = currentUsageContext()?.tally;
  if (!tally || !reservationId || tally.reservation) return;
  tally.reservation = Promise.resolve(reservationId);
}

// Work that was reserved for and never started (a claim refused, a route that
// failed before its job): the credits go back.
export async function releaseReservation(reservationId: string | null, reason: string): Promise<void> {
  if (!reservationId) return;
  try { await refund(reservationId, { reason }); } catch (err) { accountingFault("nova.release", err); }
}

interface Priced { event: LlmCallEvent; costMicros: number; unknown: boolean }
const price = (event: LlmCallEvent): Priced => {
  const c = costOf(event);
  return { event, costMicros: c.estimatedCostMicros ?? 0, unknown: c.costState === "unknown" && event.outcome !== "not_sent" };
};
const sum = (xs: Priced[]) => xs.reduce((a, x) => a + x.costMicros, 0);

// The account a call was for (the same rule as its usage event).
async function accountOf(context: UsageContext, cache: Map<string, string>): Promise<string> {
  const k = `${context.usageKey ?? ""}|${context.learner ?? ""}|${context.profileId ?? ""}|${context.surface}`;
  const hit = cache.get(k);
  if (hit) return hit;
  const { subjectKey } = await usageKeysFor(context);
  cache.set(k, subjectKey);
  return subjectKey;
}

export async function settleInteraction(end: InteractionEnd): Promise<void> {
  if (accountingMode() === "off") return;
  const now = new Date();
  const id = end.context.interactionId;
  const accounts = new Map<string, string>();
  const byClass: Record<FeatureClass, Priced[]> = { nova: [], browser: [], kivo: [], system: [] };
  for (const e of end.events) byClass[featureClass(e.context.feature)].push(price(e));

  const reservationId = end.reservation ? await end.reservation.catch(() => null) : null;
  await settleNova(end, byClass.nova, reservationId, accounts, now).catch(err => accountingFault("nova.settle", err));
  await settleBrowser(byClass.browser, accounts, now).catch(err => accountingFault("nova.browser", err));
  for (const cls of ["kivo", "system"] as const) {
    if (byClass[cls].length === 0) continue;
    await recordCost(cls === "kivo" ? "kivo_funded" : "system", byClass[cls], id, accounts, now).catch(err => accountingFault(`nova.${cls}`, err));
  }
}

async function settleNova(end: InteractionEnd, calls: Priced[], reservationId: string | null, accounts: Map<string, string>, now: Date): Promise<void> {
  const ok = calls.filter(c => c.event.outcome === "success");
  const cost = sum(calls), billable = sum(ok);
  const rate = creditRateVersion();
  const credits = (reserved: number) => {
    const c = creditsFor(billable);
    return ok.some(x => x.unknown) ? Math.max(c, reserved) : c;
  };
  if (reservationId) {
    if (end.failed || ok.length === 0) {
      const reason = end.failed ? (calls.length > 0 ? "work_failed_after_model_call" : "work_failed_before_model_call") : calls.length > 0 ? "model_call_failed" : "no_model_call";
      await refund(reservationId, { reason, costMicros: cost, now, detail: `interaction:${end.context.interactionId}` });
    } else {
      const feature = ok[0]!.event.context.feature;
      await commit(reservationId, { units: credits(reserveEstimate(feature)), costMicros: cost, reason: ok.length < calls.length ? "committed_partial" : "committed", rateVersion: rate, now, detail: `interaction:${end.context.interactionId}` });
    }
    return;
  }
  if (calls.length === 0) return;
  // No entry point reserved for this work: recorded as it happened.
  const accountKey = await accountOf(calls[0]!.event.context, accounts);
  const feature = calls[0]!.event.context.feature;
  const t = await targetFor(accountKey, "nova_credits", now);
  const charge = !end.failed && ok.length > 0;
  await record(t, {
    units: charge ? credits(reserveEstimate(feature)) : 0, costMicros: cost, feature,
    reason: charge ? "unreserved" : "failed_not_charged", key: `interaction:${end.context.interactionId}`, rateVersion: rate,
    shadowRefusal: null,
  });
}

// A browser task's steps: each step's cost goes on the task's reservation;
// the first step that completes is the "meaningful work" that commits the
// task (one task, however many steps). A step whose task has no reservation
// (started before this was deployed) is recorded as cost only.
async function settleBrowser(calls: Priced[], accounts: Map<string, string>, now: Date): Promise<void> {
  for (const c of calls) {
    const taskId = c.event.context.requestId;
    const res = taskId ? await reservationByRef("browser_tasks", taskId) : null;
    const key = `${c.event.context.interactionId}:${c.event.at.getTime()}`;
    if (res) {
      const added = await addCost(res.id, { costMicros: c.costMicros, key, reason: "step_cost", feature: c.event.context.feature });
      // The $0.03 target is measured, never enforced on a running task: a
      // task that passes it is logged once and counted by the report.
      const target = browserTaskCostTargetMicros();
      if (added && added.before <= target && added.after > target) {
        console.warn(JSON.stringify({ layer: "usage_accounting", event: "browser_task_over_cost_target", targetMicros: target, costMicros: added.after }));
      }
      if (c.event.outcome === "success" && res.state === "reserved") {
        await commit(res.id, { units: 1, costMicros: 0, reason: "first_step_completed", now });
      }
      continue;
    }
    const accountKey = await accountOf(c.event.context, accounts);
    const t = await targetFor(accountKey, "browser_tasks", now);
    await record(t, { units: 0, committed: 0, costMicros: c.costMicros, feature: c.event.context.feature, reason: "step_without_task", key, shadowRefusal: null });
  }
}

async function recordCost(product: "kivo_funded" | "system", calls: Priced[], interactionId: string, accounts: Map<string, string>, now: Date): Promise<void> {
  // Grouped by account: one entry per account per interaction.
  const groups = new Map<string, Priced[]>();
  for (const c of calls) {
    const key = await accountOf(c.event.context, accounts);
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  for (const [accountKey, xs] of groups) {
    const t = await targetFor(accountKey, product, now);
    const cost = sum(xs);
    // Units: the credits this would have been, for comparison only.
    await record(t, { units: creditsFor(cost), costMicros: cost, feature: xs[0]!.event.context.feature, reason: product, key: `interaction:${interactionId}`, rateVersion: creditRateVersion(), shadowRefusal: null });
  }
}
