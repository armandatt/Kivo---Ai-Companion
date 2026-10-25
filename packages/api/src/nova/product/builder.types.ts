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
  // Files the learner shared with this message (names only; the bytes are
  // kept apart, in NovaWorkspaceDraftFile).
  files?: Array<{ name: string; pages: number | null }>;
}

// Something the learner said, in their words. A fact the model reports is
// kept as one only when its quote is in what the learner wrote; otherwise it
// is shown as an assumption.
export interface BriefFact {
  label: string;
  value: string;
  // Taken from a file the learner shared, by name, rather than their words.
  file?: string | null;
}

// A file shared in the conversation, as the page lists it.
export interface DraftFile { id: string; name: string; mimeType: string; size: number; pages: number | null }

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
  // What the check repaired in it (a task inside itself, a milestone named
  // twice), in words. Absent on an older draft.
  fixed?:      string[];
  // What the learner's last change request is about (topics, tasks, …):
  // a change set keeps only changes of these kinds (builder-changes.ts).
  touches?:    ChangeKind[];
  // Names to choose from when the learner referred to something of theirs
  // that more than one of their workspaces or subjects could be.
  choices?:    string[];
  // A deletion the learner asked for, worked out and waiting for their
  // confirmation on the page. Never carried out from a message.
  deletion?:   DeletionScope | null;
}

// ── Changing something they already have ──────────────────────────────────────

// What of theirs a conversation works on: a workspace, or subjects that
// belong to no workspace. Resolved by code among their own records.
export interface ResourceRef {
  kind:        "workspace" | "subjects";
  workspaceId: string | null;
  subjectIds:  string[];
  title:       string;
}

// One proposed change to an existing record, by its id. Checked against the
// records as they are (builder-changes.ts) when proposed and again when
// applied; applied only on approval, each through its record's own writer.
// Topics have no order in Kivo, so nothing reorders them; tasks have one.
export type ChangeOp =
  | { op: "add_topics";   subjectId: string; names: string[] }
  | { op: "add_subject";  name: string; topics: string[] }
  | { op: "rename_topic"; topicId: string; name: string }
  | { op: "remove_topic"; topicId: string }
  // The subject itself, with its topics (each removed by its own remove_topic);
  // its notes and tasks stay, unfiled. Never with studied topics or dates.
  | { op: "remove_subject"; subjectId: string }
  // A step: of a task that exists (parentId) or of another task this change
  // set adds (parentKey, that task's key). Neither: a task of its own.
  | { op: "add_task";     key: string; title: string; subjectId: string | null; topicName: string | null; dueDay: string | null; priority: "low" | "medium" | "high" | null; parentId?: string | null; parentKey?: string | null; description?: string | null }
  // parentId: move it under another task (null: make it a task of its own).
  | { op: "update_task";  taskId: string; title?: string; dueDay?: string | null; priority?: "low" | "medium" | "high" | null; parentId?: string | null; description?: string | null }
  // Its open steps go with it (steps, by id, said in words); finished ones
  // stay and move up.
  | { op: "remove_task";  taskId: string; steps?: string[] }
  | { op: "order_tasks";  taskIds: string[] }
  | { op: "add_date";     title: string; day: string; subjectId: string | null; kind: "exam" | "assignment" | "project" | "interview" | "certification" | "other" }
  | { op: "update_date";  dateId: string; title?: string; day?: string }
  | { op: "remove_date";  dateId: string }
  | { op: "add_note";     title: string; body: string; subjectId: string | null; topicName: string | null };

// The kinds of record a change request is about. A change set keeps only
// operations on the kinds asked for: "add two topics" never brings new
// tasks, notes or dates with it.
export const CHANGE_KINDS = ["topics", "subjects", "tasks", "dates", "notes"] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

// An operation as proposed: its id (for the learner to leave one out), what
// it does in words, which side of the change it is, and Nova's reason.
export type ProposedChange = ChangeOp & { id: string; says: string; effect: "add" | "change" | "remove"; why: string | null };

export interface ChangeSet {
  ops:     ProposedChange[];
  // What was asked for but left out, and why ("that topic isn't in DSA").
  dropped: string[];
}

