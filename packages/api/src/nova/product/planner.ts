// ─── Planner view builder ─────────────────────────────────────────────────────
// Lays out Nova's current planning hypothesis for the Planner page:
//   today      the Planning Engine's blocks, in its order
//   this week  recorded sessions, today's blocks, reviews the retention
//              schedule has falling due, and exams
//   pressure   upcoming exams, with the Exam Engine's reading of readiness
//   reasoning  the budget rule, the mode, and where the time goes
// Read-only. No LLM call, no writes, and no planning of its own: it arranges
// what the engines produced and reports the facts behind it.

import { buildExamContext } from "../engines/exam-engine";
import { loadPlanningInputs, planEmptyReason, planMode, type PlanningInputs } from "./planning-inputs";
import { sessionElapsedSeconds } from "./session-view";
import { toAction } from "./today";
import type {
  NovaPlannerReady,
  NovaPlannerView,
  PlannerBlock,
  PlannerDay,
  PlannerPressure,
  PlannerReasoning,
  PlannerSessionEntry,
  PlannerUnknown,
} from "./planner.types";

const DAY_MS = 86_400_000;
const MAX_REVIEWS_PER_DAY = 4;
const MAX_REASONS_PER_SUBJECT = 3;

// ── Days in the student's timezone ────────────────────────────────────────────

function resolveTimezone(timezone: string | null): string {
  if (!timezone) return "UTC";
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone });
    return timezone;
  } catch {
    return "UTC";
  }
}

export function dayKey(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
}

// Monday to Sunday of the week containing `today` (a YYYY-MM-DD key).
export function weekOf(today: string): string[] {
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  const noon      = Date.UTC(y, m - 1, d, 12);
  const mondayOffset = (new Date(noon).getUTCDay() + 6) % 7;
  return Array.from({ length: 7 }, (_, i) =>
    new Date(noon + (i - mondayOffset) * DAY_MS).toISOString().slice(0, 10),
  );
}

function sameTopic(a: string | null, b: string | null): boolean {
  return a !== null && b !== null && a.trim().toLowerCase() === b.trim().toLowerCase();
}

