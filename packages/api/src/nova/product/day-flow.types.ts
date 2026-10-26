// ─── Today's flow: the contract with the Today page ──────────────────────────
// No imports, so the web app imports it directly. Rules: product/day-flow.ts
// (persistence) and product/day-flow-rules.ts (pure).
//
// The flow is the learner's own list for one calendar day: what they chose to
// do today, in their order, with today's time for each. It is not the
// Planning Engine's plan (that is still worked out on every request and
// offered as suggestions), not the task board, and not the roadmap: putting a
// task in today's flow, or taking it out, changes nothing about the task.

export const FLOW_ITEMS_MAX     = 30;
export const FLOW_MINUTES_MIN   = 5;
export const FLOW_MINUTES_MAX   = 480;
export const FLOW_TITLE_MAX     = 160;
export const FLOW_INTENTION_MAX = 280;
export const FLOW_OPS_MAX       = 20;
export const FLOW_UNDO_MAX      = 10;

// task    one of the learner's tasks (NovaTask), by id
// topic   one of their topics (NovaTopicMastery), by id: something to learn,
//         never turned into a task
// focus   a focus item for today only, in their words: no task is made
export type FlowItemKind = "task" | "topic" | "focus";

// planned  in today's flow, not started
// active   a focus session was started on it (sessionId)
// done     done for today, as the learner said (a task's own status is the task's)
// later    kept, below "If there's time": nothing is ever dropped to fit
export type FlowItemStatus = "planned" | "active" | "done" | "later";

export interface FlowItem {
  id:          string;
  kind:        FlowItemKind;
  taskId:      string | null;
  topicId:     string | null;
  title:       string;
  subjectName: string | null;
  topicName:   string | null;
  // Today's time for it, in minutes: the learner's (or Nova's, when it was
  // asked) for this day. null: no time given. It is not the task's own
  // estimate and never changes it.
  minutes:     number | null;
  status:      FlowItemStatus;
  // A fixed time of day, "HH:MM", for the schedule view; null: in order.
  at:          string | null;
  // The focus session started on it today, if any.
  sessionId:   string | null;
  addedBy:     "learner" | "nova";
}

// What adding takes: the reference, and today's time.
export type NewFlowItem =
  | { kind: "task"; taskId: string; minutes?: number | null }
  | { kind: "topic"; topicId: string; minutes?: number | null }
  | { kind: "focus"; title: string; minutes?: number | null };

export type FlowOp =
  | { op: "add"; item: NewFlowItem; at?: number }
  | { op: "remove"; id: string }
  | { op: "move"; id: string; to: number }
  | { op: "set_minutes"; id: string; minutes: number | null }
  | { op: "set_status"; id: string; status: FlowItemStatus }
  | { op: "set_time"; id: string; at: string | null }
  | { op: "split"; id: string; parts: number[] }
  | { op: "replace"; id: string; item: NewFlowItem }
  | { op: "set_intention"; text: string | null }
  | { op: "fit"; minutes: number }
  | { op: "clear_times" };

export type FlowView = "list" | "schedule";

// Nova's proposal for a day with no flow yet, kept apart until the learner
// takes it: it never replaces a flow they have.
export interface FlowDraft {
  // A fingerprint of its items: taking it names the draft that was shown.
  id?:     string;
  items:   FlowItem[];
  // Why these, in this order, in a sentence or two.
  reasons: string[];
  // How long the day is (the planner's budget) when one is known.
  budgetMinutes: number | null;
  madeAt:  string;
}

// A thing that can be added: an open task, a topic the planner suggests
// today, or another of the learner's topics.
export interface FlowCandidate {
  kind:        "task" | "topic";
  id:          string;
  title:       string;
  subjectName: string | null;
  topicName:   string | null;
  // Its own estimate: a task's estimatedMinutes, a planned block's length.
  // null: none on record. This is what "Suggested" means when starting.
  minutes:     number | null;
  // Why it is offered: "due today", "overdue 2 days", "planned today",
  // "in your workspace Startup", or null.
  why:         string | null;
  // A workspace it was built in, for grouping.
  workspace:   string | null;
}