// ── Deleting something of theirs (on confirmation only) ─────────────────────
// Worked out by code from their records (workspaces.ts deletionScope), shown
// in full, and carried out only when the learner confirms on the page with
// this fingerprint. A chat message is never a confirmation.
export interface DeletionScope {
  title:       string;
  workspaceId: string | null;
  subjectIds:  string[];
  removes: {
    workspace: boolean;
    subjects:  Array<{ id: string; name: string }>;
    topics:    Array<{ id: string; name: string }>;
    // Open tasks, steps included.
    tasks:     Array<{ id: string; title: string }>;
    dates:     Array<{ id: string; title: string; day: string }>;
    // Only notes Nova wrote for it that nobody has edited since.
    notes:     Array<{ id: string; title: string }>;
  };
  keeps: {
    // With study on record: kept, with their history.
    topics:        string[];
    finishedTasks: number;
    // Notes the learner wrote or edited.
    notes:         string[];
    // Subjects kept because something above stays in them, or another workspace has them.
    subjects:      string[];
  };
  // Of exactly what would be removed. Confirming names it; a different one
  // (the records moved on) is refused and the scope is shown again.
  fingerprint: string;
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
  // PDFs and photos shared in this conversation. Kept until it is built or
  // cancelled.
  files:       DraftFile[];
  // The workspace of theirs this proposal adds to, if any.
  target:      WorkspaceSummary | null;
  // What of theirs this conversation works on (a workspace or subjects), and
  // those records as they are now, read back from their owners on every
  // view, so the page always shows what is stored.
  resource:    ResourceRef | null;
  current:     WorkspaceDetail | null;
  // The proposed changes to it, when Nova has proposed some.
  changes:     ChangeSet | null;
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
  // A deletion waiting for the learner's confirmation, in full. Absent on an older server.
  deletion?:   DeletionScope | null;
  // What Nova calls them and the words of the page's own lines, in their
  // language. Absent on an older server.
  greeting?:   BuilderGreeting;
  updatedAt:   string;
}

export interface DraftListItem { id: string; status: DraftStatus; title: string | null; origin: "web" | "telegram"; updatedAt: string }
// Build with Nova's opening lines, written by code in the language the
// learner chose (English, Hindi or Hinglish), with the name they asked to be
// called, when they gave one.
export interface BuilderGreeting {
  language: "english" | "hindi" | "hinglish";
  name:     string | null;
  title:    string;
  body:     string;
  // The first line of a new conversation, before anything is said.
  opening:  string;
  // Opening a conversation about a workspace of theirs ({title} is its name).
  openingFor: string;
}
export interface DraftListView { status: "ready"; drafts: DraftListItem[]; greeting?: BuilderGreeting }

// The conversation's versions, newest first (builder-history.ts).
export interface VersionListItem {
  id: string; version: number; kind: "proposal" | "applied" | "deleted"; author: "nova" | "learner" | "restore" | "build" | "delete";
  summary: string; createdAt: string; title: string;
  // What restoring it does, in words; null: it can't be restored from here.
  restores: string | null;
}
export type VersionsResponse = { ok: true; versions: VersionListItem[]; current: number } | { ok: false; error: "not_found"; message: string };
// One version as it was, to look at before restoring it.
export type VersionResponse =
  | { ok: true; version: VersionListItem; plan: WorkspacePlan | null; changes: ChangeSet | null; state: { title: string; subjects: Array<{ name: string; topics: string[] }>; tasks: Array<{ key: string; title: string; status: string; parent: string | null; dueDay: string | null; priority: string | null }>; dates: Array<{ title: string; day: string }>; notes: Array<{ title: string }> } | null }
  | { ok: false; error: "not_found"; message: string };

export type BuilderError =
  | "invalid" | "not_found" | "not_ready" | "busy" | "stale" | "closed" | "too_many" | "rate_limited" | "unavailable" | "failed";

export type BuilderResponse =
  | { ok: true; draft: DraftView }
  | { ok: false; error: BuilderError; message: string; draft?: DraftView };

// The live workspace: the real records approval made, as they now are.
export interface WorkspaceDetail {
  // The workspace, or null for subjects that belong to none.
  workspace: WorkspaceSummary | null;
  title:     string;
  // A topic's unit and what it covers come from the plan the workspace was
  // built from, when it names that topic (topics have no columns for them).
  subjects:  Array<{ id: string; name: string; topics: Array<{ id: string; name: string; unit?: string | null; subtopics?: string[] }> }>;
  // The workspace's milestones, in order, from the plan it was built from:
  // each is one of its topics, and its tasks are those filed under it.
  phases?:   Array<{ name: string; weeks: number | null; goals: string[]; completion: string | null }>;
  // A step names the task it belongs to (parentId); the rest are tasks of their own.
  tasks:     Array<{ id: string; title: string; status: "todo" | "in_progress" | "done"; priority: "low" | "medium" | "high" | null; dueDay: string | null; subjectId: string | null; topicName: string | null; estimatedMinutes: number | null; parentId: string | null; description: string | null }>;
  notes:     Array<{ id: string; title: string; subjectId: string | null; updatedAt: string }>;
  dates:     Array<{ id: string; title: string; day: string; kind: string; subjectId: string | null }>;
}
export type WorkspaceDetailResponse = { ok: true; detail: WorkspaceDetail } | { ok: false; error: "not_found"; message: string };
