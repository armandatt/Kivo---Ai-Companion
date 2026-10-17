import type { NovaTaskItem } from '@repo/api/nova/product/tasks.types'

// "Due today", "Due in 3 days", "2 days overdue". null: no due day.
export function dueLabel(task: Pick<NovaTaskItem, 'dueInDays' | 'status'>): string | null {
  const d = task.dueInDays
  if (d === null) return null
  if (d === 0) return 'Due today'
  if (d === 1) return 'Due tomorrow'
  if (d > 1) return `Due in ${d} days`
  return d === -1 ? '1 day overdue' : `${-d} days overdue`
}

export const isOverdue = (task: Pick<NovaTaskItem, 'dueInDays' | 'status'>) =>
  task.status !== 'done' && task.dueInDays !== null && task.dueInDays < 0

export const PRIORITY_LABEL = { high: 'High', medium: 'Medium', low: 'Low' } as const

// The calendar day after `day` (YYYY-MM-DD), month and year ends included.
export function nextDay(day: string): string {
  const d = new Date(`${day}T12:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

// Today's list in four plain groups, from what each task says about itself:
// late, due today (or already under way), due later, no date. Within a group
// the board's order (prioritiesOf) is kept: nothing is re-ranked here.
export type TaskGroupKey = 'overdue' | 'today' | 'upcoming' | 'someday'

export const TASK_GROUP_LABEL: Record<TaskGroupKey, string> = {
  overdue:  'Overdue',
  today:    'Today',
  upcoming: 'Coming up',
  someday:  'No date',
}

export function taskGroup(task: Pick<NovaTaskItem, 'dueInDays' | 'status'>): TaskGroupKey {
  const d = task.dueInDays
  if (d !== null && d < 0) return 'overdue'
  if (d === 0 || task.status === 'in_progress') return 'today'
  return d !== null ? 'upcoming' : 'someday'
}

export function groupTasks<T extends Pick<NovaTaskItem, 'dueInDays' | 'status'>>(ordered: readonly T[]): Array<{ key: TaskGroupKey; tasks: T[] }> {
  const keys: TaskGroupKey[] = ['overdue', 'today', 'upcoming', 'someday']
  return keys
    .map(key => ({ key, tasks: ordered.filter(t => taskGroup(t) === key) }))
    .filter(g => g.tasks.length > 0)
}

// The learner's calendar day, from this device, `offset` days on: what a due
// day typed here means. The device reports its timezone to Nova, so this is
// the same calendar the server counts "due in N days" on.
export function localDayKey(offset = 0, now: Date = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
