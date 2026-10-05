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
//   Observations are decided by the consolidation layer.
//
// ── Consolidation boundary (SKILL.md §11.7) ──────────────────────────────────
//
//   This module writes three things directly:
//     1. the conversation log (the record of what happened)
//     2. the interactive study-session lifecycle (an entity the student is
//        explicitly operating: start, pause, resume, end)
//     3. the academic-state score snapshot (the State Engine's own time series)
//   Everything inferred from the turn — facts, reality, behavioral patterns,
//   investigation state, self-reported sessions — is emitted as evidence and
//   written only by the consolidation runner. A turn's consolidation is a
//   retryable job in Postgres, applied in one transaction.

import { prisma } from "@repo/db/client";
import type { AcademicState, AcademicStateSnapshot } from "../types/academic-state.types";
import type { ResponseBrainOutput } from "../types/response.types";
import type { PatternAnalysis, SignalEngineOutput } from "../types/engine.types";
import type { AcademicUnderstanding } from "../types/understanding.types";
import type { ActiveSessionInfo } from "../engines/study-snapshot";
import type { SessionContext, SessionAction } from "../types/session.types";
import { saveUserMessage, saveAssistantMessage } from "../adapters/conversation-adapter";
import { buildTurnEvidence } from "../consolidation/evidence-builder";
import { consolidateTurn } from "../consolidation/run-consolidation";
import { updateTopicMastery, matchTopicToSubject } from "../engines/topic-mastery-engine";
import { buildExecutionReport, buildSessionContext, computeSessionAction } from "../engines/study-session-engine";
import { pauseLengthSeconds, pausedSecondsOf, sessionElapsedSeconds } from "../engines/session-clock";
import { withEstablishedSignal } from "../engines/signal-engine";
import { translateNovaCommand } from "../commands";
import type { SessionExecutionReport } from "../types/session.types";

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
  // Consolidation
  patterns:        PatternAnalysis;
  patternScanRan:  boolean;
  now:             Date;
}

// ── Fire-and-forget wrapper ────────────────────────────────────────────────────

export function persistTurnAsync(input: PersistenceInput): void {
  // DO NOT await — this is intentionally non-blocking
  persistTurn(input).catch(err => {
    console.error("[nova:persistence] Write failed:", err);
  });
}

// ── Full turn persistence ──────────────────────────────────────────────────────

