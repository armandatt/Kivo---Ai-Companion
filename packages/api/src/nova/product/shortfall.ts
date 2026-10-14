// ─── Shortfall ────────────────────────────────────────────────────────────────
// How the plan says "this does not fit". The Planning Engine counts it
// (examShortfall); this lays the count out as one sentence, what it assumes,
// and the choices the learner has. Pure: no database, no model.
//
// Today and the Planner both show what this returns, so they cannot word it
// differently. Nova never takes one of the choices for the learner: a day is
// only ever as long as they said.

import type { PlanShortfall } from "../types/engine.types";
import type { PlanShortfallView } from "./today.types";

const inDays  = (n: number) => (n <= 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`);
const topics  = (n: number) => `${n} topic${n === 1 ? "" : "s"}`;

export function shortfallView(
  shortfall: PlanShortfall | null,
  facts: {
    // Whether the learner has said what a normal day allows. When they have
    // not, the daily figure is Nova's assumption and is said to be one.
    dailyMinutesStated: boolean;
    // What they said they have today, when they said it.
    availableMinutes:   number | null;
    // The exam's distance in the learner's own calendar days, which is how
    // every page words "in N days". Unset: the engine's count.
    calendarDaysUntil?: number;
  },
): PlanShortfallView | null {
  if (!shortfall) return null;
  const s      = shortfall;
  const missed = s.topicsRemaining - s.topicsThatFit;
  const days   = facts.calendarDaysUntil ?? s.daysUntil;

  const assumptions = [
    `Counts ${s.minutesPerTopic} min for each topic. Nova has no record of how large each one is, so it treats them as equal.`,
  ];
  if (!facts.dailyMinutesStated) {
    assumptions.push(`Uses ${s.dailyMinutes} min a day as a guess: you haven't said what you usually have.`);
  }
  if (facts.availableMinutes !== null && s.studyDays > 1) {
    assumptions.push(`Counts today as the ${facts.availableMinutes} min you said you have, and each day after it as ${s.dailyMinutes} min.`);
  }

  return {
    examTitle:        s.examTitle,
    daysUntil:        days,
    topicsRemaining:  s.topicsRemaining,
    topicsThatFit:    s.topicsThatFit,
    minutesNeeded:    s.minutesNeeded,
    minutesAvailable: s.minutesAvailable,
    dailyMinutes:     s.dailyMinutes,
    summary:
      `${s.examTitle} is ${inDays(days)}. ${topics(s.topicsRemaining)} for it ${s.topicsRemaining === 1 ? "is" : "are"} not at a solid level yet: ` +
      `about ${s.minutesNeeded} min of work, and you have about ${s.minutesAvailable} min before it. ` +
      `That covers ${s.topicsThatFit} of them. Nova has not added time to your day.`,
    assumptions,
    choices: [
      {
        kind:   "keep_time",
        label:  "Keep to the time you have",
        detail: `Today's plan already puts the weakest topics for this exam first. ${topics(missed)} will not be reached before it.`,
      },
      {
        kind:   "add_time_today",
        label:  "Give today more time",
        detail: "Say how long you have today and the plan is refitted to it, for today only.",
      },
      {
        kind:   "change_usual_time",
        label:  "Change your usual daily time",
        detail: "Set it in Study setup. Every day's plan follows it from then on.",
      },
    ],
  };
}
