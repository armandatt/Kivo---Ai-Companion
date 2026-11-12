// Whether the scheduled jobs run in this process (services/schedulerGate.ts). Found 12 Nov: a laptop's .env held the
// production database and the production bot token, and `next dev` started
// the five-minute scheduler against both.

import { schedulerEnabled } from "../schedulerGate";

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
