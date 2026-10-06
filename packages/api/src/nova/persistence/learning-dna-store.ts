// ─── Learning DNA store ───────────────────────────────────────────────────────
// The only code that reads evidence for Learning DNA and the only code that
// writes NovaLearningDNA. The conclusions come from the Learning DNA engine;
// this file loads what it needs and stores what it decided.
//
// refreshLearningDna runs when a session ends (consumeExecutionReport): that
// is the only moment the evidence changes. Reading (loadLearningDna) writes
// nothing.

import { prisma } from "@repo/db/client";
import { getAllTopicMasteries } from "../engines/knowledge-engine";
import { isValidTimezone } from "../engines/learner-calendar";
import {
  DNA_EVIDENCE_DAYS, DNA_MAX_SESSIONS,
  advanceDnaMemory, computeLearningDna, legacyDnaColumns,
  type DnaEvidence, type DnaMemoryMap, type DnaSession, type DnaSignal,
} from "../engines/learning-dna-engine";
import { COUNTED_SESSION_MINUTES, SELF_REPORTED_ACTIVITY, SESSION_OUTCOMES } from "../engines/study-session-engine";

const DAY_MS = 86_400_000;

// A finished, timed session of ten minutes or more (isCountedSession).
const COUNTED = {
  status:          "completed",
  activityType:    { not: SELF_REPORTED_ACTIVITY },
  durationMinutes: { gte: COUNTED_SESSION_MINUTES },
};

export interface LoadedLearningDna {
  signals:  DnaSignal[];
  memory:   DnaMemoryMap;
  evidence: DnaEvidence;
}

export async function loadLearningDna(profileId: string, now: Date): Promise<LoadedLearningDna | null> {
  const since = new Date(now.getTime() - DNA_EVIDENCE_DAYS * DAY_MS);
  const [profile, rows, first, topics] = await Promise.all([
    prisma.novaAcademicProfile.findUnique({
      where:  { id: profileId },
      select: {
        timezone: true,
        subjects:    { select: { id: true, name: true } },
        learningDNA: { select: { signals: true } },
      },
    }),
    prisma.novaStudySession.findMany({
      where:   { profileId, ...COUNTED, sessionDate: { gte: since, lte: now } },
      orderBy: { sessionDate: "desc" },
      take:    DNA_MAX_SESSIONS,
      select:  {
        id: true, sessionDate: true, durationMinutes: true, plannedDurationMinutes: true,
        subjectId: true, topicName: true, executionReport: true,
      },
    }),
    prisma.novaStudySession.aggregate({ where: { profileId, ...COUNTED }, _min: { sessionDate: true } }),
    getAllTopicMasteries(profileId, now),
  ]);
  if (!profile) return null;

  const sessions: DnaSession[] = rows.reverse().map(r => ({
    id:             r.id,
    startedAt:      r.sessionDate,
    minutes:        r.durationMinutes,
    plannedMinutes: r.plannedDurationMinutes,
    subjectId:      r.subjectId,
    topicName:      r.topicName,
    outcome:        SESSION_OUTCOMES.find(o => o === (r.executionReport as { outcome?: unknown } | null)?.outcome) ?? null,
  }));

  const evidence: DnaEvidence = {
    sessions, topics,
    subjects: profile.subjects,
    // A stored zone that is not a real one is treated as unknown.
    timezone: profile.timezone && isValidTimezone(profile.timezone) ? profile.timezone : null,
    firstCountedAt: first._min.sessionDate,
    now,
  };
  return {
    signals: computeLearningDna(evidence),
    memory:  (profile.learningDNA?.signals as DnaMemoryMap | null) ?? {},
    evidence,
  };
}

// Recompute from the evidence and store the result. Called once per ended
// session, after its report has reached the session row.
export async function refreshLearningDna(profileId: string, now: Date): Promise<void> {
  const loaded = await loadLearningDna(profileId, now);
  if (!loaded) return;
  const data = {
    ...legacyDnaColumns(loaded.signals),
    signals:    JSON.parse(JSON.stringify(advanceDnaMemory(loaded.memory, loaded.signals, now))) as object,
    computedAt: now,
  };
  await prisma.novaLearningDNA.upsert({
    where:  { profileId },
    update: data,
    create: { profileId, ...data },
  }).catch(err => console.error("[nova:dna] refresh failed", err));
}
