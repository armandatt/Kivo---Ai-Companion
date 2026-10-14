// ─── Planning Engine ──────────────────────────────────────────────────────────
// SKILL.md §8.4 — generate study plans from state + retention data.
// NEVER makes LLM calls. NEVER modifies DB.
// LLM can express or adjust a plan in a reply, but code owns the algorithm.
// Owner: Planning Engine.

import { examCoversSubject } from "./exam-engine";
import type { PlanBudgetBasis, PlanShortfall, StudyBlock, StudyPlan } from "../types/engine.types";
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
}

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
}): PlanShortfall | null {
  const { examContext, examTopics, budget } = input;
  if (!examContext || examContext.daysUntil >= EXAM_WINDOW_DAYS) return null;
  if (budget.basis === "no_pressure" || budget.basis === "recovery") return null;

  const remaining = examTopics.filter(t => t.reviewCount === 0 || t.masteryProbability < SOLID_FROM);
  if (remaining.length === 0) return null;

  // Today, and each day after it before the day of the exam.
  const studyDays        = Math.max(1, examContext.daysUntil);
  const dailyMinutes     = Math.max(0, Math.round(input.dailyMinutes));
  const minutesAvailable = Math.round(budget.minutes) + dailyMinutes * (studyDays - 1);
  const minutesNeeded    = remaining.length * EXAM_TOPIC_MINUTES;
  if (minutesNeeded <= minutesAvailable) return null;

  return {
    examId:           examContext.examId,
    examTitle:        examContext.examTitle,
    daysUntil:        examContext.daysUntil,
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

function examPrepBlock(topic: TopicMasteryState, minutes: number, daysUntil: number): StudyBlock {
  return {
    topicId:         topic.topicId,
    topicName:       topic.topicName,
    subjectName:     topic.subjectName,
    durationMinutes: minutes,
    activityType:    "exam_prep",
    rationale:       `${daysUntil}d until exam — low mastery, high weight topic.`,
    urgency:         daysUntil < 3 ? "critical" : daysUntil < 7 ? "high" : "normal",
  };
}

// ── Core plan generation ──────────────────────────────────────────────────────

export function generateStudyPlan(
  state:                AcademicState,
  topics:               TopicMasteryState[],
  preferredHoursPerDay: number,
  examContext:          ExamContext | null,
  options:              PlanOptions = {},
): StudyPlan {
  const now            = options.now ?? new Date();
  const budget         = fitBudgetToAvailableTime(
    computeDailyBudget(preferredHoursPerDay, state), options.availableMinutes,
  );
  const budgetMinutes  = budget.minutes;
  const blocks: StudyBlock[] = [];
  const assumptions: string[] = [];
  let usedMinutes = 0;
  // Every block length below goes through this: the engine's size for the
  // kind of block, or the learner's own usual session if that is shorter.
  const cap  = sessionCap(options);
  const size = (wanted: number) => (cap === null ? wanted : Math.min(wanted, cap));
  if (cap !== null && cap < REVIEW_BLOCK_MINUTES) assumptions.push(`Blocks are kept to about ${cap} minutes, the length your own sessions usually run.`);

  // Exam prep is for the topics the exam is about: its own subject's. A
  // topic from another subject is never called exam prep for this exam.
  const examTopics = examContext ? topics.filter(t => examCoversSubject(examContext, t.subjectName)) : [];
  const shortfall  = examShortfall({ examContext, examTopics, budget, dailyMinutes: preferredHoursPerDay * 60 });

  // ── Exam crisis: all blocks are exam prep ────────────────────────────────
  // With no topic on record for the exam's subject there is nothing to
  // prepare from, and the day is planned the ordinary way instead.
  if (examContext && state.hardDirectives.examCrisisMode && examTopics.length > 0) {
    const prioritized = getExamPriorityOrder(examTopics, examContext.topicWeights);
    for (const topic of prioritized) {
      if (usedMinutes >= budgetMinutes) break;
      const remaining = budgetMinutes - usedMinutes;
      const mins      = Math.min(size(45), remaining);
      blocks.push(examPrepBlock(topic, mins, examContext.daysUntil));
      usedMinutes += mins;
    }
    assumptions.push("Assumes full focus mode for exam prep.");
    return buildPlan(blocks, budget, assumptions, now, shortfall);
  }

  // ── Recovery mode: very gentle, single topic ─────────────────────────────
  if (state.hardDirectives.recoveryMode) {
    const easiestTopic = topics
      .filter(t => t.masteryProbability > 0.5)
      .sort((a, b) => b.masteryProbability - a.masteryProbability)[0];

    if (easiestTopic && budgetMinutes >= MIN_BLOCK_MINUTES) {
      blocks.push(reviewBlock(easiestTopic, Math.min(size(20), budgetMinutes), "optional"));
      assumptions.push("Light session — recovery mode active. No new material.");
    }
    return buildPlan(blocks, budget, assumptions, now, shortfall);
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
      blocks.push(examPrepBlock(topic, mins, examContext.daysUntil));
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
  const notStarted = topics
    .filter(t => t.reviewCount === 0 && t.lastStudied === null)
    .filter(t => !blocks.some(b => b.topicId === t.topicId))
    .slice(0, blocks.length === 0 ? 2 : 1);

  for (const topic of notStarted) {
    if (usedMinutes >= budgetMinutes) break;
    const mins = Math.min(size(NEW_MATERIAL_BLOCK_MINUTES), budgetMinutes - usedMinutes);
    if (mins < MIN_BLOCK_MINUTES) break;
    blocks.push(newMaterialBlock(topic, mins));
    usedMinutes += mins;
  }

  if (blocks.length === 0) {
    assumptions.push("No specific topics loaded yet — plan is incomplete until subjects are added.");
  }

  return buildPlan(blocks, budget, assumptions, now, shortfall);
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
