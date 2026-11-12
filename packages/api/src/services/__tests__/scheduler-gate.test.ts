// Whether the scheduled jobs run in this process, and the hourly cleanup pace
// (services/schedulerGate.ts). Found 12 Nov: a laptop's .env held the
// production database and the production bot token, and `next dev` started
// the five-minute scheduler against both.

import { createHousekeepingGate, schedulerEnabled } from "../schedulerGate";

describe("schedulerEnabled", () => {
  test("production runs it", () => {
    expect(schedulerEnabled({ NODE_ENV: "production" }).enabled).toBe(true);
  });
  test("production told not to: off", () => {
    expect(schedulerEnabled({ NODE_ENV: "production", DISABLE_INTERNAL_CHECKIN_CRON: "true" }).enabled).toBe(false);
  });
  test("next dev, or no NODE_ENV: off unless asked", () => {
    expect(schedulerEnabled({ NODE_ENV: "development" }).enabled).toBe(false);
    expect(schedulerEnabled({}).enabled).toBe(false);
    expect(schedulerEnabled({ NODE_ENV: "development", ENABLE_INTERNAL_CHECKIN_CRON: "true" }).enabled).toBe(true);
  });
  test("DISABLE wins over ENABLE", () => {
    expect(schedulerEnabled({ ENABLE_INTERNAL_CHECKIN_CRON: "true", DISABLE_INTERNAL_CHECKIN_CRON: "true" }).enabled).toBe(false);
  });
  test("only the exact word counts", () => {
    expect(schedulerEnabled({ NODE_ENV: "development", ENABLE_INTERNAL_CHECKIN_CRON: "1" }).enabled).toBe(false);
    expect(schedulerEnabled({ NODE_ENV: "production", DISABLE_INTERNAL_CHECKIN_CRON: "false" }).enabled).toBe(true);
  });
});

describe("createHousekeepingGate", () => {
  const t = (min: number) => new Date(Date.UTC(2026, 10, 12, 0, 0, 0) + min * 60_000);

  test("first tick runs it, then once an hour of five-minute ticks", () => {
    const due = createHousekeepingGate();
    const runs = Array.from({ length: 36 }, (_, i) => due(t(i * 5))).flatMap((ran, i) => (ran ? [i * 5] : []));
    expect(runs).toEqual([0, 60, 120]);
  });

  test("a fresh process (new gate) runs it at once", () => {
    const before = createHousekeepingGate();
    before(t(0));
    expect(createHousekeepingGate()(t(5))).toBe(true);
  });

  test("a clock that went backwards runs it rather than waiting", () => {
    const due = createHousekeepingGate();
    due(t(60));
    expect(due(t(10))).toBe(true);
  });
});
