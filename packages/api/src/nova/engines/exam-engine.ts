// ─── Exam Intelligence Engine ──────────────────────────────────────────────────
// SKILL.md §8.5 — analyze exam proximity and generate risk matrix.
// NEVER makes LLM calls. NEVER modifies DB.
// Owner: Exam Engine.

import type { ExamContext, ExamMode, TopicMasteryState } from "../types/engine.types.js";

export interface RawExam {
  id:          string;
  title:       string;
  subjectName: string | null;
  scheduledAt: Date;
  examType:    string;
}

// ── Risk classification ────────────────────────────────────────────────────────

function classifyRisk(
  topics:   TopicMasteryState[],
  daysLeft: number,
): ExamContext["riskMatrix"] {
  const critical: string[] = [];
  const risky:    string[] = [];
  const safe:     string[] = [];

  for (const t of topics) {
    if (t.masteryProbability < 0.4) {
      critical.push(t.topicName);
    } else if (t.masteryProbability < 0.7) {
      risky.push(t.topicName);
    } else {
      safe.push(t.topicName);
    }
  }

  return { critical, risky, safe };
}

// ── Topic weights (uniform until user provides weights) ───────────────────────

function buildTopicWeights(topics: TopicMasteryState[]): Record<string, number> {
  const weights: Record<string, number> = {};
  for (const t of topics) {
    weights[t.topicName] = 0.5;  // uniform default
  }
  return weights;
}

// ── Exam mode ─────────────────────────────────────────────────────────────────

function computeExamMode(daysUntil: number, topics: TopicMasteryState[]): ExamMode {
  const criticalCount = topics.filter(t => t.masteryProbability < 0.4).length;
  if (daysUntil < 2 || (daysUntil < 5 && criticalCount > 0)) return "crisis";
  if (daysUntil < 7 && criticalCount > 0) return "triage";
  return "normal";
}

// ── Recommended daily hours ────────────────────────────────────────────────────

function computeRecommendedHours(
  daysUntil:     number,
  criticalTopics: number,
): number {
  const base = 3.0;
  if (daysUntil < 2)   return 8.0;
  if (daysUntil < 5)   return Math.min(6.0, base + criticalTopics * 0.5);
  if (daysUntil < 14)  return Math.min(5.0, base + criticalTopics * 0.3);
  return base;
}

// ── Primary focus (single topic this turn) ────────────────────────────────────

function computePrimaryFocus(
  riskMatrix:    ExamContext["riskMatrix"],
  topicWeights:  Record<string, number>,
  topics:        TopicMasteryState[],
): string {
  if (riskMatrix.critical.length > 0) {
    // Pick the highest-weight critical topic
    return riskMatrix.critical.sort((a, b) =>
      (topicWeights[b] ?? 0) - (topicWeights[a] ?? 0),
    )[0] ?? riskMatrix.critical[0]!;
  }
  if (riskMatrix.risky.length > 0) {
    return riskMatrix.risky[0]!;
  }
  // Everything is safe — pick lowest mastery among safe topics
  const lowestSafe = topics
    .filter(t => riskMatrix.safe.includes(t.topicName))
    .sort((a, b) => a.masteryProbability - b.masteryProbability)[0];
  return lowestSafe?.topicName ?? "exam topics";
}

// ── Main function ─────────────────────────────────────────────────────────────

export function buildExamContext(
  exam:   RawExam,
  topics: TopicMasteryState[],  // topics belonging to this exam's subject
  now:    Date = new Date(),
): ExamContext {
  const daysUntil  = Math.ceil((exam.scheduledAt.getTime() - now.getTime()) / 86_400_000);
  const riskMatrix = classifyRisk(topics, daysUntil);
  const topicWeights = buildTopicWeights(topics);
  const mode         = computeExamMode(daysUntil, topics);
  const primaryFocus = computePrimaryFocus(riskMatrix, topicWeights, topics);
  const recommendedDailyHours = computeRecommendedHours(
    daysUntil, riskMatrix.critical.length,
  );

  return {
    examId:           exam.id,
    examTitle:        exam.title,
    subjectName:      exam.subjectName ?? "Unknown Subject",
    daysUntil,
    scheduledAt:      exam.scheduledAt,
    mode,
    topicWeights,
    riskMatrix,
    primaryFocus,
    recommendedDailyHours,
  };
}

// ── Select most urgent exam ────────────────────────────────────────────────────
// Returns context for the soonest exam within 14 days.

export function selectActiveExam(
  exams:         RawExam[],
  topicsByExam:  Record<string, TopicMasteryState[]>,
  now:           Date = new Date(),
): ExamContext | null {
  const upcoming = exams
    .filter(e => e.scheduledAt > now)
    .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());

  const next = upcoming[0];
  if (!next) return null;

  const daysUntil = Math.ceil((next.scheduledAt.getTime() - now.getTime()) / 86_400_000);
  if (daysUntil > 14) return null;

  const topics = topicsByExam[next.id] ?? [];
  return buildExamContext(next, topics, now);
}
