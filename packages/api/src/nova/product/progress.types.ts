// ─── Progress view: the contract between Nova and the Progress page ───────────
// "Have I actually changed?", answered only from what is on record: finished
// study sessions, the learner's own answers to "How did it go?", the Topic
// Mastery Engine's record of its changes, and exam dates. Every number and
// sentence here is produced on the server; the page renders it. No imports,
// so the web app can import the types directly.
//
// The definitions (all in product/progress.ts):
//
//   counted session   finished, timed by Nova, and at least 10 minutes of
//                     study time. A session the learner only told Nova
//                     about has no duration and is not counted; nor is a
//                     timer stopped within ten minutes.
//   active day        a calendar day, in the learner's timezone, with at
//                     least one counted session. A chat message is never one.
//   week              Monday to Sunday in the learner's timezone.
//   comeback          a counted session on an active day that follows the
//                     previous active day by 4 calendar days or more.
//   mastery           the Topic Mastery Engine's number, as on Knowledge: a
//                     self-report-driven estimate, not a test result.

export type ProgressLevel   = "weak" | "developing" | "solid";
export type ProgressOutcome = "struggled" | "okay" | "good" | "crushed_it";

// ── Overview ──────────────────────────────────────────────────────────────────

export interface ProgressOverview {
  // The learner's first counted session. null: there is none yet.
  since:           string | null;
  sessions:        number;          // counted sessions, all time
  learningMinutes: number;          // their study time, pauses excluded
  activeDays:      number;          // within the last year
  topicsImproved:  number;          // topics in growth.improving
  // Finished sessions left out of every number on this page, and why.
  notCounted: { selfReported: number; underTenMinutes: number };
}

// ── Topic growth ──────────────────────────────────────────────────────────────

export type ProgressDirection =
  | "improving"
  | "steady"
  | "needs_attention"
  | "just_started";     // one session so far: nothing to compare

// A recorded movement of the topic's mastery number.
export interface ProgressMasteryChange {
  fromPercent: number;
  toPercent:   number;
  fromLevel:   ProgressLevel;
  toLevel:     ProgressLevel;
  since:       string;              // when the "from" value was recorded
}

export interface ProgressTopic {
  topicId:        string;
  topicName:      string;
  subjectName:    string;
  masteryPercent: number;           // as on Knowledge
  level:          ProgressLevel;
  sessions:       number;           // finished sessions that fed the topic
  direction:      ProgressDirection;
  // null: the topic's number has not been recorded moving. Topics changed
  // before mastery history was kept have none until their next session.
  change:         ProgressMasteryChange | null;
  // The learner's answers to "How did it go?" on this topic, oldest first,
  // at most the six most recent.
  outcomes:       ProgressOutcome[];
  // Why the topic is under this direction, as one short fact.
  reason:         string;
}

export interface ProgressGrowth {
  improving:      ProgressTopic[];  // largest gain first
  steady:         ProgressTopic[];
  needsAttention: ProgressTopic[];  // lowest mastery first
  justStarted:    ProgressTopic[];
}

// ── Consistency ───────────────────────────────────────────────────────────────

export interface ProgressWeek {
  weekStart:   string;              // the Monday, YYYY-MM-DD in the learner's timezone
  sessions:    number;
  minutes:     number;
  activeDays:  number;              // 0–7
  current:     boolean;             // this week, still in progress
  // The whole week is earlier than the learner's first counted session. It
  // is not a week they missed.
  beforeStart: boolean;
}

export type ConsistencyTrend =
  | "more_consistent" | "steady" | "less_consistent"
  // Fewer than eight finished weeks since the first counted session.
  | "not_enough_history";

export interface ProgressComeback {
  date:      string;                // the session that ended the gap
  gapDays:   number;                // calendar days since the previous active day
  topicName: string | null;
}

export interface ProgressConsistency {
  timezone: string;                 // the zone the days and weeks were drawn in
  weeks:    ProgressWeek[];         // oldest first: eight finished weeks, then this one
  trend:    ConsistencyTrend;
  // Average active days a week: the last four finished weeks against the
  // four before. null when trend is not_enough_history.
  trendBasis: { recent: number; earlier: number } | null;
  lastActiveDay:       string | null;   // YYYY-MM-DD
  daysSinceLastActive: number | null;
  comebacks: ProgressComeback[];    // newest first
}

// ── Journey ───────────────────────────────────────────────────────────────────

export type JourneyEventType =
  | "first_session"
  | "session_milestone"   // the 5th, 10th, 25th, 50th, 100th, 250th, 500th counted session
  | "comeback"
  | "topic_level_up"      // the mastery number crossed into a higher level
  | "breakthrough";       // "Good" or "Crushed it" on a topic after "Struggled"

export interface JourneyEvent {
  id:          string;              // stable for the same evidence
  type:        JourneyEventType;
  date:        string;
  title:       string;
  description: string;
  // What on record this event rests on, in words.
  evidence:    string;
  // The record itself.
  source:      { kind: "session" | "mastery_record"; id: string };
  subjectName: string | null;
  topicName:   string | null;
  importance:  "major" | "notable";
}

// ── The page ──────────────────────────────────────────────────────────────────

// One sentence of "what changed", with the kind of evidence behind it.
export interface ProgressChange {
  kind: "topic_improved" | "topic_slipped" | "comeback" | "sessions" | "consistency";
  text: string;
}

export interface NovaProgressReady {
  status:      "ready";
  generatedAt: string;
  // false: no counted session yet. Every section below is then empty.
  hasEvidence: boolean;
  overview:    ProgressOverview;
  changes:     ProgressChange[];
  growth:      ProgressGrowth;
  consistency: ProgressConsistency;
  journey:     JourneyEvent[];      // newest first
  // What the learner told Nova they are working toward, in their words.
  // Nova does not track completion of these, so none is shown.
  goals:       string[];
  // The next exam on record. null: none upcoming.
  nextExam:    { title: string; subjectName: string | null; date: string; daysUntil: number } | null;
  // From Learning DNA, and only once it has enough sessions behind it.
  usualSession: { minutes: number; basedOnSessions: number } | null;
}

export type NovaProgressView =
  | NovaProgressReady
  | { status: "not_nova" }
  | { status: "not_connected" }
  | { status: "onboarding_incomplete" };
