// ─── Knowledge view builder ───────────────────────────────────────────────────
// What Nova has on record about each topic: the Knowledge Engine's topic
// state, the Retention Engine's "due", and the finished sessions behind
// them. Read-only. No LLM call, no writes, nothing derived that an engine
// does not already own. Learning DNA is a different owner and is not read.

import { prisma } from "@repo/db/client";
import { getAllTopicMasteries, masteryLevel } from "../engines/knowledge-engine";
import { REVIEW_BLOCK_MINUTES } from "../engines/planning-engine";
import { daysOverdue, getOverdueTopics, isDueForReview } from "../engines/retention-engine";
import { SESSION_OUTCOMES } from "../engines/study-session-engine";
import { normalizeTopicName } from "../engines/topic-mastery-engine";
import type { TopicMasteryState } from "../types/engine.types";
import type {
  KnowledgeDueReview,
  KnowledgeSession,
  KnowledgeSubject,
  KnowledgeTopic,
  NovaKnowledgeReady,
  NovaKnowledgeView,
} from "./knowledge.types";

const RECENT_SESSION_DAYS    = 90;
const SESSIONS_PER_TOPIC     = 3;
const RECENT_LEARNING_LIMIT  = 8;
const SELF_REPORTED_ACTIVITY = "self_reported";

// A finished session row, as stored.
export interface SessionRecord {
  id:              string;
  subjectId:       string | null;
  topicName:       string | null;
  sessionDate:     Date;
  durationMinutes: number;
  activityType:    string;
  executionReport: unknown;
}

export interface KnowledgeInputs {
  subjects: Array<{ id: string; name: string }>;
  topics:   TopicMasteryState[];
  sessions: SessionRecord[];          // completed only
  activeSession: { topicName: string | null; subjectName: string | null } | null;
  now:      Date;
}

const key = (name: string | null) => (name ? normalizeTopicName(name).toLowerCase() : "");

function toSession(row: SessionRecord, subjectName: string | null): KnowledgeSession {
  // A session the learner only told Nova about has a placeholder duration in
  // the table (consolidation writes one). It was never timed, so it is never
  // reported as study time.
  const measured = row.activityType !== SELF_REPORTED_ACTIVITY;
  const report   = (row.executionReport ?? {}) as { outcome?: unknown; confusionPoints?: unknown };
  return {
    id:        row.id,
    topicName: row.topicName,
    subjectName,
    date:      row.sessionDate.toISOString(),
    measured,
    minutes:   measured ? row.durationMinutes : null,
    outcome:   SESSION_OUTCOMES.find(o => o === report.outcome) ?? null,
    confusionPoints: Array.isArray(report.confusionPoints)
      ? report.confusionPoints.filter((c): c is string => typeof c === "string")
      : [],
  };
}

// ── Pure builder ──────────────────────────────────────────────────────────────