const inDays = (n: number) => (n <= 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`);

// ── Reasoning ─────────────────────────────────────────────────────────────────

function buildReasoning(input: PlanningInputs, blocks: PlannerBlock[]): PlannerReasoning {
  const { academicState, plan, examContext, snapshot } = input;
  const usualMinutes = Math.round(snapshot.preferredStudyHoursPerDay * 60);
  const budget       = plan.budgetMinutes;

  const mode = planMode(academicState);

  const adjustments: PlannerReasoning["adjustments"] = [];
  const exam = examContext ? `${examContext.examTitle} is ${inDays(examContext.daysUntil)}` : null;

  switch (plan.budgetBasis) {
    case "stated_time":
      adjustments.push({ kind: "stated_time", text: `Fitted to the ${budget} min you said you have today.` });
      break;
    case "no_pressure":
      adjustments.push({
        kind: "no_pressure",
        text: academicState.scores.burnoutRisk > 70
          ? `Kept to ${budget} min at most: burnout risk is high (${Math.round(academicState.scores.burnoutRisk)} of 100).`
          : `Kept to ${budget} min at most: Nova is taking the pressure off while you recover.`,
      });
      break;
    case "exam_crisis":
      adjustments.push({
        kind: "exam_crisis",
        text: `${exam ?? "An exam is within three days"}: study time is raised from ${usualMinutes} to ${budget} min.`,
      });
      break;
    case "recovery":
      adjustments.push({
        kind: "recovery",
        text: `Cut from ${usualMinutes} to ${budget} min: ${academicState.consecutiveMisses} planned days were missed in a row.`,
      });
      break;
    case "exam_ramp":
      if (budget > usualMinutes) {
        adjustments.push({
          kind: "exam_ramp",
          text: `${exam ?? `An exam is ${inDays(academicState.daysUntilNextExam ?? 0)}`}: study time is raised from ${usualMinutes} to ${budget} min.`,
        });
      }
      break;
    case "preferred":
      break;
  }

  // The mode changes what goes in the plan, separately from how long it is.
  if (mode === "exam_crisis" && blocks.length > 0 && blocks.every(b => b.activityType === "exam_prep")) {
    adjustments.push({ kind: "exam_crisis", text: "Every block today is exam prep. Nothing else is scheduled." });
  }
  if (mode === "recovery" && plan.budgetBasis !== "recovery") {
    adjustments.push({
      kind: "recovery",
      text: `One light review at most: ${academicState.consecutiveMisses} planned days were missed in a row.`,
    });
  }
  if (mode === "standard") {
    const overdueFirst = blocks.filter(b => b.activityType === "review" && b.urgency === "high").length;
    if (overdueFirst > 0) {
      adjustments.push({
        kind: "overdue_first",
        text: `${overdueFirst} overdue review${overdueFirst === 1 ? " comes" : "s come"} before anything else.`,
      });
    }
  }

  const total = blocks.reduce((sum, b) => sum + b.durationMinutes, 0);
  const bySubject = new Map<string, PlannerReasoning["subjects"][number]>();
  for (const b of blocks) {
    const s = bySubject.get(b.subjectName)
      ?? { subjectName: b.subjectName, minutes: 0, sharePercent: 0, blockCount: 0, reasons: [] };
    s.minutes    += b.durationMinutes;
    s.blockCount += 1;
    for (const r of b.reasons) if (!s.reasons.includes(r)) s.reasons.push(r);
    bySubject.set(b.subjectName, s);
  }
  const subjects = [...bySubject.values()]
    .map(s => ({
      ...s,
      sharePercent: total > 0 ? Math.round((s.minutes / total) * 100) : 0,
      reasons:      s.reasons.slice(0, MAX_REASONS_PER_SUBJECT),
    }))
    .sort((a, b) => b.minutes - a.minutes);

  return {
    mode,
    budget: { minutes: budget, plannedMinutes: total, usualMinutes, basis: plan.budgetBasis },
    adjustments,
    subjects,
    constraints: input.constraints,
    assumptions: plan.assumptions,
  };
}

// ── Pure builder ──────────────────────────────────────────────────────────────

export function buildPlannerView(input: PlanningInputs): NovaPlannerReady {
  const { snapshot, academicState, topics, examContext, plan, now } = input;
  const timezone = resolveTimezone(input.timezone);
  const today    = dayKey(now, timezone);
  const active   = snapshot.activeSession;

  // Today: the engine's blocks.
  const blocks: PlannerBlock[] = plan.today.map((b, i) => {
    const running = active !== null && sameTopic(active.topicName, b.topicName)
      && (active.subjectName === null || sameTopic(active.subjectName, b.subjectName));
    return {
      ...toAction(b, topics, examContext, now),
      id:     `${b.topicId}:${i}`,
      order:  i + 1,
      status: !running ? "planned" : active!.status === "paused" ? "paused" : "in_progress",
    };
  });
  // Two blocks on one topic: the session belongs to the first.
  const activeBlock = blocks.find(b => b.status !== "planned") ?? null;
  for (const b of blocks) if (b !== activeBlock) b.status = "planned";

  const emptyReason = planEmptyReason(input);

  const entry = (s: StudySnapshotSession): PlannerSessionEntry => ({
    id:        s.id,
    topicName: s.topicName,
    status:    s.status === "skipped" ? "skipped" : s.status === "paused" ? "paused"
             : s.status === "in_progress" ? "in_progress" : "completed",
    minutes:   s.durationMinutes,
  });

  const sessionsByDay = new Map<string, PlannerSessionEntry[]>();
  for (const s of [...snapshot.studySessions].sort((a, b) => a.sessionDate.getTime() - b.sessionDate.getTime())) {
    const key = dayKey(s.sessionDate, timezone);
    sessionsByDay.set(key, [...(sessionsByDay.get(key) ?? []), entry(s)]);
  }
  const done = (sessionsByDay.get(today) ?? []).filter(s => s.status === "completed");

  // This week.
  const week: PlannerDay[] = weekOf(today).map(date => {
    const relation: PlannerDay["relation"] = date < today ? "past" : date === today ? "today" : "future";
    const due = relation === "future"
      ? topics.filter(t => t.reviewDueAt !== null && dayKey(t.reviewDueAt, timezone) === date)
      : [];
    return {
      date,
      relation,
      sessions: relation === "future" ? [] : (sessionsByDay.get(date) ?? []),
      planned:  relation === "today"
        ? blocks.map(b => ({ topicName: b.topicName, subjectName: b.subjectName, minutes: b.durationMinutes }))
        : [],
      reviewsDue:      due.slice(0, MAX_REVIEWS_PER_DAY).map(t => ({ topicName: t.topicName, subjectName: t.subjectName })),
      reviewsDueCount: due.length,
      exams: snapshot.upcomingExams
        .filter(e => dayKey(e.scheduledAt, timezone) === date)
        .map(e => ({ title: e.title, subjectName: e.subjectName })),
    };
  });

  // Upcoming pressure. Readiness is the Exam Engine's reading of the topics
  // tracked for that subject; with none tracked, Nova does not know.
  const pressure: PlannerPressure[] = [...snapshot.upcomingExams]
    .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime())
    .map(e => {
      const subjectTopics = e.subjectName === null ? [] : topics.filter(t => sameTopic(t.subjectName, e.subjectName));
      const context = subjectTopics.length > 0
        ? buildExamContext({ id: e.id, title: e.title, subjectName: e.subjectName, scheduledAt: e.scheduledAt, examType: e.examType }, subjectTopics, now)
        : null;
      return {
        title:       e.title,
        subjectName: e.subjectName,
        examType:    e.examType,
        scheduledAt: e.scheduledAt.toISOString(),
        daysUntil:   Math.max(0, Math.ceil((e.scheduledAt.getTime() - now.getTime()) / DAY_MS)),
        drivesPlan:  examContext?.examId === e.id,
        preparation: context ? {
          mode:       context.mode,
          weak:       context.riskMatrix.critical,
          developing: context.riskMatrix.risky,
          solid:      context.riskMatrix.safe,
          focusTopic: context.primaryFocus,
        } : null,
      };
    });

  const goals = input.goals.slice(0, 3);
  const unknowns: PlannerUnknown[] = [];
  if (topics.length === 0)                  unknowns.push("no_topics");
  if (snapshot.upcomingExams.length === 0)  unknowns.push("no_exams");
  if (goals.length === 0)                   unknowns.push("no_goals");
  if (!snapshot.studySessions.some(s => s.status === "completed")) unknowns.push("no_sessions");

  return {
    status:      "ready",
    generatedAt: now.toISOString(),
    timezone,
    availableMinutes:   input.availableMinutes,
    preferredStudyTime: input.preferredStudyTime,

    today: {
      date: today,
      blocks,
      emptyReason,
      activeSession: active ? {
        id:          active.id,
        topicName:   active.topicName,
        subjectName: active.subjectName,
        status:      active.status === "paused" ? "paused" : "in_progress",
        startedAt:   active.startedAt.toISOString(),
        elapsedMinutes:         Math.floor(sessionElapsedSeconds(active, now) / 60),
        plannedDurationMinutes: active.plannedDurationMinutes,
      } : null,
      activeBlockId: activeBlock?.id ?? null,
      done,
      doneMinutes: done.reduce((sum, s) => sum + s.minutes, 0),
    },

    week,
    pressure,
    reasoning: buildReasoning(input, blocks),
    goals,
    unknowns,
  };
}

type StudySnapshotSession = PlanningInputs["snapshot"]["studySessions"][number];

// ── Loader ────────────────────────────────────────────────────────────────────

export async function loadNovaPlanner(
  platformChatId: string,
  options: { availableMinutes?: number | null; now?: Date } = {},
): Promise<NovaPlannerView> {
  // The same call Home makes. The Planning Engine refits the whole day to
  // the time the student has.
  const loaded = await loadPlanningInputs(platformChatId, { availableMinutes: options.availableMinutes, now: options.now });
  if (loaded.status !== "ready") return { status: loaded.status };

  return buildPlannerView(loaded.inputs);
}
