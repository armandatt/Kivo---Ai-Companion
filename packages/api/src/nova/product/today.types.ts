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
  // Set when the student said how long they have.
  trimmedToFit:    boolean;
}

export interface TodayActiveSession {
  id:                     string;
  topicName:              string | null;
  subjectName:            string | null;
  status:                 "in_progress" | "paused";
  startedAt:              string;
  elapsedMinutes:         number;
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
  subjects:    string[];
  availableMinutes: number | null;

  recommendation: TodayAction | null;
  // Why there is no recommendation, when there is none.
  emptyReason:    "no_topics" | "recovery" | "nothing_due" | null;
  alternatives:   TodayAction[];

  activeSession: TodayActiveSession | null;
  nextDeadline:  TodayDeadline | null;
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
