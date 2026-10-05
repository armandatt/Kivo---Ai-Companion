// ─── Planning inputs ──────────────────────────────────────────────────────────
// One loader for everything the product read models need to show Nova's
// plan: the snapshot, the academic state, topic mastery, the active exam,
// active constraints, and the plan the Planning Engine produces from them.
// Home and Planner both start here, so they cannot disagree about the plan.
// Read-only. No LLM call, no writes.

import { prisma } from "@repo/db/client";
import { loadStudySnapshot, type StudySnapshotResult } from "../engines/study-snapshot";
import { computeAcademicState } from "../engines/academic-state-engine";
import { getAllTopicMasteries } from "../engines/knowledge-engine";
import { selectActiveExam } from "../engines/exam-engine";
import { generateStudyPlan, MIN_BLOCK_MINUTES } from "../engines/planning-engine";
import { normalizeStoredReality } from "../types/reality.types";
import type { AcademicState } from "../types/academic-state.types";
import type { ExamContext, StudyPlan, TopicMasteryState } from "../types/engine.types";
import type { AcademicUnderstanding } from "../types/understanding.types";
import type { PlanEmptyReason, TodayConstraint } from "./today.types";

// No student message is being interpreted when a page loads.
const NO_MESSAGE: AcademicUnderstanding = {
  intent: "general_chat", emotion: "neutral", topic: null, topicConfidence: 0,
  disclosureClass: "none", ambiguityScore: 0, routingSignal: "coaching_only", rawText: "",
};

const MAX_AVAILABLE_MINUTES = 600;

export function normalizeAvailableMinutes(minutes: number | null | undefined): number | null {
  return typeof minutes === "number" && Number.isFinite(minutes) && minutes > 0
    ? Math.min(Math.round(minutes), MAX_AVAILABLE_MINUTES)
    : null;
}

export type PlanMode = "exam_crisis" | "recovery" | "standard";

export function planMode(state: AcademicState): PlanMode {
  return state.hardDirectives.examCrisisMode ? "exam_crisis"
    : state.hardDirectives.recoveryMode ? "recovery"
    : "standard";
}

// Why a plan has no blocks. One answer for every page.
export function planEmptyReason(
  input: Pick<PlanningInputs, "plan" | "topics" | "academicState">,
): PlanEmptyReason | null {
  if (input.plan.today.length > 0) return null;
  if (input.topics.length === 0) return "no_topics";
  if (input.plan.budgetBasis === "stated_time" && input.plan.budgetMinutes < MIN_BLOCK_MINUTES) return "too_little_time";
  if (planMode(input.academicState) === "recovery") return "recovery";
  return "nothing_due";
}

export interface PlanningInputs {
  // What the student said they have today, as the plan was fitted to it.
  availableMinutes: number | null;
  snapshot:      StudySnapshotResult;
  academicState: AcademicState;
  topics:        TopicMasteryState[];
  examContext:   ExamContext | null;
  plan:          StudyPlan;
  constraints:   TodayConstraint[];
  goals:         string[];
  timezone:      string | null;
  preferredStudyTime: string | null;
  now:           Date;
}

export type PlanningInputsResult =
  | { status: "ready"; inputs: PlanningInputs }
  | { status: "not_connected" }
  | { status: "onboarding_incomplete" };

async function loadActiveConstraints(userId: string, now: Date): Promise<TodayConstraint[]> {
  const rows = await prisma.userReality.findMany({
    where:   { userId, isActive: true, expiresAt: { gt: now }, confidence: { gte: 0.5 } },
    orderBy: { createdAt: "desc" },
    take:    5,
    select:  { category: true, subtype: true, fact: true, expiresAt: true },
  });
  return rows.map(r => ({
    ...normalizeStoredReality(r.category, r.subtype),
    description: r.fact,
    expiresAt:   r.expiresAt.toISOString(),
  }));
}

export async function loadPlanningInputs(
  platformChatId: string,
  options: {
    // What the student says they have today. The Planning Engine refits the
    // whole day to it. This is the only place a stated time enters planning,
    // so every page that passes the same number gets the same plan.
    availableMinutes?: number | null;
    now?:              Date;
  } = {},
): Promise<PlanningInputsResult> {
  const now = options.now ?? new Date();

  const user = await prisma.messengerUser.findUnique({
    where:  { platform_platformChatId: { platform: "telegram", platformChatId } },
    select: {
      id: true,
      novaAcademicProfile: {
        select: { onboardingComplete: true, goals: true, timezone: true, preferredStudyTime: true },
      },
    },
  });
  if (!user) return { status: "not_connected" };
  const profile = user.novaAcademicProfile;
  if (!profile?.onboardingComplete) return { status: "onboarding_incomplete" };

  const snapshot = await loadStudySnapshot(platformChatId);
  if (!snapshot.profileId) return { status: "onboarding_incomplete" };

  const [topics, constraints] = await Promise.all([
    getAllTopicMasteries(snapshot.profileId, now),
    loadActiveConstraints(user.id, now),
  ]);

  const academicState = computeAcademicState({
    semesterStartDate:       snapshot.semesterStartDate,
    semesterEndDate:         snapshot.semesterEndDate,
    daysSinceJoined:         snapshot.daysSinceJoined,
    studySessions:           snapshot.studySessions,
    upcomingExams:           snapshot.upcomingExams,
    stateHistory:            snapshot.stateHistory,
    signals:                 { detectedSignals: [], stateUpdates: [] },
    mentionedTopicMastery:   null,
    understanding:           NO_MESSAGE,
    storedScores:            snapshot.storedScores,
    storedStreakDays:        snapshot.storedStreakDays,
    storedConsecutiveMisses: snapshot.storedConsecutiveMisses,
  }, now);

  const examContext = selectActiveExam(
    snapshot.upcomingExams.map(e => ({
      id: e.id, title: e.title, subjectName: e.subjectName, scheduledAt: e.scheduledAt, examType: e.examType,
    })),
    {},
    now,
  );

  const availableMinutes = normalizeAvailableMinutes(options.availableMinutes);
  const plan = generateStudyPlan(
    academicState, topics, snapshot.preferredStudyHoursPerDay, examContext,
    { availableMinutes, now },
  );

  return {
    status: "ready",
    inputs: {
      availableMinutes,
      snapshot, academicState, topics, examContext, plan, constraints, now,
      goals:              profile.goals,
      timezone:           profile.timezone,
      preferredStudyTime: profile.preferredStudyTime,
    },
  };
}
