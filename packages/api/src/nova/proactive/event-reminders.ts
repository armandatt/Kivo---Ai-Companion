// ─── Calendar reminders ───────────────────────────────────────────────────────
// Sends the reminders learners set on calendar events. Runs in the same
// five-minute tick as the proactive messages (apps/api/lib/checkin-cron.ts),
// through the same outbox and the same Telegram client: no second timer,
// queue or table of deliveries.
//
//   due event (remindAt inside the window) → claim → text → ready → send → sent
//
// Once, and only while true:
//   • The claim is unique per (learner, "event:<id>:<remindAt>"), so of any
//     number of ticks, retries or instances one sends it.
//   • The key names the moment. Moving the event or its reminder changes
//     remindAt and so the key: the old time is never claimed, and a claimed
//     but unsent one is dropped before a retry because the event no longer
//     carries that moment. A deleted event has nothing left to send.
//   • A reminder later than REMINDER_GRACE_MINUTES is not sent: it is missed.
//
// Where it goes: the learner's own Telegram chat, the one Nova already talks
// to them in (MessengerUser.platformChatId, set only by linking an account to
// a chat). Nowhere else. A learner without Telegram, or whose chat refused
// delivery, is not sent anything, and the calendar page says why before they
// choose a reminder. Nova's nudges being off does not stop a reminder the
// learner set (calendar-rules.ts, reminderBlock).
//
// The text is written by code (calendar-rules.ts, reminderText). No model.

import { prisma } from "@repo/db/client";
import { dayKey } from "../engines/learner-calendar";
import { createTelegramClient } from "../telegram/telegram-client";
import { markUndeliverable } from "../telegram/channel-store";
import type { TelegramClient } from "../telegram/telegram.types";
import { REMINDER_GRACE_MINUTES, reminderBlock, reminderKey, reminderText } from "../product/calendar-rules";
import type { EventCategory } from "../product/calendar.types";
import {
  beginSend, claimOccurrence, dropStale, dropUnworded, EVENT_REMINDER, markReady, markSendFailed, markSent, recoverReminders, type OutboxRow,
} from "./proactive-outbox";

export interface EventRemindersResult {
  checked:  number;
  sent:     number;
  errors:   number;
  outcomes: Record<string, number>;
}

const PRIORITY = 10;

const EVENT_SELECT = {
  id: true, profileId: true, title: true, category: true, allDay: true, startDay: true, endDay: true,
  startAt: true, endAt: true, timezone: true, remindAt: true,
  profile: {
    select: {
      user:            { select: { platform: true, platformChatId: true, persona: true } },
      telegramChannel: { select: { undeliverableSince: true } },
    },
  },
} as const;

type DueEvent = {
  id: string; profileId: string; title: string; category: string; allDay: boolean; startDay: string; endDay: string;
  startAt: Date | null; endAt: Date | null; timezone: string; remindAt: Date | null;
  profile: {
    user: { platform: string; platformChatId: string; persona: string | null };
    telegramChannel: { undeliverableSince: Date | null } | null;
  };
};

