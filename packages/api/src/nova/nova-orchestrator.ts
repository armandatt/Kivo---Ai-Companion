// ─── Nova Orchestrator ────────────────────────────────────────────────────────
// SKILL.md §1, §5 — the full pipeline, single entry point.
// Order:
//   1. Study Snapshot (parallel DB load)
//   2. Understanding Brain (gpt-4o-mini)
//   3. Disambiguation Pass (if needed)
//   4. Signal Engine (deterministic)
//   5. Academic State Engine (deterministic)
//   6. Knowledge Engine (topic lookup)
//   7. Pattern Detector (every N messages)
//   8. Academic State patch (with pattern results)
//   9. Exam Engine (if exam active)
//  10. Planning Engine (if plan requested)
//  11. Memory + Reality load (parallel)
//  12. Decision Graph
//  13. Context Builder (dynamic layer + micro-prompt)
//  14. Response Brain (gpt-4o)
//  15. Persistence (fire-and-forget)
// Owner: Nova Orchestrator.

import { loadStudySnapshot } from "./engines/study-snapshot.js";
import { runUnderstandingBrain } from "./brains/understanding-brain.js";
import { runDisambiguationPass } from "./brains/disambiguation-pass.js";
import { extractSignals } from "./engines/signal-engine.js";
import { computeAcademicState, patchMomentaryState } from "./engines/academic-state-engine.js";
import { getTopicMastery, getAllTopicMasteries } from "./engines/knowledge-engine.js";
import { buildRetentionSchedule } from "./engines/retention-engine.js";
import { generateStudyPlan } from "./engines/planning-engine.js";
import { selectActiveExam, buildExamContext } from "./engines/exam-engine.js";
import { runPatternDetector } from "./engines/pattern-detector.js";
import { buildSessionContext, computeSessionAction } from "./engines/study-session-engine.js";
import { runDecisionGraph } from "./decision/decision-graph.js";
import { buildDynamicLayer, buildMicroPrompt } from "./context/context-builder.js";
import { runResponseBrain } from "./brains/response-brain.js";
import { getRelevantMemories } from "./adapters/memory-adapter.js";
import { loadActiveRealityFacts } from "./adapters/reality-adapter.js";
import { loadConversationHistory } from "./adapters/scheduler-adapter.js";
import { persistTurnAsync } from "./persistence/nova-persistence.js";
import { prisma } from "@repo/db/client";
import type { NovaOrchestratorInput, NovaContext, ConversationTurn } from "./types/context.types.js";
import type { NovaOrchestratorResult } from "./types/response.types.js";
import type { NovaCognitiveState } from "./types/memory.types.js";
import type { PatternAnalysis } from "./types/engine.types.js";
import type { SessionContext, SessionAction } from "./types/session.types.js";
import { STATE_BASELINES } from "./types/academic-state.types.js";

// How often to run the pattern detector (every N messages per user).
const PATTERN_DETECTOR_INTERVAL = 5;

// ── User resolution ───────────────────────────────────────────────────────────

