// ─── Reminder occurrences (Telegram launch, 28 Nov) ──────────────────────────
// The only code that reads or writes NovaReminderOccurrence: each time Nova
// will send a plan prompt on Telegram, and where that time stands.
//
//   source day_plan  a block of the plan the learner applied today, at its
//                    time (slot "at:HH:MM", blocks at one time share it), or
//                    the first untimed block at their check-in (slot "checkin")
//   source later     the learner's "Remind me later" on an offer
//   source carried   "Tomorrow": the same reminder, next day, re-checked
//                    against that day's plan before it offers Start
//
// The schedule is the plan. syncPlanDay works out the day's slots from the
// flow every tick and reconciles: a slot whose block moved, went or was done
// is superseded (with any snooze on it: a newer explicit change on the web
// wins), a slot that is still there keeps its state and snooze (a title edit
// changes nothing). Snoozing moves dueAt on the row and never the plan.
// Delivery is claimed in the outbox, one claim per due moment.

import { prisma } from "@repo/db/client";

export type OccurrenceSource = "day_plan" | "later" | "carried";
export type OccurrenceState =
  | "scheduled" | "deferred" | "sent" | "started" | "dismissed" | "expired" | "superseded" | "failed" | "unknown" | "undeliverable";
// Still waiting to go out.
export const PENDING: OccurrenceState[] = ["scheduled", "deferred", "failed"];
// Its buttons may still act: waiting, or sent and not yet answered.
export const ACTIONABLE: OccurrenceState[] = ["scheduled", "deferred", "failed", "sent", "unknown"];

// id: the flow item's id, or "offer:<n>" for a topic Nova offered from the
// planner's plan (no flow item), started by topic and subject.
export interface OccurrenceItem { id: string; title: string; minutes: number | null; taskId: string | null; topicId: string | null; subjectName?: string | null }

export interface Occurrence {
  id: string; profileId: string; source: OccurrenceSource; day: string; slotKey: string; items: OccurrenceItem[];
  blockAt: string | null; timezone: string; originalAt: Date; dueAt: Date; explicit: boolean; state: OccurrenceState;
  snoozes: number; sentCount: number; messageId: number | null; sentAt: Date | null; lastError: string | null; expiresAt: Date;
}

const SELECT = {
  id: true, profileId: true, source: true, day: true, slotKey: true, items: true, blockAt: true, timezone: true, originalAt: true,
  dueAt: true, explicit: true, state: true, snoozes: true, sentCount: true, messageId: true, sentAt: true, lastError: true, expiresAt: true,
} as const;

type Row = { [K in keyof typeof SELECT]: unknown };
function toOccurrence(r: Row): Occurrence {
  const items = Array.isArray(r.items) ? (r.items as OccurrenceItem[]).filter(i => i && typeof i.id === "string") : [];
  return { ...(r as unknown as Occurrence), items };
}

const json = (items: OccurrenceItem[]) => JSON.parse(JSON.stringify(items)) as object;

// ── The day's plan slots ─────────────────────────────────────────────────────

export interface PlanSlot {
  slotKey:   string;            // at:HH:MM | checkin
  items:     OccurrenceItem[];
  blockAt:   string | null;
  dueAt:     Date;
  expiresAt: Date;
}

