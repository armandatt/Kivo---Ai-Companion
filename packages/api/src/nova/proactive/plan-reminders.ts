// ─── Plan notifications: the job (Telegram launch, 28 Nov) ───────────────────
// Runs in the scheduler tick (apps/api/lib/checkin-cron.ts) and at the due
// moment itself (internal-checkin-scheduler.ts's precise timer), through the
// same outbox and Telegram client as Nova's other messages.
//
//   1. schedule   for each learner with plan notifications on: today's saved
//                 flow → slots (plan-reminder-rules.ts) → syncPlanDay, which
//                 also retires slots whose block moved, went or was started
//   2. expire     the day over, or missed by more than the grace: never sent
//                 late, and no backlog after a pause
//   3. deliver    each due occurrence: re-read the plan, the pauses, the
//                 switches and the chat just before sending; claim the due
//                 moment in the outbox (occ:<id>:<dueAt ms>), send, record.
//
// Only an applied plan schedules anything: a draft on Today is not saved, so
// it has no flow row and nothing here sees it. The text is written by code.

import { dayKey, localHour, localMinute, resolveTimezone } from "../engines/learner-calendar";
import { loadAccountPreferences } from "../adapters/account-preferences-adapter";
import { savedItemsOn } from "../product/day-flow";
import {
  dueOccurrences, expireOccurrences, moveOccurrence, purgeOccurrences, syncPlanDay, type Occurrence,
} from "../product/reminder-occurrences";
import { createTelegramClient } from "../telegram/telegram-client";
import { markUndeliverable, planNotificationLearners, reminderTarget } from "../telegram/channel-store";
import { sendBlockedBy } from "../telegram/telegram-flags";
import type { TelegramClient } from "../telegram/telegram.types";
import { beginSend, claimOrRetry, markReady, markSendFailed, markSent, PLAN_REMINDER } from "./proactive-outbox";
import { reminderMessage, slotsFor, stillEligible } from "./plan-reminder-rules";

export interface PlanRemindersResult { scheduled: number; superseded: number; expired: number; checked: number; sent: number; errors: number; outcomes: Record<string, number>; delaysMs: number[] }

export async function runPlanReminders(now = new Date(), deps: { client?: TelegramClient; housekeeping?: boolean } = {}): Promise<PlanRemindersResult> {
  const out: PlanRemindersResult = { scheduled: 0, superseded: 0, expired: 0, checked: 0, sent: 0, errors: 0, outcomes: {}, delaysMs: [] };
  const count = (k: string) => { out.outcomes[k] = (out.outcomes[k] ?? 0) + 1; };
  const blocked = sendBlockedBy("plan");
  if (blocked) {
    console.log(JSON.stringify({ ts: now.toISOString(), layer: "nova_plan_reminders", tick: "disabled", reason: blocked }));
    return out;
  }
  const client = deps.client ?? createTelegramClient();

  // ── 1. Schedule from today's applied plans ────────────────────────────────
  for (const l of await planNotificationLearners()) {
    try {
      if (!l.timezone) { count("no_timezone"); continue; }
      const zone = resolveTimezone(l.timezone);
      const day = dayKey(now, zone);
      const [{ saved, items }, account] = await Promise.all([savedItemsOn(l.profileId, day), loadAccountPreferences(l.chatId)]);
      if (!saved) { count("no_applied_plan"); continue; }
      const started = new Set(items.filter(i => i.status === "active" || i.status === "done" || (i.sessionId && i.status !== "planned")).map(i => i.id));
      const r = await syncPlanDay(l.profileId, day, zone, slotsFor(items, day, zone, account.checkinMinute), started, now);
      out.scheduled += r.created; out.superseded += r.superseded;
    } catch (err) {
      out.errors++;
      console.error(`[nova:plan-reminders] scheduling ${l.profileId} failed:`, (err as Error).message);
    }
  }

  // ── 2. Expire ─────────────────────────────────────────────────────────────
  out.expired = await expireOccurrences(now).catch(err => { out.errors++; console.error("[nova:plan-reminders] expiry failed", err); return 0; });

  // ── 3. Deliver what is due ────────────────────────────────────────────────
  const due = await dueOccurrences(now);
  out.checked = due.length;
  for (const o of due) {
    try {
      const outcome = await deliver(o, now, client);
      if (outcome === "sent") { out.sent++; out.delaysMs.push(now.getTime() - o.dueAt.getTime()); }
      count(outcome);
    } catch (err) {
      out.errors++; count("error");
      console.error(`[nova:plan-reminders] occurrence ${o.id} failed:`, (err as Error).message);
    }
  }
  if (deps.housekeeping) await purgeOccurrences(now).catch(() => 0);
  if (due.length > 0 || out.errors > 0 || out.scheduled > 0 || out.superseded > 0) {
    console.log(JSON.stringify({ ts: now.toISOString(), layer: "nova_plan_reminders", tick: "done", ...out }));
  }
  return out;
}

