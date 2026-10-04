// ─── Nova Persistence ─────────────────────────────────────────────────────────
// SKILL.md §1.5 — fire-and-forget. All writes are non-blocking.
// Orchestrator does NOT await persistence writes before returning the reply.
// On error: log and swallow (never fail the response for a write error).
// Owner: Persistence layer.
//
// ── Source-of-truth hierarchy ────────────────────────────────────────────────
//
//   EVIDENCE   — SessionExecutionReport (produced when a session ends)
//                Feeds: Knowledge (mastery), Learning DNA, Retention scheduler.
//                All mastery updates from a report use source="session_report"
//                (full FSRS interval update, reviewCount++).
//
//   OBSERVATION — Conversation signals (study_report without a tracked session)
//                 Feeds: mastery probability softly (source="conversation_signal").
//                 No FSRS interval change. No reviewCount increment.
//
//   NO engine may run a full FSRS update from conversation if an execution
//   report exists. consumeExecutionReport() is the ONLY entry point for evidence.
//   persistTopicMasteryUpdate() is the ONLY entry point for observations.

import { prisma } from "@repo/db/client";
import type { AcademicState, AcademicStateSnapshot } from "../types/academic-state.types.js";
import type { ResponseBrainOutput } from "../types/response.types.js";
import type { SignalEngineOutput } from "../types/engine.types.js";
import type { AcademicUnderstanding } from "../types/understanding.types.js";
import type { ActiveSessionInfo } from "../engines/study-snapshot.js";
import type { SessionContext, SessionAction } from "../types/session.types.js";
import { writeMemoryFact, persistCognitiveStateUpdate } from "../adapters/memory-adapter.js";
import { saveConversationTurn } from "../adapters/scheduler-adapter.js";
import { updateTopicMastery, matchTopicToSubject } from "../engines/topic-mastery-engine.js";
import { buildExecutionReport } from "../engines/study-session-engine.js";
import type { SessionExecutionReport } from "../types/session.types.js";

export interface PersistenceInput {
  userId:          string;
  profileId:       string | null;
  platformChatId:  string;
  userText:        string;
  brainOutput:     ResponseBrainOutput;
  academicState:   AcademicState;
  signals:         SignalEngineOutput;
  graphNode:       string;
  intervention:    string;
  // Step 3: Daily Study Loop
  understanding:   AcademicUnderstanding;
  activeSession:   ActiveSessionInfo | null;
  subjects:        Array<{ id: string; name: string }>;
  // Step 4: Interactive Study Session
  sessionContext:  SessionContext | null;
  sessionAction:   SessionAction | null;
}

// ── Fire-and-forget wrapper ────────────────────────────────────────────────────

export function persistTurnAsync(input: PersistenceInput): void {
  // DO NOT await — this is intentionally non-blocking
  persistTurn(input).catch(err => {
    console.error("[nova:persistence] Write failed:", err);
  });
}

// ── Full turn persistence ──────────────────────────────────────────────────────

