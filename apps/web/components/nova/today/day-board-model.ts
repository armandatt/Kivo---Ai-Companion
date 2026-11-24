// Today's board, worked out from two records the server already gives: the
// day's flow (what the learner, or Nova with their approval, put in today)
// and the task list. Pure: no fetch, no React, so it is tested on its own
// (day-board-model.test.ts). Nothing here ranks or recommends: it only
// selects what is already on record.

import type { NovaTaskItem, NovaTasksReady, TaskStatus } from '@repo/api/nova/product/tasks.types'
import type { FlowItemView } from '@repo/api/nova/product/day-flow.types'

type FlowLike = { items: Array<Pick<FlowItemView, 'id' | 'kind' | 'taskId' | 'addedBy' | 'status'>> }

export type BoardScope = 'today' | 'all'

// The task ids in today's flow, with who put each one there.
export function dayTasks(flow: FlowLike | null): Map<string, { itemId: string; addedBy: 'learner' | 'nova' }> {
  const out = new Map<string, { itemId: string; addedBy: 'learner' | 'nova' }>()
  for (const i of flow?.items ?? []) if (i.kind === 'task' && i.taskId && !out.has(i.taskId)) out.set(i.taskId, { itemId: i.id, addedBy: i.addedBy })
  return out
}

/**
 * The board for one scope. Today: the day's tasks and the steps under them
 * (a step is part of its task, so it comes with it), with the columns
 * counted for exactly those. All: every task, as the server counted them.
 */
export function boardFor(scope: BoardScope, view: NovaTasksReady, tasks: NovaTaskItem[], flow: FlowLike | null): { view: NovaTasksReady; tasks: NovaTaskItem[] } {
  if (scope === 'all') return { view, tasks }
  const inDay = dayTasks(flow)
  const keep = new Set<string>()
  const byParent = new Map<string, string[]>()
  for (const t of tasks) if (t.parentId) byParent.set(t.parentId, [...(byParent.get(t.parentId) ?? []), t.id])
  const add = (id: string) => { if (keep.has(id)) return; keep.add(id); for (const c of byParent.get(id) ?? []) add(c) }
  for (const t of tasks) if (inDay.has(t.id)) add(t.id)
  const shown = tasks.filter(t => keep.has(t.id))
  // Cards, not rows: a step is counted inside its task's card, as it is shown.
  const counts = { todo: 0, in_progress: 0, done: 0 } as Record<TaskStatus, number>
  for (const t of shown) if (!t.parentId || !keep.has(t.parentId)) counts[t.status]++
  return { view: { ...view, counts }, tasks: shown }
}

/**
 * Open tasks due today or overdue that are not in today's plan yet: what the
 * page offers to add in one go. Steps are left out (they come with their
 * task). The server's own day count (dueInDays) decides "due".
 */
export function dueNotPlanned(tasks: NovaTaskItem[], flow: FlowLike | null): NovaTaskItem[] {
  const inDay = dayTasks(flow)
  return tasks
    .filter(t => t.status !== 'done' && !t.parentId && t.dueInDays !== null && t.dueInDays <= 0 && !inDay.has(t.id))
    .sort((a, b) => (a.dueInDays ?? 0) - (b.dueInDays ?? 0))
}

/** What today's flow item should say when its task moves on the board. */
export function flowStatusFor(taskStatus: TaskStatus, current: FlowItemView['status']): FlowItemView['status'] | null {
  if (taskStatus === 'done') return current === 'done' ? null : 'done'
  // Reopened: back into today, unless the learner had put it after "If there's time".
  if (current === 'done') return 'planned'
  return null
}
