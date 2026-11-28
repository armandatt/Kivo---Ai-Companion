// ─── Taps on a reminder's buttons (Telegram launch, 28 Nov) ──────────────────
// "r:<occurrenceId>:<code>" (proactive/plan-reminder-rules.ts). A reminder is
// not a prompt: its buttons act while its block is eligible, until the local
// day ends, whatever Nova said since. Every tap re-reads the occurrence and
// the plan first; anything no longer current is said plainly and nothing
// runs. No model, no credits. Starting goes through startItem (day-flow's own
// start), so a double tap or a replay makes one session.

import { dayKey, localHour, localMinute, resolveTimezone, zonedInstant } from "../engines/learner-calendar";
import { savedItemsOn } from "../product/day-flow";
import {
  ACTIONABLE, createLater, getOccurrence, moveOccurrence, snoozeOccurrence, type Occurrence, type OccurrenceItem,
} from "../product/reminder-occurrences";
import { clock12, dayEnd, pickTimes, reminderCallback, startMinutes, stillEligible, type ReminderCode } from "../proactive/plan-reminder-rules";
import { startItem, startSession, type ActionContext, type ActionResult } from "./telegram-actions";
import type { InlineButton, TelegramReply } from "./telegram.types";

const done = (name: string, reply: TelegramReply, ok = true): ActionResult => ({ reply, operation: { name, ok } });

const NOT_CURRENT: Record<string, string> = {
  started:       "That block has already started.",
  dismissed:     "You skipped that block for today.",
  expired:       "That reminder has passed.",
  superseded:    "Your plan changed since, so that reminder is no longer current.",
  undeliverable: "That reminder is no longer current.",
};

const hhmm = (at: Date, zone: string) => `${String(localHour(at, zone)).padStart(2, "0")}:${String(localMinute(at, zone)).padStart(2, "0")}`;

// The fixed lines here, in the learner's language (a button calls no model).
const hi = (ctx: { language: string }) => ctx.language !== "english";

function laterMenu(id: string, hinglish = false): TelegramReply {
  return {
    text: hinglish ? "Kab yaad dilaun?" : "When should I remind you?",
    rows: [[
      { text: "In 15 min", callback_data: reminderCallback(id, "l15") },
      { text: "In 1 hour", callback_data: reminderCallback(id, "l60") },
      { text: "Pick a time", callback_data: reminderCallback(id, "p") },
    ]],
  };
}

function pickMenu(id: string, now: Date, zone: string): TelegramReply {
  const times = pickTimes(localHour(now, zone) * 60 + localMinute(now, zone));
  const rows: InlineButton[][] = [];
  if (times.length > 0) rows.push(times.map(t => ({ text: clock12(t), callback_data: reminderCallback(id, `a${t.replace(":", "")}`) })));
  rows.push([{ text: "Tomorrow, same time", callback_data: reminderCallback(id, "t") }]);
  return { text: "Pick a time:", rows };   // a heading over times: same in both
}

// Later on any offer (a plan block, or a topic from the planner's plan):
// makes the occurrence the menu's buttons will snooze.
export async function offerLater(ctx: ActionContext, items: OccurrenceItem[]): Promise<ActionResult> {
  if (items.length === 0) return done("later", { text: "OK. /today shows your plan whenever you want it." });
  const zone = resolveTimezone(ctx.timezone);
  const day = dayKey(ctx.now, zone);
  const o = await createLater(ctx.profileId, { day, timezone: zone, items, expiresAt: dayEnd(day, zone) }, ctx.now);
  return done("later", laterMenu(o.id, hi(ctx)));
}

