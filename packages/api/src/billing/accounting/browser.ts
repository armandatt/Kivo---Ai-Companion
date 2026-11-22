// ─── Browser-agent tasks on the ledger ────────────────────────────────────────
// One task is one unit of `browser_tasks`, reserved when the task starts
// (POST …/agent/start), however many steps it then takes. The existing step
// cap (agent-ticket.ts AGENT_TASK_STEPS) and the route's limits are
// unchanged. Policy:
//   - reserved at start, after the start succeeded (a start refused or failed
//     before a ticket is issued reserves nothing);
//   - committed by the first step that completes (nova.ts settleBrowser):
//     meaningful work has begun, so a later cancellation keeps the charge;
//   - refunded by reconciliation when the ticket expires with no completed
//     step (Kivo or the provider failed before any work, or the learner
//     cancelled before any);
//   - the same start sent again with the same client key returns the first
//     task's reservation and its task id, so a retry is never charged twice.
// Every step's measured cost is added to the task (cost, never units).

import { entitlementForLearner } from "../entitlements";
import { refund, reservationById, reserve } from "./ledger";
import { accountingFault, accountingMode, targetFor } from "./targets";

export interface TaskReservation { reservationId: string; taskId: string; duplicate: boolean; shadowRefusal: string | null }

// The client's key for one start, if it sent a usable one.
export function clientTaskKey(raw: unknown): string | null {
  return typeof raw === "string" && /^[A-Za-z0-9_-]{8,80}$/.test(raw) ? raw : null;
}

export async function reserveBrowserTask(input: { platformChatId: string; taskId: string; clientKey?: string | null; now?: Date }): Promise<TaskReservation | null> {
  if (accountingMode() === "off") return null;
  try {
    const ent = await entitlementForLearner(input.platformChatId, input.now);
    const t = await targetFor(ent.usageKey, "browser_tasks", input.now);
    const key = input.clientKey ? `client:${input.clientKey}` : `task:${input.taskId}`;
    const r = await reserve(t, { units: 1, idempotencyKey: key, feature: "extension_agent", ref: input.taskId, reason: "task_started", now: input.now });
    if (!r.ok) return null;
    if (!r.duplicate) return { reservationId: r.reservationId, taskId: input.taskId, duplicate: false, shadowRefusal: r.shadowRefusal };
    // A retried start: the task it already started.
    const row = await reservationById(r.reservationId);
    return { reservationId: r.reservationId, taskId: row?.ref ?? input.taskId, duplicate: true, shadowRefusal: r.shadowRefusal };
  } catch (err) {
    accountingFault("browser.reserve", err);
    return null;
  }
}

// Kivo could not start the task after reserving (the ticket was not sent).
export async function refundBrowserTask(reservationId: string, reason: string): Promise<void> {
  try { await refund(reservationId, { reason }); } catch (err) { accountingFault("browser.refund", err); }
}
