// ─── Pace projection ──────────────────────────────────────────────────────────
// For a date the planner prepares topics for: what is left, how many days
// there are, and what pace that asks for against the time the learner has.
// Read-only. It changes no plan, schedules nothing and promises nothing: it
// is arithmetic on what is on record, and it says what it had to assume.
// Pure: no database, no model.
//
// It is deliberately coarse. Nova has no record of how large a topic is or
// how much an exam weighs it, and the same days are shared with every other
// subject. Those limits are stated with the figures, never hidden in them.

import { EXAM_TOPIC_MINUTES } from "../engines/planning-engine";
import type { PaceView } from "./planner.types";

// A topic at or above this has been taken as far as the plan asks: the
// Knowledge Engine's "solid" boundary.
const SOLID_FROM = 0.7;

export function paceProjection(input: {
  topics:       Array<{ masteryProbability: number; reviewCount: number }>;   // this date's subject's topics
  daysUntil:    number;                                                      // the learner's calendar days
  dailyMinutes: number;
  dailyMinutesStated: boolean;
}): PaceView | null {
  // Nothing on record to pace, or no day left to pace it over.
  if (input.topics.length === 0 || input.daysUntil < 0) return null;

  const remaining = input.topics.filter(t => t.reviewCount === 0 || t.masteryProbability < SOLID_FROM).length;
  const days      = Math.max(1, input.daysUntil);     // today, and each day before the date
  const daily     = Math.max(0, Math.round(input.dailyMinutes));
  const needed    = remaining * EXAM_TOPIC_MINUTES;
  const available = daily * days;
  const perDay    = Math.ceil(needed / days);
  const fits      = needed <= available;

  const assumptions = [
    `${EXAM_TOPIC_MINUTES} min for each topic, all counted as equal: Nova has no record of how large each one is or how much it counts.`,
    "Every day until then, with all of each day's time going to this. Your other subjects share those days.",
  ];
  if (!input.dailyMinutesStated) assumptions.push(`${daily} min a day is a guess: you haven't said what you usually have.`);

  const left = `${remaining} of ${input.topics.length} topic${input.topics.length === 1 ? "" : "s"}`;
  const summary = remaining === 0
    ? `All ${input.topics.length} topic${input.topics.length === 1 ? " is" : "s are"} at a solid level by your own ratings. Nothing is left to pace.`
    : fits
      ? `${left} not at a solid level yet. Covering them by then takes about ${perDay} min a day; your usual day is ${daily} min, so there is room.`
      : `${left} not at a solid level yet. Covering them by then would take about ${perDay} min a day, and your usual day is ${daily} min. As things stand they do not all fit.`;

  return {
    topicsTotal: input.topics.length, topicsRemaining: remaining, studyDays: days,
    minutesNeeded: needed, minutesAvailable: available, minutesPerDayNeeded: perDay, dailyMinutes: daily,
    fits, summary, assumptions,
  };
}
