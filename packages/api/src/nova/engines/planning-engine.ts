// ─── Planning Engine ──────────────────────────────────────────────────────────
// SKILL.md §8.4 — generate study plans from state + retention data.
// NEVER makes LLM calls. NEVER modifies DB.
// LLM can express or adjust a plan in a reply, but code owns the algorithm.
// Owner: Planning Engine.

import { examCoversSubject } from "./exam-engine";
import type { PlanBudgetBasis, PlanShortfall, StudyBlock, StudyPlan } from "../types/engine.types";
import { reentryMinutes } from "./recovery-engine";
import { classifyChange } from "../decision/plan-change-policy";
import type { AcademicState } from "../types/academic-state.types";
import type { TopicMasteryState } from "../types/engine.types";
import type { ExamContext } from "../types/engine.types";
import { getOverdueTopics, getExamPriorityOrder } from "./retention-engine";

// ── Time budget ───────────────────────────────────────────────────────────────

// Returns the budget and which rule set it, so a reader of the plan can be
// told why today is the length it is.
//
// The learner's daily time is a hard limit. Nothing here raises it: an exam
// changes what the day holds, never how long it is. When the work for an
// exam does not fit the time before it, the plan says so (examShortfall) and
// the learner chooses; only they can give a day more time.
function computeDailyBudget(
  preferredHoursPerDay: number,
  state:                AcademicState,
): { minutes: number; basis: PlanBudgetBasis } {
  const base = preferredHoursPerDay * 60;

  if (state.hardDirectives.noStudyPressure)  return { minutes: Math.min(base, 30), basis: "no_pressure" };
  if (state.hardDirectives.recoveryMode)     return { minutes: Math.min(base * 0.6, 60), basis: "recovery" };

  return { minutes: base, basis: "preferred" };
}

// The time the student says they have today replaces their usual hours. It
// is theirs to state, so it may be more than their usual day as well as
// less. It cannot lift a wellbeing cap, only shorten one.
function fitBudgetToAvailableTime(
  budget:           { minutes: number; basis: PlanBudgetBasis },
  availableMinutes: number | null | undefined,
): { minutes: number; basis: PlanBudgetBasis } {
  if (typeof availableMinutes !== "number" || availableMinutes <= 0) return budget;
  if (availableMinutes >= budget.minutes && budget.basis !== "preferred") return budget;
  return { minutes: availableMinutes, basis: "stated_time" };
}

