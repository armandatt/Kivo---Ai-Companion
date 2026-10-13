// ─── Goals: the contract between Nova and the goal editor ─────────────────────
// What a learner says they are working toward, in their own words. Plain
// text, at most three. Nova shows them and keeps them in mind; it does not
// track how far along they are, and a stated goal is never evidence of
// anything studied. No imports, so the web app can import the types directly.

export const GOALS_MAX     = 3;
export const GOAL_TEXT_MAX = 200;
// The whole request that saves goals. Three goals at their longest fit with
// room to spare; anything larger is refused unread.
export const GOALS_BODY_MAX_BYTES = 8 * 1024;

// Where a learner edits their goals. Pages that show goals link here.
export const GOALS_HREF = "/settings/study#goals";

export type GoalsError = "invalid" | "too_many" | "too_long";

export type NovaGoalsView =
  | { status: "ready"; goals: string[] }
  | { status: "not_nova" }
  | { status: "not_connected" };

export type GoalsResponse =
  | { ok: true; goals: string[] }
  | { ok: false; error: GoalsError | "too_large" | "unauthenticated" | "not_nova" | "not_connected" | "failed"; message: string };
