// ─── Recent focus sessions ────────────────────────────────────────────────────
// A read model: the learner's latest finished sessions, Quick Focus ones (a
// title, no task, no topic) and topic sessions alike, for Progress. It writes
// nothing and calls no model. "Counted" is Progress's own rule (finished,
// timed by Nova, at least COUNTED_SESSION_MINUTES), so a list and the totals
// never disagree. A session with no topic moves no mastery and completes no
// task: the list says what it was, nothing more.

import { prisma } from "@repo/db/client";
import { COUNTED_SESSION_MINUTES, SELF_REPORTED_ACTIVITY } from "../engines/study-session-engine";
import { readFocusDetails } from "./session";
import type { RecentSession } from "./focus-history.types";

export type { RecentSession };

export const RECENT_SESSIONS = 12;


export async function recentSessions(profileId: string, take = RECENT_SESSIONS): Promise<RecentSession[]> {
  const rows = await prisma.novaStudySession.findMany({
    where:   { profileId, status: "completed" },
    orderBy: { sessionDate: "desc" },
    take,
    select:  { id: true, sessionDate: true, durationMinutes: true, topicName: true, currentFocus: true, subjectId: true, activityType: true, focusDetails: true },
  });
  const subjectIds = [...new Set(rows.map(r => r.subjectId).filter((id): id is string => !!id))];
  const subjects = subjectIds.length ? await prisma.novaSubject.findMany({ where: { profileId, id: { in: subjectIds } }, select: { id: true, name: true } }) : [];
  return rows.map(r => {
    const details = readFocusDetails(r.focusDetails);
    return {
      id: r.id,
      startedAt: r.sessionDate.toISOString(),
      minutes: r.durationMinutes,
      title: r.topicName ?? r.currentFocus ?? "Focus session",
      kind: r.topicName ? "topic" : "focus",
      subjectName: subjects.find(s => s.id === r.subjectId)?.name ?? null,
      category: details?.category ?? null,
      description: details?.description ?? null,
      counted: r.activityType !== SELF_REPORTED_ACTIVITY && r.durationMinutes >= COUNTED_SESSION_MINUTES,
    };
  });
}

// Finished sessions on each topic, counted as Progress counts them (completed,
// timed, ten minutes or more), with their minutes: the Knowledge Map's
// session numbers (item 3, 28 Nov).
export async function sessionsByTopic(profileId: string): Promise<Array<{ subjectId: string; topicName: string; sessions: number; minutes: number }>> {
  const rows = await prisma.novaStudySession.groupBy({
    by: ["subjectId", "topicName"],
    where: { profileId, status: "completed", activityType: { not: SELF_REPORTED_ACTIVITY }, subjectId: { not: null }, topicName: { not: null }, durationMinutes: { gte: COUNTED_SESSION_MINUTES } },
    _count: { _all: true }, _sum: { durationMinutes: true },
  });
  return rows.map(r => ({ subjectId: r.subjectId!, topicName: r.topicName!, sessions: r._count._all, minutes: r._sum.durationMinutes ?? 0 }));
}