// Makes the day's occurrences match its slots. Creates the missing ones,
// supersedes waiting ones whose slot is gone, and refreshes the items of the
// rest (a title edit, a second block at the same time) without touching their
// state or snooze. Only day_plan rows of that day; later and carried ones
// belong to the learner's own request.
export async function syncPlanDay(profileId: string, day: string, timezone: string, slots: PlanSlot[], startedItemIds: ReadonlySet<string>, now: Date): Promise<{ created: number; superseded: number }> {
  const existing = await prisma.novaReminderOccurrence.findMany({
    where: { profileId, day, source: "day_plan" }, select: { id: true, slotKey: true, state: true, items: true, originalAt: true, timezone: true },
  });
  const have = new Map(existing.map(e => [e.slotKey, e]));
  const want = new Map(slots.map(s => [s.slotKey, s]));
  let created = 0, superseded = 0;
  const fresh = slots.filter(s => !have.has(s.slotKey) && s.dueAt.getTime() > now.getTime() - DUE_GRACE_MS);
  if (fresh.length > 0) {
    const r = await prisma.novaReminderOccurrence.createMany({
      data: fresh.map(s => ({
        profileId, source: "day_plan", day, slotKey: s.slotKey, items: json(s.items), blockAt: s.blockAt, timezone,
        originalAt: s.dueAt, dueAt: s.dueAt, explicit: true, state: "scheduled", expiresAt: s.expiresAt,
      })),
      skipDuplicates: true,
    });
    created = r.count;
  }
  for (const e of existing) {
    const slot = want.get(e.slotKey);
    // Its block came back to this time after the slot was superseded: the
    // learner's latest schedule is the one that holds.
    if (e.state === "superseded" && slot && slot.dueAt.getTime() > now.getTime()) {
      await prisma.novaReminderOccurrence.updateMany({
        where: { id: e.id, state: "superseded" },
        data: { state: "scheduled", items: json(slot.items), dueAt: slot.dueAt, originalAt: slot.dueAt, blockAt: slot.blockAt, expiresAt: slot.expiresAt, lastError: null },
      });
      continue;
    }
    if (!(PENDING as string[]).includes(e.state) && e.state !== "sent") continue;
    if (!slot) {
      // Its block moved, went, was done or was started: what it would say is
      // no longer the plan. A sent one's buttons re-check the plan anyway.
      if (e.state === "sent") continue;
      const items = Array.isArray(e.items) ? e.items as unknown as OccurrenceItem[] : [];
      const started = items.some(i => startedItemIds.has(i.id));
      const r = await prisma.novaReminderOccurrence.updateMany({
        where: { id: e.id, state: { in: PENDING } }, data: started ? { state: "started", lastError: null } : { state: "superseded", lastError: "plan changed" },
      });
      superseded += r.count;
      continue;
    }
    // The learner's timezone changed since this was scheduled: a time not yet
    // snoozed moves to the block's time in the new zone. A snooze is a moment
    // the learner chose and stays.
    if (e.state === "scheduled" && (e.originalAt.getTime() !== slot.dueAt.getTime() || e.timezone !== timezone)) {
      await prisma.novaReminderOccurrence.updateMany({ where: { id: e.id, state: "scheduled" }, data: { originalAt: slot.dueAt, dueAt: slot.dueAt, timezone, expiresAt: slot.expiresAt, items: json(slot.items) } });
      continue;
    }
    if (JSON.stringify(e.items) !== JSON.stringify(slot.items)) {
      await prisma.novaReminderOccurrence.updateMany({ where: { id: e.id, state: e.state }, data: { items: json(slot.items) } });
    }
  }
  return { created, superseded };
}

// "Remind me later" on an offer that had no occurrence (/today's Later).
// Made when Later is tapped, as an offer already seen ("sent"): it goes out
// only once the learner picks when (snoozeOccurrence).
export async function createLater(profileId: string, input: { day: string; timezone: string; items: OccurrenceItem[]; expiresAt: Date }, now: Date): Promise<Occurrence> {
  const row = await prisma.novaReminderOccurrence.create({
    data: {
      profileId, source: "later", day: input.day, slotKey: `later:${now.getTime()}:${Math.random().toString(36).slice(2, 6)}`, items: json(input.items), blockAt: null,
      timezone: input.timezone, originalAt: now, dueAt: now, explicit: true, state: "sent", sentAt: now, expiresAt: input.expiresAt,
    },
    select: SELECT,
  });
  return toOccurrence(row);
}

// ── Reading ──────────────────────────────────────────────────────────────────

export const DUE_GRACE_MS = 30 * 60_000;   // later than this, a reminder is missed, not sent

export async function getOccurrence(profileId: string, id: string): Promise<Occurrence | null> {
  const row = await prisma.novaReminderOccurrence.findFirst({ where: { id, profileId }, select: SELECT });
  return row ? toOccurrence(row) : null;
}

export async function dueOccurrences(now: Date, take = 200): Promise<Occurrence[]> {
  const rows = await prisma.novaReminderOccurrence.findMany({
    where: { state: { in: PENDING }, dueAt: { lte: now, gt: new Date(now.getTime() - DUE_GRACE_MS) } },
    orderBy: [{ dueAt: "asc" }, { id: "asc" }], take, select: SELECT,
  });
  return rows.map(toOccurrence);
}

// When the next occurrence is due, for the scheduler's precise timer and its
// "is anything due" check. Every waiting one inside its grace counts.
export async function occurrenceWindows(now: Date): Promise<Array<{ from: Date; until: Date }>> {
  const rows = await prisma.novaReminderOccurrence.findMany({
    where: { state: { in: PENDING }, dueAt: { gt: new Date(now.getTime() - DUE_GRACE_MS) } },
    orderBy: { dueAt: "asc" }, take: 2000, select: { dueAt: true },
  });
  return rows.map(r => ({ from: r.dueAt, until: new Date(r.dueAt.getTime() + DUE_GRACE_MS) }));
}

