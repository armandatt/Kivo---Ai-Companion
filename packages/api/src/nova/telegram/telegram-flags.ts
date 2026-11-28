// ─── Telegram kill switches (launch, 28 Nov) ─────────────────────────────────
// Read from the environment on every call, so turning one off on Render takes
// effect on the next tick or update without a deploy. Chat, commands and
// buttons always keep working: these stop only what Nova sends by itself.
//
//   TELEGRAM_PROACTIVE_SENDS=off     every automatic message: nudges, plan
//                                    notifications, personal reminders
//   TELEGRAM_PLAN_NOTIFICATIONS=off  "Your plan: … Ready to start?" messages;
//                                    their buttons and the settings to turn
//                                    them on are hidden
//   TELEGRAM_PERSONAL_REMINDERS=off  reminders the learner set (Telegram or
//                                    the calendar); creating one on Telegram
//                                    is hidden
//   TELEGRAM_COACHING=on             the occasional-coaching pilot (F1). Off
//                                    by default; not built for launch, so on
//                                    changes nothing yet
//   NOVA_PROACTIVE_DISABLED=true     the older switch: the same as
//                                    TELEGRAM_PROACTIVE_SENDS=off
//
// No imports: pure, held by telegram-flags.test.ts.

type Env = Record<string, string | undefined>;
const off = (v: string | undefined) => (v ?? "").trim().toLowerCase() === "off";

export function proactiveSendsOn(env: Env = process.env): boolean {
  return env.NOVA_PROACTIVE_DISABLED !== "true" && !off(env.TELEGRAM_PROACTIVE_SENDS);
}
export function planNotificationsOn(env: Env = process.env): boolean {
  return !off(env.TELEGRAM_PLAN_NOTIFICATIONS);
}
export function personalRemindersOn(env: Env = process.env): boolean {
  return !off(env.TELEGRAM_PERSONAL_REMINDERS);
}
export function coachingOn(env: Env = process.env): boolean {
  return (env.TELEGRAM_COACHING ?? "").trim().toLowerCase() === "on";
}

// Whether a kind of automatic message may go out now, and why not.
export type SendKind = "nudge" | "plan" | "personal";
export function sendBlockedBy(kind: SendKind, env: Env = process.env): string | null {
  if (env.NOVA_PROACTIVE_DISABLED === "true") return "NOVA_PROACTIVE_DISABLED";
  if (off(env.TELEGRAM_PROACTIVE_SENDS)) return "TELEGRAM_PROACTIVE_SENDS";
  if (kind === "plan" && !planNotificationsOn(env)) return "TELEGRAM_PLAN_NOTIFICATIONS";
  if (kind === "personal" && !personalRemindersOn(env)) return "TELEGRAM_PERSONAL_REMINDERS";
  return null;
}
