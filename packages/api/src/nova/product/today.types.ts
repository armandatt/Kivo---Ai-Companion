// ─── Today view: the contract between Nova and the Home page ──────────────────
// A read model. Every field is computed by an existing engine; the frontend
// renders it and decides nothing. This file has no imports so the web app can
// import its types directly.

export type TodayUrgency = "critical" | "high" | "normal" | "optional";
export type TodayActivity = "review" | "practice" | "new_material" | "exam_prep";

export interface TodayAction {
  topicName:       string;
  subjectName:     string;
  activityType:    TodayActivity;
  durationMinutes: number;
  urgency:         TodayUrgency;
  // Why this, in the engines' own terms. Short facts, most important first:
  // "exam in 6 days", "mastery 32%", "review 3 days overdue".
  reasons:         string[];
  rationale:       string;          // the planning engine's sentence
}

// Why there are no blocks, when there are none.
export type PlanEmptyReason =
  | "no_topics"        // Nova has no topics on record to plan from
  | "too_little_time"  // the time the student has is shorter than any block
  | "recovery"         // recovery mode, and nothing comfortable to revisit
  | "nothing_due";     // nothing is due and no exam is close

export type PlanBudgetBasisName =
  | "preferred" | "stated_time" | "exam_ramp" | "exam_crisis" | "recovery" | "no_pressure";

export interface TodayActiveSession {
  id:                     string;
  topicName:              string | null;
  subjectName:            string | null;
  status:                 "in_progress" | "paused";
  startedAt:              string;
  elapsedMinutes:         number;   // time spent paused is excluded
  plannedDurationMinutes: number;
}

export interface TodayDeadline {
  title:       string;
  subjectName: string | null;
  examType:    string;
  scheduledAt: string;
  daysUntil:   number;
}

export interface TodayWeakArea {
  topicName:      string;
  subjectName:    string;
  masteryPercent: number;
  lastStudiedAt:  string | null;
  reviewDue:      boolean;
}

export interface TodayConstraint {
  category:    string;
  subtype:     string | null;
  description: string;
  expiresAt:   string | null;
}

export interface NovaTodayReady {
  status:      "ready";
  generatedAt: string;
  learnerName: string | null;       // from the signed-in account
  goals:       string[];            // what the student said they are working toward
  subjects:    string[];
  // What the student said they have today. The whole plan below was fitted
  // to it by the Planning Engine, the same way the Planner's is.
  availableMinutes: number | null;

  recommendation: TodayAction | null;
  // Why there is no recommendation, when there is none.
  emptyReason:    PlanEmptyReason | null;
  alternatives:   TodayAction[];

  activeSession: TodayActiveSession | null;
  nextDeadline:  TodayDeadline | null;
  upcoming:      TodayDeadline[];   // soonest first, nextDeadline included
  weakArea:      TodayWeakArea | null;
  reviewDue:     { count: number; topics: Array<{ topicName: string; subjectName: string; daysOverdue: number }> };
  constraints:   TodayConstraint[];

  progress: {
    sessionsThisWeek:     number;
    minutesThisWeek:      number;
    streakDays:           number;
    daysSinceLastSession: number | null;
    lastSession:          { topicName: string | null; date: string; minutes: number } | null;
  };

  plan: {
    mode:              "exam_crisis" | "recovery" | "standard";
    blockCount:        number;
    totalMinutesToday: number;
    // The time the day was fitted to and the rule that set it. "stated_time"
    // means the plan was refitted to availableMinutes.
    budgetMinutes:     number;
    budgetBasis:       PlanBudgetBasisName;
    assumptions:       string[];
  };
}

export type NovaTodayView =
  | NovaTodayReady
  // The account is not a Nova learner yet. Each status maps to one next step.
  | { status: "not_nova" }                  // the account uses another companion
  | { status: "not_connected" }             // no Telegram chat linked to this account
  | { status: "onboarding_incomplete" };    // linked, but Nova has not finished onboarding

// ── Web message endpoint ──────────────────────────────────────────────────────

export interface NovaMessageRequest {
  text: string;   // natural language, or a slash command such as "/study Deadlocks"
}

export type NovaMessageResponse =
  | { ok: true; reply: string; intervention: string | null }
  | { ok: false; error: "unauthenticated" | "not_connected" | "not_nova" | "rate_limited" | "empty" | "failed"; message: string };

// ── Session commands ──────────────────────────────────────────────────────────
// What the Start / Pause / Resume / End buttons send. Explicit protocol, like
// a slash command: handled by deterministic code, no LLM call.

export interface NovaSessionView {
  id:                     string;
  topicName:              string | null;
  subjectName:            string | null;
  status:                 "in_progress" | "paused";
  startedAt:              string;
  pausedAt:               string | null;
  plannedDurationMinutes: number;      // 0 = no planned length
  // Study time so far as of serverNow, pauses excluded. The page counts up
  // from this value; it never keeps a clock of its own.
  elapsedSeconds:         number;
  serverNow:              string;
  pauseCount:             number;
  confusionPoints:        string[];
}

export type NovaSessionCommand =
  | { action: "start"; topicName: string; subjectName: string | null; plannedMinutes: number | null }
  | { action: "pause" }
  | { action: "resume" }
  | { action: "end" };

export type NovaSessionError =
  | "unauthenticated" | "not_connected" | "not_nova" | "onboarding_incomplete"
  | "invalid" | "no_active_session" | "not_paused" | "already_paused" | "failed";

export type NovaSessionResponse =
  | {
      ok:      true;
      session: NovaSessionView | null;
      // Set by "end": what was recorded.
      ended:   { topicName: string | null; minutes: number } | null;
    }
  | { ok: false; error: NovaSessionError; message: string };
