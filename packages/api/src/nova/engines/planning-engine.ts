// ─── Planning Engine ──────────────────────────────────────────────────────────
// SKILL.md §8.4 — generate study plans from state + retention data.
// NEVER makes LLM calls. NEVER modifies DB.
// LLM can express or adjust a plan in a reply, but code owns the algorithm.
// Owner: Planning Engine.

import type { PlanBudgetBasis, StudyBlock, StudyPlan } from "../types/engine.types";
import type { AcademicState } from "../types/academic-state.types";
import type { TopicMasteryState } from "../types/engine.types";
import type { ExamContext } from "../types/engine.types";
import { getOverdueTopics, getExamPriorityOrder } from "./retention-engine";

// ── Time budget ───────────────────────────────────────────────────────────────

// Returns the budget and which rule set it, so a reader of the plan can be
// told why today is the length it is.
function computeDailyBudget(
  preferredHoursPerDay: number,
  state:                AcademicState,
): { minutes: number; basis: PlanBudgetBasis } {
  const base = preferredHoursPerDay * 60;

  if (state.hardDirectives.noStudyPressure)  return { minutes: Math.min(base, 30), basis: "no_pressure" };
  if (state.hardDirectives.examCrisisMode)   return { minutes: Math.min(base * 1.5, 360), basis: "exam_crisis" };
  if (state.hardDirectives.recoveryMode)     return { minutes: Math.min(base * 0.6, 60), basis: "recovery" };

  // Exam within 14 days: scale up linearly toward crisis
  if (state.daysUntilNextExam !== null && state.daysUntilNextExam < 14) {
    const scale = 1 + (14 - state.daysUntilNextExam) / 14 * 0.5;
    return { minutes: Math.min(base * scale, 360), basis: "exam_ramp" };
  }

  return { minutes: base, basis: "preferred" };
}

// The time the student says they have today replaces their usual hours and
// is a ceiling on everything else: it cannot lift a wellbeing cap or stretch
// an exam ramp, only shorten them.
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
}

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
  const now            = new Date();
  const budget         = fitBudgetToAvailableTime(
    computeDailyBudget(preferredHoursPerDay, state), options.availableMinutes,
  );
  const budgetMinutes  = budget.minutes;
  const blocks: StudyBlock[] = [];
  const assumptions: string[] = [];
  let usedMinutes = 0;

  // ── Exam crisis: all blocks are exam prep ────────────────────────────────
  if (examContext && state.hardDirectives.examCrisisMode) {
    const prioritized = getExamPriorityOrder(topics, examContext.topicWeights);
    for (const topic of prioritized) {
      if (usedMinutes >= budgetMinutes) break;
      const remaining = budgetMinutes - usedMinutes;
      const mins      = Math.min(45, remaining);
      blocks.push(examPrepBlock(topic, mins, examContext.daysUntil));
      usedMinutes += mins;
    }
    assumptions.push("Assumes full focus mode for exam prep.");
    return buildPlan(blocks, budget, assumptions, now);
  }

  // ── Recovery mode: very gentle, single topic ─────────────────────────────
  if (state.hardDirectives.recoveryMode) {
    const easiestTopic = topics
      .filter(t => t.masteryProbability > 0.5)
      .sort((a, b) => b.masteryProbability - a.masteryProbability)[0];

    if (easiestTopic) {
      blocks.push(reviewBlock(easiestTopic, 20, "optional"));
      assumptions.push("Light session — recovery mode active. No new material.");
    }
    return buildPlan(blocks, budget, assumptions, now);
  }

  // ── Standard mode: overdue reviews first, then practice ──────────────────

  // 1. Overdue reviews (critical first)
  const overdue = getOverdueTopics(topics);
  for (const topic of overdue) {
    if (usedMinutes >= budgetMinutes * 0.6) break;  // max 60% on overdue
    const mins = Math.min(25, budgetMinutes - usedMinutes);
    if (mins < 10) break;
    blocks.push(reviewBlock(topic, mins, "high"));
    usedMinutes += mins;
  }

  // 2. Exam context: high-weight low-mastery topics
  if (examContext && state.daysUntilNextExam !== null && state.daysUntilNextExam < 14) {
    const examTopics = getExamPriorityOrder(topics, examContext.topicWeights).slice(0, 3);
    for (const topic of examTopics) {
      if (usedMinutes >= budgetMinutes * 0.8) break;
      if (overdue.some(o => o.topicId === topic.topicId)) continue; // already added
      const mins = Math.min(30, budgetMinutes - usedMinutes);
      if (mins < 10) break;
      blocks.push(examPrepBlock(topic, mins, state.daysUntilNextExam));
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
    const mins = Math.min(30, budgetMinutes - usedMinutes);
    if (mins < 10) break;
    blocks.push(practiceBlock(topic, mins));
    usedMinutes += mins;
  }

  if (blocks.length === 0) {
    assumptions.push("No specific topics loaded yet — plan is incomplete until subjects are added.");
  }

  return buildPlan(blocks, budget, assumptions, now);
}

function buildPlan(
  blocks:        StudyBlock[],
  budget:        { minutes: number; basis: PlanBudgetBasis },
  assumptions:   string[],
  now:           Date,
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
  };
}
