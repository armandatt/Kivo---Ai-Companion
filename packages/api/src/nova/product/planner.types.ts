// ─── Planner view: the contract between Nova and the Planner page ─────────────
// A read model of Nova's current planning hypothesis. Nothing here is stored:
// the plan is recomputed from the Learning Twin on every request, which is
// what makes it adaptive. The page renders it and plans nothing itself.

import type {
  PlanBudgetBasisName,
  PlanEmptyReason,
  TodayAction,
  TodayActiveSession,
  TodayConstraint,
  TodayDeadline,
} from "./today.types";

export type PlannerBlockStatus = "planned" | "in_progress" | "paused";

// A block the Planning Engine produced for today. Blocks have an order and a
// length, never a clock time: Nova does not schedule hours.
export interface PlannerBlock extends TodayAction {
  id:     string;                 // stable within one response
  order:  number;                 // the planner's own order, 1-based
  // "planned" unless the running session is on this block's topic.
  status: PlannerBlockStatus;
}

// A study session Nova has on record. Never a plan.
export interface PlannerSessionEntry {
  id:        string;
  topicName: string | null;
  status:    "completed" | "skipped" | "in_progress" | "paused";
  minutes:   number;
}

// One day of the week. Its four lists are different kinds of thing and are
// never mixed:
//   sessions    records of what happened
//   planned     blocks the Planning Engine produced (today only: it plans
//               one day at a time, so no other day ever has any)
//   reviewsDue  dates from the retention schedule, not planned work: no
//               length, no order, and Nova may plan something else that day
//   exams       dates the student gave
export interface PlannerDay {
  date:     string;               // YYYY-MM-DD in the student's timezone
  relation: "past" | "today" | "future";
  sessions: PlannerSessionEntry[];
  planned:  Array<{ topicName: string; subjectName: string; minutes: number }>;
  reviewsDue:      Array<{ topicName: string; subjectName: string }>;
  reviewsDueCount: number;
  exams:    Array<{ title: string; subjectName: string | null }>;
}

export interface PlannerPressure extends TodayDeadline {
  // True for the exam the Planning Engine is currently planning around.
  drivesPlan:  boolean;
  // How prepared the student is, from tracked topic mastery. null when Nova
  // has no topics on record for the exam's subject: it does not know.
  preparation: {
    mode:       "normal" | "triage" | "crisis";
    weak:       string[];
    developing: string[];
    solid:      string[];
    focusTopic: string | null;
  } | null;
}

export type PlannerAdjustmentKind =
  | "stated_time" | "exam_ramp" | "exam_crisis" | "recovery" | "no_pressure" | "overdue_first";

export interface PlannerReasoning {
  mode: "exam_crisis" | "recovery" | "standard";
  budget: {
    minutes:        number;       // what today was fitted to
    plannedMinutes: number;       // what the blocks add up to
    usualMinutes:   number;       // the student's usual daily study time
    basis:          PlanBudgetBasisName;
  };
  // What is shaping today's plan: every way it departs from the student's
  // usual day, with the fact that caused it. Empty when it does not depart.
  // These describe today only. Plans are not stored, so there is no
  // comparison with an earlier plan here.
  adjustments: Array<{ kind: PlannerAdjustmentKind; text: string }>;
  // Where the time goes, and the evidence behind each subject's share.
  subjects: Array<{
    subjectName:  string;
    minutes:      number;
    sharePercent: number;
    blockCount:   number;
    reasons:      string[];
  }>;
  constraints: TodayConstraint[];
  assumptions: string[];
}

// What Nova does not know. The page says so instead of filling the gap.
export type PlannerUnknown = "no_topics" | "no_exams" | "no_goals" | "no_sessions";

export interface NovaPlannerReady {
  status:      "ready";
  generatedAt: string;
  timezone:    string;            // the zone the day boundaries were drawn in
  availableMinutes:   number | null;
  preferredStudyTime: string | null;   // "morning" | "afternoon" | "evening", as the student said

  today: {
    date:          string;
    blocks:        PlannerBlock[];
    emptyReason:   PlanEmptyReason | null;
    // The running session, and the block it belongs to if it is one of today's.
    activeSession: TodayActiveSession | null;
    activeBlockId: string | null;
    done:          PlannerSessionEntry[];
    doneMinutes:   number;
  };

  week:      PlannerDay[];        // Monday to Sunday of the current week
  pressure:  PlannerPressure[];
  reasoning: PlannerReasoning;
  goals:     string[];
  unknowns:  PlannerUnknown[];
}

export type NovaPlannerView =
  | NovaPlannerReady
  | { status: "not_nova" }
  | { status: "not_connected" }
  | { status: "onboarding_incomplete" };
