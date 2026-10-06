import { runCheckinCron } from "./checkin-cron";

const CHECKIN_INTERVAL_MS = 5 * 60 * 1000;
const STARTUP_DELAY_MS = 10 * 1000;

type SchedulerGlobal = typeof globalThis & {
  __kevoCheckinSchedulerStarted?: boolean;
  __kevoCheckinSchedulerRunning?: boolean;
  __kevoCheckinLastTickAt?: string;
  __kevoCheckinLastTickOk?: boolean;
};

export interface SchedulerStatus {
  // running: this process ticks every five minutes. disabled: it was told
  // not to (DISABLE_INTERNAL_CHECKIN_CRON=true); some other host must.
  state:      "running" | "disabled" | "not_started";
  lastTickAt: string | null;
  lastTickOk: boolean | null;
}

// What this process's scheduler is doing, for the health check. It reports
// only this process: it cannot see whether another host is also ticking.
export function schedulerStatus(): SchedulerStatus {
  const globalState = globalThis as SchedulerGlobal;
  return {
    state: process.env.DISABLE_INTERNAL_CHECKIN_CRON === "true" ? "disabled"
         : globalState.__kevoCheckinSchedulerStarted ? "running" : "not_started",
    lastTickAt: globalState.__kevoCheckinLastTickAt ?? null,
    lastTickOk: globalState.__kevoCheckinLastTickOk ?? null,
  };
}

export function startInternalCheckinScheduler() {
  const globalState = globalThis as SchedulerGlobal;

  if (process.env.DISABLE_INTERNAL_CHECKIN_CRON === "true") {
    console.log("[CHECKIN] Internal scheduler disabled by DISABLE_INTERNAL_CHECKIN_CRON=true");
    return;
  }

  if (globalState.__kevoCheckinSchedulerStarted) {
    return;
  }

  globalState.__kevoCheckinSchedulerStarted = true;
  console.log("[CHECKIN] Internal scheduler started; interval=5m");

  const tick = async () => {
    if (globalState.__kevoCheckinSchedulerRunning) {
      console.log("[CHECKIN] Previous internal scheduler tick still running; skipping this tick");
      return;
    }

    globalState.__kevoCheckinSchedulerRunning = true;
    try {
      const result = await runCheckinCron();
      globalState.__kevoCheckinLastTickOk = result.ok;
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
