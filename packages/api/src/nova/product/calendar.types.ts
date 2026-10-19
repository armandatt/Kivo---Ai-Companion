// ─── Calendar: the contract between Nova and the calendar page ────────────────
// One calendar over three records, each still owned where it was:
//   • events     NovaCalendarEvent (product/calendar.ts): classes, meetings,
//                study blocks, personal things. The only rows the calendar owns.
//   • tasks      NovaTask with a due day (product/tasks.ts): shown on that day.
//   • deadlines  NovaExam (product/exams.ts): exams, assignments, projects,
//                interviews, certifications, other dates.
// The page tells them apart; nothing is copied from one to another.
//
// No imports, so the web app imports this file directly.

export const EVENT_CATEGORIES = ["class", "meeting", "study", "personal", "other"] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];

export const EVENT_CATEGORY_LABEL: Record<EventCategory, string> = {
  class:    "Class",
  meeting:  "Meeting",
  study:    "Study block",
  personal: "Personal",
  other:    "Other",
};

export const EVENT_TITLE_MAX       = 120;
export const EVENT_DESCRIPTION_MAX = 2000;
export const EVENT_KEY_MAX         = 120;
// An event spans at most this many days, and the page asks for at most this
// many days at a time (a month grid is six weeks).
export const EVENT_SPAN_MAX_DAYS     = 31;
export const CALENDAR_RANGE_MAX_DAYS = 62;
// The body of one create or change.
export const EVENT_BODY_MAX_BYTES = 8 * 1024;

// An all-day event's reminder is timed from this hour on its first day.
export const ALL_DAY_REMINDER_HOUR = 9;

// The reminders a learner can choose, in minutes before the start. A fixed
// list, so a typo cannot schedule a message at three in the morning.
export const TIMED_REMINDERS: ReadonlyArray<{ minutes: number; label: string }> = [
  { minutes: 0,    label: "When it starts" },
  { minutes: 10,   label: "10 minutes before" },
  { minutes: 30,   label: "30 minutes before" },
  { minutes: 60,   label: "1 hour before" },
  { minutes: 120,  label: "2 hours before" },
  { minutes: 1440, label: "1 day before" },
];
export const ALL_DAY_REMINDERS: ReadonlyArray<{ minutes: number; label: string }> = [
  { minutes: 0,    label: "On the day, at 9:00" },
  { minutes: 1440, label: "The day before, at 9:00" },
];

// What the page sends to create an event, or (any subset) to change one.
// Times are wall-clock times in `timezone`; the server works out the moments.
export interface CalendarEventInput {
  title?:           string;
  description?:     string | null;
  category?:        EventCategory;
  allDay?:          boolean;
  startDay?:        string;          // YYYY-MM-DD
  endDay?:          string | null;   // YYYY-MM-DD, inclusive; null: the start day
  startTime?:       string | null;   // "HH:MM", timed events only
  endTime?:         string | null;   // "HH:MM"; null: no end time
  timezone?:        string;          // IANA; left out, the learner's own
  reminderMinutes?: number | null;   // one of the lists above; null: none
  taskId?:          string | null;   // a task of theirs this time is for
  subjectId?:       string | null;
  clientKey?:       string;          // makes a create idempotent
}

// Where a reminder stands.
//   scheduled    it will be sent when due
//   sent         Telegram accepted it
//   failed       it could not be delivered (it was tried)
//   missed       its time passed without a send (the server was asleep, or
//                it was added too late)
//   unavailable  there is nowhere to send it (see NovaCalendarReady.reminders)
export type ReminderStatus = "scheduled" | "sent" | "failed" | "missed" | "unavailable";

export interface CalendarEventItem {
  id:              string;
  title:           string;
  description:     string | null;
  category:        EventCategory;
  allDay:          boolean;
  startDay:        string;
  endDay:          string;
  // Timed events: the moments (ISO) and their wall-clock times in `timezone`.
  startAt:         string | null;
  endAt:           string | null;
  startTime:       string | null;
  endTime:         string | null;
  timezone:        string;
  reminderMinutes: number | null;
  reminder:        { at: string; status: ReminderStatus } | null;
  task:            { id: string; title: string; status: string } | null;
  subject:         { id: string; name: string } | null;
}

export interface CalendarTaskItem {
  id:          string;
  title:       string;
  dueDay:      string;
  status:      "todo" | "in_progress" | "done";
  priority:    "low" | "medium" | "high" | null;
  subjectName: string | null;
  overdue:     boolean;
}

export interface CalendarDeadlineItem {
  id:          string;
  title:       string;
  kind:        "exam" | "assignment" | "project" | "interview" | "certification" | "other";
  kindLabel:   string;
  day:         string;
  subjectName: string | null;
}

// Where reminders go. Telegram is the one channel that delivers them; a
// learner without it, or whose chat refuses Nova's messages, is told so
// before choosing one.
export interface CalendarReminderChannel {
  channel: "telegram" | "none";
  // none: why.
  reason:  "not_connected" | "blocked" | null;
}

export interface NovaCalendarReady {
  status:    "ready";
  from:      string;
  to:        string;
  today:     string;
  timezone:  string;
  events:    CalendarEventItem[];
  tasks:     CalendarTaskItem[];
  deadlines: CalendarDeadlineItem[];
  // For the forms: the learner's subjects, and open tasks an event can be for.
  subjects:  Array<{ id: string; name: string }>;
  openTasks: Array<{ id: string; title: string; dueDay: string | null }>;
  reminders: CalendarReminderChannel;
}

export type NovaCalendarView =
  | NovaCalendarReady
  | { status: "not_nova" }
  | { status: "not_connected" }
  | { status: "onboarding_incomplete" };

export type CalendarError =
  | "invalid" | "no_title" | "title_too_long" | "description_too_long" | "bad_category"
  | "bad_day" | "bad_time" | "end_before_start" | "too_long" | "bad_timezone"
  | "bad_reminder" | "bad_task" | "bad_subject" | "bad_range" | "not_found" | "too_large" | "failed";

export type CalendarEventResponse =
  | { ok: true; event: CalendarEventItem; created?: boolean }
  | { ok: false; error: CalendarError | "unauthenticated" | "not_nova" | "not_connected" | "onboarding_incomplete"; message: string };
