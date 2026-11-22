// ─── Browser-agent tasks on the ledger ────────────────────────────────────────
// One task is one unit of `browser_tasks`, reserved when the task starts
// (POST …/agent/start), however many steps it then takes. The existing step
// cap (agent-ticket.ts AGENT_TASK_STEPS) and the route's limits are
// unchanged. Policy:
//   - reserved at start, after the start succeeded (a start refused or failed
//     before a ticket is issued reserves nothing);
//   - committed by the first step that completes (nova.ts settleBrowser):
//     meaningful work has begun, so a later cancellation keeps the charge;
//   - refunded at once when the start fails on Kivo's side after reserving,
//     and by reconciliation when the ticket expires with no completed step
//     (Kivo or the provider failed before any work, or the learner left
//     before any). A task that did work keeps its charge, however it ended;
//   - the same start sent again with the same client key returns the first
//     task's reservation and its task id, so a retry is never charged twice.
// Every step's measured cost is added to the task (cost, never units).

import { entitlementForLearner } from "../entitlements";
import { AGENT_TASK_TTL_MS } from "../../nova/product/agent-ticket";
import { countStep, recentReservations, refund, reservationById, reservationByKey, reservationByRef, reserve } from "./ledger";
import { hitLimit } from "./limiter";
import { fairUse, type Tier } from "./rules";
import { accountingFault, accountingMode, enforcing, targetFor } from "./targets";

export interface TaskReservation { reservationId: string; taskId: string; duplicate: boolean; shadowRefusal: string | null }
export type TaskRefusal =
  | { code: "browser_allowance_exhausted"; tier: Tier; used: number; limit: number; resetsAt: string | null }
  | { code: "browser_rate_limited"; retryAfterSeconds: number }
  | { code: "browser_too_many_open"; limit: number };
export type TaskAdmission = { refused: null; task: TaskReservation | null } | { refused: TaskRefusal; task: null };

// The client's key for one start, if it sent a usable one.
export function clientTaskKey(raw: unknown): string | null {
  return typeof raw === "string" && /^[A-Za-z0-9_-]{8,80}$/.test(raw) ? raw : null;
}

// One task, reserved when it starts. Enforcing (USAGE_ACCOUNTING=enforce with
// browser_tasks), the start is refused when the month's tasks are used, when
// the account starts tasks faster than fair use allows, or when it already
// has as many tasks running as it may. A task already running is never
// stopped by any of these: steps are not checked against the month's tasks.
// A fault in accounting allows the start.
export async function admitBrowserTask(input: { platformChatId: string; taskId: string; clientKey?: string | null; now?: Date }): Promise<TaskAdmission> {
  const allowed: TaskAdmission = { refused: null, task: null };
  if (accountingMode() === "off") return allowed;
  const now = input.now ?? new Date();
  const enforce = enforcing("browser_tasks");
  try {
    const ent = await entitlementForLearner(input.platformChatId, now);
    const t = await targetFor(ent.usageKey, "browser_tasks", now);
    const key = input.clientKey ? `client:${input.clientKey}` : `task:${input.taskId}`;
    if (enforce) {
      const fair = fairUse();
      // A retried start (same client key) is not a new start: answered below as a duplicate.
      const existing = input.clientKey ? await reservationByKey(t.accountKey, "browser_tasks", key) : null;
      if (!existing) {
        const open = await recentReservations(t.accountKey, "browser_tasks", new Date(now.getTime() - AGENT_TASK_TTL_MS));
        if (open >= fair.browserOpenTasks) return { refused: { code: "browser_too_many_open", limit: fair.browserOpenTasks }, task: null };
        const hit = await hitLimit(`browser-start:${t.accountKey}`, fair.browserStartsPer10Min, 10 * 60_000, now);
        if (!hit.allowed) return { refused: { code: "browser_rate_limited", retryAfterSeconds: hit.retryAfterSeconds }, task: null };
      }
    }
    const r = await reserve(t, { units: 1, idempotencyKey: key, feature: "extension_agent", ref: input.taskId, reason: "task_started", now, mode: enforce ? "enforce" : "shadow" });
    if (!r.ok) return { refused: { code: "browser_allowance_exhausted", tier: t.tier, used: r.used, limit: r.limit, resetsAt: t.period.end?.toISOString() ?? null }, task: null };
    if (!r.duplicate) return { refused: null, task: { reservationId: r.reservationId, taskId: input.taskId, duplicate: false, shadowRefusal: r.shadowRefusal } };
    // A retried start: the task it already started.
    const row = await reservationById(r.reservationId);
    return { refused: null, task: { reservationId: r.reservationId, taskId: row?.ref ?? input.taskId, duplicate: true, shadowRefusal: r.shadowRefusal } };
  } catch (err) {
    accountingFault("browser.reserve", err);
    return allowed;
  }
}

// Phase 1's name, kept for callers that only record.
export async function reserveBrowserTask(input: { platformChatId: string; taskId: string; clientKey?: string | null; now?: Date }): Promise<TaskReservation | null> {
  const a = await admitBrowserTask(input);
  return a.task;
}

// Kivo could not start the task after reserving (the start failed on Kivo's
// side before the ticket was sent): the task goes back.
export async function refundBrowserTask(reservationId: string, reason: string): Promise<void> {
  try { await refund(reservationId, { reason }); } catch (err) { accountingFault("browser.refund", err); }
}

// One step of a task. Answers whether it may run under the step cap, counted
// on the task's reservation so the cap holds across restarts. A task with no
// reservation (started before accounting, or accounting off) answers null:
// the caller's in-memory cap applies.
export async function stepOfTask(taskId: string, cap: number): Promise<{ allowed: boolean; steps: number } | null> {
  if (accountingMode() === "off") return null;
  try {
    const res = await reservationByRef("browser_tasks", taskId);
    if (!res) return null;
    const steps = await countStep(res.id);
    if (steps === null) return null;
    return { allowed: steps <= cap, steps };
  } catch (err) {
    accountingFault("browser.step", err);
    return null;
  }
}
