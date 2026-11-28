// ─── The Telegram page (Telegram launch, 28 Nov) ─────────────────────────────
// What Nova will send on Telegram and what happened to what it sent, and the
// same controls the chat has: snooze or skip a plan prompt, plan
// notifications on/off, nudges on/off, pause and resume. Every change goes
// through the same functions the chat's buttons call, so the two never
// disagree. Personal reminders are calendar events' reminders: made, edited
// and removed on the Calendar page.

import { dayKey, resolveTimezone } from "../engines/learner-calendar";
import { loadAccountPreferences } from "../adapters/account-preferences-adapter";
import { dayEnd } from "../proactive/plan-reminder-rules";
import {
  loadChannel, pauseAllUntil, pausePlanUntil, resumeSends, setPlanNotifications, setProactiveEnabled,
} from "../telegram/channel-store";
import { planNotificationsOn, proactiveSendsOn } from "../telegram/telegram-flags";
import { upcomingEventReminders } from "./calendar";
import { ACTIONABLE, getOccurrence, holdPending, moveOccurrence, occurrencesFor, snoozeOccurrence, type Occurrence } from "./reminder-occurrences";
import type { NovaTelegramPage, TelegramRecent, TelegramUpcoming } from "./telegram-page.types";

const titleOf = (o: Occurrence) => o.items.map(i => i.title).join(", ") || "Your plan";

const RECENT_LABEL: Record<string, string> = {
  sent:          "Sent · no action recorded",
  started:       "Started",
  dismissed:     "Skipped",
  expired:       "Not sent",
  superseded:    "Plan changed, not sent",
  unknown:       "Sent · delivery not confirmed",
  undeliverable: "Undeliverable",
  failed:        "Failed to send",
};

function recentOf(o: Occurrence): TelegramRecent {
  const why = o.state === "expired" && o.lastError
    ? ({ paused_all: "Not sent · paused", paused_plan: "Not sent · plan paused", notifications_off: "Not sent · notifications off", missed: "Missed", "day over": o.sentCount > 0 ? "Sent · no action recorded" : "Not sent" } as Record<string, string>)[o.lastError] ?? "Not sent"
    : RECENT_LABEL[o.state] ?? o.state;
  return { id: o.id, title: titleOf(o), at: o.dueAt.toISOString(), status: o.state, label: why };
}

export async function loadTelegramPage(input: { profileId: string; platformChatId: string; timezone: string | null; credits: NovaTelegramPage["credits"] }, now = new Date()): Promise<NovaTelegramPage> {
  const [channel, account, occ, personal] = await Promise.all([
    loadChannel(input.profileId),
    loadAccountPreferences(input.platformChatId),
    occurrencesFor(input.profileId, now),
    upcomingEventReminders(input.profileId, now, 8),
  ]);
  const upcoming: TelegramUpcoming[] = [
    ...occ.upcoming.map(o => ({
      id: o.id, source: "day_plan" as const, title: titleOf(o), at: o.dueAt.toISOString(),
      state: o.state === "deferred" ? "snoozed" as const : o.state === "failed" ? "failed" as const : "scheduled" as const,
      snoozes: o.snoozes, canSnooze: true, canCancel: true,
    })),
    ...personal.map(p => ({
      id: p.eventId, source: "personal" as const, title: p.title, at: p.remindAt.toISOString(),
      state: "scheduled" as const, snoozes: 0, canSnooze: false, canCancel: false,
    })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  if (account.checkinTime && channel.proactiveEnabled) {
    upcoming.push({ id: "checkin", source: "mentor_checkin", title: `Daily check-in around ${account.checkinTime}, on days you haven't studied yet`, at: "", state: "daily", snoozes: 0, canSnooze: false, canCancel: false });
  }
  const pause = channel.allPausedUntil && channel.allPausedUntil > now ? { scope: "all" as const, until: channel.allPausedUntil.toISOString() }
    : channel.planPausedUntil && channel.planPausedUntil > now ? { scope: "plan" as const, until: channel.planPausedUntil.toISOString() }
    : channel.proactivePausedUntil && channel.proactivePausedUntil > now ? { scope: "nudges" as const, until: channel.proactivePausedUntil.toISOString() }
    : null;
  const next = upcoming.find(u => u.at);
  return {
    status: "ready",
    connected: !input.platformChatId.startsWith("web:"),
    undeliverableSince: channel.undeliverableSince?.toISOString() ?? null,
    timezone: input.timezone, checkinTime: account.checkinTime,
    planFeature: planNotificationsOn(), sendsOn: proactiveSendsOn(),
    planNotifications: channel.planNotifications ?? false, nudgesOn: channel.proactiveEnabled,
    pause,
    nextDelivery: next ? { title: next.title, at: next.at, source: next.source } : null,
    upcoming, recent: occ.recent.map(recentOf), credits: input.credits,
  };
}

export type TelegramPageResult = { ok: true } | { ok: false; error: "invalid" | "not_found" | "not_connected"; message: string };

// One change from the page, through the chat's own functions.
export async function changeTelegramPage(input: { profileId: string; platformChatId: string; timezone: string | null }, raw: unknown, now = new Date()): Promise<TelegramPageResult> {
  const body = (raw ?? {}) as Record<string, unknown>;
  const zone = resolveTimezone(input.timezone);
  const midnight = dayEnd(dayKey(now, zone), zone);
  const invalid: TelegramPageResult = { ok: false, error: "invalid", message: "That isn't a change this page can make." };
  switch (body.action) {
    case "snooze": {
      const minutes = body.minutes === 15 || body.minutes === 60 ? body.minutes : null;
      if (typeof body.id !== "string" || !minutes) return invalid;
      const o = await getOccurrence(input.profileId, body.id);
      if (!o || !(ACTIONABLE as string[]).includes(o.state)) return { ok: false, error: "not_found", message: "That reminder is no longer current." };
      const at = new Date(now.getTime() + minutes * 60_000);
      const done = await snoozeOccurrence(input.profileId, o.id, at, dayEnd(dayKey(at, zone), zone), false);
      return done ? { ok: true } : { ok: false, error: "not_found", message: "That reminder is no longer current." };
    }
    case "skip": {
      if (typeof body.id !== "string") return invalid;
      const o = await getOccurrence(input.profileId, body.id);
      const moved = o ? await moveOccurrence(o.id, ACTIONABLE, "dismissed", { lastError: null }) : false;
      return moved ? { ok: true } : { ok: false, error: "not_found", message: "That reminder is no longer current." };
    }
    case "plan_notifications": {
      if (typeof body.enabled !== "boolean") return invalid;
      if (body.enabled && input.platformChatId.startsWith("web:")) return { ok: false, error: "not_connected", message: "Connect Telegram first." };
      await setPlanNotifications(input.profileId, body.enabled);
      if (!body.enabled) await holdPending(input.profileId, "notifications_off");
      return { ok: true };
    }
    case "nudges":
      if (typeof body.enabled !== "boolean") return invalid;
      await setProactiveEnabled(input.profileId, body.enabled);
      return { ok: true };
    case "pause":
      if (body.scope === "plan") await pausePlanUntil(input.profileId, midnight);
      else if (body.scope === "all") await pauseAllUntil(input.profileId, midnight);
      else return invalid;
      return { ok: true };
    case "resume":
      await resumeSends(input.profileId);
      return { ok: true };
    default:
      return invalid;
  }
}