async function persistTurn(input: PersistenceInput): Promise<void> {
  const {
    userId, profileId, userText, brainOutput,
    academicState, signals, graphNode, intervention,
    understanding, activeSession, subjects,
    sessionContext, sessionAction,
  } = input;

  const now = new Date();

  const hasStudyReport  = signals.detectedSignals.some(s => s.type === "study_report");
  const hasStudySkip    = signals.detectedSignals.some(s => s.type === "study_skip");
  const hasSessionStart = signals.detectedSignals.some(s => s.type === "session_start");

  const masteryConfidence =
    signals.detectedSignals.find(s => s.type === "mastery_claim")?.intensity ?? 0.6;

  // Build a set of session-lifecycle tasks based on the session action
  const sessionTasks: Promise<void>[] = [];

  if (profileId) {
    const action = sessionAction?.type;

    if (hasSessionStart && !activeSession) {
      // Open a new session
      sessionTasks.push(openStudySession(profileId, understanding.topic, subjects, now));
    }

    if (action === "break_recommendation" && activeSession) {
      // Pause the session
      sessionTasks.push(pauseStudySession(activeSession.id, now));
    }

    if (action === "resume_session" && activeSession) {
      // Resume from break
      sessionTasks.push(resumeStudySession(activeSession.id, now));
    }

    if (sessionAction?.writeBack && activeSession) {
      const wb = sessionAction.writeBack;
      // Write back confusion / completed topics / energy to the session record
      sessionTasks.push(applySessionWriteBack(activeSession.id, wb, now));
    }

    if (action === "end_session" && activeSession && sessionContext) {
      // Close + produce execution report
      sessionTasks.push(
        endStudySession(activeSession.id, sessionContext, masteryConfidence, subjects, now)
      );
    } else if (hasStudyReport && !activeSession) {
      // No tracked session — fall back to self-report estimate
      sessionTasks.push(persistStudySessionFromSignal(profileId, now));
    } else if (hasStudyReport && activeSession && action !== "end_session") {
      // study_report signal but session engine didn't route to end_session
      // (shouldn't normally happen, but handle gracefully)
      sessionTasks.push(closeStudySession(activeSession.id, now));
    }

    if (hasStudySkip) {
      sessionTasks.push(persistStudySkipFromSignal(profileId, now));
    }

    // Conversation-level mastery observation (no session backing).
    // Uses "conversation_signal" source — no FSRS, no reviewCount++.
    if (hasStudyReport && understanding.topic && !activeSession) {
      sessionTasks.push(persistTopicMasteryObservation(understanding.topic, subjects, masteryConfidence, now));
    }
  }

  await Promise.allSettled([
    // 1. Conversation turn
    saveConversationTurn(userId, userText, brainOutput.reply, {
      intervention,
      reasoningMode:  brainOutput.reasoningMode,
      confidence:     brainOutput.confidence,
      graphNode,
    }),

    // 2. Signal memory writes
    ...signals.memoryWrites.map(mw =>
      writeMemoryFact(userId, mw.type, mw.key, mw.value, mw.confidence, mw.shouldUpsert)
    ),

    // 3. Academic state snapshot
    profileId ? persistStateSnapshot(profileId, academicState, now) : Promise.resolve(),

    // 4. Cognitive state update
    profileId && brainOutput.investigationUpdate
      ? persistCognitiveStateUpdate(profileId, brainOutput.investigationUpdate)
      : Promise.resolve(),

    // 5. Session lifecycle tasks (all fire in parallel)
    ...sessionTasks,
  ]);
}

// ── State snapshot ────────────────────────────────────────────────────────────

async function persistStateSnapshot(
  profileId: string,
  state:     AcademicState,
  now:       Date,
): Promise<void> {
  const snapshot: AcademicStateSnapshot = {
    timestamp:      now.toISOString(),
    scores:         state.scores,
    semesterPhase:  state.semesterPhase,
    activeMode:     state.activeMode,
    momentaryState: state.momentaryState,
  };

  const existing = await prisma.novaCognitiveState.findUnique({
    where:  { profileId },
    select: { stateHistory: true },
  });

  const prior      = (existing?.stateHistory as unknown as AcademicStateSnapshot[] | null) ?? [];
  const updated    = [...prior, snapshot].slice(-12);
  const serialized = JSON.parse(JSON.stringify(updated)) as object[];

  await prisma.novaCognitiveState.upsert({
    where:  { profileId },
    update: { stateHistory: serialized },
    create: { profileId, stateHistory: serialized },
  });
}

// ── Session lifecycle ─────────────────────────────────────────────────────────

async function openStudySession(
  profileId: string,
  topic:     string | null,
  subjects:  Array<{ id: string; name: string }>,
  now:       Date,
): Promise<void> {
  const match = topic ? matchTopicToSubject(topic, subjects) : null;
  await prisma.novaStudySession.create({
    data: {
      profileId,
      subjectId:       match?.subjectId ?? null,
      topicName:       topic ?? null,
      durationMinutes: 0,
      activityType:    "active",
      status:          "in_progress",
      sessionDate:     now,
    },
  }).catch(() => {/* swallow — duplicate or constraint */});
}

async function pauseStudySession(sessionId: string, now: Date): Promise<void> {
  await prisma.novaStudySession.update({
    where: { id: sessionId },
    data: {
      status:   "paused",
      pausedAt: now,
      pauseCount: { increment: 1 },
    },
  }).catch(() => {});
}

