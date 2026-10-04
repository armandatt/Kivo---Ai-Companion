// ─── Adaptive Planning Engine ─────────────────────────────────────────────────
// When reality changes, plans change automatically.
// Pure function — no LLM, no DB. All data provided by caller.
// Owner: Phase 5 Proactive Mentor System.

import type { AdaptedPlan, PlanChange, MomentumState } from "../types/proactive.types.js";

export interface TopicMasterySnapshot {
  topicName:          string;
  subjectId:          string;
  masteryProbability: number;
  nextReviewAt:       Date | null;
  reviewCount:        number;
}

export interface UpcomingExamSnapshot {
  title:       string;
  subjectName: string;
  subjectId:   string | null;
  scheduledAt: Date;
}

export interface AdaptivePlanningInput {
  momentum:         MomentumState;
  topicMasteries:   TopicMasterySnapshot[];
  upcomingExams:    UpcomingExamSnapshot[];
  plannedTopics:    Array<{ topicName: string; durationMinutes: number; priority: number }>;
  burnoutRiskScore: number;    // 0–100
  missedYesterday:  boolean;
  now:              Date;
}

// ── Public export ─────────────────────────────────────────────────────────────

export function computeAdaptedPlan(input: AdaptivePlanningInput): AdaptedPlan {
  const changes: PlanChange[] = [];
  let totalReducedMinutes = 0;
  let totalAddedMinutes   = 0;

  // ── 1. Remove mastered topics from urgent queue ───────────────────────────
  for (const topic of input.topicMasteries) {
    if (topic.masteryProbability >= 0.85 && topic.reviewCount >= 3) {
      changes.push({
        type:      "remove",
        topicName: topic.topicName,
        reason:    `Mastery ${(topic.masteryProbability * 100).toFixed(0)}% with ${topic.reviewCount} reviews — no urgent revision needed`,
      });
    }
  }

  // ── 2. Boost exam-related topics if exam < 3 days ─────────────────────────
  const imminentExam = findImminentExam(input.upcomingExams, 3, input.now);
  if (imminentExam) {
    const examTopics = input.topicMasteries
      .filter(t => t.subjectId === imminentExam.subjectId && t.masteryProbability < 0.80);
    for (const topic of examTopics) {
      changes.push({
        type:      "reprioritize",
        topicName: topic.topicName,
        reason:    `${imminentExam.title} in ${imminentExam.daysUntil} day(s) — prioritise`,
        priority:  10,
      });
    }
    totalAddedMinutes += examTopics.length * 20;
  }

  // ── 3. Compress plan if burnout risk is high ──────────────────────────────
  if (input.burnoutRiskScore >= 70 || input.momentum.currentMomentum === "critical") {
    const reduction = Math.ceil(input.plannedTopics.length * 0.4);
    const toReduce  = [...input.plannedTopics]
      .sort((a, b) => a.priority - b.priority)   // lowest-priority first
      .slice(0, reduction);
    for (const topic of toReduce) {
      changes.push({
        type:      "reduce_duration",
        topicName: topic.topicName,
        reason:    "Burnout risk detected — reducing session load",
      });
      totalReducedMinutes += Math.round(topic.durationMinutes * 0.35);
    }
  }

  // ── 4. Redistribute missed-yesterday topics ───────────────────────────────
  if (input.missedYesterday) {
    // Find topics that are overdue (nextReviewAt is in the past)
    const overdue = input.topicMasteries.filter(
      t => t.nextReviewAt !== null && t.nextReviewAt <= input.now && t.masteryProbability < 0.75
    );
    for (const topic of overdue.slice(0, 3)) {  // cap at 3 redistributed topics
      changes.push({
        type:      "add",
        topicName: topic.topicName,
        reason:    "Missed yesterday — redistributing overdue topic to today",
        priority:  6,
      });
      totalAddedMinutes += 25;
    }
  }

  // ── 5. Increase challenge if student is ahead ─────────────────────────────
  const averageMastery = computeAverageMastery(input.topicMasteries);
  if (averageMastery >= 0.75 && input.momentum.currentMomentum === "high") {
    const strongTopics = input.topicMasteries
      .filter(t => t.masteryProbability >= 0.80)
      .slice(0, 2);
    for (const topic of strongTopics) {
      changes.push({
        type:      "increase_challenge",
        topicName: topic.topicName,
        reason:    `Mastery ${(topic.masteryProbability * 100).toFixed(0)}% — ready for harder problems`,
      });
    }
  }

  const isSignificantChange = changes.length >= 3 || totalReducedMinutes >= 30 || totalAddedMinutes >= 30;
  const adaptationReason    = summariseReason(changes, imminentExam, input);

  return {
    changes,
    totalReducedMinutes,
    totalAddedMinutes,
    adaptationReason,
    isSignificantChange,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function findImminentExam(
  exams:      UpcomingExamSnapshot[],
  withinDays: number,
  now:        Date,
): { title: string; subjectId: string | null; daysUntil: number } | null {
  const upcoming = exams
    .filter(e => e.scheduledAt > now)
    .map(e => ({
      title:     e.title,
      subjectId: e.subjectId,
      daysUntil: Math.ceil((e.scheduledAt.getTime() - now.getTime()) / 86_400_000),
    }))
    .filter(e => e.daysUntil <= withinDays)
    .sort((a, b) => a.daysUntil - b.daysUntil);
  return upcoming[0] ?? null;
}

function computeAverageMastery(topics: TopicMasterySnapshot[]): number {
  if (topics.length === 0) return 0;
  return topics.reduce((s, t) => s + t.masteryProbability, 0) / topics.length;
}

function summariseReason(
  changes:      PlanChange[],
  imminentExam: { title: string } | null,
  input:        AdaptivePlanningInput,
): string {
  if (changes.length === 0)                        return "No adaptation needed";
  if (imminentExam && input.burnoutRiskScore < 70) return `Exam prep boost: ${imminentExam.title}`;
  if (input.burnoutRiskScore >= 70)                return "Plan compressed — burnout risk";
  if (input.missedYesterday)                       return "Redistribution after missed session";
  return `${changes.length} plan adjustment(s)`;
}
