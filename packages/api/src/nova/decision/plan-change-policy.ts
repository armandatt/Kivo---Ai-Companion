// ─── What may change a learner's plan, and how ────────────────────────────────
// Pure. One place that says which changes Nova may make by itself and which
// need the learner's yes. Recovery (engines/recovery-engine.ts) proposes;
// this decides; the accept route checks again before anything is written.
//
//   automatic       changes only the shape of today's computed plan, which is
//                   never stored: it may only shorten the day, never while
//                   the learner has said how long they have today, and never
//                   while an exam or certification is taking over the day.
//   needs_approval  changes a record the learner set (a task's due day). It
//                   is shown as a proposal and written only on their accept.
//   refused         never: adding time to a day, moving a task into the
//                   past or onto an exam day, past its subject's next date,
//                   or touching a deadline. Only the learner moves a date
//                   (Settings → exams) or lengthens a day.

import { dayNumber } from "../engines/learner-calendar";

export type ChangeClass = "automatic" | "needs_approval" | "refused";

export type PlanChange =
  | { kind: "shorten_today"; usualMinutes: number; minutes: number; statedToday: boolean; dayTakenByExam: boolean }
  | { kind: "lengthen_today" }
  | { kind: "move_task"; from: string | null; to: string; today: string; takenDays: string[]; latestDay: string | null; taskOpen: boolean }
  | { kind: "change_deadline" };

export interface ChangeVerdict { class: ChangeClass; why: string }

export function classifyChange(change: PlanChange): ChangeVerdict {
  switch (change.kind) {
    case "shorten_today":
      if (change.statedToday) return { class: "refused", why: "They said how long they have today: that is the answer." };
      if (change.dayTakenByExam) return { class: "refused", why: "An exam or certification is taking over the day." };
      if (!(change.minutes > 0) || change.minutes > change.usualMinutes) return { class: "refused", why: "A day may only be made shorter." };
      return { class: "automatic", why: "Only today's computed plan changes; nothing is stored." };
    case "lengthen_today":
      return { class: "refused", why: "Only the learner gives a day more time." };
    case "change_deadline":
      return { class: "refused", why: "Only the learner moves or removes a date." };
    case "move_task": {
      if (!change.taskOpen) return { class: "refused", why: "A finished task is not moved." };
      const to = dayNumber(change.to);
      if (!Number.isFinite(to) || to < dayNumber(change.today)) return { class: "refused", why: "A task is never moved into the past." };
      if (change.takenDays.includes(change.to)) return { class: "refused", why: "An exam or certification day is left free." };
      if (change.latestDay !== null && to > dayNumber(change.latestDay)) return { class: "refused", why: "Not past its subject's next date." };
      return { class: "needs_approval", why: "A due day is the learner's own commitment." };
    }
  }
}
