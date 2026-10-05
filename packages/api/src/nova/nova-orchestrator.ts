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
//  11. Memory + Reality load (parallel, read-only)
//  12. Decision Graph
//  13. Context Builder (dynamic layer + micro-prompt)
//  14. Response Brain (gpt-4o)
//  15. Persistence (fire-and-forget): conversation log, then
//      evidence → consolidation → durable state (SKILL.md §11.7)
// Owner: Nova Orchestrator.

import { loadStudySnapshot } from "./engines/study-snapshot";
import { runUnderstandingBrain } from "./brains/understanding-brain";
import { runDisambiguationPass } from "./brains/disambiguation-pass";
import { resolveTurnSignals } from "./engines/turn-signals";
import { computeAcademicState, patchMomentaryState } from "./engines/academic-state-engine";
import { getTopicMastery, getAllTopicMasteries } from "./engines/knowledge-engine";
import { buildRetentionSchedule } from "./engines/retention-engine";
import { generateStudyPlan } from "./engines/planning-engine";
import { selectActiveExam, buildExamContext } from "./engines/exam-engine";
import { runPatternDetector } from "./engines/pattern-detector";
import { buildSessionContext, computeSessionAction } from "./engines/study-session-engine";
import { runDecisionGraph } from "./decision/decision-graph";
import { buildDynamicLayer, buildMicroPrompt } from "./context/context-builder";
import { runResponseBrain } from "./brains/response-brain";
import { getRelevantMemories } from "./adapters/memory-adapter";
import { loadActiveRealityFacts } from "./adapters/reality-adapter";
import { loadConversationHistory, loadSignalHistory, annotationTags } from "./adapters/conversation-adapter";
import { loadPriorPatterns } from "./consolidation/stores/behavioral-pattern-store";
import { persistTurn, persistTurnAsync } from "./persistence/nova-persistence";
import { prisma } from "@repo/db/client";
import type { NovaOrchestratorInput, NovaContext, ConversationTurn } from "./types/context.types";
import type { NovaOrchestratorResult } from "./types/response.types";
import type { NovaCognitiveState } from "./types/memory.types";
import type { PatternAnalysis } from "./types/engine.types";
import type { SessionContext, SessionAction } from "./types/session.types";
import { STATE_BASELINES } from "./types/academic-state.types";

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
  const [snapshot, conversationHistory, signalHistory, priorPatterns] = await Promise.all([
    loadStudySnapshot(platformChatId),
    loadConversationHistory(userId),
    loadSignalHistory(userId),
    loadPriorPatterns(userId),
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

  // The signal engine proposes; commands and the Understanding Brain
  // establish; everything uncorroborated is dropped (engines/turn-signals.ts).
  const signals = resolveTurnSignals({ text, command: input.command, understanding, state: EMPTY_STATE });

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
      // Prior turns from the conversation log, plus this turn.
      signalHistory:        [
        ...signalHistory,
        {
          timestamp: now,
          signals:   annotationTags({
            intent:  understanding.intent,
            emotion: understanding.emotion,
            signals: signals.detectedSignals.map(s => s.type),
            secondaryIntents: understanding.secondaryIntents,
          }),
        },
      ],
      topicMasteries:       allTopics.map(t => ({
        topicName:          t.topicName,
        masteryProbability: t.masteryProbability,
        confidenceReported: t.confidenceReported,
        reviewCount:        t.reviewCount,
        lastStudiedAt:      t.lastStudied,
      })),
      priorPatterns,
      messagesSinceLastRun: 1,
    }, now);
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
  const persistence = {
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
    patterns:       patternAnalysis,
    patternScanRan: shouldRunPatterns && snapshot.profileId !== null,
    now,
  };

  if (input.awaitPersistence) {
    await persistTurn(persistence).catch(err => console.error("[nova:persistence] Write failed:", err));
  } else {
    persistTurnAsync(persistence);
  }

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
