// ─── Nova Proactive Cron ──────────────────────────────────────────────────────
// Entry point for the 5-minute Nova proactive tick.
// Loads all onboarded Nova users and runs the per-user pipeline.
// Reuses Rex's global fire rules (quiet hours, recently messaged check).
// Owner: Phase 5 Proactive Mentor System.
//
// Pipeline per user:
//   1. Load Academic Snapshot + Reality Facts (parallel)
//   2. Compute Academic State (deterministic, reuse existing engine)
//   3. Compute Momentum State (new — study-momentum-engine)
//   4. Compute Scheduling Decision (new — study-scheduler-engine)
//   5. Compute Intervention Decision (new — intervention-engine)
//   6. Check cooldown (DB query for NovaProactiveMessage)
//   7. Run Proactive Decision Graph (new — proactive-decision-graph)
//   8. If approved → Response Brain → text
//   9. Send Telegram
//  10. Persist NovaProactiveMessage (cooldown + dedup record)

import { prisma } from "@repo/db/client";
import { loadStudySnapshot } from "../engines/study-snapshot.js";
import { computeAcademicState } from "../engines/academic-state-engine.js";
import { computeMomentumState } from "../engines/study-momentum-engine.js";
import { computeSchedulingDecision } from "../engines/study-scheduler-engine.js";
import { computeIntervention } from "../engines/intervention-engine.js";
import { runProactiveDecisionGraph } from "../decision/proactive-decision-graph.js";
import { runProactiveResponseBrain } from "./nova-proactive-response.js";
import { getLocalHHMM, isInQuietHours } from "../../services/schedulerEngine.service.js";
import { STATE_BASELINES } from "../types/academic-state.types.js";
import type { NovaRealityFact, RealityCategory } from "../types/reality.types.js";
import type { InterventionType } from "../types/proactive.types.js";
import { INTERVENTION_COOLDOWN_HOURS } from "../types/proactive.types.js";

export interface NovaProactiveCronResult {
  ok:       boolean;
  sent:     number;
  checked:  number;
  errors:   number;
}

// ── Main export ────────────────────────────────────────────────────────────────

export async function runNovaProactiveCron(now = new Date()): Promise<NovaProactiveCronResult> {
  console.log(`[nova:cron] Proactive tick at ${now.toISOString()}`);

  const token = process.env.TELEGRAM_BOT_TOKEN ?? process.env.BOT_TOKEN;
  if (!token) {
    console.error("[nova:cron] TELEGRAM_BOT_TOKEN not set");
    return { ok: false, sent: 0, checked: 0, errors: 0 };
  }

  // Load all onboarded Nova users with their Telegram chat IDs
  const profiles = await prisma.novaAcademicProfile.findMany({
    where: { onboardingComplete: true },
    select: {
      id:                        true,
      timezone:                  true,
      preferredStudyTime:        true,
      preferredStudyHoursPerDay: true,
      user: {
        select: {
          id:             true,
          platformChatId: true,
          timezone:       true,
          intakeAnswers:  true,
          displayName:    true,
        },
      },
    },
  });

  console.log(`[nova:cron] Found ${profiles.length} onboarded Nova users`);

  let sent   = 0;
  let errors = 0;

  for (const profile of profiles) {
    try {
      const fired = await processNovaUser(profile, now, token);
      if (fired) sent++;
    } catch (err) {
      console.error(`[nova:cron] Error for profile ${profile.id}:`, err);
      errors++;
    }
  }

  return { ok: true, sent, checked: profiles.length, errors };
}

// ── Per-user pipeline ─────────────────────────────────────────────────────────

