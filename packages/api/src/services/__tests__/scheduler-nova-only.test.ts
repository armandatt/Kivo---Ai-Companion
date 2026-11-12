// The five-minute scheduler is Nova's only. Rex is not part of Kivo: none of
// its jobs (dynamic check-ins, custom reminders, the gym and web-gym jobs)
// may run in the tick or be predicted by the skip decision. Read from the
// source, like the other boundary tests, so adding one back fails here.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../../../../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

const SCHEDULER_PATH = [
  "apps/api/lib/checkin-cron.ts",
  "apps/api/lib/internal-checkin-scheduler.ts",
  "apps/api/app/api/checkin/route.ts",
  "packages/api/src/services/schedulerIdle.ts",
  "packages/api/src/services/schedulerDueSources.ts",
  "packages/api/src/services/schedulerGate.ts",
];

// Rex's scheduled jobs and the services only they use.
const REX = [
  "gymCron.service", "customReminder.service", "checkin.service", "schedulerEngine.service",
  "rexSchedulerMessages.service", "workoutTracking.service", "gymDetections.service", "memory.service",
  "runGymCronJobs", "fireCustomReminders", "getUsersDueForDynamicCheckIn", "advanceDynamicCheckIn",
  "clearStaleCheckIns", "generateDynamicCheckIn",
];

test.each(SCHEDULER_PATH)("%s runs and predicts no Rex job", file => {
  const code = read(file).split("\n").filter(line => !line.trim().startsWith("//")).join("\n");
  for (const name of REX) expect(code.includes(name) ? `${file} uses ${name}` : null).toBeNull();
});

test("the Telegram webhook stops counting writes before Rex's branch", () => {
  const route = read("apps/api/app/api/telegram/route.ts");
  const nova  = route.indexOf('messengerUser?.persona === "nova"');
  const quiet = route.indexOf('quietFromHere("rex-legacy")');
  const intake = route.indexOf("── Intake gate");
  expect(nova).toBeGreaterThan(0);
  expect(quiet).toBeGreaterThan(nova);
  expect(intake).toBeGreaterThan(quiet);
});
