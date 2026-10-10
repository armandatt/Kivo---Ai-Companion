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
