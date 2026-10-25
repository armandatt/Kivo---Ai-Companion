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
import { learnerKey } from "./product/learner-key";
import { runUnderstandingBrain } from "./brains/understanding-brain";
import { runDisambiguationPass } from "./brains/disambiguation-pass";
import { safeReading } from "./decision/interpretation-safety";
import { resolveTurnSignals } from "./engines/turn-signals";
import { computeAcademicState, patchMomentaryState } from "./engines/academic-state-engine";
import { getTopicMastery, getAllTopicMasteries } from "./engines/knowledge-engine";
import { buildRetentionSchedule } from "./engines/retention-engine";
import { generateStudyPlan } from "./engines/planning-engine";
import { selectActiveExam, buildExamContext } from "./engines/exam-engine";
import { runPatternDetector } from "./engines/pattern-detector";
import { buildSessionContext, computeSessionAction } from "./engines/study-session-engine";
import { runDecisionGraph } from "./decision/decision-graph";
import { buildDynamicLayer, buildExplainPrompt, buildFocusedLayer, buildMicroPrompt, NOTHING_RECOMMENDED } from "./context/context-builder";
import { runResponseBrain, UNREADABLE_RESPONSE_REPLY } from "./brains/response-brain";
import { groundDurations, groundTopics } from "./brains/grounded-reply";
import { chooseRegister, registerLine } from "./decision/register";
import { loadAccountabilityStyle, loadTone } from "./adapters/operating-style-adapter";
import type { ResponseBrainOutput } from "./types/response.types";
import { getRelevantMemories } from "./adapters/memory-adapter";
import { loadActiveRealityFacts } from "./adapters/reality-adapter";
import { loadCoachingStyle } from "./adapters/operating-style-adapter";
import { loadFirstFocus, loadLearningContexts, loadSignupAnswers } from "./adapters/account-preferences-adapter";
import { builderContextLines } from "./product/builder";
import { preparesTopics, takesOverTheDay } from "./product/deadline-types";
import { calendarDaysUntil, dayKey, resolveTimezone } from "./engines/learner-calendar";
import { countedStudyDays, studiedToday, studyGap } from "./engines/recovery-engine";
import { loadDayOverrides } from "./product/plan-overrides";
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

