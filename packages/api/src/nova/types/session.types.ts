// ─── Study Session Types ──────────────────────────────────────────────────────
// Step 4: Interactive Study Session.
// SessionContext = in-memory view of an active session.
// SessionAction  = what the Session Engine recommends for this turn.
// SessionExecutionReport = canonical output at session end.
// All downstream consumers (Knowledge, Planner, Learning DNA) read the report.

// ── Session state machine ──────────────────────────────────────────────────────
// Transitions:
//   none → in_progress  (session_start)
//   in_progress → paused (break_request)
//   paused → in_progress (session_start)
//   in_progress → completed (study_report)

export type SessionStatus = "in_progress" | "paused" | "completed" | "skipped";

// ── Session context ────────────────────────────────────────────────────────────
// Everything Nova knows about the current session.
// Derived from DB at snapshot load + engine computation.

export interface SessionContext {
  sessionId:              string;
  profileId:              string;
  status:                 SessionStatus;
  topicName:              string | null;
  subjectId:              string | null;
  subjectName:            string | null;
  currentFocus:           string | null;
  startedAt:              Date;
  elapsedMinutes:         number;          // wall time - paused time
  plannedDurationMinutes: number;          // 0 = unplanned
  confusionPoints:        string[];
  topicsCompleted:        string[];
  pauseCount:             number;
  totalPausedMinutes:     number;
  isPaused:               boolean;
  pausedAt:               Date | null;
  energyLevel:            "high" | "medium" | "low" | null;
  masteryEstimate:        number;          // 0–1, from NovaTopicMastery or 0.5 default
  sessionGoal:            string | null;   // from plan block rationale, if applicable
}

// ── Session action ─────────────────────────────────────────────────────────────
// What the Session Engine recommends for this turn.
// The Response Brain receives this via the dynamic layer and acts accordingly.

export type SessionActionType =
  | "explain_topic"         // "I don't understand this"
  | "focus_intervention"    // "I'm distracted"
  | "next_task"             // "what should I do next" within session
  | "break_recommendation"  // "I need a break"
  | "adapt_session"         // "I already know this" — skip/shorten
  | "planner_adapt"         // "I'm behind" — adjust remaining plan
  | "resume_session"        // returning from break
  | "end_session"           // "I finished" — trigger reflection + report
  | "continue";             // default: keep going

export interface SessionWriteBack {
  confusionPoint?:  string;
  topicCompleted?:  string;
  energyLevel?:     "high" | "medium" | "low";
  pauseStarted?:    boolean;
  pauseEnded?:      boolean;
}

export interface SessionAction {
  type:       SessionActionType;
  topicName:  string | null;    // topic this action applies to
  rationale:  string;           // deterministic rationale (logged, not shown to user)
  writeBack:  SessionWriteBack; // what to persist back to the session record
}

// ── Execution report ───────────────────────────────────────────────────────────
// Produced at session end. Becomes the canonical input for all downstream consumers.
// Stored as Json on NovaStudySession.executionReport.

export type CompletionStatus = "natural" | "goal_complete" | "exhausted" | "abandoned";
export type FocusQuality    = "deep" | "moderate" | "scattered";
export type EnergyTrend     = "rising" | "stable" | "falling";

// ── How a session went ────────────────────────────────────────────────────────
// The learner's own one-tap answer at the end of a session. It is the only
// thing in a report that says how the studying went; a timer cannot.

export type SessionOutcome = "struggled" | "okay" | "good" | "crushed_it";

// Where a report's confidence value came from.
//   learner_outcome  the learner answered "How did it go?"
//   mastery_claim    the closing chat message claimed mastery ("I've got this")
//   unreported       nobody said. The value is a neutral placeholder, not
//                    evidence of how the session went.
export type SessionEvidenceBasis = "learner_outcome" | "mastery_claim" | "unreported";

export interface SessionEvidence {
  confidence: number;                 // 0–1, the Topic Mastery Engine's input
  basis:      SessionEvidenceBasis;
  outcome:    SessionOutcome | null;  // set only when basis is learner_outcome
}

export interface TopicCoverageEntry {
  name:       string;
  subjectId:  string | null;
  confidence: number;   // 0–1, see SessionEvidence for where it came from
}

export interface MasteryUpdate {
  topicName:  string;
  subjectId:  string;
  confidence: number;
}

export interface SessionExecutionReport {
  sessionId:              string;
  profileId:              string;
  actualDurationMinutes:  number;
  plannedDurationMinutes: number;
  topicsCovered:          TopicCoverageEntry[];
  confusionPoints:        string[];
  topicsCompleted:        string[];
  focusQuality:           FocusQuality;
  energyTrend:            EnergyTrend;
  pauseCount:             number;
  totalPausedMinutes:     number;
  completionStatus:       CompletionStatus;
  masteryUpdates:         MasteryUpdate[];
  // How the session went, and who said so (see SessionEvidence).
  outcome:                SessionOutcome | null;
  evidenceBasis:          SessionEvidenceBasis;
  reflectionText:         string | null;
  producedAt:             Date;
}
