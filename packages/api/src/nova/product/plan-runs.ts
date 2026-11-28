// ─── Plan your time: runs, undo, clear, settings (28 Nov) ────────────────────
// The only code that reads or writes NovaPlanRun and NovaAcademicProfile.
// planSettings. Calendar events are written through calendar.ts only.
//
//   proposal  calendar-planner.ts works it out; nothing is written
//   apply     the blocks the learner kept, re-checked here against the
//             calendar as it is now (still theirs, still open, still free,
//             still in the future, still under the day's cap), created in
//             one transaction as auto blocks of one run
//   undo      the run's blocks go, except ones the learner changed and ones
//             already under way or over; idempotent
//   clear     every auto block in a range, by the same rule, counted first
//
// Removing a block retires its Telegram reminder by itself: the reminder
// belongs to the event, and an event that is gone sends nothing
// (proactive/event-reminders.ts). Tasks are never touched: one with no block
// ahead is back in Needs time with its own due day and estimate.

import { prisma } from "@repo/db/client";
import { dayKey, dayKeyOfNumber, dayNumber, resolveTimezone, zonedInstant } from "../engines/learner-calendar";
import { createAutoBlocks, loadCalendar, removeAutoBlocks, type AutoRemoval } from "./calendar";
import { DEFAULT_PLAN, type PlanSettings } from "./calendar-plan";
import { listTasks } from "./tasks";

// ── Settings ──────────────────────────────────────────────────────────────────

export interface PlanSettingsInput { dayStart: number; dayEnd: number; focusPerDay: number; bufferMinutes: number; avoidDays: number[] }
const int = (v: unknown, lo: number, hi: number): number | undefined => (typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : undefined);

export function checkPlanSettings(raw: unknown): PlanSettings {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const dayStart = int(r.dayStart, 0, 22 * 60) ?? DEFAULT_PLAN.dayStart;
  const dayEnd = int(r.dayEnd, dayStart + 60, 24 * 60) ?? Math.max(DEFAULT_PLAN.dayEnd, dayStart + 60);
  const avoid = Array.isArray(r.avoidDays) ? [...new Set(r.avoidDays.filter((d): d is number => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6))].sort() : [];
  return {
    dayStart, dayEnd,
    focusPerDay: int(r.focusPerDay, 30, 12 * 60) ?? DEFAULT_PLAN.focusPerDay,
    bufferMinutes: int(r.bufferMinutes, 0, 60) ?? DEFAULT_PLAN.bufferMinutes,
    horizonDays: DEFAULT_PLAN.horizonDays,
    avoidDays: avoid.length === 7 ? [] : avoid,
  };
}

export async function loadPlanSettings(profileId: string): Promise<PlanSettings> {
  const row = await prisma.novaAcademicProfile.findUnique({ where: { id: profileId }, select: { planSettings: true } });
  return checkPlanSettings(row?.planSettings ?? null);
}

export async function savePlanSettings(profileId: string, raw: unknown): Promise<PlanSettings> {
  const s = checkPlanSettings(raw);
  await prisma.novaAcademicProfile.update({ where: { id: profileId }, data: { planSettings: JSON.parse(JSON.stringify(s)) as object } });
  return s;
}

// ── Apply ─────────────────────────────────────────────────────────────────────

export interface ApplyBlock { taskId: string; startAt: string; endAt: string }
export type ApplyResult =
  | { ok: true; runId: string; placed: number; days: number; skipped: Array<{ taskId: string; reason: string }> }
  | { ok: false; error: "invalid" | "nothing"; message: string };

