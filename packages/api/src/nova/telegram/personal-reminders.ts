// ─── Personal reminders on Telegram, by buttons (launch, 28 Nov, M7) ─────────
// "/remind" (or Add reminder in /settings) → the title, typed as the next
// message and taken exactly as typed → when → repeat → saved as a calendar
// event of the learner's own (category personal, reminded when it starts),
// so the Calendar page shows it and the existing reminder delivery sends it.
// No model and no credit at any step. After saving: Edit and Cancel.

import { dayKey, localHour, localMinute, resolveTimezone } from "../engines/learner-calendar";
import { createEvent, deleteEvent, updateEvent } from "../product/calendar";
import { clock12, pickTimes } from "../proactive/plan-reminder-rules";
import type { ActionContext, ActionResult } from "./telegram-actions";
import type { OptionAction, TelegramReply } from "./telegram.types";

export const REMINDER_TITLE_MAX = 80;
const done = (name: string, reply: TelegramReply, ok = true): ActionResult => ({ reply, operation: { name, ok } });
const IDS = "abcdefghij";
const opts = (items: Array<{ label: string; action: OptionAction }>) => items.slice(0, 10).map((x, i) => ({ id: IDS[i]!, ...x }));

const nextDay = (day: string) => { const [y, m, d] = day.split("-").map(Number) as [number, number, number]; return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10); };
const two = (n: number) => String(n).padStart(2, "0");

export function askReminderTitle(): ActionResult {
  return done("reminder_new", {
    text: "What should I remind you about? Send it as your next message.",
    prompt: { kind: "reminder_title", options: opts([{ label: "Cancel", action: { type: "dismiss" } }]) },
  });
}

// The title as typed: one line, trimmed, capped. null: nothing usable.
export function reminderTitle(text: string): string | null {
  const one = text.split("\n").join(" ").split("\t").join(" ").split(" ").filter(Boolean).join(" ");
  return one ? [...one].slice(0, REMINDER_TITLE_MAX).join("") : null;
}

// When: in an hour, the next times today, tomorrow morning and evening.
export function whenReply(ctx: ActionContext, title: string, eventId?: string): TelegramReply {
  const zone = resolveTimezone(ctx.timezone);
  const today = dayKey(ctx.now, zone);
  const nowMin = localHour(ctx.now, zone) * 60 + localMinute(ctx.now, zone);
  const choices: Array<{ label: string; day: string; time: string }> = [];
  const inHour = Math.ceil((nowMin + 60) / 5) * 5;
  if (inHour < 24 * 60) choices.push({ label: "In 1 hour", day: today, time: `${two(Math.floor(inHour / 60))}:${two(inHour % 60)}` });
  for (const t of pickTimes(nowMin + 60)) choices.push({ label: `Today ${clock12(t)}`, day: today, time: t });
  const tomorrow = nextDay(today);
  choices.push({ label: "Tomorrow 9:00 AM", day: tomorrow, time: "09:00" }, { label: "Tomorrow 6:00 PM", day: tomorrow, time: "18:00" });
  return {
    text: `"${title}". When should I remind you?`,
    prompt: { kind: "settings", options: opts([
      ...choices.map(c => ({ label: c.label, action: { type: "reminder_when" as const, title, day: c.day, time: c.time, ...(eventId ? { eventId } : {}) } })),
      { label: "Cancel", action: { type: "dismiss" } },
    ]) },
  };
}

function repeatReply(title: string, day: string, time: string): TelegramReply {
  const save = (repeat: "none" | "daily" | "weekdays" | "weekly") => ({ type: "reminder_save" as const, title, day, time, repeat });
  return {
    text: "Repeat it?",
    prompt: { kind: "settings", options: opts([
      { label: "Just once", action: save("none") }, { label: "Every day", action: save("daily") },
      { label: "Weekdays", action: save("weekdays") }, { label: "Every week", action: save("weekly") },
    ]) },
  };
}

const REPEAT_WORDS = { none: "", daily: ", every day", weekdays: ", every weekday", weekly: ", every week" } as const;

function savedReply(eventId: string, title: string, label: string): TelegramReply {
  return {
    text: `Saved: "${title}", ${label}. I'll remind you then. It's on your Calendar too.`,
    prompt: { kind: "settings", options: opts([
      { label: "Edit", action: { type: "reminder_edit", eventId, title } },
      { label: "Cancel reminder", action: { type: "reminder_cancel", eventId } },
    ]) },
  };
}

function dayLabel(ctx: ActionContext, day: string, time: string): string {
  const zone = resolveTimezone(ctx.timezone);
  const today = dayKey(ctx.now, zone);
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const name = day === today ? "today" : day === nextDay(today) ? "tomorrow"
    : new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
  return `${name} at ${clock12(time)}`;
}

export async function runPersonalReminder(ctx: ActionContext, action: Extract<OptionAction, { type: "reminder_when" | "reminder_save" | "reminder_edit" | "reminder_cancel" }>): Promise<ActionResult> {
  switch (action.type) {
    case "reminder_edit": return done("reminder_edit", whenReply(ctx, action.title, action.eventId));
    case "reminder_cancel": {
      const gone = await deleteEvent(ctx.profileId, action.eventId);
      return done("reminder_cancel", { text: gone ? "Cancelled. Nothing will be sent for it." : "That reminder was already gone." }, gone);
    }
    case "reminder_when": {
      if (action.eventId) {
        // Edit: a new time for the same reminder; its repeat stays.
        const r = await updateEvent(ctx.profileId, action.eventId, { startDay: action.day, endDay: action.day, startTime: action.time, endTime: null }, ctx.now);
        if (!r.ok) return done("reminder_edit", { text: r.error === "not_found" ? "That reminder was already gone." : r.message }, false);
        return done("reminder_edit", savedReply(action.eventId, action.title, dayLabel(ctx, action.day, action.time)));
      }
      return done("reminder_when", repeatReply(action.title, action.day, action.time));
    }
    case "reminder_save": {
      const zone = resolveTimezone(ctx.timezone);
      const repeat = action.repeat === "none" ? null : action.repeat === "weekdays" ? { freq: "weekly" as const, days: [1, 2, 3, 4, 5] } : { freq: action.repeat };
      const r = await createEvent(ctx.profileId, {
        title: action.title, category: "personal", allDay: false, startDay: action.day, endDay: null, startTime: action.time, endTime: null,
        timezone: zone, reminderMinutes: 0, repeat, clientKey: `tg:${action.day}:${action.time}:${action.repeat}:${action.title}`.slice(0, 120),
      }, ctx.now);
      if (!r.ok) return done("reminder_save", { text: `I couldn't save that: ${r.message}` }, false);
      // Said from the first time it will really be sent: a weekday series
      // made on a Saturday starts on Monday.
      const first = r.event.reminder?.at ? dayKey(new Date(r.event.reminder.at), zone) : action.day;
      const label = action.repeat === "none" ? dayLabel(ctx, first, action.time) : `${clock12(action.time)}${REPEAT_WORDS[action.repeat]}, starting ${dayLabel(ctx, first, action.time).split(" at ")[0]}`;
      return done("reminder_save", savedReply(r.event.id, action.title, label));
    }
  }
}