async function resumeStudySession(sessionId: string, now: Date): Promise<void> {
  const session = await prisma.novaStudySession.findUnique({
    where:  { id: sessionId },
    select: { pausedAt: true, totalPausedMinutes: true },
  });
  if (!session?.pausedAt) return;

  const pausedMinutes = Math.floor((now.getTime() - session.pausedAt.getTime()) / 60_000);
  const totalPaused   = session.totalPausedMinutes + Math.max(0, pausedMinutes);

  await prisma.novaStudySession.update({
    where: { id: sessionId },
    data: {
      status:            "in_progress",
      pausedAt:          null,
      totalPausedMinutes: totalPaused,
    },
  }).catch(() => {});
}

async function applySessionWriteBack(
  sessionId: string,
  wb:        SessionAction["writeBack"],
  now:       Date,
): Promise<void> {
  const data: Record<string, unknown> = {};

  if (wb.confusionPoint) {
    const session = await prisma.novaStudySession.findUnique({
      where:  { id: sessionId },
      select: { confusionPoints: true },
    });
    const existing = session?.confusionPoints ?? [];
    if (!existing.includes(wb.confusionPoint)) {
      data["confusionPoints"] = [...existing, wb.confusionPoint];
    }
  }

  if (wb.topicCompleted) {
    const session = await prisma.novaStudySession.findUnique({
      where:  { id: sessionId },
      select: { topicsCompleted: true },
    });
    const existing = session?.topicsCompleted ?? [];
    if (!existing.includes(wb.topicCompleted)) {
      data["topicsCompleted"] = [...existing, wb.topicCompleted];
    }
  }

  if (wb.energyLevel) data["energyLevel"] = wb.energyLevel;
  if (wb.pauseStarted) { data["status"] = "paused"; data["pausedAt"] = now; data["pauseCount"] = { increment: 1 }; }
  if (wb.pauseEnded) {
    const session = await prisma.novaStudySession.findUnique({
      where:  { id: sessionId },
      select: { pausedAt: true, totalPausedMinutes: true },
    });
    if (session?.pausedAt) {
      const mins = Math.floor((now.getTime() - session.pausedAt.getTime()) / 60_000);
      data["status"]             = "in_progress";
      data["pausedAt"]           = null;
      data["totalPausedMinutes"] = session.totalPausedMinutes + Math.max(0, mins);
    }
  }

  if (Object.keys(data).length === 0) return;

  await prisma.novaStudySession.update({
    where: { id: sessionId },
    data,
  }).catch(() => {});
}

async function closeStudySession(sessionId: string, now: Date): Promise<void> {
  const session = await prisma.novaStudySession.findUnique({
    where:  { id: sessionId },
    select: { sessionDate: true, totalPausedMinutes: true },
  });
  if (!session) return;

  const wallMinutes     = Math.floor((now.getTime() - session.sessionDate.getTime()) / 60_000);
  const durationMinutes = Math.max(1, wallMinutes - session.totalPausedMinutes);

  await prisma.novaStudySession.update({
    where: { id: sessionId },
    data:  { status: "completed", durationMinutes },
  }).catch(() => {});
}

async function endStudySession(
  sessionId:      string,
  sessionContext: SessionContext,
  confidence:     number,
  subjects:       Array<{ id: string; name: string }>,
  now:            Date,
): Promise<void> {
  // 1. Produce execution report (pure function — no DB)
  const report = buildExecutionReport(sessionContext, null, confidence, now);

  // 2. Close session with report + accurate duration
  await prisma.novaStudySession.update({
    where: { id: sessionId },
    data: {
      status:          "completed",
      durationMinutes: report.actualDurationMinutes,
      focusQuality:    report.focusQuality,
      executionReport: JSON.parse(JSON.stringify(report)) as object,
    },
  }).catch(err => console.error("[nova:session] end failed", err));

  // 3. Feed all long-term engines from the execution report.
  //    This is the ONLY place that uses source="session_report".
  await consumeExecutionReport(report, subjects, now);
}

// ── consumeExecutionReport ────────────────────────────────────────────────────
// Single entry point for session evidence → long-term engine writes.
// ALL callers that have a SessionExecutionReport MUST go through here.
// NEVER call updateTopicMastery("session_report") from anywhere else.