// Only moments still ahead: a failed send is retried by the regular tick, so
// a timer never spins on one that is already due.
export async function nextDueAt(now: Date): Promise<Date | null> {
  const row = await prisma.novaReminderOccurrence.findFirst({
    where: { state: { in: ["scheduled", "deferred"] }, dueAt: { gt: now } },
    orderBy: { dueAt: "asc" }, select: { dueAt: true },
  });
  return row?.dueAt ?? null;
}

// The learner's upcoming and recent occurrences, for the Telegram page.
export async function occurrencesFor(profileId: string, now: Date): Promise<{ upcoming: Occurrence[]; recent: Occurrence[] }> {
  const [upcoming, recent] = await Promise.all([
    prisma.novaReminderOccurrence.findMany({
      where: { profileId, state: { in: PENDING }, dueAt: { gt: new Date(now.getTime() - DUE_GRACE_MS) } }, orderBy: { dueAt: "asc" }, take: 20, select: SELECT,
    }),
    prisma.novaReminderOccurrence.findMany({
      where: { profileId, state: { notIn: PENDING }, updatedAt: { gt: new Date(now.getTime() - 3 * 86_400_000) } }, orderBy: { updatedAt: "desc" }, take: 15, select: SELECT,
    }),
  ]);
  return { upcoming: upcoming.map(toOccurrence), recent: recent.map(toOccurrence) };
}

// ── Changing one ─────────────────────────────────────────────────────────────

// Moves an occurrence from one of `from` to `to`, guarded: of two ticks or
// two taps, one does it. true when this call did.
export async function moveOccurrence(id: string, from: OccurrenceState[], to: OccurrenceState, extra: { lastError?: string | null; messageId?: number; sentAt?: Date; sentCount?: "increment" } = {}): Promise<boolean> {
  const r = await prisma.novaReminderOccurrence.updateMany({
    where: { id, state: { in: from } },
    data: {
      state: to,
      ...(extra.lastError !== undefined ? { lastError: extra.lastError } : {}),
      ...(extra.messageId !== undefined ? { messageId: extra.messageId } : {}),
      ...(extra.sentAt ? { sentAt: extra.sentAt } : {}),
      ...(extra.sentCount ? { sentCount: { increment: 1 } } : {}),
    },
  });
  return r.count === 1;
}

// A snooze: the next send moves to `dueAt`. Delivery only; the plan is not
// touched. `carried`: "Tomorrow", re-checked against that day's plan.
export async function snoozeOccurrence(profileId: string, id: string, dueAt: Date, expiresAt: Date, carried: boolean): Promise<Occurrence | null> {
  const r = await prisma.novaReminderOccurrence.updateMany({
    where: { id, profileId, state: { in: ACTIONABLE } },
    data: { dueAt, expiresAt, state: "deferred", snoozes: { increment: 1 }, lastError: null, ...(carried ? { source: "carried" } : {}) },
  });
  return r.count === 1 ? getOccurrence(profileId, id) : null;
}

// Waiting or unanswered ones whose day is over, or whose time passed by more
// than the grace without being sent: expired. Nothing is sent late and no
// backlog is replayed after a pause.
export async function expireOccurrences(now: Date): Promise<number> {
  const [over, missed] = await Promise.all([
    prisma.novaReminderOccurrence.updateMany({ where: { state: { in: ACTIONABLE }, expiresAt: { lte: now } }, data: { state: "expired", lastError: "day over" } }),
    prisma.novaReminderOccurrence.updateMany({ where: { state: { in: PENDING }, dueAt: { lte: new Date(now.getTime() - DUE_GRACE_MS) } }, data: { state: "expired", lastError: "missed" } }),
  ]);
  return over.count + missed.count;
}

// The learner's waiting occurrences of a day, held (pause, plan nudges off).
export async function holdPending(profileId: string, reason: string): Promise<number> {
  const r = await prisma.novaReminderOccurrence.updateMany({ where: { profileId, state: { in: PENDING }, source: "day_plan" }, data: { state: "expired", lastError: reason } });
  return r.count;
}

// Housekeeping: rows past their day by a week.
export async function purgeOccurrences(now: Date): Promise<number> {
  const r = await prisma.novaReminderOccurrence.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 7 * 86_400_000) } } });
  return r.count;
}
