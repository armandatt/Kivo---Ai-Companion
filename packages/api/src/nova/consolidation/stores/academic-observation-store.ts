// ─── Academic Observation Store ───────────────────────────────────────────────
// Self-reported study activity with no interactive session behind it.
// These are academic entities (NovaStudySession / NovaTopicMastery), never
// UserFacts. Writes only what the consolidator decided.
//
// Mastery here is always an OBSERVATION (source "conversation_signal"): no
// FSRS interval change, no reviewCount increment. Session execution reports
// remain the only path to a full mastery update.

import { prisma } from "@repo/db/client";
import type { ConsolidationDecision, RecentSession } from "../../types/consolidation.types";
import { updateTopicMastery, matchTopicToSubject } from "../../engines/topic-mastery-engine";
import type { Db } from "./db";

// Session records are written inside the consolidation transaction.
export async function applySessionObservation(
  db:        Db,
  profileId: string,
  decision:  ConsolidationDecision,
  now:       Date,
): Promise<void> {
  const w = decision.write;
  if (w?.target !== "academic_observation" || decision.action === "IGNORE") return;

  if (w.op === "self_reported_session") {
    const profile = await db.novaAcademicProfile.findUnique({
      where:  { id: profileId },
      select: { preferredStudyHoursPerDay: true },
    });
    const duration = profile ? Math.round(profile.preferredStudyHoursPerDay * 60 / 2) : 60;
    await db.novaStudySession.create({
      data: { profileId, durationMinutes: duration, activityType: "self_reported", status: "completed", sessionDate: now },
    });
  } else if (w.op === "skipped_session") {
    await db.novaStudySession.create({
      data: { profileId, durationMinutes: 0, activityType: "self_reported", status: "skipped", sessionDate: now },
    });
  }
}

// The mastery table belongs to the Knowledge Engine and is updated through
// it, after the transaction commits. It is a soft nudge, applied once per
// completed job.
export async function applyMasteryObservation(
  decision: ConsolidationDecision,
  subjects: Array<{ id: string; name: string }>,
  now:      Date,
): Promise<void> {
  const w = decision.write;
  if (w?.target !== "academic_observation" || w.op !== "mastery_observation" || !w.topic) return;
  const match = matchTopicToSubject(w.topic, subjects);
  if (!match) return;
  await updateTopicMastery(match.subjectId, match.resolvedName, w.confidence, now, "conversation_signal");
}

// What consolidation needs to know about the student's academic records.
// Loaded fresh, so a retried job sees the current state.
export async function loadAcademicContext(profileId: string): Promise<{
  recentSessions: RecentSession[];
  subjects:       Array<{ id: string; name: string }>;
}> {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000);
  const profile = await prisma.novaAcademicProfile.findUnique({
    where:  { id: profileId },
    select: {
      subjects:      { select: { id: true, name: true } },
      studySessions: {
        where:  { sessionDate: { gte: ninetyDaysAgo } },
        select: { sessionDate: true, status: true },
      },
    },
  });
  return { recentSessions: profile?.studySessions ?? [], subjects: profile?.subjects ?? [] };
}