async function processNovaUser(
  profile: {
    id:                        string;
    timezone:                  string | null;
    preferredStudyTime:        string | null;
    preferredStudyHoursPerDay: number;
    user: {
      id:             string;
      platformChatId: string;
      timezone:       string | null;
      intakeAnswers:  unknown;
      displayName:    string | null;
    };
  },
  now:   Date,
  token: string,
): Promise<boolean> {
  const chatId   = profile.user.platformChatId;
  const timezone = profile.timezone ?? profile.user.timezone ?? "UTC";

  // ── Global fire rules (reused from Rex) ────────────────────────────────────
  const localHHMM = getLocalHHMM(now, timezone);
  if (isInQuietHours(profile.user.intakeAnswers, localHHMM)) {
    return false;
  }

  // Check if messaged in last 5 minutes (lighter than Rex's 10-min check)
  const recentlyMessaged = await messagedRecently(chatId, now, 5);
  if (recentlyMessaged) return false;

  // ── Step 1: Load Academic Snapshot + Reality (parallel) ───────────────────
  const [snapshot, realityFacts] = await Promise.all([
    loadStudySnapshot(chatId),
    loadProactiveRealityFacts(profile.user.id, now),
  ]);

  if (!snapshot.profileId) return false;

  // ── Step 2: Compute Academic State ───────────────────────────────────────
  const academicState = computeAcademicState({
    semesterStartDate:       snapshot.semesterStartDate,
    semesterEndDate:         snapshot.semesterEndDate,
    daysSinceJoined:         snapshot.daysSinceJoined,
    studySessions:           snapshot.studySessions,
    upcomingExams:           snapshot.upcomingExams,
    stateHistory:            snapshot.stateHistory,
    signals:                 { detectedSignals: [], stateUpdates: [], memoryWrites: [] },
    mentionedTopicMastery:   null,
    understanding:           buildNullUnderstanding(),
    storedScores:            snapshot.storedScores,
    storedStreakDays:        snapshot.storedStreakDays,
    storedConsecutiveMisses: snapshot.storedConsecutiveMisses,
  }, now);

  // ── Step 3: Compute Momentum State ────────────────────────────────────────
  const momentum = computeMomentumState({
    studySessions:     snapshot.studySessions,
    consecutiveMisses: academicState.consecutiveMisses,
    studyStreakDays:   academicState.studyStreakDays,
    stateHistory:      snapshot.stateHistory.map(h => ({
      engagement: typeof h.scores?.engagement === "number" ? h.scores.engagement : undefined,
    })),
    now,
  });

  // ── Step 4: Compute Scheduling Decision ───────────────────────────────────
  const studiedToday    = academicState.daysSinceLastSession === 0;
  const hasActiveSession = snapshot.activeSession !== null;

  // Load overdue topics from knowledge engine
  const overdueTopics = await loadOverdueTopics(snapshot.profileId!, now);

  const scheduling = computeSchedulingDecision({
    momentum,
    preferredStudyTime:       profile.preferredStudyTime,
    preferredStudyHoursPerDay: profile.preferredStudyHoursPerDay,
    upcomingExams:            snapshot.upcomingExams.map(e => ({
      title:       e.title,
      subjectName: e.subjectName ?? "Unknown",
      scheduledAt: e.scheduledAt,
    })),
    topicsOverdueForReview: overdueTopics,
    studiedToday,
    hasActiveSession,
    now: localNow(now, timezone),   // local time for window checks
  });

  // ── Step 5: Compute Intervention Decision ─────────────────────────────────
  const intervention = computeIntervention({
    scheduling,
    momentum,
    academicState,
    realityFacts,
  });

  // ── Step 6: Cooldown check ────────────────────────────────────────────────
  const isInCooldown = await checkCooldown(snapshot.profileId!, intervention.type, now);

  // ── Step 7: Proactive Decision Graph ──────────────────────────────────────
  const decision = runProactiveDecisionGraph({
    intervention,
    academicState,
    momentum,
    realityFacts,
    hasActiveSession,
    studiedToday,
    isInCooldown,
    messagedRecently: false,  // already checked above
    isQuietHours:     false,  // already checked above
  });

  // ── Persist decision (even if suppressed — for analytics) ─────────────────
  await persistProactiveDecision(snapshot.profileId!, decision, intervention.type, now);

  if (!decision.approved) {
    console.log(`[nova:cron] ${chatId} suppressed: ${decision.suppressReason}`);
    return false;
  }

  // ── Step 8: Response Brain ────────────────────────────────────────────────
  const upcomingExam   = snapshot.upcomingExams[0] ?? null;
  const studentName    = profile.user.displayName ?? "Student";

  const text = await runProactiveResponseBrain({
    studentName,
    decision,
    momentum,
    academicState,
    upcomingExamTitle: upcomingExam?.title ?? null,
    overdueTopics:     overdueTopics.map(t => t.topicName),
    studiedToday,
    preferredStudyHoursPerDay: profile.preferredStudyHoursPerDay,
  });

  // ── Step 9: Send Telegram ─────────────────────────────────────────────────
  await sendTelegramMessage(chatId, text, token);

  // ── Step 10: Persist conversation turn ────────────────────────────────────
  await persistProactiveMessage(snapshot.profileId!, chatId, text, decision.finalInterventionType);

  console.log(`[nova:cron] Sent ${decision.finalInterventionType} to ${chatId}`);
  return true;
}

// ── DB helpers ────────────────────────────────────────────────────────────────

async function messagedRecently(chatId: string, now: Date, minutes: number): Promise<boolean> {
  const since = new Date(now.getTime() - minutes * 60_000);
  const user  = await prisma.messengerUser.findUnique({
    where:  { platform_platformChatId: { platform: "telegram", platformChatId: chatId } },
    select: {
      messages: {
        where:  { role: "user", createdAt: { gte: since } },
        select: { id: true },
        take:   1,
      },
    },
  });
  return Boolean(user?.messages.length);
}

