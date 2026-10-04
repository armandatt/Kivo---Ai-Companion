// ─── Knowledge Engine ─────────────────────────────────────────────────────────
// SKILL.md §8.2 — compute and maintain topic mastery.
// Interface is permanent. Algorithm is replaceable (FSRS-lite for now).
// NEVER makes LLM calls. NEVER infers mastery from conversation text.
// NEVER sets the study schedule (Planning Engine does that).
// Owner: Knowledge Engine.

import { prisma } from "@repo/db/client";
import type { TopicMasteryState } from "../types/engine.types.js";

// ── FSRS-lite retention estimate ──────────────────────────────────────────────
// Simplified retention curve based on Ebbinghaus with efFactor scaling.
// TODO: replace with full FSRS-4.5 algorithm when implementation is ready.
// Interface (TopicMasteryState) is permanent and will not change.

function estimateRetention(
  efFactor:      number,   // stability factor (higher = slower forgetting)
  daysSinceReview: number, // days elapsed since last review
): number {
  if (daysSinceReview <= 0) return 1.0;
  // R(t) = e^(-t / (S * efFactor)) where S is a base constant
  const S = 10; // base stability constant
  const R = Math.exp(-(daysSinceReview / (S * efFactor)));
  return Math.max(0, Math.min(1, R));
}

function computeMasteryTrend(
  reviewCount: number,
  masteryProbability: number,
  efFactor: number,
): "rising" | "stable" | "falling" {
  if (reviewCount < 3) return "rising";  // insufficient data — assume rising (new topic)
  if (efFactor > 2.8 && masteryProbability > 0.75) return "stable";
  if (masteryProbability < 0.5) return "falling";
  return "rising";
}

// ── Get topic mastery by name (for context builder when topic is mentioned) ───

export async function getTopicMastery(
  profileId: string,
  topicName: string,
): Promise<TopicMasteryState | null> {
  const topic = await prisma.novaTopicMastery.findFirst({
    where: {
      name:    { contains: topicName, mode: "insensitive" },
      subject: { profileId },
    },
    include: { subject: { select: { name: true } } },
  });

  if (!topic) return null;

  const now = new Date();
  const daysSinceReview = topic.lastStudiedAt
    ? Math.floor((now.getTime() - topic.lastStudiedAt.getTime()) / 86_400_000)
    : 999;

  const retentionEstimate = estimateRetention(topic.efFactor, daysSinceReview);
  const calibrationGap    = topic.masteryProbability - topic.confidenceReported;

  return {
    topicId:            topic.id,
    topicName:          topic.name,
    subjectName:        topic.subject.name,
    masteryProbability: topic.masteryProbability,
    lastStudied:        topic.lastStudiedAt,
    retentionEstimate,
    confidenceReported: topic.confidenceReported,
    calibrationGap,
    reviewDueAt:        topic.nextReviewAt,
    masteryTrend:       computeMasteryTrend(topic.reviewCount, topic.masteryProbability, topic.efFactor),
    reviewCount:        topic.reviewCount,
  };
}

// ── Get all topics for a profile (for planning) ───────────────────────────────

export async function getAllTopicMasteries(profileId: string): Promise<TopicMasteryState[]> {
  const topics = await prisma.novaTopicMastery.findMany({
    where:   { subject: { profileId } },
    include: { subject: { select: { name: true } } },
    orderBy: { nextReviewAt: "asc" },
  });

  const now = new Date();
  return topics.map(topic => {
    const daysSinceReview = topic.lastStudiedAt
      ? Math.floor((now.getTime() - topic.lastStudiedAt.getTime()) / 86_400_000)
      : 999;

    const retentionEstimate = estimateRetention(topic.efFactor, daysSinceReview);
    return {
      topicId:            topic.id,
      topicName:          topic.name,
      subjectName:        topic.subject.name,
      masteryProbability: topic.masteryProbability,
      lastStudied:        topic.lastStudiedAt,
      retentionEstimate,
      confidenceReported: topic.confidenceReported,
      calibrationGap:     topic.masteryProbability - topic.confidenceReported,
      reviewDueAt:        topic.nextReviewAt,
      masteryTrend:       computeMasteryTrend(topic.reviewCount, topic.masteryProbability, topic.efFactor),
      reviewCount:        topic.reviewCount,
    };
  });
}

// ── Update mastery after a review session ─────────────────────────────────────
// Called fire-and-forget after study session is logged.
// performance: 0-5 scale (FSRS grade)
//   0-1: blackout / wrong
//   2:   hard but correct
//   3:   correct with hesitation
//   4:   correct
//   5:   perfect

export async function updateTopicMasteryAfterReview(
  topicId:          string,
  performanceScore: number,  // 0–5
): Promise<void> {
  const topic = await prisma.novaTopicMastery.findUnique({ where: { id: topicId } });
  if (!topic) return;

  const clampedScore = Math.max(0, Math.min(5, performanceScore));

  // FSRS-lite: update efFactor and interval
  // EF update: EF' = EF + (0.1 - (5 - score) * (0.08 + (5 - score) * 0.02))
  const efDelta  = 0.1 - (5 - clampedScore) * (0.08 + (5 - clampedScore) * 0.02);
  const newEF    = Math.max(1.3, Math.min(3.5, topic.efFactor + efDelta));

  // Interval: first review = 1d, second = 6d, then * efFactor
  const reviewCount = topic.reviewCount + 1;
  let intervalDays: number;
  if (clampedScore < 3) {
    // Failed recall: reset to 1 day
    intervalDays = 1;
  } else if (reviewCount === 1) {
    intervalDays = 1;
  } else if (reviewCount === 2) {
    intervalDays = 6;
  } else {
    intervalDays = Math.round(topic.intervalDays * newEF);
  }

  // Mastery probability: based on performance and review count
  // Smoothed toward 1 with each successful review
  const successRate = clampedScore >= 3 ? 1 : 0;
  const newMastery  = Math.min(0.99,
    topic.masteryProbability * 0.7 + successRate * 0.3 * (1 + reviewCount * 0.05),
  );

  const nextReviewAt = new Date();
  nextReviewAt.setDate(nextReviewAt.getDate() + intervalDays);

  await prisma.novaTopicMastery.update({
    where: { id: topicId },
    data: {
      masteryProbability: newMastery,
      efFactor:           newEF,
      intervalDays,
      reviewCount,
      lastStudiedAt:      new Date(),
      nextReviewAt,
    },
  });
}

// ── Update self-reported confidence ──────────────────────────────────────────
// Fired when mastery_claim signal detected. Updates confidenceReported only.

export async function updateTopicConfidence(
  topicId:    string,
  confidence: number,  // 0–1
): Promise<void> {
  await prisma.novaTopicMastery.update({
    where: { id: topicId },
    data:  { confidenceReported: Math.max(0, Math.min(1, confidence)) },
  }).catch(() => {/* topic may not exist yet */});
}

// ── Ensure topic exists (upsert) ──────────────────────────────────────────────

export async function ensureTopicExists(
  subjectId: string,
  topicName: string,
): Promise<string> {
  const existing = await prisma.novaTopicMastery.findUnique({
    where: { subjectId_name: { subjectId, name: topicName } },
    select: { id: true },
  });
  if (existing) return existing.id;

  const created = await prisma.novaTopicMastery.create({
    data: { subjectId, name: topicName },
    select: { id: true },
  });
  return created.id;
}
