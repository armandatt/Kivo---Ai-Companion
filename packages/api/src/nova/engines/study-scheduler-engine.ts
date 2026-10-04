// ─── Study Scheduler Engine ───────────────────────────────────────────────────
// Decides WHEN and WHY a proactive event should fire.
// NEVER decides IF (that's the Decision Graph) or HOW (that's Response Brain).
// NEVER makes LLM calls. Deterministic.
// Owner: Phase 5 Proactive Mentor System.

import type { SchedulingDecision, InterventionType, MomentumState } from "../types/proactive.types.js";
import { INTERVENTION_BASE_PRIORITY } from "../types/proactive.types.js";

export interface SchedulerInput {
  momentum:                 MomentumState;
  preferredStudyTime:       string | null;  // "morning" | "afternoon" | "evening"
  preferredStudyHoursPerDay: number;
  upcomingExams: Array<{
    title:       string;
    subjectName: string;
    scheduledAt: Date;
  }>;
  topicsOverdueForReview: Array<{
    topicName: string;
    nextReviewAt: Date;
  }>;
  studiedToday:   boolean;
  hasActiveSession: boolean;
  now:            Date;
}

// ── Public export ─────────────────────────────────────────────────────────────

export function computeSchedulingDecision(input: SchedulerInput): SchedulingDecision {
  const { momentum, upcomingExams, topicsOverdueForReview, studiedToday, hasActiveSession, now } = input;

  const localHour = now.getUTCHours();  // caller must pass local time as UTC (via localNow() in cron)

  // ── 1. Exam countdown (overrides everything) ──────────────────────────────
  const imminent = findImminentExam(upcomingExams, now);
  if (imminent) {
    const daysUntil = imminent.daysUntil;
    const priority  = daysUntil <= 1 ? 10 : daysUntil <= 3 ? 9 : 7;
    return decision("exam_countdown", priority, now, true,
      `${imminent.exam.title} in ${daysUntil} day${daysUntil !== 1 ? "s" : ""}`);
  }

  // ── 2. Burnout prevention (second highest urgency) ────────────────────────
  if (momentum.consecutiveMisses >= 5 || momentum.currentMomentum === "critical") {
    return decision("burnout_prevention", 8, now, false,
      `${momentum.consecutiveMisses} consecutive misses — burnout risk`);
  }

  // ── 3. Active session check-in ────────────────────────────────────────────
  if (hasActiveSession) {
    return decision("mid_session_support", 3, now, false, "student is currently in a study session");
  }

  // ── 4. Consistency recovery (3+ misses, not burnout level) ───────────────
  if (momentum.consecutiveMisses >= 3) {
    return decision("consistency_recovery", 7, now, false,
      `${momentum.consecutiveMisses} consecutive missed sessions`);
  }

  // ── 5. Missed session follow-up (1–2 misses) ─────────────────────────────
  if (momentum.consecutiveMisses >= 1 && momentum.lastSessionDaysAgo >= 1) {
    return decision("missed_session", 6, now, false,
      `No session yesterday — ${momentum.consecutiveMisses} miss(es)`);
  }

  // ── 6. Morning brief (7–9am, not yet studied today) ──────────────────────
  if (localHour >= 7 && localHour < 9 && !studiedToday) {
    return decision("morning_brief", 5, now, false, "morning planning window");
  }

  // ── 7. Study reminder (rhythm-aligned window, not yet studied today) ──────
  if (!studiedToday && isInStudyWindow(input, localHour)) {
    return decision("study_reminder", 5, now, false,
      `${input.preferredStudyTime ?? "preferred"} study window`);
  }

  // ── 8. Revision reminder (overdue topics) ─────────────────────────────────
  if (topicsOverdueForReview.length > 0 && isAfternoonOrEvening(localHour)) {
    return decision("revision_reminder", 4, now, false,
      `${topicsOverdueForReview.length} topic(s) overdue for review`);
  }

  // ── 9. Reflection reminder (evening, studied today) ──────────────────────
  if (studiedToday && localHour >= 19 && localHour < 22) {
    return decision("reflection_reminder", 3, now, false, "end-of-day reflection window");
  }

  // ── 10. Milestone celebration ─────────────────────────────────────────────
  const milestone = findStreakMilestone(momentum.currentStreak);
  if (milestone) {
    return decision("milestone_celebration", 3, now, false,
      `${momentum.currentStreak}-day streak milestone`);
  }

  // ── 11. Weekly review (Sunday evening) ───────────────────────────────────
  if (now.getDay() === 0 && localHour >= 19 && localHour < 22) {
    return decision("weekly_review", 2, now, false, "weekly review window");
  }

  // ── No event ──────────────────────────────────────────────────────────────
  return decision("none", 0, now, false, "no event scheduled");
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function decision(
  eventType:      InterventionType,
  priorityOverride: number,
  now:            Date,
  isUrgent:       boolean,
  triggeringFact: string | null,
): SchedulingDecision {
  const basePriority = INTERVENTION_BASE_PRIORITY[eventType];
  return {
    eventType,
    reason:        triggeringFact ?? eventType,
    priority:      Math.max(basePriority, priorityOverride),
    scheduledFor:  now,
    isUrgent,
    triggeringFact,
  };
}

function findImminentExam(
  exams: Array<{ title: string; subjectName: string; scheduledAt: Date }>,
  now:   Date,
): { exam: { title: string; subjectName: string }; daysUntil: number } | null {
  const upcoming = exams
    .filter(e => e.scheduledAt > now)
    .map(e => ({
      exam:      e,
      daysUntil: Math.ceil((e.scheduledAt.getTime() - now.getTime()) / 86_400_000),
    }))
    .filter(e => e.daysUntil <= 7)   // only care about exams within 7 days
    .sort((a, b) => a.daysUntil - b.daysUntil);

  return upcoming[0] ?? null;
}

function isInStudyWindow(input: SchedulerInput, localHour: number): boolean {
  const preferred = input.preferredStudyTime ?? input.momentum.studyRhythm;
  switch (preferred) {
    case "morning":   return localHour >= 8  && localHour < 11;
    case "afternoon": return localHour >= 14 && localHour < 17;
    case "evening":   return localHour >= 18 && localHour < 21;
    case "night":     return localHour >= 21 || localHour < 1;
    default:          return localHour >= 9  && localHour < 11;  // irregular → morning default
  }
}

function isAfternoonOrEvening(hour: number): boolean {
  return hour >= 13 && hour < 22;
}

const STREAK_MILESTONES = new Set([3, 7, 14, 21, 30, 60, 90, 100, 180, 365]);

function findStreakMilestone(streak: number): number | null {
  return STREAK_MILESTONES.has(streak) ? streak : null;
}
