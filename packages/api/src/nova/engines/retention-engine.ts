// ─── Retention Engine ─────────────────────────────────────────────────────────
// SKILL.md §8.3 — compute review schedules and urgency rankings.
// Interface is permanent. Algorithm (FSRS-lite) is replaceable.
// NEVER makes LLM calls. NEVER modifies DB (read-only; writes go through
// knowledge-engine.ts after a session is confirmed complete).
// Owner: Retention Engine.

import type { RetentionSchedule } from "../types/engine.types";
import type { TopicMasteryState } from "../types/engine.types";

const RETENTION_TARGET = 0.85;  // below this = review is due

// ── Urgency computation ───────────────────────────────────────────────────────
// urgencyScore 0–1 where 1 = critically overdue

function computeUrgency(
  retentionEstimate: number,
  daysOverdue:       number,
): number {
  if (retentionEstimate >= RETENTION_TARGET && daysOverdue <= 0) return 0;

  const retentionGap     = Math.max(0, RETENTION_TARGET - retentionEstimate) / RETENTION_TARGET;
  const overdueComponent = Math.min(1, daysOverdue / 14);  // caps at 14 days overdue

  // Weighted: retention gap matters more than raw overdue days
  return Math.min(1, retentionGap * 0.7 + overdueComponent * 0.3);
}

// ── Build schedule from loaded topic masteries ────────────────────────────────

export function buildRetentionSchedule(topics: TopicMasteryState[]): RetentionSchedule[] {
  const now = new Date();

  return topics
    .map(t => {
      const daysOverdue = t.reviewDueAt
        ? Math.floor((now.getTime() - t.reviewDueAt.getTime()) / 86_400_000)
        : 0;

      const urgencyScore = computeUrgency(t.retentionEstimate, daysOverdue);

      return {
        topicId:         t.topicId,
        topicName:       t.topicName,
        nextReviewAt:    t.reviewDueAt ?? now,
        intervalDays:    t.reviewDueAt
          ? Math.max(1, Math.ceil((t.reviewDueAt.getTime() - (t.lastStudied?.getTime() ?? now.getTime())) / 86_400_000))
          : 1,
        efFactor:        2.5,   // default — actual stored in DB via knowledge-engine
        retentionTarget: RETENTION_TARGET,
        urgencyScore,
      };
    })
    .sort((a, b) => b.urgencyScore - a.urgencyScore);
}

// ── Get topics that need review today ─────────────────────────────────────────

export function getOverdueTopics(topics: TopicMasteryState[]): TopicMasteryState[] {
  const now = new Date();
  return topics.filter(t =>
    t.reviewDueAt !== null && t.reviewDueAt <= now && t.retentionEstimate < RETENTION_TARGET,
  ).sort((a, b) => a.retentionEstimate - b.retentionEstimate);
}

// ── Prioritize for exam (override normal FSRS schedule) ───────────────────────
// When exam is within 14 days, urgency is weighted by masteryProbability.

export function getExamPriorityOrder(
  topics:       TopicMasteryState[],
  topicWeights: Record<string, number>,  // topicName → 0–1 importance
): TopicMasteryState[] {
  return [...topics].sort((a, b) => {
    const weightA    = topicWeights[a.topicName] ?? 0.5;
    const weightB    = topicWeights[b.topicName] ?? 0.5;
    const priorityA  = weightA * (1 - a.masteryProbability);
    const priorityB  = weightB * (1 - b.masteryProbability);
    return priorityB - priorityA;
  });
}

// ── Compute estimated retention at exam time ──────────────────────────────────
// R(t) = e^(-t / (S * efFactor)), S = 10

export function estimateRetentionAtExam(
  topic:        TopicMasteryState,
  daysUntilExam: number,
): number {
  const S        = 10;
  const daysSinceStudied = topic.lastStudied
    ? Math.floor((Date.now() - topic.lastStudied.getTime()) / 86_400_000)
    : 30;

  const totalDays = daysSinceStudied + daysUntilExam;
  const efFactor  = 2.5;  // default; actual stored in DB
  const R         = Math.exp(-(totalDays / (S * efFactor)));
  return Math.max(0, Math.min(1, R));
}
