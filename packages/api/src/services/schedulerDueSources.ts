// ─── Upcoming Nova work, read once after a full tick ──────────────────────────
// What the scheduler needs to know, until its next full tick, about Nova work
// that will come due (services/schedulerIdle.ts). Each part is read by the
// module that owns the table, with the same conditions as the job that acts
// on it, so a moment this calls due is a moment that job would act.
//
// Nova only: the legacy Rex jobs (dynamic check-ins, custom reminders, gym)
// are not predicted. Five small queries after a full tick, in parallel. A
// failure of any one fails the read, and the next tick runs in full.

import { upcomingEventReminderWindows } from "../nova/proactive/event-reminders";
import { consolidationRetryTimes } from "../nova/consolidation/stores/consolidation-job-store";
import { processingDueTimes } from "../nova/product/learning-events";
import { openSessionsForSweep } from "../nova/persistence/nova-persistence";
import type { DueSources, DueWindow } from "./schedulerIdle";

// Due from `at` until a full tick deals with it.
const open = (source: string) => (at: Date): DueWindow => ({ source, from: at.getTime(), until: null });

export async function loadDueSources(now: Date): Promise<DueSources> {
  const [calendar, consolidation, pages, sessions] = await Promise.all([
    upcomingEventReminderWindows(now),
    consolidationRetryTimes(),
    processingDueTimes(),
    openSessionsForSweep(),
  ]);
  return {
    windows: [
      // From the reminder moment to the end of its grace (exclusive), as the
      // "come due" query selects it; retries likewise inside their window.
      ...calendar.map(w => ({ source: "calendar_reminder", from: w.from.getTime(), until: w.until.getTime() })),
      ...consolidation.map(open("consolidation_retry")),
      ...pages.map(open("saved_page")),
    ],
    sessions,
  };
}
