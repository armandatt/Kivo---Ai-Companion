// ─── Topic Mastery Engine ─────────────────────────────────────────────────────
// SKILL.md §8 — FSRS-lite (SM-2 inspired) mastery tracking.
// NEVER makes LLM calls. NEVER reads DB (caller provides subjectId).
// Writes go through updateTopicMastery() which owns the upsert.
// Owner: Topic Mastery Engine.
//
// ── Source hierarchy (MUST be respected by all callers) ──────────────────────
//
//   "session_report"    — evidence: full FSRS update, interval grows, reviewCount++
//                         Only SessionExecutionReport consumers may use this source.
//
//   "conversation_signal" — observation: confidenceReported + lastStudiedAt only.
//                           No interval change. No reviewCount increment.
//                           Mastery probability updates with 0.15 weight (vs 0.40).
//                           Used when a student mentions a topic in conversation
//                           without a backing session execution report.
//
// No engine may infer verified learning from conversation if an execution
// report exists. Conversation provides observations. Sessions provide evidence.

import { prisma } from "@repo/db/client";

// ── FSRS-lite algorithm ───────────────────────────────────────────────────────
// Confidence (0–1, student self-report) → SM-2 grade (1–5).
// Grade < 3 → reset interval to 1 day, reduce ef_factor.
// Grade >= 3 → grow interval, adjust ef_factor.

function confidenceToGrade(confidence: number): number {
  if (confidence >= 0.85) return 5;
  if (confidence >= 0.70) return 4;
  if (confidence >= 0.55) return 3;
  if (confidence >= 0.40) return 2;
  return 1;
}

interface FsrsUpdate {
  masteryProbability: number;
  efFactor:           number;
  intervalDays:       number;
  nextReviewAt:       Date;
}

function computeFsrsUpdate(
  current: { masteryProbability: number; efFactor: number; intervalDays: number; reviewCount: number } | null,
  reportedConfidence: number,
  now: Date,
): FsrsUpdate {
  const grade = confidenceToGrade(reportedConfidence);

  if (!current || current.reviewCount === 0) {
    // First study: bootstrap state from reported confidence
    const interval = grade >= 4 ? 3 : grade >= 3 ? 2 : 1;
    const nextReviewAt = new Date(now);
    nextReviewAt.setDate(nextReviewAt.getDate() + interval);
    return {
      masteryProbability: Math.round(reportedConfidence * 100) / 100,
      efFactor:           2.5,
      intervalDays:       interval,
      nextReviewAt,
    };
  }

  // Blended mastery update (prevents wild swings from a single report)
  const newMastery = Math.min(1, Math.round((0.6 * current.masteryProbability + 0.4 * reportedConfidence) * 100) / 100);

  let newEfFactor: number;
  let newInterval: number;

  if (grade >= 3) {
    // Correct recall: update ef_factor and grow interval
    newEfFactor = Math.max(
      1.3,
      current.efFactor + 0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02),
    );
    newEfFactor = Math.round(newEfFactor * 100) / 100;
    newInterval = Math.max(1, Math.round(current.intervalDays * newEfFactor));
  } else {
    // Incorrect / low confidence: reset interval, decrease ef_factor
    newEfFactor = Math.max(1.3, Math.round((current.efFactor - 0.2) * 100) / 100);
    newInterval = 1;
  }

  const nextReviewAt = new Date(now);
  nextReviewAt.setDate(nextReviewAt.getDate() + newInterval);

  return {
    masteryProbability: newMastery,
    efFactor:           newEfFactor,
    intervalDays:       newInterval,
    nextReviewAt,
  };
}

// ── Subject matcher ────────────────────────────────────────────────────────────
// Finds best subject for a given topic string.
// Returns null if no match — mastery update is skipped.

export function matchTopicToSubject(
  topicName: string,
  subjects:  Array<{ id: string; name: string }>,
): { subjectId: string; resolvedName: string } | null {
  if (subjects.length === 0 || !topicName) return null;

  const topic = topicName.toLowerCase().trim();

  // 1. Exact match
  const exact = subjects.find(s => s.name.toLowerCase() === topic);
  if (exact) return { subjectId: exact.id, resolvedName: topicName };

  // 2. Subject contains topic string (e.g. topic="OS" → subject="Operating Systems")
  const contained = subjects.find(s =>
    s.name.toLowerCase().includes(topic) || topic.includes(s.name.toLowerCase())
  );
  if (contained) return { subjectId: contained.id, resolvedName: topicName };

  return null;
}

// ── Source type ───────────────────────────────────────────────────────────────

export type MasteryUpdateSource = "session_report" | "conversation_signal";

// ── Main export ────────────────────────────────────────────────────────────────
// source = "session_report"      → full FSRS update (evidence)
// source = "conversation_signal" → observation-only write (no FSRS, no count)

export async function updateTopicMastery(
  subjectId:          string,
  topicName:          string,
  reportedConfidence: number,
  now:                Date,
  source:             MasteryUpdateSource = "conversation_signal",
): Promise<void> {
  const clampedConf = Math.max(0, Math.min(1, reportedConfidence));

  const existing = await prisma.novaTopicMastery.findUnique({
    where:  { subjectId_name: { subjectId, name: topicName } },
    select: {
      masteryProbability: true,
      efFactor:           true,
      intervalDays:       true,
      reviewCount:        true,
    },
  });

  if (source === "session_report") {
    // ── Evidence path: full FSRS update ──────────────────────────────────────
    const update = computeFsrsUpdate(existing, clampedConf, now);

    await prisma.novaTopicMastery.upsert({
      where:  { subjectId_name: { subjectId, name: topicName } },
      update: {
        masteryProbability: update.masteryProbability,
        confidenceReported: clampedConf,
        efFactor:           update.efFactor,
        intervalDays:       update.intervalDays,
        nextReviewAt:       update.nextReviewAt,
        lastStudiedAt:      now,
        reviewCount:        { increment: 1 },
      },
      create: {
        subjectId,
        name:               topicName,
        masteryProbability: update.masteryProbability,
        confidenceReported: clampedConf,
        efFactor:           update.efFactor,
        intervalDays:       update.intervalDays,
        nextReviewAt:       update.nextReviewAt,
        lastStudiedAt:      now,
        reviewCount:        1,
      },
    });
  } else {
    // ── Observation path: soft update only ────────────────────────────────────
    // No FSRS interval change. No reviewCount increment.
    // masteryProbability updated with a 0.15 weight (vs 0.40 for evidence).
    // If no prior record exists, create with reviewCount = 0 and discounted mastery.
    const newMastery = existing
      ? Math.min(1, Math.round((0.85 * existing.masteryProbability + 0.15 * clampedConf) * 100) / 100)
      : Math.round(clampedConf * 0.7 * 100) / 100;  // discount first-time conversation mention

    await prisma.novaTopicMastery.upsert({
      where:  { subjectId_name: { subjectId, name: topicName } },
      update: {
        masteryProbability: newMastery,
        confidenceReported: clampedConf,
        lastStudiedAt:      now,
        // intentionally NOT updating: efFactor, intervalDays, nextReviewAt, reviewCount
      },
      create: {
        subjectId,
        name:               topicName,
        masteryProbability: newMastery,
        confidenceReported: clampedConf,
        efFactor:           2.5,    // default, unchanged until first session
        intervalDays:       1,
        nextReviewAt:       now,    // due immediately — no session evidence yet
        lastStudiedAt:      now,
        reviewCount:        0,      // not a verified review
      },
    });
  }
}
