// ─── Tasks: the contract between Nova and the Planner's task views ────────────
// The learner's own to-do list. Every field here is something the learner
// set; nothing is inferred. No imports, so the web app can import the types
// directly.

export const TASK_STATUSES = ["todo", "in_progress", "done"] as const;
export type TaskStatus = typeof TASK_STATUSES[number];

export const TASK_PRIORITIES = ["low", "medium", "high"] as const;
export type TaskPriority = typeof TASK_PRIORITIES[number];

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = { todo: "To do", in_progress: "In progress", done: "Done" };

export const TASK_TITLE_MAX = 160;
export const TASK_TOPIC_MAX = 120;
export const TASK_KEY_MAX   = 120;
// Open tasks a learner can hold. A list longer than this is not a plan.
export const TASK_OPEN_MAX  = 300;
// Finished tasks shown on the board: the most recently finished.
export const TASK_DONE_SHOWN = 30;

export interface NovaTaskItem {
  id:          string;
  title:       string;
  status:      TaskStatus;
  priority:    TaskPriority | null;
  subjectId:   string | null;
  subjectName: string | null;
  topicName:   string | null;
  dueDay:      string | null;      // YYYY-MM-DD, the learner's calendar
  // Days from the learner's today to the due day: 0 today, negative overdue.
  // null: no due day.
  dueInDays:   number | null;
  completedAt: string | null;
  createdAt:   string;
  updatedAt:   string;
}

export interface TaskSubjectOption { id: string; name: string }

export interface NovaTasksReady {
  status:   "ready";
  today:    string;                // the learner's calendar day the due counts were made from
  tasks:    NovaTaskItem[];        // open tasks, then the most recently finished
  subjects: TaskSubjectOption[];
  counts:   Record<TaskStatus, number>;   // every task, shown or not
}

export type NovaTasksView =
  | NovaTasksReady
  | { status: "not_nova" }
  | { status: "not_connected" }
  | { status: "onboarding_incomplete" };

// What a create or an edit may carry. Anything else in a request is ignored.
export interface TaskInput {
  title?:     string;
  status?:    TaskStatus;
  priority?:  TaskPriority | null;
  subjectId?: string | null;
  topicName?: string | null;
  dueDay?:    string | null;
  clientKey?: string;              // create only
}

export type TaskError =
  | "invalid" | "title_required" | "title_too_long" | "topic_too_long"
  | "unknown_status" | "unknown_priority" | "bad_due_day" | "unknown_subject"
  | "too_many" | "not_found" | "failed";

export type TaskResponse =
  | { ok: true; task: NovaTaskItem; created?: boolean }
  | { ok: false; error: TaskError; message: string };