export function buildKnowledgeView(input: KnowledgeInputs): NovaKnowledgeReady {
  const { subjects, topics, now } = input;
  const subjectName = new Map(subjects.map(s => [s.id, s.name]));
  const subjectId   = new Map(subjects.map(s => [s.name, s.id]));

  const sessions = [...input.sessions].sort((a, b) => b.sessionDate.getTime() - a.sessionDate.getTime());

  // A session belongs to a topic when it has that topic's subject and name.
  const sessionsOf = (topic: TopicMasteryState): KnowledgeSession[] =>
    sessions
      .filter(s => s.subjectId !== null && s.subjectId === subjectId.get(topic.subjectName) && key(s.topicName) === key(topic.topicName))
      .slice(0, SESSIONS_PER_TOPIC)
      .map(s => toSession(s, topic.subjectName));

  const toTopic = (t: TopicMasteryState): KnowledgeTopic => {
    const due = isDueForReview(t, now);
    return {
      id:               t.topicId,
      topicName:        t.topicName,
      subjectName:      t.subjectName,
      masteryPercent:   Math.round(t.masteryProbability * 100),
      level:            masteryLevel(t),
      reviewCount:      t.reviewCount,
      lastStudiedAt:    t.lastStudied?.toISOString() ?? null,
      retentionPercent: Math.round(t.retentionEstimate * 100),
      reviewState:      t.reviewDueAt === null ? "unscheduled" : due ? "due" : "scheduled",
      nextReviewAt:     t.reviewDueAt?.toISOString() ?? null,
      daysOverdue:      due ? daysOverdue(t, now) : 0,
      recentSessions:   sessionsOf(t),
    };
  };

  // Due reviews: the Retention Engine's list, in its order.
  const dueReviews: KnowledgeDueReview[] = getOverdueTopics(topics, now).map(t => {
    const topic  = toTopic(t);
    const reasons: string[] = [
      topic.daysOverdue <= 0 ? "due today" : `${topic.daysOverdue} day${topic.daysOverdue === 1 ? "" : "s"} overdue`,
      `retention about ${topic.retentionPercent}%`,
    ];
    if (topic.level === "weak") reasons.push(`weak (${topic.masteryPercent}%)`);
    if (topic.level === "unverified") reasons.push("no session on it yet");
    return { ...topic, reasons, reviewMinutes: REVIEW_BLOCK_MINUTES };
  });

  const knowledgeSubjects: KnowledgeSubject[] = subjects.map(s => {
    const own = topics.filter(t => t.subjectName === s.name).map(toTopic).sort((a, b) =>
      Number(b.reviewState === "due") - Number(a.reviewState === "due") || a.masteryPercent - b.masteryPercent);
    return {
      subjectId:   s.id,
      subjectName: s.name,
      topics:      own,
      summary:     { topicCount: own.length, dueCount: own.filter(t => t.reviewState === "due").length },
    };
  }).sort((a, b) => b.summary.dueCount - a.summary.dueCount || b.summary.topicCount - a.summary.topicCount || a.subjectName.localeCompare(b.subjectName));

  return {
    status:      "ready",
    generatedAt: now.toISOString(),
    subjects:    knowledgeSubjects,
    dueReviews,
    recentLearning: sessions.slice(0, RECENT_LEARNING_LIMIT)
      .map(s => toSession(s, s.subjectId ? subjectName.get(s.subjectId) ?? null : null)),
    activeSession: input.activeSession,
    totals: { subjectCount: subjects.length, topicCount: topics.length, dueCount: dueReviews.length },
  };
}

// ── Loader ────────────────────────────────────────────────────────────────────

export async function loadNovaKnowledge(
  platformChatId: string,
  options: { now?: Date } = {},
): Promise<NovaKnowledgeView> {
  const now = options.now ?? new Date();

  const user = await prisma.messengerUser.findUnique({
    where:  { platform_platformChatId: { platform: "telegram", platformChatId } },
    select: {
      novaAcademicProfile: {
        select: {
          id: true, onboardingComplete: true,
          subjects: { select: { id: true, name: true }, orderBy: { name: "asc" } },
        },
      },
    },
  });
  if (!user) return { status: "not_connected" };
  const profile = user.novaAcademicProfile;
  if (!profile?.onboardingComplete) return { status: "onboarding_incomplete" };

  const since = new Date(now.getTime() - RECENT_SESSION_DAYS * 86_400_000);
  const [topics, sessions, active] = await Promise.all([
    getAllTopicMasteries(profile.id, now),
    prisma.novaStudySession.findMany({
      where:   { profileId: profile.id, status: "completed", sessionDate: { gte: since } },
      orderBy: { sessionDate: "desc" },
      select:  {
        id: true, subjectId: true, topicName: true, sessionDate: true,
        durationMinutes: true, activityType: true, executionReport: true,
      },
    }),
    prisma.novaStudySession.findFirst({
      where:  { profileId: profile.id, status: { in: ["in_progress", "paused"] } },
      select: { topicName: true, subjectId: true },
    }),
  ]);

  return buildKnowledgeView({
    subjects: profile.subjects,
    topics,
    sessions,
    activeSession: active ? {
      topicName:   active.topicName,
      subjectName: active.subjectId ? profile.subjects.find(s => s.id === active.subjectId)?.name ?? null : null,
    } : null,
    now,
  });
}
