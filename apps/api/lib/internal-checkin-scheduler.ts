import { runCheckinCron, type CheckinCronResult } from "./checkin-cron";
// Production runs the jobs; `next dev` only with ENABLE_INTERNAL_CHECKIN_CRON=true.
//@ts-ignore
import { schedulerEnabled } from "@repo/api/services/schedulerGate";
// Ticks that cannot find work skip the database (SCHEDULER_IDLE_SKIP).
//@ts-ignore
import { IdleScheduler, idleModeOf, type IdleStats } from "@repo/api/services/schedulerIdle";
//@ts-ignore
import { loadDueSources } from "@repo/api/services/schedulerDueSources";
//@ts-ignore
import { runWithoutWriteSignal } from "@repo/db/write-signal";

const CHECKIN_INTERVAL_MS = 5 * 60 * 1000;
const STARTUP_DELAY_MS = 10 * 1000;

type SchedulerGlobal = typeof globalThis & {
  __kevoCheckinSchedulerStarted?: boolean;
  __kevoCheckinSchedulerRunning?: boolean;
  __kevoCheckinLastTickAt?: string;
  __kevoCheckinLastTickOk?: boolean;
  __kevoCheckinStartedAt?: string;
  __kevoCheckinLastNova?: CheckinCronResult["nova"];
  __kevoCheckinDisabledLogged?: boolean;
  __kevoCheckinIdle?: IdleScheduler;
};

// One per process, shared by the timer and the health check (globalThis:
// Next bundles the instrumentation hook and the routes separately).
function idleScheduler(): IdleScheduler {
  const globalState = globalThis as SchedulerGlobal;
  return (globalState.__kevoCheckinIdle ??= new IdleScheduler({
    runFull: async (now: Date) => {
      const result = await runCheckinCron(now);
      globalState.__kevoCheckinLastTickOk = result.ok;
      globalState.__kevoCheckinLastNova   = result.nova;
      return { work: result.work, nova: result.novaOutlooks };
    },
    loadDue: (now: Date) => loadDueSources(now),
    mode:    () => idleModeOf(process.env),
    log:     (line: Record<string, unknown>) => console.log(JSON.stringify(line)),
    quietly: <T,>(work: () => Promise<T>) => runWithoutWriteSignal("scheduler", work),
  }));
}

// A tick is due every five minutes. Three missed in a row means the timer is
// not doing its job, whatever the process says about itself.
const STALE_AFTER_MS = 3 * CHECKIN_INTERVAL_MS + 60_000;

export interface SchedulerStatus {
  // running: this process ticks every five minutes. disabled: it was told
  // not to (DISABLE_INTERNAL_CHECKIN_CRON=true), or it is not production and
  // was not asked to (schedulerEnabled); some other host must.
  state:      "running" | "disabled" | "not_started";
  lastTickAt: string | null;
  lastTickOk: boolean | null;
  // When this process started its timer. A recent time on a host that sleeps
  // means the scheduler was not running before then.
  startedAt:  string | null;
  // running, but no tick for longer than three intervals.
  stale:      boolean;
  // Nova's proactive job on the last full tick: learners looked at, messages
  // sent, and how many ended in each outcome. No learner data.
  nova:       CheckinCronResult["nova"] | null;
  // Skipping the database on idle ticks (services/schedulerIdle.ts): mode,
  // full and skipped ticks, the reasons for the last decision, when work is
  // next due, and how many full ticks found work a skip would have missed.
  // From memory: reading it never touches the database.
  idle:       IdleStats | null;
}

// What this process's scheduler is doing, for the health check. It reports
// only this process: it cannot see whether another host is also ticking.
export function schedulerStatus(): SchedulerStatus {
  const globalState = globalThis as SchedulerGlobal;
  return {
    state: !schedulerEnabled().enabled ? "disabled"
         : globalState.__kevoCheckinSchedulerStarted ? "running" : "not_started",
    lastTickAt: globalState.__kevoCheckinLastTickAt ?? null,
    lastTickOk: globalState.__kevoCheckinLastTickOk ?? null,
    startedAt:  globalState.__kevoCheckinStartedAt ?? null,
    stale:      globalState.__kevoCheckinSchedulerStarted === true
      && Date.now() - new Date(globalState.__kevoCheckinLastTickAt ?? globalState.__kevoCheckinStartedAt ?? Date.now()).getTime() > STALE_AFTER_MS,
    nova:       globalState.__kevoCheckinLastNova ?? null,
    idle:       globalState.__kevoCheckinIdle?.status() ?? null,
  };
}

export function startInternalCheckinScheduler() {
  const globalState = globalThis as SchedulerGlobal;

  const { enabled, reason } = schedulerEnabled();
  if (!enabled) {
    // Said once per process: /api/health calls this on every ping.
    if (!globalState.__kevoCheckinDisabledLogged) console.log(`[CHECKIN] Internal scheduler not started: ${reason}`);
    globalState.__kevoCheckinDisabledLogged = true;
    return;
  }

  if (globalState.__kevoCheckinSchedulerStarted) {
    return;
  }

  globalState.__kevoCheckinSchedulerStarted = true;
  globalState.__kevoCheckinStartedAt = new Date().toISOString();
  console.log(`[CHECKIN] Internal scheduler started; interval=5m; idle skip=${idleModeOf(process.env)}`);

  const tick = async () => {
    if (globalState.__kevoCheckinSchedulerRunning) {
      console.log("[CHECKIN] Previous internal scheduler tick still running; skipping this tick");
      return;
    }

    globalState.__kevoCheckinSchedulerRunning = true;
    try {
      // A full tick, or none at all when nothing can be due
      // (SCHEDULER_IDLE_SKIP=on). The heartbeat below is kept either way, so
      // /api/health/scheduler sees a skipped tick as a live one.
      const { ran } = await idleScheduler().tick(new Date());
      if (!ran) globalState.__kevoCheckinLastTickOk = true;
    } catch (error) {
      globalState.__kevoCheckinLastTickOk = false;
      console.error("[CHECKIN] Internal scheduler tick failed:", error);
    } finally {
      globalState.__kevoCheckinLastTickAt = new Date().toISOString();
      globalState.__kevoCheckinSchedulerRunning = false;
    }
  };

  setTimeout(tick, STARTUP_DELAY_MS);
  setInterval(tick, CHECKIN_INTERVAL_MS);
}