// One due occurrence, re-checked against everything just before it is sent.
async function deliver(o: Occurrence, now: Date, client: TelegramClient): Promise<string> {
  const target = await reminderTarget(o.profileId);
  if (!target || target.platform !== "telegram" || target.persona !== "nova") {
    await moveOccurrence(o.id, ["scheduled", "deferred", "failed"], "undeliverable", { lastError: "no Telegram chat" });
    return "no_chat";
  }
  const ch = target.channel;
  if (ch?.undeliverableSince) {
    await moveOccurrence(o.id, ["scheduled", "deferred", "failed"], "undeliverable", { lastError: "chat blocked" });
    return "undeliverable";
  }
  // Pause all holds everything; a plan pause, and plan notifications being
  // off, hold the plan's own prompts (a "remind me later" is the learner's).
  const held = ch?.allPausedUntil && ch.allPausedUntil > now ? "paused_all"
    : o.source === "day_plan" && ch?.planPausedUntil && ch.planPausedUntil > now ? "paused_plan"
    : o.source === "day_plan" && !ch?.planNotifications ? "notifications_off" : null;
  if (held) {
    await moveOccurrence(o.id, ["scheduled", "deferred", "failed"], "expired", { lastError: held });
    return held;
  }

  // What is still eligible in the plan as it is now. A carried reminder is
  // matched on the plan of the day it is sent.
  const zone = resolveTimezone(target.timezone ?? o.timezone);
  const day = o.source === "carried" ? dayKey(now, zone) : o.day;
  const { items } = await savedItemsOn(o.profileId, day);
  const offer = stillEligible(o, items);
  if (offer.length === 0) {
    const started = o.items.some(want => items.some(i => i.id === want.id && (i.status === "active" || i.status === "done")));
    if (o.source === "carried") {
      // Nothing to start from yesterday's request: say so plainly, once.
      return send(o, now, client, target.chatId, `Yesterday you asked me to remind you about ${o.items.map(i => i.title).join(", ")}. It isn't on today's plan.`, [[{ text: "Open Today", url: webUrl("/home") }]], day);
    }
    await moveOccurrence(o.id, ["scheduled", "deferred", "failed"], started ? "started" : "superseded", { lastError: started ? null : "no longer on the plan" });
    return started ? "already_started" : "not_on_plan";
  }
  const when = o.blockAt ?? `${String(localHour(o.dueAt, zone)).padStart(2, "0")}:${String(localMinute(o.dueAt, zone)).padStart(2, "0")}`;
  const msg = reminderMessage(o, offer, when);
  return send(o, now, client, target.chatId, msg.text, msg.buttons, day);
}

function webUrl(path: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "https://www.thekivo.in").replace(/\/$/, "");
  return `${base}${path}`;
}

async function send(o: Occurrence, now: Date, client: TelegramClient, chatId: string, text: string, buttons: Array<Array<{ text: string; callback_data?: string; url?: string }>>, localDay: string): Promise<string> {
  const row = await claimOrRetry(o.profileId, PLAN_REMINDER, `occ:${o.id}:${o.dueAt.getTime()}`, localDay, now);
  if (!row) return "already_claimed";
  if (row.status === "claimed") await markReady(row.id, text);
  if (!await beginSend(row.id, now)) return "already_claimed";
  const result = await client.sendMessage(chatId, row.text ?? text, buttons);
  const log = (outcome: string) => console.log(JSON.stringify({
    ts: now.toISOString(), layer: "nova_plan_reminders", profileId: o.profileId, occurrence: o.id, source: o.source,
    outcome, attempt: row.attempts + 1, delayMs: now.getTime() - o.dueAt.getTime(), messageId: result.ok ? result.messageId : null,
  }));
  if (result.ok) {
    await markSent(row.id, result.messageId, now);
    await moveOccurrence(o.id, ["scheduled", "deferred", "failed"], "sent", { messageId: result.messageId, sentAt: now, sentCount: "increment", lastError: null });
    log("sent");
    return "sent";
  }
  if (result.kind === "blocked") {
    await markSendFailed(row.id, "permanent", result.detail);
    await markUndeliverable(o.profileId, now);
    await moveOccurrence(o.id, ["scheduled", "deferred", "failed"], "undeliverable", { lastError: result.detail });
  } else if (result.kind === "unknown") {
    // It may have arrived: never sent again.
    await markSendFailed(row.id, "unknown", result.detail);
    await moveOccurrence(o.id, ["scheduled", "deferred", "failed"], "unknown", { lastError: result.detail });
  } else if (result.kind === "bad_request") {
    // Telegram refused this message: sending it again would be refused too.
    await markSendFailed(row.id, "permanent", result.detail);
    await moveOccurrence(o.id, ["scheduled", "deferred", "failed"], "expired", { lastError: `refused: ${result.detail}` });
  } else {
    // 429 or 5xx: tried again on the next run, inside the grace.
    await markSendFailed(row.id, "retryable", result.detail);
    await moveOccurrence(o.id, ["scheduled", "deferred"], "failed", { lastError: `${result.kind}${result.retryAfterSeconds ? ` retry_after=${result.retryAfterSeconds}` : ""}` });
  }
  log(result.kind);
  return "send_failed";
}