export async function runReminderTap(ctx: ActionContext, occurrenceId: string, code: ReminderCode): Promise<ActionResult & { clear: boolean }> {
  const o = await getOccurrence(ctx.profileId, occurrenceId);
  if (!o) return { ...done("reminder", { text: "That reminder is no longer current." }, false), clear: true };
  const zone = resolveTimezone(ctx.timezone ?? o.timezone);
  const today = dayKey(ctx.now, zone);
  if (!(ACTIONABLE as string[]).includes(o.state)) return { ...done("reminder", { text: NOT_CURRENT[o.state] ?? NOT_CURRENT.undeliverable! }, false), clear: true };
  if (o.source !== "carried" && o.day !== today) return { ...done("reminder", { text: NOT_CURRENT.expired! }, false), clear: true };

  switch (code.kind) {
    case "start": return { ...(await start(ctx, o, code.index, today)), clear: true };
    case "later_menu": return { ...done("reminder_later", laterMenu(o.id, hi(ctx))), clear: false };
    case "pick": return { ...done("reminder_pick", pickMenu(o.id, ctx.now, zone)), clear: false };
    case "snooze": return { ...(await snooze(ctx, o, new Date(ctx.now.getTime() + code.minutes * 60_000), zone, false)), clear: true };
    case "at": {
      const [h, m] = code.at.split(":").map(Number) as [number, number];
      const at = zonedInstant(today, h * 60 + m, zone);
      if (at <= ctx.now) return { ...done("reminder_pick", pickMenu(o.id, ctx.now, zone)), clear: false };
      return { ...(await snooze(ctx, o, at, zone, false)), clear: true };
    }
    case "tomorrow": {
      const [y, mo, d] = today.split("-").map(Number) as [number, number, number];
      const next = new Date(Date.UTC(y, mo - 1, d + 1)).toISOString().slice(0, 10);
      const when = o.blockAt ?? hhmm(o.originalAt, zone);
      const [h, m] = when.split(":").map(Number) as [number, number];
      return { ...(await snooze(ctx, o, zonedInstant(next, h * 60 + m, zone), zone, true)), clear: true };
    }
    case "skip": {
      const moved = await moveOccurrence(o.id, ACTIONABLE, "dismissed", { lastError: null });
      return { ...done("reminder_skip", { text: moved ? (hi(ctx) ? "Aaj ke liye skip. Block plan mein rahega." : "Skipped for today. The block stays on your plan.") : "That reminder is no longer current." }, moved), clear: true };
    }
  }
}

async function snooze(ctx: ActionContext, o: Occurrence, at: Date, zone: string, carried: boolean): Promise<ActionResult> {
  const day = dayKey(at, zone);
  const s = await snoozeOccurrence(ctx.profileId, o.id, at, dayEnd(day, zone), carried);
  if (!s) return done("reminder_snooze", { text: "That reminder is no longer current." }, false);
  const when = clock12(hhmm(at, zone));
  const sameDay = day === dayKey(ctx.now, zone);
  return done("reminder_snooze", { text: hi(ctx)
    ? (sameDay ? `Theek hai, ${when} pe yaad dilaunga.` : `Theek hai, kal ${when} pe yaad dilaunga, pehle check karke ki wo kal ke plan mein hai.`)
    : (sameDay ? `OK, I'll remind you at ${when}.` : `OK, I'll remind you tomorrow at ${when}, and check it's still on that day's plan first.`) });
}

async function start(ctx: ActionContext, o: Occurrence, index: number, today: string): Promise<ActionResult> {
  const day = o.source === "carried" ? today : o.day;
  const { items } = await savedItemsOn(o.profileId, day);
  const eligible = stillEligible(o, items);
  const want = o.source === "carried" ? eligible[index] : eligible.find(i => i.id === o.items[index]?.id);
  if (!want) {
    // Started (maybe by the other tap of a double tap, or on the web), done or
    // removed: startItem's own answer covers a session already running.
    const target = o.items[index];
    const live = target ? items.find(i => i.id === target.id) : undefined;
    if (live?.status === "active") return startItem(ctx, { itemId: live.id, minutes: startMinutes(live) });
    return done("session_start", { text: "That block isn't on your plan any more.", link: { label: "Open Today", path: "/home" } }, false);
  }
  const result = want.id.startsWith("offer:")
    ? await startSession(ctx, { topicName: want.title, subjectName: want.subjectName ?? null, minutes: startMinutes(want) })
    : await startItem(ctx, { itemId: want.id, minutes: startMinutes(want) });
  if (result.operation.ok) await moveOccurrence(o.id, ACTIONABLE, "started", { lastError: null });
  return result;
}
