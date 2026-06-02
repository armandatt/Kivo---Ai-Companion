import { runCheckinCron } from "./checkin-cron";

const CHECKIN_INTERVAL_MS = 5 * 60 * 1000;
const STARTUP_DELAY_MS = 10 * 1000;

type SchedulerGlobal = typeof globalThis & {
  __kevoCheckinSchedulerStarted?: boolean;
  __kevoCheckinSchedulerRunning?: boolean;
};

export function startInternalCheckinScheduler() {
  const globalState = globalThis as SchedulerGlobal;

  if (process.env.DISABLE_INTERNAL_CHECKIN_CRON === "true") {
    console.log("[CHECKIN] Internal Railway scheduler disabled by DISABLE_INTERNAL_CHECKIN_CRON=true");
    return;
  }

  if (globalState.__kevoCheckinSchedulerStarted) {
    return;
  }

  globalState.__kevoCheckinSchedulerStarted = true;
  console.log("[CHECKIN] Internal Railway scheduler started; interval=5m");

  const tick = async () => {
    if (globalState.__kevoCheckinSchedulerRunning) {
      console.log("[CHECKIN] Previous internal scheduler tick still running; skipping this tick");
      return;
    }

    globalState.__kevoCheckinSchedulerRunning = true;
    try {
      await runCheckinCron();
    } catch (error) {
      console.error("[CHECKIN] Internal scheduler tick failed:", error);
    } finally {
      globalState.__kevoCheckinSchedulerRunning = false;
    }
  };

  setTimeout(tick, STARTUP_DELAY_MS);
  setInterval(tick, CHECKIN_INTERVAL_MS);
}
