// ─── Build with Nova: the contract the web app reads ──────────────────────────
// No imports beyond types, so the web app imports it directly.

import type { WorkspacePlan } from "./workspace-plan";
import type { WorkspaceCounts, WorkspaceSummary } from "./workspaces.types";

// Where a draft is in its life (builder-state.ts holds the transitions):
//   discovery          Nova is learning what the learner wants
//   drafting           Nova is writing a proposal (a job is running)
//   awaiting_approval  a proposal is there to review, edit and approve
//   building           an approved version is being created
//   ready              it was created; the workspace is real
//   failed             drafting or building failed; it can be retried
//   cancelled          the learner stopped it; nothing was created
export const DRAFT_STATUSES = ["discovery", "drafting", "awaiting_approval", "building", "ready", "failed", "cancelled"] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

// The kind of work, as Nova reads it. It shapes the proposal; it is not a
// template.
export const WORK_KINDS = ["project", "exam", "skill", "semester", "work", "career", "other"] as const;
export type WorkKind = (typeof WORK_KINDS)[number];

export interface BuilderMessage {
  id:   string;
  role: "user" | "nova";
  text: string;
  at:   string;
  // What a Nova message is: a question, ordinary talk, a proposal or a
  // revision of one (with the version it made), the result of building, or
  // a notice from Kivo (written by code, not by the model).
  kind?: "question" | "chat" | "proposal" | "revision" | "built" | "notice" | "error";
  version?: number;
}

// Something the learner said, in their words. A fact the model reports is
// kept as one only when its quote is in what the learner wrote; otherwise it
// is shown as an assumption.
export interface BriefFact { label: string; value: string }

export interface BuilderBrief {
  kind:        WorkKind | null;
  title:       string | null;
  // From the learner, in this conversation.
  facts:       BriefFact[];
  // From their Kivo record (sign-up answers, subjects, goals): not asked again.
  known:       BriefFact[];
  // What Nova is taking as given without being told.
  assumptions: string[];
  // Nova's recommendations: offered, not decided.
  suggestions: string[];
  // The one question Nova has open, if any.
  question:    string | null;
  questionsAsked: number;
  // What the check left out of the last proposal, in words.
  dropped:     string[];
}

// A model job in progress, with the stage it has actually reached.
export interface PendingJob {
  kind:        "reply" | "draft" | "revise";
  stage:       "reading" | "writing" | "checking";
  startedAt:   string;
  // The plan version the job started from. Its result is applied only if
  // the plan is still that version: a newer edit of the learner's wins.
  baseVersion: number;
}

export interface DraftFailure {
  stage: "reply" | "drafting" | "building";
  message: string;
  // For a proposal that failed to be written: the change it was for.
  change?: string | null;
}

// What changed between two versions of a proposal, by name.
export interface PlanChangeSummary {
  added:   string[];
  removed: string[];
  renamed: number;
}

export interface DraftView {
  id:          string;
  status:      DraftStatus;
  origin:      "web" | "telegram";
  title:       string | null;
  messages:    BuilderMessage[];
  brief:       BuilderBrief;
  plan:        WorkspacePlan | null;
  // The plan's version. Approve names it; an older one cannot be approved.
  version:     number;
  pending:     PendingJob | null;
  failure:     DraftFailure | null;
  // The workspace of theirs this proposal adds to, if any.
  target:      WorkspaceSummary | null;
  // What approval made or added to.
  workspace:   WorkspaceSummary | null;
  builtVersion: number | null;
  // The last message is the learner's and no job is running: the page asks
  // Nova to answer it (a draft started from Telegram opens like this).
  needsReply:  boolean;
  // Workspaces of theirs this proposal would repeat, shown before approval.
  similar:     WorkspaceSummary[];
  // The counts of the last build, when it was this draft's.
  counts:      WorkspaceCounts | null;
  updatedAt:   string;
}

export interface DraftListItem { id: string; status: DraftStatus; title: string | null; origin: "web" | "telegram"; updatedAt: string }
export interface DraftListView { status: "ready"; drafts: DraftListItem[] }

export type BuilderError =
  | "invalid" | "not_found" | "not_ready" | "busy" | "stale" | "closed" | "too_many" | "rate_limited" | "unavailable" | "failed";

export type BuilderResponse =
  | { ok: true; draft: DraftView }
  | { ok: false; error: BuilderError; message: string; draft?: DraftView };

// The live workspace: the real records approval made, as they now are.
export interface WorkspaceDetail {
  workspace: WorkspaceSummary;
  subjects:  Array<{ id: string; name: string; topics: Array<{ id: string; name: string }> }>;
  tasks:     Array<{ id: string; title: string; status: "todo" | "in_progress" | "done"; priority: "low" | "medium" | "high" | null; dueDay: string | null; subjectId: string | null; topicName: string | null; estimatedMinutes: number | null }>;
  notes:     Array<{ id: string; title: string; subjectId: string | null; updatedAt: string }>;
  dates:     Array<{ id: string; title: string; day: string; kind: string; subjectId: string | null }>;
}
export type WorkspaceDetailResponse = { ok: true; detail: WorkspaceDetail } | { ok: false; error: "not_found"; message: string };
