import { coachingOn, personalRemindersOn, planNotificationsOn, proactiveSendsOn, sendBlockedBy } from "../telegram/telegram-flags";

describe("Telegram kill switches", () => {
  it("are on by default, except the coaching pilot", () => {
    expect([proactiveSendsOn({}), planNotificationsOn({}), personalRemindersOn({}), coachingOn({})]).toEqual([true, true, true, false]);
    expect(["nudge", "plan", "personal"].map(k => sendBlockedBy(k as never, {}))).toEqual([null, null, null]);
  });
  it("TELEGRAM_PROACTIVE_SENDS=off stops every automatic message", () => {
    const env = { TELEGRAM_PROACTIVE_SENDS: "off" };
    expect(proactiveSendsOn(env)).toBe(false);
    expect(["nudge", "plan", "personal"].map(k => sendBlockedBy(k as never, env))).toEqual(Array(3).fill("TELEGRAM_PROACTIVE_SENDS"));
  });
  it("NOVA_PROACTIVE_DISABLED=true still stops them all", () => {
    expect(sendBlockedBy("personal", { NOVA_PROACTIVE_DISABLED: "true" })).toBe("NOVA_PROACTIVE_DISABLED");
  });
  it("one kind's switch stops only that kind", () => {
    expect(sendBlockedBy("plan", { TELEGRAM_PLAN_NOTIFICATIONS: "OFF " })).toBe("TELEGRAM_PLAN_NOTIFICATIONS");
    expect(sendBlockedBy("nudge", { TELEGRAM_PLAN_NOTIFICATIONS: "off" })).toBeNull();
    expect(sendBlockedBy("personal", { TELEGRAM_PERSONAL_REMINDERS: "off" })).toBe("TELEGRAM_PERSONAL_REMINDERS");
    expect(sendBlockedBy("plan", { TELEGRAM_PERSONAL_REMINDERS: "off" })).toBeNull();
  });
  it("coaching turns on only with an explicit on", () => {
    expect([coachingOn({ TELEGRAM_COACHING: "on" }), coachingOn({ TELEGRAM_COACHING: "true" }), coachingOn({ TELEGRAM_COACHING: "off" })]).toEqual([true, false, false]);
  });
});