// Who the learner is, as far as it is on record: the name on their account or
// chat, and what they said they are working toward. Either may be missing,
// and a missing one stays missing: nothing stands in for it.
async function resolveUser(platformChatId: string): Promise<{ id: string; displayName: string | null; goals: string[]; profileId: string | null } | null> {
  const user = await prisma.messengerUser.findUnique({
    where:  learnerKey(platformChatId),
    select: { id: true, displayName: true, novaAcademicProfile: { select: { id: true, goals: true } } },
  });
  if (!user) return null;
  return { id: user.id, displayName: user.displayName?.trim() || null, goals: user.novaAcademicProfile?.goals ?? [], profileId: user.novaAcademicProfile?.id ?? null };
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

export async function runNovaOrchestrator(
  input: NovaOrchestratorInput,
): Promise<NovaOrchestratorResult> {
  const now = input.timestamp ?? new Date();
  const turnStartedAt = Date.now();
  const { platformChatId, text } = input;

  // ── 0. Resolve user ───────────────────────────────────────────────────────
  const user = await resolveUser(platformChatId);
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
  // A surface that already read the message (with its own conversation
  // context) hands the reading in: one message, one reading.
  // A reading the orchestrator makes itself (the web chat box) goes through
  // the same check a surface applies to its own: noise becomes a neutral
  // reading, and an unclear message keeps only its feeling and circumstance.
  let understanding = input.understanding ?? safeReading(
    await runUnderstandingBrain(text, conversationHistory),
    { today: now.toISOString().slice(0, 10) },
  );

  // ── 3. Disambiguation Pass (if needed) ────────────────────────────────────
  if (!input.understanding && understanding.ambiguityScore > 0.80 && understanding.topic === null) {
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
    upcomingExams:          snapshot.upcomingExams.filter(takesOverTheDay),
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
        upcomingExams:          snapshot.upcomingExams.filter(takesOverTheDay),
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
  // The learner's topic names, for checking what the reply recommends (15).
  let topicNames: string[] = [];
  if (shouldRunPatterns && snapshot.profileId) {
    const allTopics = await getAllTopicMasteries(snapshot.profileId);
    topicNames = allTopics.map(t => t.topicName);
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
    snapshot.upcomingExams.filter(preparesTopics).map(e => ({
      id:          e.id,
      title:       e.title,
      subjectName: e.subjectName,
      scheduledAt: e.scheduledAt,
      examType:    e.examType,
    })),
    {},  // topic-by-exam loaded separately if needed
    now,
  );

  // The same dates in the learner's calendar days, which is how every page
  // counts them: the reply must not give a different number from Today.
  const zone = snapshot.timezone ?? null;
  const examCalendarDays = examContext ? calendarDaysUntil(examContext.scheduledAt, now, zone) : null;
  const nextDayTaker = snapshot.upcomingExams.filter(takesOverTheDay)
    .filter(e => e.scheduledAt.getTime() >= now.getTime())
    .sort((x, y) => x.scheduledAt.getTime() - y.scheduledAt.getTime())[0];
  const nextExamCalendarDays = nextDayTaker ? calendarDaysUntil(nextDayTaker.scheduledAt, now, zone) : null;
  // Where the learner is after missed days, on their calendar (recovery-engine).
  const gap = studyGap(dayKey(now, resolveTimezone(zone)), countedStudyDays(snapshot.studySessions, zone));

  // ── 10. Planning Engine (when plan explicitly requested) ──────────────────
  let studyPlan = null;
  if (understanding.intent === "plan_request" && snapshot.profileId) {
    const allTopics = await getAllTopicMasteries(snapshot.profileId);
    studyPlan = generateStudyPlan(
      academicState,
      allTopics,
      snapshot.preferredStudyHoursPerDay,
      examContext,
      // A first day back, and the learner's own changes to today, are
      // planned as Home and the Planner plan them.
      // What was already studied today, as Home and the Planner count it.
      { now, examCalendarDays, reentry: gap.situation === "returning",
        overrides: await loadDayOverrides(snapshot.profileId, dayKey(now, resolveTimezone(zone))),
        doneToday: studiedToday(snapshot.studySessions, zone, now, allTopics) },
    );
  }

  // ── 11. Memory + Reality (parallel) ──────────────────────────────────────
  const [memoryResult, realityFacts, coachingStyle, learningContexts, firstFocus, signup, building] = await Promise.all([
    getRelevantMemories(userId, understanding),
    loadActiveRealityFacts(userId, understanding),
    loadCoachingStyle(platformChatId),
    // What they said they are learning for, what they asked for first, and
    // the rest of their sign-up answers. A turn depends on none of them:
    // unreadable, the learner is spoken to as one who has not said.
    loadLearningContexts(platformChatId).catch(() => []),
    loadFirstFocus(platformChatId).catch(() => null),
    loadSignupAnswers(platformChatId),
    // What they built or are shaping in Build with Nova (titles only).
    user.profileId ? builderContextLines(user.profileId).catch(() => [] as string[]) : Promise.resolve([] as string[]),
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
      displayName:              user.displayName,
      preferredName:            signup.preferredName ?? null,
      goals:                    user.goals,
      building,
      yearOfStudy:              snapshot.yearOfStudy,
      major:                    snapshot.major,
      institution:              snapshot.institution,
      learningContexts,
      firstFocus,
      workingOn:                signup.workingOn,
      weeklyHours:              signup.weeklyHours,
      obstacles:                signup.obstacles,
      preferredStudyHoursPerDay: snapshot.preferredStudyHoursPerDay,
      subjects:                 snapshot.subjects.map(s => s.name),
      daysSinceJoined:          snapshot.daysSinceJoined,
    },
    topicMastery,
    examContext,
    examCalendarDays,
    nextExamCalendarDays,
    daysSinceStudy: gap.daysSinceStudy,
    reentryDay:     gap.situation === "returning",
    studyPlan,
    activeSession:      snapshot.activeSession,
    sessionContext,
    sessionAction,
    patterns:           patternAnalysis,
    topRelevantMemories: memoryResult.top,
    contrastiveMemories: memoryResult.contrastive,
    cognitiveState,
    activeRealityFacts: realityFacts,
    operatingStyle:       coachingStyle.lines,
    operatingStyleStated: coachingStyle.stated,
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
  // A surface that classified the message says which parts of the record the
  // reply needs; only those are put in front of the Response Brain.
  const explaining   = input.focus?.mode === "explain";
  const dynamicLayer = input.focus ? buildFocusedLayer(ctx, input.focus.needs, input.focus.facts) : buildDynamicLayer(ctx);
  const microPrompt  = explaining ? buildExplainPrompt(ctx) : buildMicroPrompt(decision, ctx);

  // ── 15. Response Brain ────────────────────────────────────────────────────
  // A scripted reply states the result of an action that already happened.
  // Otherwise the Response Brain words the decision: it is told the register
  // and, when a surface decided an action, what that action is.
  const scripted = (reply: string): ResponseBrainOutput => ({
    reply, reasoningMode: "direct", confidence: 1,
    stateUpdates: undefined, investigationUpdate: null, followUpCheck: null,
  });
  let brainOutput: ResponseBrainOutput;
  let responseGenerated = false;
  let responseOk        = true;
  let register: string | null = null;
  // Where the turn's time went, for the surface's one log line.
  const contextMs = Date.now() - turnStartedAt;
  let responseMs  = 0;

  if (input.scriptedReply) {
    brainOutput = scripted(input.scriptedReply);
  } else {
    responseGenerated = true;
    const chosen = chooseRegister({
      emotion:           understanding.emotion,
      daysUntilNextExam: academicState.daysUntilNextExam,
      // What is already on record, and what the student has just said: a
      // circumstance disclosed in this message sets the tone of its own reply.
      activeReality:     [
        ...realityFacts.map(r => r.category),
        ...(understanding.realityObservations ?? []).filter(o => o.status === "active").map(o => o.category),
      ],
      accountability:    await loadAccountabilityStyle(platformChatId),
      tone:              await loadTone(platformChatId),
    });
    register = chosen;
    // An explanation has no register to play with: it is plain either way.
    const prompt = [microPrompt, explaining ? null : registerLine(chosen), input.directive ? `Decided action (word this, do not change it): ${input.directive}` : null]
      .filter(Boolean).join("\n\n");
    input.hooks?.beforeResponse?.();
    const respondStartedAt = Date.now();
    try {
      brainOutput = await (input.respond ?? runResponseBrain)(dynamicLayer, prompt);
      responseMs  = Date.now() - respondStartedAt;
      if (input.responseFallback && brainOutput.reply === UNREADABLE_RESPONSE_REPLY) {
        responseOk  = false;
        brainOutput = scripted(input.responseFallback);
      }
      // A length of time the reply states that Nova did not give it was made
      // up by the model: that sentence is taken out (brains/grounded-reply.ts).
      const told = `${dynamicLayer}\n${prompt}\n${text}`;
      const grounded = groundDurations(brainOutput.reply, told);
      if (grounded.removed.length > 0) {
        console.log(JSON.stringify({ layer: "nova:response", event: "ungrounded_duration_removed", removed: grounded.removed.length }));
        brainOutput = { ...brainOutput, reply: grounded.reply };
      }
      // So is a topic it recommends that Nova did not give it (rule 13): a
      // name must be in the context or the learner's message. When the context
      // says nothing is recommended, only the learner's own message grounds
      // one, and the check does not rest on the model declaring it: any of
      // their topics a sentence names is held to that, since nothing chose
      // one of them now.
      const nothingRecommended = dynamicLayer.includes(NOTHING_RECOMMENDED);
      const topics = nothingRecommended
        ? groundTopics(brainOutput.reply, [...(brainOutput.recommends ?? []), ...topicNames], text)
        : groundTopics(brainOutput.reply, brainOutput.recommends, told);
      if (topics.removed.length > 0) {
        console.log(JSON.stringify({ layer: "nova:response", event: "ungrounded_topic_removed", removed: topics.removed.length }));
        brainOutput = { ...brainOutput, reply: topics.reply };
      }
    } catch (err) {
      if (!input.responseFallback) throw err;
      console.error("[nova] response brain failed, using fallback:", (err as Error).message);
      responseMs  = Date.now() - respondStartedAt;
      responseOk  = false;
      brainOutput = scripted(input.responseFallback);
    }
  }

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
    sessionCommandsHandled: input.sessionCommands === "surface",
    now,
  };

  // The reply exists. A surface that sends it itself does so now; what
  // follows records the turn and does not change the reply.
  if (input.hooks?.reply) await input.hooks.reply(brainOutput.reply);

  let persisted: Awaited<ReturnType<typeof persistTurn>> | null = null;
  if (input.awaitPersistence) {
    persisted = await persistTurn(persistence).catch(err => { console.error("[nova:persistence] Write failed:", err); return null; });
  } else {
    persistTurnAsync(persistence);
  }

  return {
    reply:         brainOutput.reply,
    intervention:  decision.selectedIntervention,
    reasoningMode: brainOutput.reasoningMode,
    confidence:    brainOutput.confidence,
    trace: {
      responseGenerated, responseOk, register, contextMs, responseMs,
      persisted:           persisted !== null,
      evidenceKinds:       persisted?.evidenceKinds ?? [],
      consolidationQueued: persisted?.consolidationQueued ?? false,
    },
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