async function loadProactiveRealityFacts(userId: string, now: Date): Promise<NovaRealityFact[]> {
  const stored = await prisma.userReality.findMany({
    where:   { userId, isActive: true, expiresAt: { gte: now } },
    orderBy: { createdAt: "desc" },
    take:    10,
  });

  return stored
    .filter(r => r.confidence >= 0.5)
    .map(r => ({
      id:          r.id,
      category:    (r.category ?? "other") as RealityCategory,
      description: r.fact,
      confidence:  r.confidence,
      relevance:   0.8,   // all active facts are relevant to proactive decisions
      expiresAt:   r.expiresAt,
      sourceText:  r.sourceText ?? null,
    }));
}

async function loadOverdueTopics(
  profileId: string,
  now:       Date,
): Promise<Array<{ topicName: string; nextReviewAt: Date }>> {
  const overdue = await prisma.novaTopicMastery.findMany({
    where: {
      subject: { profileId },
      nextReviewAt: { lte: now },
    },
    orderBy: { nextReviewAt: "asc" },
    take: 5,
    select: { name: true, nextReviewAt: true },
  });
  return overdue
    .filter(t => t.nextReviewAt !== null)
    .map(t => ({ topicName: t.name, nextReviewAt: t.nextReviewAt! }));
}

async function checkCooldown(
  profileId:    string,
  eventType:    InterventionType,
  now:          Date,
): Promise<boolean> {
  if (eventType === "none") return true;
  const existing = await prisma.novaProactiveMessage.findFirst({
    where: {
      profileId,
      eventType,
      cooldownUntil: { gte: now },
    },
    select: { id: true },
  });
  return existing !== null;
}

async function persistProactiveDecision(
  profileId:    string,
  decision:     { approved: boolean; finalInterventionType: InterventionType; suppressReason: string | null; priority: number; confidence: number },
  originalType: InterventionType,
  now:          Date,
): Promise<void> {
  const eventType    = decision.finalInterventionType;
  const cooldownHrs  = INTERVENTION_COOLDOWN_HOURS[eventType] ?? 4;
  const cooldownUntil = new Date(now.getTime() + cooldownHrs * 3_600_000);

  await prisma.novaProactiveMessage.create({
    data: {
      profileId,
      eventType,
      firedAt:       now,
      cooldownUntil,
      priority:      decision.priority,
      confidence:    decision.confidence,
      approved:      decision.approved,
      suppressReason: decision.suppressReason,
    },
  }).catch(err => console.error("[nova:cron] persist decision failed", err));
}

async function persistProactiveMessage(
  profileId:        string,
  chatId:           string,
  text:             string,
  interventionType: InterventionType,
): Promise<void> {
  // Store as a CompanionMessage so it appears in conversation history
  const user = await prisma.messengerUser.findUnique({
    where:  { platform_platformChatId: { platform: "telegram", platformChatId: chatId } },
    select: { id: true },
  });
  if (!user) return;

  await prisma.companionMessage.create({
    data: {
      userId:  user.id,
      role:    "assistant",
      text,
      intent:  `nova_proactive_${interventionType}`,
    },
  }).catch(err => console.error("[nova:cron] persist message failed", err));
}

// ── Send ──────────────────────────────────────────────────────────────────────

async function sendTelegramMessage(chatId: string, text: string, token: string): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ chat_id: chatId, text }),
  });
  if (!res.ok) {
    console.error(`[nova:cron] Telegram send failed for ${chatId}: ${res.status}`);
  }
}

// ── Academic State null understanding ─────────────────────────────────────────
// The academic state engine requires an understanding object but the proactive
// cron has no student message. We pass a neutral placeholder.

function buildNullUnderstanding() {
  return {
    intent:          "general_chat" as const,
    emotion:         "neutral" as const,
    topic:           null,
    topicConfidence: 0,
    ambiguityScore:  0,
    disclosureClass: "none" as const,
    routingSignal:   "coaching_only" as const,
    confidence:      1,
    reasoning:       "proactive cron — no student message",
    rawText:         "",
  };
}

// ── Local time conversion ─────────────────────────────────────────────────────
// Returns a Date whose getHours() returns local hours for the given timezone.
// Used by scheduler engine window checks.

function localNow(now: Date, timezone: string): Date {
  const localStr  = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(now);

  // "2024-11-13, 14:30:00" → parse as local Date
  // Intl returns "YYYY-MM-DD, HH:mm:ss" in en-CA locale
  const cleaned = localStr.replace(",", "");
  return new Date(cleaned + " GMT+0000");   // treat as UTC so getHours() gives local hours
}
