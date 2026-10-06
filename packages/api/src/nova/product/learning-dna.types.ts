// ─── Learning DNA view: the contract between Nova and the Learning DNA page ───
// What Nova has concluded about how this learner studies, with what stands
// behind each conclusion. Everything is computed on the server by the
// Learning DNA engine; the page renders it. No imports, so the web app can
// import the types directly.
//
// A signal is a belief, not a fact about the person. It carries its own
// support (`level`, `evidenceCount`), where it comes from (`explanation`),
// and whether it is moving (`trend`). A signal whose level is "unknown" has
// no value: Nova says what it would need instead of guessing.

export type DnaLevel = "unknown" | "emerging" | "supported" | "strong";
export type DnaTrend = "new" | "strengthening" | "steady" | "weakening" | "changed";

export type DnaSignalKey =
  | "typical_session"       // how long a session usually runs
  | "plan_follow_through"   // study time against the planned length
  | "days_per_week"         // study days in a typical week
  | "usual_study_window"    // the part of the day sessions usually start in
  | "best_session_size"     // the session length that goes best, by the learner's own answers
  | "best_study_window"     // the part of the day that goes best
  | "revision_spacing"      // the gap before coming back to a topic that goes best
  | "needs_more_retrieval"; // topics the learner keeps struggling with

export type DnaSection = "rhythm" | "works" | "struggles";

export type DnaValue =
  | { kind: "minutes"; typical: number; low: number; high: number }           // low–high: the middle half
  | { kind: "percent_of_plan"; typical: number }
  | { kind: "days_per_week"; typical: number; low: number; high: number }
  | { kind: "window"; label: string; sessions: number; of: number }
  | { kind: "comparison"; label: string; wentWell: number; of: number; against: Array<{ label: string; wentWell: number; of: number }> }
  | { kind: "topics"; topics: Array<{ topicName: string; subjectName: string | null; struggled: number; answered: number; masteryPercent: number | null }> };

export interface DnaSignalView {
  key:      DnaSignalKey;
  section:  DnaSection;
  label:    string;                 // "Typical session"
  level:    DnaLevel;
  // The conclusion in a few words. null when level is "unknown".
  headline: string | null;
  value:    DnaValue | null;
  evidenceCount: number;
  evidenceUnit:  "sessions" | "answered sessions" | "weeks" | "reviews";
  // The most recent piece of evidence behind it.
  lastUpdated:   string | null;
  trend:     DnaTrend | null;       // null when there is no conclusion
  trendNote: string | null;
  // Why Nova concludes this, or what it would need before it does.
  explanation: string;
  // When Nova first reached this conclusion, and what it replaced.
  heldSince: string | null;
  previous:  { label: string; until: string } | null;
}

export interface NovaLearningDnaReady {
  status:      "ready";
  generatedAt: string;
  // Counted sessions in the evidence window (finished, timed, ten minutes or
  // more, within `windowDays`). 0: nothing can be said yet.
  sessionsConsidered: number;
  answeredSessions:   number;       // of those, with a "How did it go?" answer
  windowDays:  number;
  // The zone clock-time claims are made in. null: unknown, and none are made.
  timezone:    string | null;
  // What the learner told Nova during setup about when they study. A
  // statement, shown as one; it is not a conclusion and feeds none.
  statedStudyTime: string | null;
  signals:     DnaSignalView[];
  // Signals whose trend is anything other than steady.
  changing:    DnaSignalKey[];
  // What Nova does not track, and why. Shown so that silence is not read as
  // "no problem".
  notTracked:  Array<{ label: string; reason: string }>;
  thresholds:  { emerging: number; supported: number; strong: number; perSide: number; leadPoints: number };
}

export type NovaLearningDnaView =
  | NovaLearningDnaReady
  | { status: "not_nova" }
  | { status: "not_connected" }
  | { status: "onboarding_incomplete" };

// PUT /api/nova/timezone
export type TimezoneResponse =
  | { ok: true; timezone: string; changed: boolean }
  | { ok: false; error: "invalid_timezone" | "not_nova" | "not_connected" | "onboarding_incomplete" };
