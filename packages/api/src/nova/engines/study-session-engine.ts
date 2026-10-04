// ─── Study Session Engine ─────────────────────────────────────────────────────
// SKILL.md §8 — deterministic session action routing.
// Maps (understanding + signals + sessionContext) → SessionAction.
// Owns the session state machine logic.
// NEVER makes LLM calls. NEVER modifies DB.
// Owner: Study Session Engine.

import type { AcademicUnderstanding } from "../types/understanding.types.js";
import type { SignalEngineOutput } from "../types/engine.types.js";
import type { ActiveSessionInfo } from "./study-snapshot.js";
import type {
  SessionContext,
  SessionAction,
  SessionActionType,
  SessionExecutionReport,
  FocusQuality,
  CompletionStatus,
} from "../types/session.types.js";

// ── Build SessionContext from raw snapshot data ────────────────────────────────
// Called by the orchestrator after snapshot load.

export function buildSessionContext(
  info:            ActiveSessionInfo,
  masteryEstimate: number,   // 0–1, from Knowledge Engine or 0.5 default
  now:             Date,
  profileId:       string,
): SessionContext {
  const wallMinutes = Math.floor((now.getTime() - info.startedAt.getTime()) / 60_000);
  const elapsed     = Math.max(0, wallMinutes - info.totalPausedMinutes);

  return {
    sessionId:              info.id,
    profileId,
    status:                 info.status as SessionContext["status"],
    topicName:              info.topicName,
    subjectId:              info.subjectId,
    subjectName:            info.subjectName,
    currentFocus:           info.currentFocus,
    startedAt:              info.startedAt,
    elapsedMinutes:         elapsed,
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

// ── Execution report ───────────────────────────────────────────────────────────
// Pure function — no DB access.
// Called by persistence layer when session ends.

export function buildExecutionReport(
  session:            SessionContext,
  reflectionText:     string | null,
  reportedConfidence: number,   // 0–1, from mastery_claim signal intensity or default
  now:                Date,
): SessionExecutionReport {
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
    reflectionText,
    producedAt:             now,
  };
}