export async function persistTurn(input: PersistenceInput): Promise<void> {
  const {
    userId, profileId, userText, brainOutput,
    academicState, signals, graphNode, intervention,
    understanding, activeSession, subjects,
    sessionContext, sessionAction, now,
  } = input;

  const { tasks: sessionTasks } = sessionLifecycle({
    profileId, signals, sessionAction, sessionContext, activeSession,
    topic: understanding.topic, subjects, now,
  });

  // 1. Conversation log first: the user message id is the provenance of
  //    every piece of evidence this turn produces.
  let sourceMessageId: string | null = null;
  try {
    sourceMessageId = await saveUserMessage(userId, userText, {
      intent:  understanding.intent,
      emotion: understanding.emotion,
      signals: signals.detectedSignals.map(s => s.type),
      secondaryIntents: understanding.secondaryIntents,
    }, now);
  } catch (err) {
    console.error("[nova:persistence] user message save failed:", err);
  }

  // 2. Evidence → Consolidation → Durable state.
  const evidence = buildTurnEvidence({
    userId, profileId, sourceMessageId, userText,
    observedAt:    now,
    signals:       signals.detectedSignals,
    understanding,
    patterns:      input.patterns,
    brainOutput,
  });

  await Promise.allSettled([
    saveAssistantMessage(userId, brainOutput.reply, `nova_${intervention}`, {
      intervention,
      reasoningMode: brainOutput.reasoningMode,
      confidence:    brainOutput.confidence,
      graphNode,
    }, now),

    // No source message, no provenance: nothing from this turn may become
    // durable state.
    sourceMessageId === null ? Promise.resolve(null) : consolidateTurn({
      messageId: sourceMessageId,
      userId, profileId, evidence, now,
      patternScanRan:   input.patternScanRan,
      hasActiveSession: activeSession !== null,
    }),

    // 3. Academic state snapshot
    profileId ? persistStateSnapshot(profileId, academicState, now) : Promise.resolve(),

    // 4. Session lifecycle tasks (all fire in parallel)
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
// One routing of (signals, session action) to session writes. A chat turn
// (persistTurn) and a session command from the web app (persistSessionEnd)
// both go through it, so "the session ended" means one thing.

const OPEN_STATUSES = ["in_progress", "paused"];

interface SessionLifecycleInput {
  profileId:      string | null;
  signals:        SignalEngineOutput;
  sessionAction:  SessionAction | null;
  sessionContext: SessionContext | null;
  activeSession:  ActiveSessionInfo | null;
  topic:          string | null;
  subjects:       Array<{ id: string; name: string }>;
  now:            Date;
}

function sessionLifecycle(input: SessionLifecycleInput): {
  tasks: Promise<void>[];
  // Resolves true when this call closed the session and its execution
  // report was consumed. null when the turn does not end a session.
  ended: Promise<boolean> | null;
} {
  const { profileId, signals, sessionAction, sessionContext, activeSession, subjects, now } = input;
  const tasks: Promise<void>[] = [];
  let ended: Promise<boolean> | null = null;
  if (!profileId) return { tasks, ended };

  const hasStudyReport  = signals.detectedSignals.some(s => s.type === "study_report");
  const hasSessionStart = signals.detectedSignals.some(s => s.type === "session_start");
  const masteryConfidence =
    signals.detectedSignals.find(s => s.type === "mastery_claim")?.intensity ?? 0.6;
  const action = sessionAction?.type;

  if (hasSessionStart && !activeSession) {
    tasks.push(openStudySession(profileId, input.topic, subjects, now));
  }
  if (action === "break_recommendation" && activeSession) {
    tasks.push(pauseStudySession(activeSession.id, now));
  }
  if (action === "resume_session" && activeSession) {
    tasks.push(resumeStudySession(activeSession.id, now));
  }
  if (sessionAction?.writeBack && activeSession) {
    // Confusion points, completed topics and energy on the session record.
    tasks.push(applySessionWriteBack(activeSession.id, sessionAction.writeBack));
  }

  if (action === "end_session" && activeSession && sessionContext) {
    // Close + produce the execution report
    ended = endStudySession(activeSession.id, sessionContext, masteryConfidence, subjects, now);
    tasks.push(ended.then(() => undefined));
  } else if (hasStudyReport && activeSession && action !== "end_session") {
    // study_report signal but the session engine didn't route to end_session
    // (shouldn't normally happen, but handle gracefully)
    tasks.push(closeStudySession(activeSession.id, now));
  }
  return { tasks, ended };
}

// ── Session end from a command surface ────────────────────────────────────────
// The web app's End session button is the /done command without a chat turn.
// It produces what /done produces: the same established study_report signal,
// routed by the same session engine to the same execution report, and the
// same evidence handed to the same consolidation job. No LLM call.
// Returns false when there was nothing to end (already ended elsewhere).

export interface SessionEndInput {
  userId:        string;                 // MessengerUser.id
  profileId:     string;
  activeSession: ActiveSessionInfo;
  subjects:      Array<{ id: string; name: string }>;
  surface:       "web";
  now:           Date;
}

export async function persistSessionEnd(input: SessionEndInput): Promise<boolean> {
  const { userId, profileId, activeSession, subjects, now } = input;

  // What the command states. Nothing here is a reading of the student's
  // words: the intent is the command's own, the topic is the session's.
  const { text } = translateNovaCommand("/done");
  const signals  = withEstablishedSignal({ detectedSignals: [], stateUpdates: [] }, "study_report", "command");
  const understanding: AcademicUnderstanding = {
    intent: "study_report", emotion: "neutral",
    topic: activeSession.topicName, topicConfidence: activeSession.topicName ? 1 : 0,
    disclosureClass: "none", ambiguityScore: 0, routingSignal: "coaching_only", rawText: text,
  };

  const sessionContext = buildSessionContext(activeSession, NEUTRAL_MASTERY_ESTIMATE, now, profileId);
  const sessionAction  = computeSessionAction(understanding, signals, sessionContext);

  const { tasks, ended } = sessionLifecycle({
    profileId, signals, sessionAction, sessionContext, activeSession,
    topic: understanding.topic, subjects, now,
  });
  const [closed] = await Promise.all([ended ?? Promise.resolve(false), Promise.allSettled(tasks)]);
  // Another request or a chat turn got there first: it owns the evidence.
  if (!closed) return false;

  let sourceMessageId: string | null = null;
  try {
    sourceMessageId = await saveUserMessage(userId, text, {
      intent:  understanding.intent,
      emotion: understanding.emotion,
      signals: signals.detectedSignals.map(s => s.type),
      surface: input.surface,
    }, now);
  } catch (err) {
    console.error("[nova:persistence] session-end message save failed:", err);
  }
  // No source message, no provenance: the session row and its report stand,
  // nothing else becomes durable.
  if (sourceMessageId === null) return true;

  const evidence = buildTurnEvidence({
    userId, profileId, sourceMessageId, userText: text,
    observedAt:  now,
    signals:     signals.detectedSignals,
    understanding,
    patterns:    { detectedPatterns: [], dominantPattern: null, analysisRunAt: now, messagesSinceLastRun: 0 },
    brainOutput: null,
  });
  await consolidateTurn({
    messageId: sourceMessageId,
    userId, profileId, evidence, now,
    patternScanRan:   false,
    hasActiveSession: true,   // as in a chat turn: the state the command arrived in
  }).catch(err => console.error("[nova:persistence] session-end consolidation failed:", err));

  return true;
}

const NEUTRAL_MASTERY_ESTIMATE = 0.5;

// The session writers below are exported for the product session commands
// (product/session.ts). A button and a chat turn open and pause a session
// through the same code. Each write is conditional on the state it expects,
// so a repeated or concurrent command changes nothing.

// One learner, one open session. Two starts can arrive together (two tabs, or
// the web app and a chat turn), so the check and the insert run under a row
// lock on the learner's profile: the second start waits, then finds the
// session the first one opened and creates nothing.
export async function openStudySession(
  profileId: string,
  topic:     string | null,
  subjects:  Array<{ id: string; name: string }>,
  now:       Date,
  // Known when the session starts from a plan block rather than a sentence.
  planned:   { subjectId?: string | null; durationMinutes?: number | null } = {},
): Promise<void> {
  const match = topic ? matchTopicToSubject(topic, subjects) : null;
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "NovaAcademicProfile" WHERE id = ${profileId} FOR UPDATE`;

    const open = await tx.novaStudySession.findFirst({
      where:  { profileId, status: { in: OPEN_STATUSES } },
      select: { id: true },
    });
    if (open) return;

    await tx.novaStudySession.create({
      data: {
        profileId,
        subjectId:       planned.subjectId ?? match?.subjectId ?? null,
        topicName:       topic ?? null,
        plannedDurationMinutes: planned.durationMinutes ?? null,
        durationMinutes: 0,
        activityType:    "active",
        status:          "in_progress",
        sessionDate:     now,
      },
    });
  }).catch(err => console.error("[nova:session] start failed", err));
}

export async function pauseStudySession(sessionId: string, now: Date): Promise<void> {
  await prisma.novaStudySession.updateMany({
    where: { id: sessionId, status: "in_progress" },
    data: {
      status:   "paused",
      pausedAt: now,
      pauseCount: { increment: 1 },
    },
  }).catch(() => {});
}

export async function resumeStudySession(sessionId: string, now: Date): Promise<void> {
  const session = await prisma.novaStudySession.findUnique({
    where:  { id: sessionId },
    select: { pausedAt: true, totalPausedMinutes: true, totalPausedSeconds: true },
  });
  if (!session?.pausedAt) return;

  const totalPaused = pausedSecondsOf(session) + pauseLengthSeconds(session.pausedAt, now);

  // Conditional on the pause being the one that was read: a second resume
  // finds it gone and adds nothing.
  await prisma.novaStudySession.updateMany({
    where: { id: sessionId, status: "paused", pausedAt: session.pausedAt },
    data: {
      status:             "in_progress",
      pausedAt:           null,
      totalPausedSeconds: totalPaused,
      totalPausedMinutes: Math.floor(totalPaused / 60),
    },
  }).catch(() => {});
}

// Pausing and resuming are not written here: break_recommendation and
// resume_session go through pauseStudySession / resumeStudySession, the one
// place the pause clock is kept.
async function applySessionWriteBack(
  sessionId: string,
  wb:        SessionAction["writeBack"],
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

  if (Object.keys(data).length === 0) return;

  await prisma.novaStudySession.update({
    where: { id: sessionId },
    data,
  }).catch(() => {});
}

async function closeStudySession(sessionId: string, now: Date): Promise<void> {
  const session = await prisma.novaStudySession.findUnique({
    where:  { id: sessionId },
    select: { sessionDate: true, status: true, pausedAt: true, totalPausedMinutes: true, totalPausedSeconds: true },
  });
  if (!session) return;

  const seconds = sessionElapsedSeconds({
    startedAt: session.sessionDate, status: session.status, pausedAt: session.pausedAt,
    totalPausedSeconds: pausedSecondsOf(session),
  }, now);

  await prisma.novaStudySession.updateMany({
    where: { id: sessionId, status: { in: OPEN_STATUSES } },
    data:  { status: "completed", durationMinutes: Math.max(1, Math.floor(seconds / 60)) },
  }).catch(() => {});
}

async function endStudySession(
  sessionId:      string,
  sessionContext: SessionContext,
  confidence:     number,
  subjects:       Array<{ id: string; name: string }>,
  now:            Date,
): Promise<boolean> {
  // 1. Produce execution report (pure function — no DB)
  const report = buildExecutionReport(sessionContext, null, confidence, now);

  // 2. Close session with report + accurate duration. Conditional on the
  //    session still being open: only the call that closes it goes on to
  //    feed the engines, so a report is consumed exactly once.
  const closed = await prisma.novaStudySession.updateMany({
    where: { id: sessionId, status: { in: OPEN_STATUSES } },
    data: {
      status:          "completed",
      durationMinutes: report.actualDurationMinutes,
      focusQuality:    report.focusQuality,
      executionReport: JSON.parse(JSON.stringify(report)) as object,
    },
  }).then(r => r.count === 1).catch(err => { console.error("[nova:session] end failed", err); return false; });
  if (!closed) return false;

  // 3. Feed all long-term engines from the execution report.
  //    This is the ONLY place that uses source="session_report".
  await consumeExecutionReport(report, subjects, now);
  return true;
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
