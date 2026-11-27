// Bug batch 28 Nov, item 1: sessions closed as "abandoned" while paused,
// before paused sessions were saved instead. Each becomes what the sweep now
// makes of it: completed, with the study time on its clock at the pause (the
// clock stopped there), marked executionReport.autoClosed with backfilled.
//
// Idempotent: only rows still "abandoned" with a pause on record are touched,
// each by a conditional update on exactly that. Nothing is deleted; the pause
// fields and every other column stay as they are. Dry run by default.

import { prisma } from "@repo/db/client";
import { AUTO_SAVED_PAUSED, pausedSecondsOf, ABANDONED_STATUS } from "../engines/session-clock";
import { COUNTED_SESSION_MINUTES } from "../engines/study-session-engine";

export const BACKFILL_MARK = "2026-11-28";

export interface PausedBackfillResult {
  candidates:        number;   // abandoned while paused
  saved:             number;   // written (0 on a dry run)
  wouldCount:        number;   // ten minutes or more: Progress will count them
  underTen:          number;
  minutesRecovered:  number;   // sum of the study minutes they get
  learners:          number;
  sample:            Array<{ id: string; profileId: string; minutesNow: number; minutesAfter: number }>;
}

// Study minutes up to the pause: wall time from start to the pause, less the
// earlier pauses. Never negative, never made up.
export function studiedAtPause(row: { sessionDate: Date; pausedAt: Date; totalPausedSeconds: number; totalPausedMinutes: number }): number {
  const wall = (row.pausedAt.getTime() - row.sessionDate.getTime()) / 1000 - pausedSecondsOf(row);
  return Number.isFinite(wall) ? Math.max(0, Math.floor(wall / 60)) : 0;
}

export async function backfillPausedAbandoned(opts: { apply: boolean; profileId?: string }): Promise<PausedBackfillResult> {
  const rows = await prisma.novaStudySession.findMany({
    where:  { status: ABANDONED_STATUS, pausedAt: { not: null }, ...(opts.profileId ? { profileId: opts.profileId } : {}) },
    select: { id: true, profileId: true, sessionDate: true, pausedAt: true, totalPausedSeconds: true, totalPausedMinutes: true, durationMinutes: true },
    orderBy: { sessionDate: "asc" },
  });
  const out: PausedBackfillResult = { candidates: rows.length, saved: 0, wouldCount: 0, underTen: 0, minutesRecovered: 0, learners: new Set(rows.map(r => r.profileId)).size, sample: [] };
  for (const r of rows) {
    const minutes = studiedAtPause({ ...r, pausedAt: r.pausedAt! });
    if (minutes >= COUNTED_SESSION_MINUTES) out.wouldCount++; else out.underTen++;
    out.minutesRecovered += minutes;
    if (out.sample.length < 15) out.sample.push({ id: r.id, profileId: r.profileId, minutesNow: r.durationMinutes, minutesAfter: minutes });
    if (!opts.apply) continue;
    const done = await prisma.novaStudySession.updateMany({
      where: { id: r.id, status: ABANDONED_STATUS, pausedAt: r.pausedAt },
      data:  { status: "completed", durationMinutes: minutes, executionReport: { autoClosed: AUTO_SAVED_PAUSED, pausedAt: r.pausedAt!.toISOString(), backfilled: BACKFILL_MARK } },
    });
    out.saved += done.count;
  }
  return out;
}