export async function applyPlanRun(profileId: string, input: { scope?: unknown; blocks?: unknown; unplaced?: unknown; remind: boolean }, now = new Date()): Promise<ApplyResult> {
  if (!Array.isArray(input.blocks) || input.blocks.length === 0 || input.blocks.length > 50) return { ok: false, error: "invalid", message: "Nothing to apply." };
  const scope = input.scope === "one" ? "one" : "all";
  const asked = input.blocks.flatMap((b: unknown) => {
    const x = b as Partial<ApplyBlock>;
    const start = typeof x?.startAt === "string" ? new Date(x.startAt) : null, end = typeof x?.endAt === "string" ? new Date(x.endAt) : null;
    return typeof x?.taskId === "string" && start && end && !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end > start && end.getTime() - start.getTime() <= 4 * 3_600_000
      ? [{ taskId: x.taskId, start, end }] : [];
  });
  const settings = await loadPlanSettings(profileId);
  const tasks = await listTasks(profileId, { now });
  const open = new Map(tasks.tasks.filter(t => t.status !== "done").map(t => [t.id, t]));
  const t0 = dayNumber(tasks.today);
  const cal = await loadCalendar(profileId, dayKeyOfNumber(t0), dayKeyOfNumber(t0 + DEFAULT_PLAN.horizonDays), now);
  if (!cal.ok) return { ok: false, error: "invalid", message: cal.message };
  const tz = resolveTimezone(cal.view.timezone);
  const taken = cal.view.events.filter(e => !e.allDay && e.startAt && e.endAt).map(e => ({ s: Date.parse(e.startAt!), e: Date.parse(e.endAt!), study: !!(e.task || e.category === "study") }));
  const studyOn = new Map<string, number>();
  for (const t of taken) if (t.study) { const d = dayKey(new Date(t.s), tz); studyOn.set(d, (studyOn.get(d) ?? 0) + (t.e - t.s) / 60_000); }
  // Tasks that already have a block ahead are not given a second.
  const ahead = new Set(cal.view.events.filter(e => e.task && e.endAt && Date.parse(e.endAt) > now.getTime()).map(e => e.task!.id));

  const keep: Array<{ taskId: string; title: string; subjectId: string | null; start: Date; end: Date }> = [];
  const skipped: Array<{ taskId: string; reason: string }> = [];
  for (const b of asked) {
    const task = open.get(b.taskId);
    const day = dayKey(b.start, tz);
    const minutes = (b.end.getTime() - b.start.getTime()) / 60_000;
    const inHours = b.start >= zonedInstant(day, settings.dayStart, tz) && b.end <= zonedInstant(day, settings.dayEnd, tz);
    const clash = taken.some(t => b.start.getTime() < t.e && t.s < b.end.getTime());
    const why = !task ? "It isn't an open task of yours any more."
      : ahead.has(b.taskId) || keep.some(k => k.taskId === b.taskId) ? "It already has time set aside."
      : b.start <= now ? "That time has passed."
      : !inHours ? "Outside your working hours."
      : clash ? "Something else is on the calendar then."
      : (studyOn.get(day) ?? 0) + minutes > settings.focusPerDay ? "Over your daily limit."
      : null;
    if (why) { skipped.push({ taskId: b.taskId, reason: why }); continue; }
    keep.push({ taskId: b.taskId, title: task!.title, subjectId: task!.subjectId ?? null, start: b.start, end: b.end });
    taken.push({ s: b.start.getTime(), e: b.end.getTime(), study: true });
    studyOn.set(day, (studyOn.get(day) ?? 0) + minutes);
  }
  if (keep.length === 0) return { ok: false, error: "nothing", message: skipped[0]?.reason ?? "Nothing could be placed." };

  const run = await prisma.novaPlanRun.create({
    data: { profileId, scope, eventIds: [], placed: 0, unplaced: Array.isArray(input.unplaced) ? JSON.parse(JSON.stringify(input.unplaced.slice(0, 60))) as object : undefined },
    select: { id: true },
  });
  try {
    const ids = await createAutoBlocks(profileId, run.id, keep, tz, input.remind, now);
    await prisma.novaPlanRun.update({ where: { id: run.id }, data: { eventIds: ids, placed: ids.length } });
    return { ok: true, runId: run.id, placed: ids.length, days: new Set(keep.map(k => dayKey(k.start, tz))).size, skipped };
  } catch (err) {
    // Nothing was created (one transaction): the empty run goes too.
    await prisma.novaPlanRun.delete({ where: { id: run.id } }).catch(() => {});
    throw err;
  }
}

// ── Undo, clear, unschedule ───────────────────────────────────────────────────

export type RemovalResult = { ok: true; already?: boolean } & AutoRemoval | { ok: false; error: "not_found"; message: string };

export async function undoPlanRun(profileId: string, runId: string, now = new Date()): Promise<RemovalResult> {
  const run = await prisma.novaPlanRun.findFirst({ where: { id: runId, profileId }, select: { id: true, undoneAt: true } });
  if (!run) return { ok: false, error: "not_found", message: "That plan isn't there any more." };
  if (run.undoneAt) return { ok: true, already: true, removed: [], kept: 0, started: 0 };
  // Claimed first: two undos at once remove once.
  const claimed = await prisma.novaPlanRun.updateMany({ where: { id: runId, profileId, undoneAt: null }, data: { undoneAt: now } });
  if (claimed.count !== 1) return { ok: true, already: true, removed: [], kept: 0, started: 0 };
  const r = await removeAutoBlocks(profileId, { planRunId: runId }, now);
  await prisma.novaPlanRun.update({ where: { id: runId }, data: { undo: { removed: r.removed.length, kept: r.kept, started: r.started } } });
  return { ok: true, ...r };
}

// "This week": from now to the end of the learner's Sunday. "Everything
// ahead": from now on. preview counts and removes nothing.
export async function clearAutoBlocks(profileId: string, range: unknown, preview: boolean, now = new Date()): Promise<RemovalResult | { ok: false; error: "invalid"; message: string }> {
  if (range !== "week" && range !== "ahead") return { ok: false, error: "invalid", message: "Choose this week or everything ahead." };
  let to: Date | undefined;
  if (range === "week") {
    const tasks = await listTasks(profileId, { now });
    const cal = await loadCalendar(profileId, tasks.today, tasks.today, now);
    const tz = resolveTimezone(cal.ok ? cal.view.timezone : null);
    const today = dayKey(now, tz);
    const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
    to = zonedInstant(dayKeyOfNumber(dayNumber(today) + (7 - dow) % 7 + 1), 0, tz);
  }
  const r = await removeAutoBlocks(profileId, { from: now, to }, now, preview);
  return { ok: true, ...r };
}

export async function unscheduleBlock(profileId: string, eventId: string, now = new Date()): Promise<RemovalResult> {
  const r = await removeAutoBlocks(profileId, { ids: [eventId] }, now);
  if (r.removed.length === 0 && r.kept === 0 && r.started === 0) return { ok: false, error: "not_found", message: "That block isn't one Kivo placed." };
  return { ok: true, ...r };
}

// The last five runs, with what is still on the calendar from each.
export async function recentRuns(profileId: string): Promise<Array<{ id: string; createdAt: string; scope: string; placed: number; remaining: number; undoneAt: string | null }>> {
  const runs = await prisma.novaPlanRun.findMany({ where: { profileId }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, createdAt: true, scope: true, placed: true, undoneAt: true } });
  const counts = await prisma.novaCalendarEvent.groupBy({ by: ["planRunId"], where: { profileId, planRunId: { in: runs.map(r => r.id) } }, _count: { _all: true } });
  const left = new Map(counts.map(c => [c.planRunId, c._count._all]));
  return runs.map(r => ({ id: r.id, createdAt: r.createdAt.toISOString(), scope: r.scope, placed: r.placed, remaining: left.get(r.id) ?? 0, undoneAt: r.undoneAt?.toISOString() ?? null }));
}
