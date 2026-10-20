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
//   • A repeating event's remindAt is its next occurrence's reminder. Once a
//     tick has dealt with one occurrence (sent, claimed elsewhere, or held
//     because there is nowhere to send it), remindAt moves on to the next,
//     guarded on the moment it held, so two ticks move it once. One the
//     server slept through is moved on as missed. A claimed occurrence stays
//     sendable on retry while the event, as it now is, still has a reminder
//     at that moment.
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
import {
  nextReminder, occurrenceOfReminder, REMINDER_GRACE_MINUTES, reminderBlock, reminderKey, reminderKeyMoment, reminderText,
  type Occurrence, type Series,
} from "../product/calendar-rules";
import { REPEAT_FREQS, type EventCategory, type RepeatFreq } from "../product/calendar.types";
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
  reminderMinutes: true, repeat: true, repeatDays: true, repeatUntil: true, skipDays: true,
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
  reminderMinutes: number | null; repeat: string | null; repeatDays: number[]; repeatUntil: string | null; skipDays: string[];
  profile: {
    user: { platform: string; platformChatId: string; persona: string | null };
    telegramChannel: { undeliverableSince: Date | null } | null;
  };
};

// The event as the rules read it.
function seriesOf(event: DueEvent): Series & { reminderMinutes: number | null } {
  const freq = event.repeat && (REPEAT_FREQS as readonly string[]).includes(event.repeat) ? event.repeat as RepeatFreq : null;
  return {
    allDay: event.allDay, startDay: event.startDay, endDay: event.endDay, startAt: event.startAt, endAt: event.endAt,
    timezone: event.timezone, reminderMinutes: event.reminderMinutes, skipDays: event.skipDays,
    repeat: freq ? { freq, days: freq === "weekly" ? event.repeatDays : [], until: event.repeatUntil } : null,
  };
}

// The reminder text for one occurrence.
const textFor = (event: DueEvent, occurrence: Occurrence, now: Date) =>
  reminderText({ ...event, ...occurrence, category: event.category as EventCategory }, now);

// A repeating event's remindAt moves from `from` to the next occurrence's
// reminder after `after`. Guarded on `from`, so of two ticks one moves it.
async function moveOn(event: DueEvent, from: Date, after: Date): Promise<void> {
  const next = nextReminder(seriesOf(event), after);
  await prisma.novaCalendarEvent.updateMany({ where: { id: event.id, remindAt: from }, data: { remindAt: next?.at ?? null } });
}

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

  // ── Repeating events whose reminder passed unsent (the server slept) ─────
  const graceStart = new Date(now.getTime() - REMINDER_GRACE_MINUTES * 60_000);
  const behind = await prisma.novaCalendarEvent.findMany({
    where:  { repeat: { not: null }, remindAt: { lte: graceStart } },
    take:   500,
    select: EVENT_SELECT,
  }) as DueEvent[];
  for (const event of behind) {
    try {
      await moveOn(event, event.remindAt!, graceStart);
      count("missed_moved_on");
    } catch (err) {
      errors++;
      console.error(`[nova:reminders] moving on ${event.id} failed:`, err);
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
  const at = event.remindAt!;
  try {
    const block = reminderBlock(event.profile.user, event.profile.telegramChannel);
    if (block) return block;
    const occurrence = occurrenceOfReminder(seriesOf(event), at);
    if (!occurrence) return "stale";
    const row = await claimOccurrence(event.profileId, { type: EVENT_REMINDER, occurrenceKey: reminderKey(event.id, at) }, dayKey(now, event.timezone), PRIORITY, now);
    if (!row) return "already_claimed";
    const text = textFor(event, occurrence, now);
    await markReady(row.id, text);
    return await send({ ...row, status: "ready", text }, event.profile.user.platformChatId, now, client);
  } finally {
    // This occurrence is dealt with: a repeating event waits for its next.
    if (event.repeat) await moveOn(event, at, at);
  }
}

// A row a previous tick claimed or failed to send. It goes out only if the
// event still exists, still carries that reminder time, and the learner can
// still be reached; otherwise it is closed.
async function retry(row: OutboxRow, now: Date, client: TelegramClient): Promise<string> {
  const eventId = row.occurrenceKey.split(":")[1] ?? "";
  const event = await prisma.novaCalendarEvent.findFirst({ where: { id: eventId, profileId: row.profileId }, select: EVENT_SELECT }) as DueEvent | null;
  const at = reminderKeyMoment(row.occurrenceKey, eventId);
  // Still true only if the event, as it is now, has a reminder at that moment.
  const occurrence = event && at ? occurrenceOfReminder(seriesOf(event), at) : null;
  if (!event || !occurrence) {
    if (row.text) await dropStale(row.id); else await dropUnworded(row.id);
    return "dropped";
  }
  if (reminderBlock(event.profile.user, event.profile.telegramChannel)) return "held";
  let text = row.text;
  if (!text) {
    text = textFor(event, occurrence, now);
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
