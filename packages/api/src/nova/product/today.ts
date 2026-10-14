// ─── Today view builder ───────────────────────────────────────────────────────
// Composes the Home page's answer to "what should I do right now?" from the
// engines that already decide it: Academic State, Knowledge, Retention, Exam,
// and Planning. Read-only. No LLM call, no writes, and no decision logic of
// its own: it selects from the plan the Planning Engine produced and reports
// the facts behind it.

import { examCoversSubject } from "../engines/exam-engine";
import type { StudySnapshotResult } from "../engines/study-snapshot";
import { calendarDaysUntil, dayKey, dayNumber, resolveTimezone } from "../engines/learner-calendar";
import { daysOverdue, getOverdueTopics, isDueForReview } from "../engines/retention-engine";
import { loadPlanningInputs, planEmptyReason, planMode } from "./planning-inputs";
import { shortfallView } from "./shortfall";
import { DEADLINE_RULES, deadlineType } from "./deadline-types";
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

// ── Pure builder ──────────────────────────────────────────────────────────────

export interface TodayInputs {
  snapshot:         StudySnapshotResult;
  academicState:    AcademicState;
  topics:           TopicMasteryState[];
  examContext:      ExamContext | null;
  plan:             StudyPlan;
  constraints:      TodayConstraint[];
  availableMinutes: number | null;
  // The learner's timezone, so "in N days" counts their calendar days.
  timezone?:        string | null;
  learnerName?:     string | null;
  goals?:           string[];
  now:              Date;
}

// The facts behind a block, stated the way a student would want to hear them.
export function reasonsFor(
  block:       StudyBlock,
  topic:       TopicMasteryState | undefined,
  examContext: ExamContext | null,
  now:         Date,
  timezone:    string | null = null,
): string[] {
  const reasons: string[] = [];

  // Only for a block in the exam's own subject (or any block, when the exam
  // has no subject on record). Another subject's topic is not urgent because
  // of this exam, whatever kind of block it is.
  if (examContext && examCoversSubject(examContext, block.subjectName)) {
    // The learner's calendar days, the same count the deadline list shows,
    // so one message never gives two numbers for the same exam.
    const days = calendarDaysUntil(examContext.scheduledAt, now, timezone);
    reasons.push(DEADLINE_RULES[deadlineType(examContext.examType)].reason(days));
  }
  if (topic) {
    const pct = Math.round(topic.masteryProbability * 100);
    if (topic.reviewCount === 0) reasons.push("not studied yet");
    else if (pct < 40) reasons.push(`weak mastery (${pct}%)`);
    else if (pct < 70) reasons.push(`developing (${pct}%)`);

    if (isDueForReview(topic, now)) {
      const overdue = daysOverdue(topic, now);
      reasons.push(overdue <= 0 ? "review due today" : `review ${overdue} day${overdue === 1 ? "" : "s"} overdue`);
    }
    if (topic.calibrationGap < -0.25) reasons.push("feels stronger than it tests");
  }
  if (block.urgency === "critical" && reasons.length === 0) reasons.push("highest priority today");
  return reasons;
}

// A block as the pages show it. The length is the engine's: the plan was
// already fitted to the time available, so nothing is trimmed here.
export function toAction(
  block:       StudyBlock,
  topics:      TopicMasteryState[],
  examContext: ExamContext | null,
  now:         Date,
  timezone:    string | null = null,
): TodayAction {
  const topic = topics.find(t => t.topicId === block.topicId)
    ?? topics.find(t => t.topicName === block.topicName && t.subjectName === block.subjectName);
  return {
    topicName:       block.topicName,
    subjectName:     block.subjectName,
    activityType:    block.activityType,
    durationMinutes: block.durationMinutes,
    urgency:         block.urgency,
    reasons:         reasonsFor(block, topic, examContext, now, timezone),
    rationale:       block.rationale,
  };
}

