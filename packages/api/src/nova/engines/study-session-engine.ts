// ─── Study Session Engine ─────────────────────────────────────────────────────
// SKILL.md §8 — deterministic session action routing.
// Maps (understanding + signals + sessionContext) → SessionAction.
// Owns the session state machine logic.
// NEVER makes LLM calls. NEVER modifies DB.
// Owner: Study Session Engine.

import type { AcademicUnderstanding } from "../types/understanding.types";
import type { SignalEngineOutput } from "../types/engine.types";
import type { ActiveSessionInfo } from "./study-snapshot";
import { sessionElapsedSeconds } from "./session-clock";
import type {
  SessionContext,
  SessionAction,
  SessionActionType,
  SessionExecutionReport,
  FocusQuality,
  CompletionStatus,
  SessionEvidence,
  SessionOutcome,
} from "../types/session.types";

// ── Build SessionContext from raw snapshot data ────────────────────────────────
// Called by the orchestrator after snapshot load.

export function buildSessionContext(
  info:            ActiveSessionInfo,
  masteryEstimate: number,   // 0–1, from Knowledge Engine or 0.5 default
  now:             Date,
  profileId:       string,
): SessionContext {
  const elapsed = Math.floor(sessionElapsedSeconds(info, now) / 60);

  return {
    sessionId:              info.id,
    profileId,
    status:                 info.status as SessionContext["status"],
    topicName:              info.topicName,
    subjectId:              info.subjectId,
    subjectName:            info.subjectName,
    currentFocus:           info.currentFocus,
    startedAt:              info.startedAt,
    elapsedMinutes:         elapsed,          // pauses excluded, an open one included
    plannedDurationMinutes: info.plannedDurationMinutes,
    confusionPoints:        info.confusionPoints,
    topicsCompleted:        info.topicsCompleted,
    pauseCount:             info.pauseCount,
    totalPausedMinutes:     info.totalPausedMinutes,
    isPaused:               info.status === "paused",
    pausedAt:               info.pausedAt,
    energyLevel:            (info.energyLevel as SessionContext["energyLevel"]) ?? null,
    masteryEstimate,
    sessionGoal:            null,  // TODO: wire from plan block rationale
  };
}

// ── Action routing ────────────────────────────────────────────────────────────
// Priority order:
//   1. Break request (structural signal, always honoured)
//   2. Distraction (structural signal, focus intervention)
//   3. Resume (paused + session_start)
//   4. Topic confusion / explanation request
//   5. Mastery claim (already knows this → adapt)
//   6. Session end (study_report)
//   7. Next task / planner adapt
//   8. Continue (default)

export function computeSessionAction(
  understanding: AcademicUnderstanding,
  signals:       SignalEngineOutput,
  session:       SessionContext | null,
): SessionAction | null {
  if (!session) return null;
  if (session.status === "completed" || session.status === "skipped") return null;

  const det = signals.detectedSignals;
  const topic = understanding.topic ?? session.topicName;

  // 1. Break
  if (det.some(s => s.type === "break_request")) {
    return {
      type:      "break_recommendation",
      topicName: session.topicName,
      rationale: "Student requested a break",
      writeBack: { pauseStarted: true, energyLevel: "low" },
    };
  }

  // 2. Distraction
  if (det.some(s => s.type === "distraction")) {
    return {
      type:      "focus_intervention",
      topicName: session.topicName,
      rationale: "Student losing focus during session",
      writeBack: { energyLevel: "low" },
    };
  }

  // 3. Resume from break
  if (session.isPaused && det.some(s => s.type === "session_start")) {
    return {
      type:      "resume_session",
      topicName: session.topicName,
      rationale: "Student returning from break",
      writeBack: { pauseEnded: true, energyLevel: "medium" },
    };
  }

  // 4. Confusion / explanation (topic_question intent OR confusion in text)
  if (understanding.intent === "topic_question") {
    return {
      type:      "explain_topic",
      topicName: topic,
      rationale: `Student confused about ${topic ?? "current topic"}`,
      writeBack: topic ? { confusionPoint: topic } : {},
    };
  }

  // 5. Mastery claim → skip or shorten current topic
  if (understanding.intent === "mastery_claim") {
    return {
      type:      "adapt_session",
      topicName: session.topicName,
      rationale: "Student claims mastery — advance to next topic",
      writeBack: session.topicName
        ? { topicCompleted: session.topicName, energyLevel: "high" }
        : {},
    };
  }

  // 6. Session end
  if (det.some(s => s.type === "study_report")) {
    return {
      type:      "end_session",
      topicName: session.topicName,
      rationale: "Student completed study session",
      writeBack: session.topicName ? { topicCompleted: session.topicName } : {},
    };
  }

  // 7. Progress check or schedule query during session → planner adapt
  if (
    understanding.intent === "progress_check" ||
    understanding.intent === "schedule_query"
  ) {
    return {
      type:      "planner_adapt",
      topicName: session.topicName,
      rationale: "Student checking progress mid-session",
      writeBack: {},
    };
  }

  // 8. Plan request mid-session → next task
  if (understanding.intent === "plan_request") {
    return {
      type:      "next_task",
      topicName: session.topicName,
      rationale: "Student asking what to do next",
      writeBack: {},
    };
  }

  // Default: continue
  return {
    type:      "continue",
    topicName: session.topicName,
    rationale: "No session event this turn",
    writeBack: {},
  };
}