async function resolveUserId(platformChatId: string): Promise<{ id: string } | null> {
  const user = await prisma.messengerUser.findUnique({
    where:  { platform_platformChatId: { platform: "telegram", platformChatId } },
    select: { id: true },
  });
  return user;
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

export async function runNovaOrchestrator(
  input: NovaOrchestratorInput,
): Promise<NovaOrchestratorResult> {
  const now = input.timestamp ?? new Date();
  const { platformChatId, text } = input;

  // ── 0. Resolve user ───────────────────────────────────────────────────────
  const user = await resolveUserId(platformChatId);
  if (!user) {
    return {
      reply:         "Hey! Looks like you're not set up yet. Let me get you started.",
      intervention:  "empathize",
      reasoningMode: "empathetic",
      confidence:    0.9,
    };
  }
  const userId = user.id;

  // ── 1. Study Snapshot + Conversation History (parallel) ───────────────────
  const [snapshot, conversationHistory] = await Promise.all([
    loadStudySnapshot(platformChatId),
    loadConversationHistory(userId),
  ]);

  // ── 2. Understanding Brain ────────────────────────────────────────────────
  let understanding = await runUnderstandingBrain(
    text,
    conversationHistory,
  );

  // ── 3. Disambiguation Pass (if needed) ────────────────────────────────────
  if (understanding.ambiguityScore > 0.80 && understanding.topic === null) {
    understanding = await runDisambiguationPass(
      understanding,
      conversationHistory,
      snapshot.subjects.map(s => s.name),
    );
  }

  // ── 4. Signal Engine ──────────────────────────────────────────────────────
  // Need minimal AcademicState to pass to signal engine; we'll compute full
  // state next. Use empty state placeholder for signal extraction (signals
  // don't depend on state).
  const EMPTY_STATE = buildEmptyAcademicState(snapshot.daysSinceJoined);
  const signals = extractSignals(text, EMPTY_STATE);

  // ── 5. Academic State Engine ──────────────────────────────────────────────
  let academicState = computeAcademicState({
    semesterStartDate:      snapshot.semesterStartDate,
    semesterEndDate:        snapshot.semesterEndDate,
    daysSinceJoined:        snapshot.daysSinceJoined,
    studySessions:          snapshot.studySessions,
    upcomingExams:          snapshot.upcomingExams,
    stateHistory:           snapshot.stateHistory,
    signals,
    mentionedTopicMastery:  null,  // loaded next
    understanding,
    storedScores:           snapshot.storedScores,
    storedStreakDays:        snapshot.storedStreakDays,
    storedConsecutiveMisses: snapshot.storedConsecutiveMisses,
  }, now);

  // ── 6. Knowledge Engine (topic lookup) ────────────────────────────────────
  let topicMastery = null;
  if (understanding.topic && snapshot.profileId) {
    topicMastery = await getTopicMastery(snapshot.profileId, understanding.topic);
    if (topicMastery) {
      // Re-run state with topic mastery for calibration gap
      academicState = computeAcademicState({
        semesterStartDate:      snapshot.semesterStartDate,
        semesterEndDate:        snapshot.semesterEndDate,
        daysSinceJoined:        snapshot.daysSinceJoined,
        studySessions:          snapshot.studySessions,
        upcomingExams:          snapshot.upcomingExams,
        stateHistory:           snapshot.stateHistory,
        signals,
        mentionedTopicMastery:  topicMastery,
        understanding,
        storedScores:           snapshot.storedScores,
        storedStreakDays:        snapshot.storedStreakDays,
        storedConsecutiveMisses: snapshot.storedConsecutiveMisses,
      }, now);
    }
  }

  // ── 6b. Study Session Engine ──────────────────────────────────────────────
  // Converts raw activeSession info + mastery into SessionContext,
  // then routes this turn's intent to a deterministic SessionAction.
  let sessionContext: SessionContext | null = null;
  let sessionAction:  SessionAction  | null = null;

  if (snapshot.activeSession && snapshot.profileId) {
    const masteryEstimate = topicMastery?.masteryProbability ?? 0.5;
    sessionContext = buildSessionContext(snapshot.activeSession, masteryEstimate, now, snapshot.profileId);
    sessionAction  = computeSessionAction(understanding, signals, sessionContext);
  }

  // ── 7. Pattern Detector (every N messages) ────────────────────────────────
  let patternAnalysis: PatternAnalysis = {
    detectedPatterns:     [],
    dominantPattern:      null,
    analysisRunAt:        now,
    messagesSinceLastRun: 0,
  };

  // Determine if we should run pattern detection this turn
  const shouldRunPatterns = true; // TODO: track per-user count and gate on interval
  if (shouldRunPatterns && snapshot.profileId) {
    const allTopics = await getAllTopicMasteries(snapshot.profileId);
    patternAnalysis = runPatternDetector({
      studySessions:        snapshot.studySessions,
      signalHistory:        [],  // TODO: load from memory facts
      topicMasteries:       allTopics.map(t => ({
        topicName:          t.topicName,
        masteryProbability: t.masteryProbability,
        confidenceReported: t.confidenceReported,
        reviewCount:        t.reviewCount,
        lastStudiedAt:      t.lastStudied,
      })),
      priorPatterns:        [],  // TODO: load from cognitive state
      messagesSinceLastRun: 1,
    });
  }

  // ── 8. Patch momentary state with pattern results ──────────────────────────
  const hasExcuseLoop     = patternAnalysis.detectedPatterns.some(p => p.type === "excuse_loop");
  const hasComparisonTrap = patternAnalysis.detectedPatterns.some(p => p.type === "comparison_trap");
  academicState = patchMomentaryState(academicState, hasExcuseLoop, hasComparisonTrap, understanding);

  // ── 9. Exam Engine ────────────────────────────────────────────────────────
  const examContext = selectActiveExam(
    snapshot.upcomingExams.map(e => ({
      id:          e.id,
      title:       e.title,
      subjectName: e.subjectName,
      scheduledAt: e.scheduledAt,
      examType:    e.examType,
    })),
    {},  // topic-by-exam loaded separately if needed
    now,
  );

  // ── 10. Planning Engine (when plan explicitly requested) ──────────────────
  let studyPlan = null;
  if (understanding.intent === "plan_request" && snapshot.profileId) {
    const allTopics = await getAllTopicMasteries(snapshot.profileId);
    studyPlan = generateStudyPlan(
      academicState,
      allTopics,
      snapshot.preferredStudyHoursPerDay,
      examContext,
    );
  }

  // ── 11. Memory + Reality (parallel) ──────────────────────────────────────
  const [memoryResult, realityFacts] = await Promise.all([
    getRelevantMemories(userId, understanding),
    loadActiveRealityFacts(userId, understanding),
  ]);

  // ── 12. Assemble NovaContext ───────────────────────────────────────────────
  const cognitiveState: NovaCognitiveState = {
    investigationTopic:       snapshot.cognitiveState?.investigationTopic ?? null,
    investigationHypotheses:  snapshot.cognitiveState?.investigationHypotheses ?? [],
    investigationMissingData: snapshot.cognitiveState?.investigationMissingData ?? [],
    investigationEvidence:    snapshot.cognitiveState?.investigationEvidence ?? null,
    investigationAttempts:    snapshot.cognitiveState?.investigationAttempts ?? 0,
    investigationStatus:      snapshot.cognitiveState?.investigationStatus ?? null,
    investigationStartedAt:   snapshot.cognitiveState?.investigationStartedAt ?? null,
    investigationUpdatedAt:   snapshot.cognitiveState?.investigationUpdatedAt ?? null,
    followUpChecks:           snapshot.cognitiveState?.followUpChecks as NovaCognitiveState["followUpChecks"] ?? null,
    reasoningHistory:         snapshot.cognitiveState?.reasoningHistory as NovaCognitiveState["reasoningHistory"] ?? null,
  };

  const ctx: NovaContext = {
    platformChatId,
    rawMessage:     text,
    timestamp:      now,
    understanding,
    academicState,
    signals,
    userProfile: {
      displayName:              "Student",  // TODO: load from MessengerUser.name
      yearOfStudy:              snapshot.yearOfStudy,
      major:                    snapshot.major,
      institution:              snapshot.institution,
      preferredStudyHoursPerDay: snapshot.preferredStudyHoursPerDay,
      subjects:                 snapshot.subjects.map(s => s.name),
      daysSinceJoined:          snapshot.daysSinceJoined,
    },
    topicMastery,
    examContext,
    studyPlan,
    activeSession:      snapshot.activeSession,
    sessionContext,
    sessionAction,
    patterns:           patternAnalysis,
    topRelevantMemories: memoryResult.top,
    contrastiveMemories: memoryResult.contrastive,
    cognitiveState,
    activeRealityFacts: realityFacts,
    conversationHistory,
    decision:           null,  // filled after graph runs
  };

  // ── 13. Decision Graph ────────────────────────────────────────────────────
  const decision = runDecisionGraph(
    understanding,
    academicState,
    signals,
    patternAnalysis,
    memoryResult.top,
  );
  ctx.decision = decision;

  // ── 14. Context Builder ───────────────────────────────────────────────────
  const dynamicLayer = buildDynamicLayer(ctx);
  const microPrompt  = buildMicroPrompt(decision, ctx);

  // ── 15. Response Brain ────────────────────────────────────────────────────
  const brainOutput = await runResponseBrain(dynamicLayer, microPrompt);

  // ── 16. Persistence (fire-and-forget) ─────────────────────────────────────
  persistTurnAsync({
    userId,
    profileId:      snapshot.profileId,
    platformChatId,
    userText:       text,
    brainOutput,
    academicState,
    signals,
    graphNode:      decision.graphNode,
    intervention:   decision.selectedIntervention,
    understanding,
    activeSession:  snapshot.activeSession,
    subjects:       snapshot.subjects,
    sessionContext,
    sessionAction,
  });

  return {
    reply:         brainOutput.reply,
    intervention:  decision.selectedIntervention,
    reasoningMode: brainOutput.reasoningMode,
    confidence:    brainOutput.confidence,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildEmptyAcademicState(daysSinceJoined: number) {
  return {
    semesterPhase:  "beginning" as const,
    activeMode:     "standard" as const,
    momentaryState: "neutral" as const,
    scores:         { ...STATE_BASELINES },
    hardDirectives: {
      noStudyPressure: false, examCrisisMode: false, planFreezeMode: false,
      calibrationAlert: false, noChallenging: false, recoveryMode: false,
      beginnerMode: daysSinceJoined < 30,
    },
    daysSinceJoined,
    daysSinceLastSession: 999,
    consecutiveMisses:    0,
    studyStreakDays:       0,
    daysUntilNextExam:    null,
    momentum7dTrend:      [0, 0, 0, 0, 0, 0, 0],
    stateHistory:         [],
  };
}