export async function runEventReminders(now = new Date(), deps: { client?: TelegramClient } = {}): Promise<EventRemindersResult> {
  const outcomes: Record<string, number> = {};
  const count = (outcome: string) => { outcomes[outcome] = (outcomes[outcome] ?? 0) + 1; };

  // The same operational switch that stops Nova messaging first.
  if (process.env.NOVA_PROACTIVE_DISABLED === "true") {
    console.log(JSON.stringify({ ts: now.toISOString(), layer: "nova_reminders", tick: "disabled", reason: "NOVA_PROACTIVE_DISABLED" }));
    return { checked: 0, sent: 0, errors: 0, outcomes };
  }
  const client = deps.client ?? createTelegramClient();
  let sent = 0, errors = 0;

  // ── Retries first: claimed or failed earlier, still inside the window ─────
  for (const row of await recoverReminders(now, REMINDER_GRACE_MINUTES)) {
    try {
      const outcome = await retry(row, now, client);
      if (outcome === "sent") sent++;
      count(`retry_${outcome}`);
    } catch (err) {
      errors++;
      console.error(`[nova:reminders] retry ${row.id} failed:`, err);
    }
  }

  // ── Reminders that have come due ──────────────────────────────────────────
  const due = await prisma.novaCalendarEvent.findMany({
    where:   { remindAt: { lte: now, gt: new Date(now.getTime() - REMINDER_GRACE_MINUTES * 60_000) } },
    orderBy: { remindAt: "asc" },
    take:    500,
    select:  EVENT_SELECT,
  }) as DueEvent[];

  for (const event of due) {
    try {
      const outcome = await deliverDue(event, now, client);
      if (outcome === "sent") sent++;
      count(outcome);
    } catch (err) {
      errors++;
      count("error");
      console.error(`[nova:reminders] event ${event.id} failed:`, err);
    }
  }

  if (due.length > 0 || errors > 0) {
    console.log(JSON.stringify({ ts: now.toISOString(), layer: "nova_reminders", tick: "done", checked: due.length, sent, errors, outcomes }));
  }
  return { checked: due.length, sent, errors, outcomes };
}

async function deliverDue(event: DueEvent, now: Date, client: TelegramClient): Promise<string> {
  const block = reminderBlock(event.profile.user, event.profile.telegramChannel);
  if (block) return block;
  const at = event.remindAt!;
  const row = await claimOccurrence(event.profileId, { type: EVENT_REMINDER, occurrenceKey: reminderKey(event.id, at) }, dayKey(now, event.timezone), PRIORITY, now);
  if (!row) return "already_claimed";
  const text = reminderText({ ...event, category: event.category as EventCategory }, now);
  await markReady(row.id, text);
  return send({ ...row, status: "ready", text }, event.profile.user.platformChatId, now, client);
}

// A row a previous tick claimed or failed to send. It goes out only if the
// event still exists, still carries that reminder time, and the learner can
// still be reached; otherwise it is closed.
async function retry(row: OutboxRow, now: Date, client: TelegramClient): Promise<string> {
  const eventId = row.occurrenceKey.split(":")[1] ?? "";
  const event = await prisma.novaCalendarEvent.findFirst({ where: { id: eventId, profileId: row.profileId }, select: EVENT_SELECT }) as DueEvent | null;
  if (!event || !event.remindAt || reminderKey(event.id, event.remindAt) !== row.occurrenceKey) {
    if (row.text) await dropStale(row.id); else await dropUnworded(row.id);
    return "dropped";
  }
  if (reminderBlock(event.profile.user, event.profile.telegramChannel)) return "held";
  let text = row.text;
  if (!text) {
    text = reminderText({ ...event, category: event.category as EventCategory }, now);
    await markReady(row.id, text);
  }
  return send({ ...row, text }, event.profile.user.platformChatId, now, client);
}

async function send(row: OutboxRow, chatId: string, now: Date, client: TelegramClient): Promise<string> {
  if (!await beginSend(row.id, now)) return "already_claimed";
  const result = await client.sendMessage(chatId, row.text ?? "", []);
  const log = (outcome: string) => console.log(JSON.stringify({
    ts: now.toISOString(), layer: "nova_reminders", profileId: row.profileId, occurrence: row.occurrenceKey,
    outcome, attempt: row.attempts + 1, messageId: result.ok ? result.messageId : null,
  }));
  if (result.ok) {
    // The channel's lastDeliveredAt is left alone: it also holds the chat's
    // once-only first message (claimFirstUse), which a reminder must not use up.
    await markSent(row.id, result.messageId, now);
    log("sent");
    return "sent";
  }
  if (result.kind === "blocked") {
    await markSendFailed(row.id, "permanent", result.detail);
    await markUndeliverable(row.profileId, now);
  } else if (result.kind === "unknown") {
    await markSendFailed(row.id, "unknown", result.detail);
  } else if (result.kind === "bad_request") {
    await markSendFailed(row.id, "permanent", result.detail);
  } else {
    await markSendFailed(row.id, "retryable", result.detail);
  }
  log(result.kind);
  return "send_failed";
}