export interface PlanOptions {
  // What the student said they have today. Unset: plan from their usual hours.
  availableMinutes?: number | null;
  // The moment the plan is for. Defaults to the present; a caller that
  // judges "due" at some other moment passes the same one here.
  now?: Date;
  // How long this learner's own sessions run, when their record supports a
  // conclusion (Learning DNA "typical_session", supported or stronger and not
  // weakening). A block is never planned longer than this: a learner whose
  // sessions run 15 minutes is not handed 30-minute blocks they do not do.
  // It only shortens, and only when they have not said how long they have.
  usualSessionMinutes?: number | null;
  // A first day back after four or more days without study (isReentryDay in
  // recovery-engine.ts). The usual day is planned shorter, where the plan
  // change policy lets that happen by itself: not over a time they stated,
  // not while an exam takes the day, not on top of another cut.
  reentry?: boolean;
  // The learner's own changes to today's plan (NovaPlanOverride, read by
  // product/plan-overrides.ts): topics left out today, topics added first,
  // and an order for the blocks. Applied to what the engine plans; they never
  // lengthen the day.
  overrides?: { skip: string[]; pin: string[]; order: Array<{ topicId: string; position: number }> };
  // How far off the active date is in the learner's own calendar days (0 is
  // today). Given, the shortfall counts study days from it, so the time it
  // says is left agrees with the "in N days" the pages show. Unset: the
  // exam engine's elapsed-time count.
  examCalendarDays?: number | null;
  // What the learner has already done today (studiedToday in
  // recovery-engine.ts). The plan is for the rest of the day: a topic done
  // today is not planned again, and the minutes done count against the
  // day's time. Not against a time they stated: "I have 40 minutes" is
  // said about now.
  doneToday?: { topicIds: string[]; minutes: number } | null;
  // The one subject the learner chose to work on today. Only its topics are
  // planned, continuing from where they left off. An exam in another
  // subject does not take this day over: the learner asked for this one.
  focusSubject?: string | null;
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

// How many not-started topics a focused day may take, in syllabus order.
export const FOCUS_NEW_TOPICS = 3;

// The longest a block may be for this learner, or null for no limit of
// their own. Rounded to five minutes, and never under the shortest block.
export function sessionCap(options: PlanOptions): number | null {
  const usual = options.usualSessionMinutes;
  if (typeof usual !== "number" || !Number.isFinite(usual) || usual <= 0) return null;
  // They said how long they have today: that is the answer, not their habit.
  if (typeof options.availableMinutes === "number" && options.availableMinutes > 0) return null;
  return Math.max(MIN_BLOCK_MINUTES, Math.round(usual / 5) * 5);
}

// The shortest block worth planning. A budget below it yields no blocks.
export const MIN_BLOCK_MINUTES = 10;

// ── When the work for an exam does not fit ────────────────────────────────────

// How close an exam must be before the plan works toward it (the exam
// engine's own window), and so before a shortfall is worth stating.
export const EXAM_WINDOW_DAYS = 14;

// What one topic is counted as needing before an exam. An assumption, said
// as one wherever the figure is shown: nothing on record says how big a
// topic is, and no topic is known to weigh more than another.
export const EXAM_TOPIC_MINUTES = 30;

// A topic at or above this has been taken as far as the plan asks for an
// exam. The Knowledge Engine's "solid" boundary (DEVELOPING_BELOW).
const SOLID_FROM = 0.7;

// Whether the topics still to be worked on for this exam fit in the time the
// learner has before it, at the daily time they gave. null when they fit,
// when no exam is inside the window, or when the day is held short for the
// learner's wellbeing: a day cut for recovery is not the day to count what
// is missing.
export function examShortfall(input: {
  examContext:  ExamContext | null;
  examTopics:   TopicMasteryState[];
  budget:       { minutes: number; basis: PlanBudgetBasis };
  dailyMinutes: number;
  // The exam's distance in the learner's calendar days, when known.
  calendarDays?: number | null;
}): PlanShortfall | null {
  const { examContext, examTopics, budget } = input;
  if (!examContext || examContext.daysUntil >= EXAM_WINDOW_DAYS) return null;
  if (budget.basis === "no_pressure" || budget.basis === "recovery") return null;

  const remaining = examTopics.filter(t => t.reviewCount === 0 || t.masteryProbability < SOLID_FROM);
  if (remaining.length === 0) return null;

  // Today, and each day after it before the day of the exam. Counted on the
  // learner's calendar when it is known: elapsed time rounded up would count
  // the day of the exam itself as a day to study for it.
  const calendarDays     = typeof input.calendarDays === "number" && Number.isFinite(input.calendarDays) ? Math.max(0, Math.floor(input.calendarDays)) : null;
  const studyDays        = Math.max(1, calendarDays ?? examContext.daysUntil);
  const dailyMinutes     = Math.max(0, Math.round(input.dailyMinutes));
  const minutesAvailable = Math.round(budget.minutes) + dailyMinutes * (studyDays - 1);
  const minutesNeeded    = remaining.length * EXAM_TOPIC_MINUTES;
  if (minutesNeeded <= minutesAvailable) return null;

  return {
    examId:           examContext.examId,
    examTitle:        examContext.examTitle,
    daysUntil:        calendarDays ?? examContext.daysUntil,
    studyDays,
    dailyMinutes,
    topicsRemaining:  remaining.length,
    topicsThatFit:    Math.min(remaining.length, Math.floor(minutesAvailable / EXAM_TOPIC_MINUTES)),
    minutesPerTopic:  EXAM_TOPIC_MINUTES,
    minutesNeeded,
    minutesAvailable,
  };
}

// How long a review of one topic is planned for.
export const REVIEW_BLOCK_MINUTES = 25;
export const NEW_MATERIAL_BLOCK_MINUTES = 25;

// ── Block builder helpers ─────────────────────────────────────────────────────

function reviewBlock(topic: TopicMasteryState, minutes: number, urgency: StudyBlock["urgency"]): StudyBlock {
  return {
    topicId:         topic.topicId,
    topicName:       topic.topicName,
    subjectName:     topic.subjectName,
    durationMinutes: minutes,
    activityType:    "review",
    rationale:       `Retention at ${Math.round(topic.retentionEstimate * 100)}% — review to prevent forgetting.`,
    urgency,
  };
}

function practiceBlock(topic: TopicMasteryState, minutes: number): StudyBlock {
  return {
    topicId:         topic.topicId,
    topicName:       topic.topicName,
    subjectName:     topic.subjectName,
    durationMinutes: minutes,
    activityType:    "practice",
    rationale:       `Mastery at ${Math.round(topic.masteryProbability * 100)}% — active practice to deepen retention.`,
    urgency:         "normal",
  };
}

function newMaterialBlock(topic: TopicMasteryState, minutes: number): StudyBlock {
  return {
    topicId:         topic.topicId,
    topicName:       topic.topicName,
    subjectName:     topic.subjectName,
    durationMinutes: minutes,
    activityType:    "new_material",
    rationale:       "On your syllabus and not started yet.",
    urgency:         "normal",
  };
}

// The rationale names the date and nothing else: how far off it is is said
// once, in the learner's calendar days, by whoever shows the block (the
// engine counts elapsed time, and two numbers for one date read as a
// mistake), and nothing on record says how much a topic weighs in an exam.
function examPrepBlock(topic: TopicMasteryState, minutes: number, daysUntil: number, examTitle: string): StudyBlock {
  return {
    topicId:         topic.topicId,
    topicName:       topic.topicName,
    subjectName:     topic.subjectName,
    durationMinutes: minutes,
    activityType:    "exam_prep",
    rationale:       `${examTitle} covers this topic, and it is close.`,
    urgency:         daysUntil < 3 ? "critical" : daysUntil < 7 ? "high" : "normal",
  };
}

// ── Core plan generation ──────────────────────────────────────────────────────

export function generateStudyPlan(
  state:                AcademicState,
  allTopics:            TopicMasteryState[],
  preferredHoursPerDay: number,
  examContext:          ExamContext | null,
  options:              PlanOptions = {},
): StudyPlan {
  const now            = options.now ?? new Date();
  const fitted         = fitBudgetToAvailableTime(
    computeDailyBudget(preferredHoursPerDay, state), options.availableMinutes,
  );
  // Exam prep is for the topics the exam is about: its own subject's. A
  // topic from another subject is never called exam prep for this exam.
  // The learner's changes to today. A skipped topic and an added one are not
  // picked by the rules below; an added one is planned first. Whether an exam
  // takes the day, and what is short before it, count every topic: skipping
  // one today does not remove its work.
  // A topic already done today is not planned again today, and on a focused
  // day only the chosen subject's topics are.
  const focus  = options.focusSubject?.trim() ? options.focusSubject.trim() : null;
  const inFocus = (t: TopicMasteryState) => focus === null || sameName(t.subjectName, focus);
  const done   = new Set(options.doneToday?.topicIds ?? []);
  const skip   = new Set([...(options.overrides?.skip ?? []), ...done]);
  const pinned = (options.overrides?.pin ?? []).filter(id => !skip.has(id))
    .map(id => allTopics.find(t => t.topicId === id)).filter((t): t is TopicMasteryState => t !== undefined && inFocus(t));
  const taken  = new Set([...skip, ...pinned.map(t => t.topicId)]);
  const topics = allTopics.filter(t => !taken.has(t.topicId) && inFocus(t));
  const examTopicsAll = examContext ? allTopics.filter(t => examCoversSubject(examContext, t.subjectName)) : [];
  const examTopics    = examContext ? topics.filter(t => examCoversSubject(examContext, t.subjectName)) : [];
  const examTakesDay = !!examContext && state.hardDirectives.examCrisisMode && examTopicsAll.length > 0
    && (focus === null || examCoversSubject(examContext, focus));
  const budget         = options.reentry && fitted.basis === "preferred" && classifyChange({
    kind: "shorten_today", usualMinutes: fitted.minutes, minutes: reentryMinutes(fitted.minutes, MIN_BLOCK_MINUTES),
    statedToday: false, dayTakenByExam: examTakesDay,
  }).class === "automatic"
    ? { minutes: reentryMinutes(fitted.minutes, MIN_BLOCK_MINUTES), basis: "reentry" as const }
    : fitted;
  const budgetMinutes  = budget.minutes;
  const blocks: StudyBlock[] = [];
  const assumptions: string[] = [];
  // Time already studied today is part of the day, unless the learner gave
  // the time they have now.
  const doneMinutes = budget.basis === "stated_time" ? 0 : Math.max(0, Math.round(options.doneToday?.minutes ?? 0));
  let usedMinutes = doneMinutes;
  // Every block length below goes through this: the engine's size for the
  // kind of block, or the learner's own usual session if that is shorter.
  const cap  = sessionCap(options);
  const size = (wanted: number) => (cap === null ? wanted : Math.min(wanted, cap));
  if (cap !== null && cap < REVIEW_BLOCK_MINUTES) assumptions.push(`Blocks are kept to about ${cap} minutes, the length your own sessions usually run.`);

  // Topics the learner added to today come first, inside the day's time.
  for (const topic of pinned) {
    const mins = Math.min(size(REVIEW_BLOCK_MINUTES), budgetMinutes - usedMinutes);
    if (mins < MIN_BLOCK_MINUTES) { assumptions.push(`You added ${topic.topicName} to today, but it doesn't fit in the time you have.`); continue; }
    const block = topic.reviewCount === 0 && topic.lastStudied === null ? newMaterialBlock(topic, mins) : reviewBlock(topic, mins, "high");
    blocks.push({ ...block, rationale: "You added this to today's plan." });
    usedMinutes += mins;
  }
  // The learner's order, then the engine's for what they did not place.
  const position = new Map((options.overrides?.order ?? []).map(o => [o.topicId, o.position] as const));
  const ordered = (bs: StudyBlock[]): StudyBlock[] => position.size === 0 ? bs : [...bs].sort((a, b) => {
    const pa = position.get(a.topicId), pb = position.get(b.topicId);
    if (pa !== undefined && pb !== undefined) return pa - pb;
    return pa !== undefined ? -1 : pb !== undefined ? 1 : 0;
  });

  const shortfall  = examShortfall({ examContext, examTopics: examTopicsAll, budget, dailyMinutes: preferredHoursPerDay * 60, calendarDays: options.examCalendarDays });

  // ── Exam crisis: all blocks are exam prep ────────────────────────────────
  // With no topic on record for the exam's subject there is nothing to
  // prepare from, and the day is planned the ordinary way instead.
  if (examContext && examTakesDay) {
    const prioritized = getExamPriorityOrder(examTopics, examContext.topicWeights);
    for (const topic of prioritized) {
      if (usedMinutes >= budgetMinutes) break;
      const remaining = budgetMinutes - usedMinutes;
      const mins      = Math.min(size(45), remaining);
      blocks.push(examPrepBlock(topic, mins, examContext.daysUntil, examContext.examTitle));
      usedMinutes += mins;
    }
    assumptions.push("Assumes full focus mode for exam prep.");
    return buildPlan(ordered(blocks), budget, assumptions, now, shortfall);
  }

  // ── Recovery mode: very gentle, single topic ─────────────────────────────
  if (state.hardDirectives.recoveryMode) {
    const easiestTopic = topics
      .filter(t => t.masteryProbability > 0.5)
      .sort((a, b) => b.masteryProbability - a.masteryProbability)[0];

    if (easiestTopic && budgetMinutes - usedMinutes >= MIN_BLOCK_MINUTES && doneMinutes === 0) {
      blocks.push(reviewBlock(easiestTopic, Math.min(size(20), budgetMinutes - usedMinutes), "optional"));
      assumptions.push("Light session — recovery mode active. No new material.");
    }
    return buildPlan(ordered(blocks), budget, assumptions, now, shortfall);
  }

  // ── Standard mode: overdue reviews first, then practice ──────────────────

  // 1. Overdue reviews (critical first)
  const overdue = getOverdueTopics(topics, now);
  for (const topic of overdue) {
    if (usedMinutes >= budgetMinutes * 0.6) break;  // max 60% on overdue
    const mins = Math.min(size(REVIEW_BLOCK_MINUTES), budgetMinutes - usedMinutes);
    if (mins < MIN_BLOCK_MINUTES) break;
    blocks.push(reviewBlock(topic, mins, "high"));
    usedMinutes += mins;
  }

  // 2. Exam context: high-weight low-mastery topics
  // The deadline's own distance, not the academic state's: that counts only
  // the dates that can take over a day, and an interview is prepared for too.
  if (examContext && examContext.daysUntil < EXAM_WINDOW_DAYS) {
    for (const topic of getExamPriorityOrder(examTopics, examContext.topicWeights).slice(0, 3)) {
      if (usedMinutes >= budgetMinutes * 0.8) break;
      if (overdue.some(o => o.topicId === topic.topicId)) continue; // already added
      const mins = Math.min(size(30), budgetMinutes - usedMinutes);
      if (mins < MIN_BLOCK_MINUTES) break;
      blocks.push(examPrepBlock(topic, mins, examContext.daysUntil, examContext.examTitle));
      usedMinutes += mins;
    }
  }

  // 3. Practice on recently studied topics (above 0.4 mastery)
  const practiceReady = topics
    .filter(t => t.masteryProbability > 0.4 && t.masteryProbability < 0.85)
    .filter(t => !blocks.some(b => b.topicId === t.topicId))
    .sort((a, b) => b.masteryProbability - a.masteryProbability)
    .slice(0, 2);

  for (const topic of practiceReady) {
    if (usedMinutes >= budgetMinutes) break;
    const mins = Math.min(size(30), budgetMinutes - usedMinutes);
    if (mins < MIN_BLOCK_MINUTES) break;
    blocks.push(practiceBlock(topic, mins));
    usedMinutes += mins;
  }

  // 4. Topics on the syllabus that have never been studied. One a day once
  //    there is other work, two when there is nothing else: a learner who has
  //    just said what a subject covers gets somewhere to start. In the order
  //    they were given.
  //    A day given to one subject carries on through its syllabus: up to
  //    FOCUS_NEW_TOPICS, while there is time.
  const notStarted = topics
    .filter(t => t.reviewCount === 0 && t.lastStudied === null)
    .filter(t => !blocks.some(b => b.topicId === t.topicId))
    .slice(0, focus !== null ? FOCUS_NEW_TOPICS : blocks.length === 0 ? 2 : 1);

  for (const topic of notStarted) {
    if (usedMinutes >= budgetMinutes) break;
    const mins = Math.min(size(NEW_MATERIAL_BLOCK_MINUTES), budgetMinutes - usedMinutes);
    if (mins < MIN_BLOCK_MINUTES) break;
    blocks.push(newMaterialBlock(topic, mins));
    usedMinutes += mins;
  }

  if (blocks.length === 0 && allTopics.length === 0) {
    assumptions.push("No specific topics loaded yet — plan is incomplete until subjects are added.");
  }

  return buildPlan(ordered(blocks), budget, assumptions, now, shortfall);
}

function buildPlan(
  blocks:        StudyBlock[],
  budget:        { minutes: number; basis: PlanBudgetBasis },
  assumptions:   string[],
  now:           Date,
  shortfall:     PlanShortfall | null,
): StudyPlan {
  const budgetMinutes = budget.minutes;
  const totalMinutesToday = blocks.reduce((s, b) => s + b.durationMinutes, 0);
  const confidence        = blocks.length === 0
    ? 0.2
    : Math.min(1, 0.5 + (totalMinutesToday / Math.max(1, budgetMinutes)) * 0.5);

  return {
    today:       blocks,
    thisWeek:    [],   // weekly planning runs less frequently, not per-message
    generatedAt: now,
    confidence,
    assumptions,
    totalMinutesToday,
    budgetMinutes: Math.round(budgetMinutes),
    budgetBasis:   budget.basis,
    shortfall,
  };
}
