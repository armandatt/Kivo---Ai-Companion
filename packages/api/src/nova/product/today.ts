// ─── Today view builder ───────────────────────────────────────────────────────
// Composes the Home page's answer to "what should I do right now?" from the
// engines that already decide it: Academic State, Knowledge, Retention, Exam,
// and Planning. Read-only. No LLM call, no writes, and no decision logic of
// its own: it selects from the plan the Planning Engine produced and reports
// the facts behind it.

import type { StudySnapshotResult } from "../engines/study-snapshot";
import { getOverdueTopics } from "../engines/retention-engine";
import { loadPlanningInputs, normalizeAvailableMinutes } from "./planning-inputs";
import type { AcademicState } from "../types/academic-state.types";
import type { ExamContext, StudyBlock, StudyPlan, TopicMasteryState } from "../types/engine.types";
import type {
  NovaTodayReady,
  NovaTodayView,
  TodayAction,
  TodayConstraint,
  TodayDeadline,
} from "./today.types";
import { sessionElapsedSeconds } from "./session-view";

const DAY_MS = 86_400_000;
const MIN_USEFUL_MINUTES = 10;

// ── Pure builder ──────────────────────────────────────────────────────────────

export interface TodayInputs {
  snapshot:         StudySnapshotResult;
  academicState:    AcademicState;
  topics:           TopicMasteryState[];
  examContext:      ExamContext | null;
  plan:             StudyPlan;
  constraints:      TodayConstraint[];
  availableMinutes: number | null;
  learnerName?:     string | null;
  goals?:           string[];
  now:              Date;
}

function daysBetween(later: Date, earlier: Date): number {
  return Math.floor((later.getTime() - earlier.getTime()) / DAY_MS);
}

// The facts behind a block, stated the way a student would want to hear them.
export function reasonsFor(
  block:       StudyBlock,
  topic:       TopicMasteryState | undefined,
  examContext: ExamContext | null,
  now:         Date,
): string[] {
  const reasons: string[] = [];

  if (examContext && (block.activityType === "exam_prep" || examContext.subjectName === block.subjectName)) {
    reasons.push(examContext.daysUntil <= 0 ? "exam today"
      : examContext.daysUntil === 1 ? "exam tomorrow"
      : `exam in ${examContext.daysUntil} days`);
  }
  if (topic) {
    const pct = Math.round(topic.masteryProbability * 100);
    if (topic.reviewCount === 0) reasons.push("not studied yet");
    else if (pct < 40) reasons.push(`weak mastery (${pct}%)`);
    else if (pct < 70) reasons.push(`developing (${pct}%)`);

    if (topic.reviewDueAt && topic.reviewDueAt < now) {
      const overdue = daysBetween(now, topic.reviewDueAt);
      reasons.push(overdue <= 0 ? "review due today" : `review ${overdue} day${overdue === 1 ? "" : "s"} overdue`);
    }
    if (topic.calibrationGap < -0.25) reasons.push("feels stronger than it tests");
  }
  if (block.urgency === "critical" && reasons.length === 0) reasons.push("highest priority today");
  return reasons;
}

export function toAction(
  block:            StudyBlock,
  topics:           TopicMasteryState[],
  examContext:      ExamContext | null,
  availableMinutes: number | null,
  now:              Date,
): TodayAction {
  const topic = topics.find(t => t.topicId === block.topicId)
    ?? topics.find(t => t.topicName === block.topicName && t.subjectName === block.subjectName);
  const fits = availableMinutes === null || block.durationMinutes <= availableMinutes;
  return {
    topicName:       block.topicName,
    subjectName:     block.subjectName,
    activityType:    block.activityType,
    durationMinutes: fits ? block.durationMinutes : Math.max(MIN_USEFUL_MINUTES, availableMinutes!),
    urgency:         block.urgency,
    reasons:         reasonsFor(block, topic, examContext, now),
    rationale:       block.rationale,
    trimmedToFit:    !fits,
  };
}

