// ─── Creature view: the contract between Nova and the Creature page ───────────
// The world a learner's studying grows. Every number here is one Nova already
// shows somewhere else, or is worked out from those by a rule written below;
// the page renders them and decides nothing. No imports, so the web app can
// import the types directly.
//
//   streakDays   the study streak, exactly as Home shows it.
//   activeDays   days with a counted session in the last year, exactly as
//                Progress shows it.
//   level        1, plus one for every 5 active days.
//   worldHealth  70 to 100: 70, plus 5 for each active day in this week and
//                the last one. 70 is where the world is drawn clear, so a
//                week off (or a week ill) takes away some sparkle and never
//                brings fog: the world does not suffer for a missed day.

export const CREATURE_DAYS_PER_LEVEL = 5;
export const CREATURE_BASE_HEALTH    = 70;
export const CREATURE_HEALTH_PER_DAY = 5;

export interface NovaCreatureReady {
  status:      "ready";
  // Picks this learner's terrain. Stable, and names nobody.
  seed:        string;
  streakDays:  number;
  activeDays:  number;
  level:       number;
  worldHealth: number;
}

export type NovaCreatureView =
  | NovaCreatureReady
  | { status: "not_nova" }
  | { status: "not_connected" }
  | { status: "onboarding_incomplete" };
