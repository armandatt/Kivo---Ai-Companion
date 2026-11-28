// ─── Plan notifications: the rules (Telegram launch, 28 Nov) ─────────────────
// Pure: no database, no clock of its own, no model. Held by
// plan-reminder-rules.test.ts. The job that uses them is plan-reminders.ts.
//
//   A block with a time    one occurrence at its local start time; blocks at
//                          the same time are one message
//   Blocks with an order   at the learner's check-in time, the first eligible
//                          block; no check-in time, no automatic prompt
//   "If there's time"      (status later) never prompts by itself
//   Started, done, removed never prompts

import { zonedInstant } from "../engines/learner-calendar";
import type { FlowItem } from "../product/day-flow.types";
import type { Occurrence, OccurrenceItem, PlanSlot } from "../product/reminder-occurrences";
import type { InlineButton } from "../telegram/telegram.types";

export const MESSAGE_ITEMS_MAX = 3;

const HHMM = (at: string): number | null => {
  const [h, m] = at.split(":").map(Number);
  return Number.isInteger(h) && Number.isInteger(m) && h! >= 0 && h! < 24 && m! >= 0 && m! < 60 ? h! * 60 + m! : null;
};

export function itemOf(i: FlowItem): OccurrenceItem {
  return { id: i.id, title: i.title, minutes: i.minutes, taskId: i.taskId, topicId: i.topicId };
}

// The first instant of the day after `day` in the zone: when the day's
// buttons stop acting.
export function dayEnd(day: string, timezone: string): Date {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  return zonedInstant(next, 0, timezone);
}

export function slotsFor(items: FlowItem[], day: string, timezone: string, checkinMinute: number | null): PlanSlot[] {
  const expiresAt = dayEnd(day, timezone);
  const planned = items.filter(i => i.status === "planned");
  const byTime = new Map<string, FlowItem[]>();
  for (const i of planned) {
    if (!i.at || HHMM(i.at) === null) continue;
    byTime.set(i.at, [...(byTime.get(i.at) ?? []), i]);
  }
  const slots: PlanSlot[] = [...byTime.entries()].map(([at, group]) => ({
    slotKey: `at:${at}`, items: group.map(itemOf), blockAt: at, dueAt: zonedInstant(day, HHMM(at)!, timezone), expiresAt,
  }));
  // The order: the first untimed block, at check-in. Only when there is one,
  // and only when the learner chose a check-in time.
  const untimed = planned.filter(i => !i.at);
  if (untimed.length > 0 && checkinMinute !== null) {
    slots.push({ slotKey: "checkin", items: [itemOf(untimed[0]!)], blockAt: null, dueAt: zonedInstant(day, checkinMinute, timezone), expiresAt });
  }
  return slots.sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
}

