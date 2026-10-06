// ─── Consolidation Runner ─────────────────────────────────────────────────────
// SKILL.md §11.7 — Evidence → Consolidation → Durable State.
//   1. load the current durable state
//   2. consolidate() — pure, deterministic rules
//   3. apply every decision in ONE transaction
// No rules here and no LLM calls.
//
// Failure safety. A turn's consolidation is a job row in Postgres
// (NovaConsolidationJob): pending → processing → completed. The state writes
// and the "completed" mark commit together, so a turn is either fully
// consolidated or not at all. A failed or abandoned attempt leaves no partial
// state, stays retryable, and retryPendingConsolidations() picks it up.
// Owner: Consolidation layer.

import { prisma } from "@repo/db/client";
import { consolidate } from "./consolidator";
import { loadActiveFacts, applyFactDecision } from "./stores/user-fact-store";
import { loadActiveRealityRows, applyRealityDecision } from "./stores/reality-store";
import { loadPatterns, applyPatternDecision } from "./stores/behavioral-pattern-store";
import { loadInvestigation, applyInvestigationDecision } from "./stores/cognitive-state-store";
import {
  applyMasteryObservation,
  applySessionObservation,
  loadAcademicContext,
  loadRecentlyObservedTopics,
} from "./stores/academic-observation-store";
import {
  claimJob,
  completeJob,
  enqueueJob,
  failJob,
  findRetryableJobs,
  purgeCompletedJobs,
  type JobPayload,
} from "./stores/consolidation-job-store";
import type { Db } from "./stores/db";
import type {
  ConsolidationDecision,
  Evidence,
  RecentSession,
} from "../types/consolidation.types";

export interface RunConsolidationInput {
  userId:           string;
  profileId:        string | null;
  evidence:         Evidence[];
  now:              Date;
  patternScanRan:   boolean;
  hasActiveSession: boolean;
  recentSessions:   RecentSession[];
  subjects:         Array<{ id: string; name: string }>;
}

// ── Core: decide, then apply atomically ───────────────────────────────────────

async function consolidateAndApply(
  input:        RunConsolidationInput,
  jobMessageId: string | null,
): Promise<ConsolidationDecision[]> {
  const { userId, profileId, now } = input;

  const [facts, realities, patterns, investigation, recentlyObservedTopics] = await Promise.all([
    loadActiveFacts(userId),
    loadActiveRealityRows(userId),
    loadPatterns(userId),
    profileId ? loadInvestigation(profileId) : Promise.resolve(null),
    profileId ? loadRecentlyObservedTopics(profileId, now) : Promise.resolve([]),
  ]);

  const decisions = consolidate({
    evidence:         input.evidence,
    state:            { facts, realities, patterns, investigation, recentSessions: input.recentSessions, recentlyObservedTopics },
    now,
    patternScanRan:   input.patternScanRan,
    hasActiveSession: input.hasActiveSession,
  });
  const toApply = decisions.filter(d => d.action !== "IGNORE");

  // All or nothing. Any error rolls every write back, including the job's
  // completion, so there is never a half-consolidated turn.
  await prisma.$transaction(async tx => {
    const db: Db = tx;
    for (const d of toApply) {
      switch (d.target) {
        case "user_fact":          await applyFactDecision(db, userId, d, now); break;
        case "reality":            await applyRealityDecision(db, userId, d, now); break;
        case "behavioral_pattern": await applyPatternDecision(db, userId, d, now); break;
        case "cognitive_state":
          if (profileId) await applyInvestigationDecision(db, profileId, d, now);
          break;
        case "academic_observation":
          if (profileId) await applySessionObservation(db, profileId, d, now);
          break;
      }
    }
    if (jobMessageId) await completeJob(db, jobMessageId, now);
  });

  // After commit: the Knowledge Engine's own table, through the engine.
  for (const d of toApply) {
    await applyMasteryObservation(d, input.subjects, now)
      .catch(err => console.error("[nova:consolidation] mastery observation failed", err));
  }

  console.log(JSON.stringify({
    ts:        now.toISOString(),
    layer:     "nova:consolidation",
    userId,
    messageId: jobMessageId,
    evidence:  input.evidence.length,
    decisions: decisions.map(d => `${d.action}:${d.target}:${d.reason}`),
  }));

  return decisions;
}

// ── Evidence with no conversation message behind it (onboarding) ──────────────
// Runs inline and atomically. There is no job: the caller awaits the result.

export async function runConsolidation(input: RunConsolidationInput): Promise<ConsolidationDecision[]> {
  return consolidateAndApply(input, null);
}

// ── A conversation turn ───────────────────────────────────────────────────────

export interface TurnConsolidationInput {
  messageId:        string;         // the user turn; provenance and idempotency key
  userId:           string;
  profileId:        string | null;
  evidence:         Evidence[];
  patternScanRan:   boolean;
  hasActiveSession: boolean;
  now:              Date;
}

// Records the job, then makes the first attempt. If the attempt fails the job
// stays in Postgres and is retried later; the reply is never affected.
export async function consolidateTurn(input: TurnConsolidationInput): Promise<ConsolidationDecision[] | null> {
  const payload: JobPayload = {
    profileId:        input.profileId,
    evidence:         input.evidence,
    patternScanRan:   input.patternScanRan,
    hasActiveSession: input.hasActiveSession,
  };
  // A turn that already has a job was enqueued before: do not run it again here.
  if (!(await enqueueJob(input.messageId, input.userId, payload))) return null;
  return processConsolidationJob(input.messageId, input.userId, input.now);
}

// One attempt at one job. Returns null when the job is held by someone else,
// already completed, out of attempts, or when the attempt failed.
export async function processConsolidationJob(
  messageId: string,
  userId:    string,
  now:       Date,
): Promise<ConsolidationDecision[] | null> {
  const payload = await claimJob(messageId, now);
  if (!payload) return null;

  try {
    const academic = payload.profileId
      ? await loadAcademicContext(payload.profileId)
      : { recentSessions: [], subjects: [] };

    return await consolidateAndApply({
      userId,
      profileId:        payload.profileId,
      evidence:         payload.evidence,
      now,
      patternScanRan:   payload.patternScanRan,
      hasActiveSession: payload.hasActiveSession,
      recentSessions:   academic.recentSessions,
      subjects:         academic.subjects,
    }, messageId);
  } catch (err) {
    console.error(`[nova:consolidation] job failed messageId=${messageId}`, err);
    await failJob(messageId, err);
    return null;
  }
}

// ── Retry worker ──────────────────────────────────────────────────────────────
// Called from the existing 5-minute cron. Picks up failed jobs, jobs abandoned
// mid-attempt (lease expired) and jobs that were enqueued but never started.

export async function retryPendingConsolidations(
  now   = new Date(),
  limit = 20,
): Promise<{ retried: number; completed: number; purged: number }> {
  const jobs = await findRetryableJobs(now, limit);
  let completed = 0;
  for (const job of jobs) {
    if (await processConsolidationJob(job.messageId, job.userId, now)) completed += 1;
  }
  const purged = await purgeCompletedJobs(now);
  return { retried: jobs.length, completed, purged };
}