export interface FlowItemView extends FlowItem {
  // The thing it points at as it is now: a task's status and own estimate, a
  // topic's suggested length. gone: deleted or archived since it was added.
  ref:         { status: string | null; minutes: number | null; dueInDays: number | null; gone: boolean } | null;
  // Study time today on this item, from its session (ended or running).
  spentMinutes: number | null;
  // Its session ended and the learner has not said what next.
  sessionEnded: boolean;
}

export interface NovaDayView {
  status:    "ready";
  day:       string;
  version:   number;
  // Whether the learner has a flow for today (they made it or took Nova's).
  saved:     boolean;
  intention: string | null;
  view:      FlowView;
  items:     FlowItemView[];
  draft:     FlowDraft | null;
  canUndo:   boolean;
  // How long the planner gives today, and what the flow adds up to.
  budgetMinutes:  number | null;
  plannedMinutes: number;
  candidates: FlowCandidate[];
  // A session running now (Today resumes it first).
  activeSessionId: string | null;
  // The learner's timezone's clock, for the schedule view: minutes past midnight.
  nowMinutes: number;
}

export type DayFlowError =
  | "invalid" | "stale" | "not_found" | "too_many" | "rate_limited" | "unavailable"
  | "unauthenticated" | "not_nova" | "not_connected" | "onboarding_incomplete" | "allowance_used" | "failed";

export type DayFlowResponse =
  | { ok: true; flow: NovaDayView; changed: string[]; message: string | null }
  | { ok: false; error: DayFlowError; message: string; flow?: NovaDayView };

// ── Nova's copilot on Today ───────────────────────────────────────────────────
// Nova proposes; the learner decides. Nothing Nova reads from a message is
// written until the learner approves that exact proposal (PendingChange),
// and the server checks the approval names what was shown (its id is keyed
// with the server secret over the learner, the version and the operations).

export interface CopilotRequest {
  message: string;
  version: number;
  history?: Array<{ role: "learner" | "nova"; text: string }>;
  // The proposal open on the page, so "yes, do it" can approve it in words.
  open?:   { id: string; version: number; ops: FlowOp[] } | null;
  // The learner asked to skip questions and see a draft from what is known.
  draftNow?: boolean;
  // The top-level subject selected on the page: context only, never a request.
  subjectId?: string | null;
}

// One line of a proposed day: what it is and what the proposal does to it.
export interface PreviewItem {
  id:          string;
  title:       string;
  kind:        FlowItemKind;
  subjectName: string | null;
  minutes:     number | null;
  status:      FlowItemStatus;
  change:      "added" | "moved" | "changed" | "same";
}

// A change to today's flow that Nova proposes and has not made. Approving
// sends id, version and ops back; the server checks the id and applies them
// against that version (a newer flow refuses it as stale), all or none.
export interface PendingChange {
  id:       string;
  version:  number;
  ops:      FlowOp[];
  // What applying does, in short lines, one per operation where it can.
  changed:  string[];
  // The flow as it would stand: open items in order, then "if there's time".
  items:    PreviewItem[];
  removed:  Array<{ title: string; kind: FlowItemKind }>;
  plannedMinutes: number;
  budgetMinutes:  number | null;
  // small: one or two lines (a compact preview); plan: a day being built.
  size:     "small" | "plan";
}

export type CopilotResponse =
  | {
      ok: true;
      // What Nova says, in its words.
      reply:    string;
      // Nova asks before going on (the reply is the question).
      question: string | null;
      // Quick replies the learner can tap instead of typing.
      choices:  string[];
      // A change to today's flow waiting for the learner's yes.
      pending:  PendingChange | null;
      // Set only when the learner approved in words and the server wrote it.
      flow:     NovaDayView | null;
      changed:  string[];
      touched:  string[];
      // The open proposal was declined or approved: the panel closes it.
      closed:   "approved" | "declined" | null;
      // A place in Kivo that does what was asked.
      link:     { href: string; label: string } | null;
    }
  | { ok: false; error: DayFlowError; message: string; flow?: NovaDayView };