// ── Session evidence ──────────────────────────────────────────────────────────
// The learner's answer to "How did it go?", as the 0–1 confidence the Topic
// Mastery Engine takes. Four ordered steps, each landing in its own grade
// band of that engine (below 0.40 → 1, 0.55 → 3, 0.70 → 4, 0.85 → 5):
//
//   struggled   0.30  grade 1: the review interval resets to one day, so
//                     the topic is due again tomorrow
//   okay        0.60  grade 3: the interval grows, slowly
//   good        0.75  grade 4: the interval grows
//   crushed_it  0.90  grade 5: the interval grows fastest
//
// These are a learner's self-report, not a measurement. They replace a
// constant with something the learner said; they do not make the mastery
// number a tested result.

export const SESSION_OUTCOME_CONFIDENCE: Record<SessionOutcome, number> = {
  struggled:  0.30,
  okay:       0.60,
  good:       0.75,
  crushed_it: 0.90,
};

export const SESSION_OUTCOMES = Object.keys(SESSION_OUTCOME_CONFIDENCE) as SessionOutcome[];

// Used when nobody said how the session went (/done with no claim, or an end
// request that carries no answer). A neutral value so the topic is still
// recorded as studied and rescheduled; the report is marked "unreported".
export const UNREPORTED_SESSION_CONFIDENCE = 0.6;

// The one place a session's evidence is decided. An explicit answer from the
// learner wins over a claim read from a chat message.
export function sessionEvidence(input: {
  outcome?:              SessionOutcome | null;
  masteryClaimIntensity?: number | null;
}): SessionEvidence {
  if (input.outcome) {
    return { confidence: SESSION_OUTCOME_CONFIDENCE[input.outcome], basis: "learner_outcome", outcome: input.outcome };
  }
  if (typeof input.masteryClaimIntensity === "number") {
    return { confidence: input.masteryClaimIntensity, basis: "mastery_claim", outcome: null };
  }
  return { confidence: UNREPORTED_SESSION_CONFIDENCE, basis: "unreported", outcome: null };
}

// ── Execution report ───────────────────────────────────────────────────────────
// Pure function — no DB access.
// Called by persistence layer when session ends.

export function buildExecutionReport(
  session:            SessionContext,
  reflectionText:     string | null,
  evidence:           SessionEvidence,
  now:                Date,
): SessionExecutionReport {
  const reportedConfidence = evidence.confidence;
  const actualDuration = Math.max(
    1,
    session.elapsedMinutes,   // already has paused time subtracted
  );

  // Derive completion status
  const completionStatus: CompletionStatus =
    session.confusionPoints.length >= 3 || session.pauseCount >= 3
      ? "exhausted"
      : actualDuration >= session.plannedDurationMinutes * 0.9 && session.plannedDurationMinutes > 0
        ? "goal_complete"
        : actualDuration <= (session.plannedDurationMinutes || 60) * 0.4
          ? "abandoned"
          : "natural";

  // Derive focus quality from confusion + pauses
  const focusQuality: FocusQuality =
    session.confusionPoints.length >= 3 || session.pauseCount >= 3
      ? "scattered"
      : session.confusionPoints.length >= 1 || session.pauseCount >= 1
        ? "moderate"
        : "deep";

  // All topics touched in this session
  const topicNames = [
    ...(session.topicName ? [session.topicName] : []),
    ...session.topicsCompleted.filter(t => t !== session.topicName),
  ];

  const topicsCovered = topicNames.map(name => ({
    name,
    subjectId:  session.subjectId ?? null,
    confidence: reportedConfidence,
  }));

  const masteryUpdates = topicsCovered
    .filter(t => t.subjectId !== null)
    .map(t => ({
      topicName:  t.name,
      subjectId:  t.subjectId as string,
      confidence: t.confidence,
    }));

  return {
    sessionId:              session.sessionId,
    profileId:              session.profileId,
    actualDurationMinutes:  actualDuration,
    plannedDurationMinutes: session.plannedDurationMinutes,
    topicsCovered,
    confusionPoints:        session.confusionPoints,
    topicsCompleted:        session.topicsCompleted,
    focusQuality,
    energyTrend:            "stable",   // simplified: full trend needs multi-point readings
    pauseCount:             session.pauseCount,
    totalPausedMinutes:     session.totalPausedMinutes,
    completionStatus,
    masteryUpdates,
    outcome:                evidence.outcome,
    evidenceBasis:          evidence.basis,
    reflectionText,
    producedAt:             now,
  };
}

// ── Which finished sessions count as study ────────────────────────────────────
// The one definition, used by Progress and Learning DNA. A session the
// learner only told Nova about ("self_reported") has a placeholder duration
// and no timer behind it; a timer stopped inside ten minutes is not a study
// session. Ten minutes is the shortest block the Planning Engine schedules
// (MIN_BLOCK_MINUTES).

export const SELF_REPORTED_ACTIVITY  = "self_reported";
export const COUNTED_SESSION_MINUTES = 10;

export const isTimedSession   = (s: { activityType: string }) => s.activityType !== SELF_REPORTED_ACTIVITY;
export const isCountedSession = (s: { activityType: string; durationMinutes: number }) =>
  isTimedSession(s) && s.durationMinutes >= COUNTED_SESSION_MINUTES;