// "18:00" → "6:00 PM".
export function clock12(at: string): string {
  const minute = HHMM(at) ?? 0;
  const h = Math.floor(minute / 60), m = minute % 60;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

export function startMinutes(i: Pick<OccurrenceItem, "minutes">): number {
  return Math.max(5, Math.min(240, Math.round(i.minutes ?? 25)));
}

const minutesWord = (n: number) => `${n} minute${n === 1 ? "" : "s"}`;

// The message and its buttons. `offer` is what is still eligible now, which
// is what the message names (not what was scheduled). `when` is the local
// time it speaks of ("18:00").
export function reminderMessage(o: Pick<Occurrence, "id" | "source" | "slotKey">, offer: OccurrenceItem[], when: string): { text: string; buttons: InlineButton[][] } {
  const shown = offer.slice(0, MESSAGE_ITEMS_MAX);
  const list = shown.map(i => `${i.title}, ${minutesWord(startMinutes(i))}`).join("; ");
  const lead = o.source === "carried" ? "Reminder from yesterday" : o.source === "later" ? `${clock12(when)} · Reminder` : o.slotKey === "checkin" ? `${clock12(when)} · Next on your plan` : `${clock12(when)} · Your plan`;
  const text = `${lead}: ${list}. Ready to start?`;
  const starts: InlineButton[][] = shown.length === 1
    ? [[{ text: `Start ${startMinutes(shown[0]!)} min`, callback_data: reminderCallback(o.id, "s0") }]]
    : shown.map((i, n) => [{ text: `Start ${i.title.slice(0, 24)} · ${startMinutes(i)} min`, callback_data: reminderCallback(o.id, `s${n}`) }]);
  return {
    text,
    buttons: [...starts, [
      { text: "Remind me later", callback_data: reminderCallback(o.id, "l") },
      { text: "Skip this block", callback_data: reminderCallback(o.id, "k") },
    ]],
  };
}

// ── Buttons on a reminder: "r:<occurrenceId>:<code>" ─────────────────────────
// Not a prompt: a reminder's buttons stay usable while its block is eligible
// (until local day end), whatever Nova said since. Every tap re-reads the
// occurrence and the plan before it acts.
//   s<n>   start the n-th block it offered
//   l      Remind me later: 15 min / 1 hour / Pick a time
//   l<m>   snooze m minutes
//   p      pick a time
//   a<hhmm> snooze to that local time today
//   t      tomorrow, same time
//   k      skip this block (today's occurrence only)
export type ReminderCode = { kind: "start"; index: number } | { kind: "later_menu" } | { kind: "snooze"; minutes: number }
  | { kind: "pick" } | { kind: "at"; at: string } | { kind: "tomorrow" } | { kind: "skip" };

export const reminderCallback = (occurrenceId: string, code: string) => `r:${occurrenceId}:${code}`;

const digits = (s: string) => s.length > 0 && [...s].every(c => c >= "0" && c <= "9");

export function decodeReminderCallback(data: string): { occurrenceId: string; code: ReminderCode } | null {
  const parts = data.split(":");
  if (parts.length !== 3 || parts[0] !== "r") return null;
  const [, id, raw] = parts as [string, string, string];
  if (!id || id.length > 40 || !raw || raw.length > 8) return null;
  const head = raw[0], rest = raw.slice(1);
  if (head === "s" && digits(rest) && Number(rest) < MESSAGE_ITEMS_MAX) return { occurrenceId: id, code: { kind: "start", index: Number(rest) } };
  if (raw === "l") return { occurrenceId: id, code: { kind: "later_menu" } };
  if (head === "l" && digits(rest) && (rest === "15" || rest === "60")) return { occurrenceId: id, code: { kind: "snooze", minutes: Number(rest) } };
  if (raw === "p") return { occurrenceId: id, code: { kind: "pick" } };
  if (head === "a" && digits(rest) && rest.length === 4 && HHMM(`${rest.slice(0, 2)}:${rest.slice(2)}`) !== null) return { occurrenceId: id, code: { kind: "at", at: `${rest.slice(0, 2)}:${rest.slice(2)}` } };
  if (raw === "t") return { occurrenceId: id, code: { kind: "tomorrow" } };
  if (raw === "k") return { occurrenceId: id, code: { kind: "skip" } };
  return null;
}

// Times on offer for "Pick a time": the next whole and half hours at least
// 30 minutes ahead, up to three, before the day ends, then Tomorrow.
export function pickTimes(nowMinuteOfDay: number): string[] {
  const out: string[] = [];
  for (let t = Math.ceil((nowMinuteOfDay + 30) / 30) * 30; out.length < 3 && t < 24 * 60; t += 60) {
    out.push(`${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`);
  }
  return out;
}

// Which of the occurrence's blocks are still eligible in the plan as it is
// now: present, planned (not started, done or moved to "If there's time").
// A carried reminder is matched by what it points at, on the new day's plan.
export function stillEligible(o: Pick<Occurrence, "items" | "source">, current: FlowItem[]): OccurrenceItem[] {
  const planned = current.filter(i => i.status === "planned");
  // A topic offered from the planner's plan: nothing on the flow to check.
  const offered = o.items.filter(i => i.id.startsWith("offer:"));
  if (offered.length > 0) return offered;
  if (o.source === "carried") {
    return o.items.flatMap(want => {
      const hit = planned.find(i => (want.taskId && i.taskId === want.taskId) || (want.topicId && i.topicId === want.topicId) || (!want.taskId && !want.topicId && i.title === want.title));
      return hit ? [itemOf(hit)] : [];
    });
  }
  return o.items.flatMap(want => {
    const hit = planned.find(i => i.id === want.id);
    return hit ? [itemOf(hit)] : [];
  });
}