export function buildTodayView(input: TodayInputs): NovaTodayReady {
  const { snapshot, academicState, topics, examContext, plan, now } = input;

  const actions = plan.today.map(b => toAction(b, topics, examContext, input.availableMinutes, now));
  const recommendation = actions[0] ?? null;

  const mode: NovaTodayReady["plan"]["mode"] =
    academicState.hardDirectives.examCrisisMode ? "exam_crisis"
    : academicState.hardDirectives.recoveryMode ? "recovery"
    : "standard";

  const emptyReason: NovaTodayReady["emptyReason"] = recommendation ? null
    : topics.length === 0 ? "no_topics"
    : mode === "recovery" ? "recovery"
    : "nothing_due";

  const weekAgo   = new Date(now.getTime() - 7 * DAY_MS);
  const completed = snapshot.studySessions.filter(s => s.status === "completed");
  const thisWeek  = completed.filter(s => s.sessionDate >= weekAgo);
  const last      = [...completed].sort((a, b) => b.sessionDate.getTime() - a.sessionDate.getTime())[0];

  const overdue = getOverdueTopics(topics);
  const studied = topics.filter(t => t.reviewCount > 0);
  const weakest = [...studied].sort((a, b) => a.masteryProbability - b.masteryProbability)[0];

  const upcoming: TodayDeadline[] = [...snapshot.upcomingExams]
    .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime())
    .slice(0, 3)
    .map(e => ({
      title:       e.title,
      subjectName: e.subjectName,
      examType:    e.examType,
      scheduledAt: e.scheduledAt.toISOString(),
      daysUntil:   Math.max(0, Math.ceil((e.scheduledAt.getTime() - now.getTime()) / DAY_MS)),
    }));
  const active   = snapshot.activeSession;

  return {
    status:           "ready",
    generatedAt:      now.toISOString(),
    learnerName:      input.learnerName ?? null,
    goals:            input.goals ?? [],
    subjects:         snapshot.subjects.map(s => s.name),
    availableMinutes: input.availableMinutes,

    recommendation,
    emptyReason,
    alternatives: actions.slice(1, 3),

    activeSession: active ? {
      id:          active.id,
      topicName:   active.topicName,
      subjectName: active.subjectName,
      status:      active.status === "paused" ? "paused" : "in_progress",
      startedAt:   active.startedAt.toISOString(),
      elapsedMinutes: Math.floor(sessionElapsedSeconds(active, now) / 60),
      plannedDurationMinutes: active.plannedDurationMinutes,
    } : null,

    nextDeadline: upcoming[0] ?? null,
    upcoming,

    weakArea: weakest && weakest.masteryProbability < 0.7 ? {
      topicName:      weakest.topicName,
      subjectName:    weakest.subjectName,
      masteryPercent: Math.round(weakest.masteryProbability * 100),
      lastStudiedAt:  weakest.lastStudied?.toISOString() ?? null,
      reviewDue:      Boolean(weakest.reviewDueAt && weakest.reviewDueAt < now),
    } : null,

    reviewDue: {
      count:  overdue.length,
      topics: overdue.slice(0, 3).map(t => ({
        topicName:   t.topicName,
        subjectName: t.subjectName,
        daysOverdue: t.reviewDueAt ? Math.max(0, daysBetween(now, t.reviewDueAt)) : 0,
      })),
    },

    constraints: input.constraints,

    progress: {
      sessionsThisWeek:     thisWeek.length,
      minutesThisWeek:      thisWeek.reduce((sum, s) => sum + s.durationMinutes, 0),
      streakDays:           academicState.studyStreakDays,
      daysSinceLastSession: last ? Math.max(0, daysBetween(now, last.sessionDate)) : null,
      lastSession:          last ? { topicName: last.topicName, date: last.sessionDate.toISOString(), minutes: last.durationMinutes } : null,
    },

    plan: {
      mode,
      blockCount:        plan.today.length,
      totalMinutesToday: plan.totalMinutesToday,
      assumptions:       plan.assumptions,
    },
  };
}

// ── Loader ────────────────────────────────────────────────────────────────────

export async function loadNovaToday(
  platformChatId: string,
  options: { availableMinutes?: number | null; learnerName?: string | null; now?: Date } = {},
): Promise<NovaTodayView> {
  const now = options.now ?? new Date();

  // Home fits its one recommendation to the time available; the day's plan
  // itself is the student's usual one.
  const loaded = await loadPlanningInputs(platformChatId, { now });
  if (loaded.status !== "ready") return { status: loaded.status };

  return buildTodayView({
    ...loaded.inputs,
    learnerName:      options.learnerName ?? null,
    goals:            loaded.inputs.goals.slice(0, 3),
    availableMinutes: normalizeAvailableMinutes(options.availableMinutes),
  });
}