async function consumeExecutionReport(
  report:   SessionExecutionReport,
  subjects: Array<{ id: string; name: string }>,
  now:      Date,
): Promise<void> {
  await Promise.allSettled([
    // Knowledge: FSRS update for every topic covered in the session
    ...report.masteryUpdates.map(u =>
      updateTopicMastery(u.subjectId, u.topicName, u.confidence, now, "session_report")
    ),

    // Learning DNA: update from session metrics
    updateLearningDna(report.profileId, report, now),
  ]);
}

// ── Self-reported session (fallback — no active session) ──────────────────────

async function persistStudySessionFromSignal(
  profileId: string,
  now:       Date,
): Promise<void> {
  const profile = await prisma.novaAcademicProfile.findUnique({
    where:  { id: profileId },
    select: { preferredStudyHoursPerDay: true },
  });

  const duration = profile ? Math.round(profile.preferredStudyHoursPerDay * 60 / 2) : 60;

  await prisma.novaStudySession.create({
    data: {
      profileId,
      durationMinutes: duration,
      activityType:    "self_reported",
      status:          "completed",
      sessionDate:     now,
    },
  }).catch(() => {});
}

async function persistStudySkipFromSignal(
  profileId: string,
  now:       Date,
): Promise<void> {
  await prisma.novaStudySession.create({
    data: {
      profileId,
      durationMinutes: 0,
      activityType:    "self_reported",
      status:          "skipped",
      sessionDate:     now,
    },
  }).catch(() => {});
}

// ── Observation-only mastery (no session backing) ─────────────────────────────
// Used when a study_report signal fires in conversation without an active session.
// Source is ALWAYS "conversation_signal" — no FSRS interval update, no reviewCount++.
// This is the observation path. Evidence comes only from consumeExecutionReport().

async function persistTopicMasteryObservation(
  topicName:  string,
  subjects:   Array<{ id: string; name: string }>,
  confidence: number,
  now:        Date,
): Promise<void> {
  const match = matchTopicToSubject(topicName, subjects);
  if (!match) return;
  await updateTopicMastery(match.subjectId, match.resolvedName, confidence, now, "conversation_signal");
}

// ── Learning DNA update from execution report ─────────────────────────────────
// Only called from consumeExecutionReport() — never from conversation paths.
// Computes: optimalSessionMinutes, planAdherenceProfile, confidence tier.

async function updateLearningDna(
  profileId: string,
  report:    SessionExecutionReport,
  now:       Date,
): Promise<void> {
  const existing = await prisma.novaLearningDNA.findUnique({
    where:  { profileId },
    select: {
      optimalSessionMinutes: true,
      dataPointCount:        true,
      planAdherenceProfile:  true,
    },
  });

  const count    = (existing?.dataPointCount ?? 0) + 1;

  // Optimal session minutes: moving average over sessions that completed their goal
  let optimalMinutes = existing?.optimalSessionMinutes ?? null;
  if (
    report.completionStatus === "goal_complete" ||
    report.completionStatus === "natural"
  ) {
    optimalMinutes = optimalMinutes === null
      ? report.actualDurationMinutes
      : Math.round(0.7 * optimalMinutes + 0.3 * report.actualDurationMinutes);
  }

  // Plan adherence: actual / planned ratio across this session
  const adherenceRatio = report.plannedDurationMinutes > 0
    ? report.actualDurationMinutes / report.plannedDurationMinutes
    : null;

  let planAdherenceProfile = existing?.planAdherenceProfile ?? null;
  if (adherenceRatio !== null) {
    planAdherenceProfile =
      adherenceRatio >= 0.8 ? "consistent" :
      adherenceRatio <= 0.4 ? "inconsistent" :
      "variable";
  }

  // Confidence tier: low < 3 data points, medium < 10, high >= 10
  const dnaTier =
    count >= 10 ? "high" :
    count >= 3  ? "medium" :
    "low";

  await prisma.novaLearningDNA.upsert({
    where:  { profileId },
    update: {
      dataPointCount:       count,
      optimalSessionMinutes: optimalMinutes,
      planAdherenceProfile,
      confidence:           dnaTier,
    },
    create: {
      profileId,
      dataPointCount:       count,
      optimalSessionMinutes: optimalMinutes,
      planAdherenceProfile,
      confidence:           dnaTier,
    },
  }).catch(err => console.error("[nova:dna] update failed", err));
}