export function buildTodayView(input: TodayInputs): NovaTodayReady {
  const { snapshot, academicState, topics, examContext, plan, now } = input;

  const actions = plan.today.map(b => toAction(b, topics, examContext, now, input.timezone ?? null));
  const recommendation = actions[0] ?? null;

  const mode        = planMode(academicState);
  const emptyReason = planEmptyReason(input);

  const weekAgo   = new Date(now.getTime() - 7 * DAY_MS);
  const completed = snapshot.studySessions.filter(s => s.status === "completed");
  const thisWeek  = completed.filter(s => s.sessionDate >= weekAgo);
  const last      = [...completed].sort((a, b) => b.sessionDate.getTime() - a.sessionDate.getTime())[0];

  const overdue = getOverdueTopics(topics, now);
  const studied = topics.filter(t => t.reviewCount > 0);
  const weakest = [...studied].sort((a, b) => a.masteryProbability - b.masteryProbability)[0];

  const upcoming: TodayDeadline[] = [...snapshot.upcomingExams]
    .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime())
    .slice(0, 3)
    .map(e => ({
      title:       e.title,
      subjectName: e.subjectName,
      examType:    e.examType,
      kind:        deadlineType(e.examType),
      kindLabel:   DEADLINE_RULES[deadlineType(e.examType)].label,
      scheduledAt: e.scheduledAt.toISOString(),
      daysUntil:   calendarDaysUntil(e.scheduledAt, now, input.timezone ?? null),
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
      reviewDue:      isDueForReview(weakest, now),
    } : null,

    reviewDue: {
      count:  overdue.length,
      topics: overdue.slice(0, 3).map(t => ({
        topicName:   t.topicName,
        subjectName: t.subjectName,
        daysOverdue: daysOverdue(t, now),
      })),
    },

    constraints: input.constraints,

    progress: {
      sessionsThisWeek:     thisWeek.length,
      minutesThisWeek:      thisWeek.reduce((sum, s) => sum + s.durationMinutes, 0),
      streakDays:           academicState.studyStreakDays,
      // Calendar days in the learner's zone, the count the recovery card and
      // the Planner give for the same session.
      daysSinceLastSession: last ? Math.max(0, dayNumber(dayKey(now, resolveTimezone(input.timezone ?? null))) - dayNumber(dayKey(last.sessionDate, resolveTimezone(input.timezone ?? null)))) : null,
      lastSession:          last ? { topicName: last.topicName, date: last.sessionDate.toISOString(), minutes: last.durationMinutes } : null,
    },

    plan: {
      mode,
      blockCount:        plan.today.length,
      totalMinutesToday: plan.totalMinutesToday,
      budgetMinutes:     plan.budgetMinutes,
      budgetBasis:       plan.budgetBasis,
      assumptions:       plan.assumptions,
      shortfall:         shortfallView(plan.shortfall, {
        dailyMinutesStated: snapshot.dailyMinutesStated !== null,
        availableMinutes:   input.availableMinutes,
        calendarDaysUntil:  examContext ? calendarDaysUntil(examContext.scheduledAt, now, input.timezone ?? null) : undefined,
      }),
    },
  };
}

// ── Loader ────────────────────────────────────────────────────────────────────

export async function loadNovaToday(
  platformChatId: string,
  options: { availableMinutes?: number | null; learnerName?: string | null; now?: Date } = {},
): Promise<NovaTodayView> {
  const now = options.now ?? new Date();

  // The time the student has goes to the Planning Engine, exactly as it does
  // for the Planner. Home then shows the first blocks of that plan.
  const loaded = await loadPlanningInputs(platformChatId, { availableMinutes: options.availableMinutes, now });
  if (loaded.status !== "ready") return { status: loaded.status };

  return buildTodayView({
    ...loaded.inputs,
    learnerName:      options.learnerName ?? null,
    goals:            loaded.inputs.goals.slice(0, 3),
  });
}
