// ─── The Telegram page (Telegram launch, 28 Nov): contract ───────────────────
// No imports, so the web app imports it directly. Built by
// product/telegram-page.ts; actions through POST /api/nova/telegram.

export type TelegramReminderSource = "day_plan" | "personal" | "mentor_checkin";

export interface TelegramUpcoming {
  // An occurrence id (day plan), an event id (personal), or "checkin".
  id:       string;
  source:   TelegramReminderSource;
  title:    string;
  at:       string;            // ISO
  state:    "scheduled" | "snoozed" | "failed" | "daily";
  snoozes:  number;
  // What can be done to it here.
  canSnooze: boolean;
  canCancel: boolean;
}

export interface TelegramRecent {
  id:     string;
  title:  string;
  at:     string;              // when it was due (ISO)
  // What happened: sent and acted on, sent with no action recorded, skipped,
  // started, missed, undeliverable, …
  status: string;
  label:  string;
}

export interface NovaTelegramPage {
  status:     "ready";
  connected:  boolean;
  // Telegram refused delivery (bot blocked or chat gone), since when.
  undeliverableSince: string | null;
  timezone:   string | null;
  checkinTime: string | null;
  planFeature: boolean;        // TELEGRAM_PLAN_NOTIFICATIONS is on
  sendsOn:     boolean;        // TELEGRAM_PROACTIVE_SENDS is on
  planNotifications: boolean;
  nudgesOn:    boolean;
  // A pause in force: its scope and when it ends.
  pause: { scope: "plan" | "all" | "nudges"; until: string } | null;
  nextDelivery: { title: string; at: string; source: TelegramReminderSource } | null;
  upcoming: TelegramUpcoming[];
  recent:   TelegramRecent[];
  // Nova credits this period (the same figures as Plan and billing).
  credits:  { used: number; limit: number | null; resetsAt: string | null; enforced: boolean } | null;
}

export type TelegramPageAction =
  | { action: "snooze"; id: string; minutes: 15 | 60 }
  | { action: "skip"; id: string }
  | { action: "plan_notifications"; enabled: boolean }
  | { action: "nudges"; enabled: boolean }
  | { action: "pause"; scope: "plan" | "all" }
  | { action: "resume" };
