'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowRight, CalendarArrowUp, Check, Pencil, Play, Plus } from 'lucide-react'
import type { NovaTaskItem, TaskInput, TaskSubjectOption } from '@repo/api/nova/product/tasks.types'
import { dueLabel, isOverdue, nextDay } from './task-format'
import { TaskEditor } from './task-editor'

type Props = {
  // null: still loading.
  tasks:    NovaTaskItem[] | null
  failed:   boolean
  error:    string | null
  onCreate: (input: TaskInput) => Promise<boolean>
  onUpdate: (id: string, changes: TaskInput) => Promise<boolean>
  // Starts a session on the task's own subject and topic. Offered only for a
  // task that names both: Nova never guesses what a task is about. The
  // session is the evidence; ticking the task still records nothing studied.
  onStart?: (task: NovaTaskItem) => void
  // The key of the start in flight (`task:<id>`), or null.
  starting?: string | null
  // For editing a task here: the learner's subjects, removal, and their
  // calendar day (YYYY-MM-DD) that "tomorrow" is counted from.
  subjects?: TaskSubjectOption[]
  onRemove?: (id: string) => Promise<boolean>
  today?:    string | null
  // Today's plan against the day's time, for saying when the tasks due today
  // (with a length the learner gave) do not fit beside it. Nothing is moved.
  dayMinutes?: { planned: number; budget: number }
}

const ROW_ACTION = 'inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-foreground/45 transition-colors hover:bg-white/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-keppel-400/60 disabled:opacity-40'

const SHOWN = 6

// What "today" means for a to-do list: what is under way, what is late, what
// is due today, then what comes due next. The order is the board's own.
export function prioritiesOf(tasks: NovaTaskItem[]): NovaTaskItem[] {
  const open = tasks.filter(t => t.status !== 'done')
  const rank = (t: NovaTaskItem) =>
    t.dueInDays !== null && t.dueInDays < 0 ? 0 : t.status === 'in_progress' ? 1 : t.dueInDays === 0 ? 2 : t.dueInDays !== null ? 3 : 4
  return [...open].sort((a, b) => rank(a) - rank(b) || (a.dueInDays ?? 9999) - (b.dueInDays ?? 9999))
}

// Today's priorities: the learner's own tasks, from the same rows as the
// Planner's board. Ticking one moves it to Done there too.
export function TodayTasks({ tasks, failed, error, onCreate, onUpdate, onStart, starting = null, subjects = [], onRemove, today = null, dayMinutes }: Props) {
  const [title, setTitle]   = useState('')
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<NovaTaskItem | null>(null)
  // The last move to tomorrow, so it can be taken back.
  const [moved, setMoved] = useState<{ id: string; title: string; from: string | null } | null>(null)

  const deferToTomorrow = async (task: NovaTaskItem) => {
    if (!today) return
    // A task already due later than tomorrow is left where it is.
    const to = nextDay(today)
    if (task.dueDay && task.dueDay > to) return
    if (await onUpdate(task.id, { dueDay: to })) setMoved({ id: task.id, title: task.title, from: task.dueDay })
  }
  const undoMove = async () => {
    if (!moved) return
    if (await onUpdate(moved.id, { dueDay: moved.from })) setMoved(null)
  }

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || adding) return
    setAdding(true)
    if (await onCreate({ title })) setTitle('')
    setAdding(false)
  }

  const list  = tasks ? prioritiesOf(tasks) : []
  const shown = list.slice(0, SHOWN)
  // Only lengths the learner gave are counted; a task without one is not guessed.
  const dueNow = list.filter(t => t.dueInDays !== null && t.dueInDays <= 0)
  const taskMinutes = dueNow.reduce((sum, t) => sum + (t.estimatedMinutes ?? 0), 0)
  const unsized = dueNow.filter(t => t.estimatedMinutes === null).length
  const over = dayMinutes && taskMinutes > 0 && dayMinutes.planned + taskMinutes > dayMinutes.budget

  return (
    <section aria-label="Today's priorities">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.18em] text-foreground/45">Your tasks</h2>
        <Link href="/planner?view=board" className="inline-flex items-center gap-1 text-xs font-medium text-foreground/55 transition-colors hover:text-foreground">
          Open the board <ArrowRight className="size-3" />
        </Link>
      </div>

      <div className="mt-3 overflow-hidden rounded-2xl border border-white/8 bg-card/60">
        {tasks === null && !failed ? (
          <div aria-busy="true" aria-label="Loading your tasks" className="space-y-2 p-4">
            <div className="h-5 w-2/3 animate-pulse rounded bg-white/5" /><div className="h-5 w-1/2 animate-pulse rounded bg-white/4" />
          </div>
        ) : failed && tasks === null ? (
          <p className="p-4 text-sm text-foreground/55">Your tasks didn&apos;t load. They are safe; this will try again shortly.</p>
        ) : shown.length === 0 ? (
          <p className="p-4 text-sm leading-relaxed text-foreground/55">
            Nothing on your list. Add the assignment, chapter or errand that is on your mind, and it will be here and on the board.
          </p>
        ) : (
          <ul className="divide-y divide-white/6">
            {shown.map(task => {
              const due = dueLabel(task)
              return (
                <li key={task.id} className="flex items-center gap-3 px-4 py-3">
                  <button
                    type="button" onClick={() => void onUpdate(task.id, { status: 'done' })}
                    aria-label={`Mark "${task.title}" done`}
                    className="group flex size-5 shrink-0 items-center justify-center rounded-md border border-white/20 transition-colors hover:border-keppel-400 hover:bg-keppel-400/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-keppel-400/60"
                  >
                    <Check className="size-3.5 text-keppel-300 opacity-0 transition-opacity group-hover:opacity-100" />
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground/90">{task.title}</p>
                    <p className="truncate text-xs text-foreground/45">
                      {[task.status === 'in_progress' ? 'In progress' : null, task.subjectName, task.topicName, task.estimatedMinutes ? `${task.estimatedMinutes} min` : null].filter(Boolean).join(' · ') || 'To do'}
                    </p>
                  </div>
                  {onStart && task.subjectName && task.topicName && (
                    <button type="button" onClick={() => onStart(task)} disabled={starting !== null} data-start-task
                      aria-label={`Start a session on ${task.topicName} for "${task.title}"`}
                      className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-white/10 px-2.5 text-xs font-medium text-foreground/75 transition-colors hover:bg-white/5 hover:text-foreground disabled:opacity-40">
                      <Play className="size-3" /> {starting === `task:${task.id}` ? 'Starting…' : 'Focus'}
                    </button>
                  )}
                  {due && <span className={`shrink-0 text-xs ${isOverdue(task) ? 'font-medium text-rose-300' : task.dueInDays === 0 ? 'font-medium text-amber-300' : 'text-foreground/50'}`}>{due}</span>}
                  {today && (task.dueInDays === null || task.dueInDays <= 0) && (
                    <button type="button" onClick={() => void deferToTomorrow(task)} className={ROW_ACTION} data-defer-task
                      aria-label={`Move "${task.title}" to tomorrow`} title="Move to tomorrow">
                      <CalendarArrowUp className="size-3.5" />
                    </button>
                  )}
                  <button type="button" onClick={() => setEditing(task)} className={ROW_ACTION} data-edit-task
                    aria-label={`Edit "${task.title}"`} title="Edit">
                    <Pencil className="size-3.5" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        <form onSubmit={add} className="flex items-center gap-2 border-t border-white/6 p-2.5">
          <Plus className="ml-1.5 size-4 shrink-0 text-foreground/35" />
          <input
            value={title} onChange={e => setTitle(e.target.value)} placeholder="Add a task" aria-label="Add a task" maxLength={160}
            className="h-9 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-foreground/35"
          />
          <button type="submit" disabled={!title.trim() || adding} className="h-8 shrink-0 rounded-lg bg-white/8 px-3 text-xs font-medium text-foreground transition-colors hover:bg-white/12 disabled:opacity-40">
            {adding ? 'Adding…' : 'Add'}
          </button>
        </form>
      </div>
      {over && dayMinutes && (
        <p role="status" className="mt-2 rounded-xl border border-amber-300/25 bg-amber-300/5 p-3 text-xs leading-relaxed text-foreground/75" data-tasks-over-time>
          Your tasks due today add up to about {taskMinutes} min{unsized ? ` (and ${unsized} without a time)` : ''}. With today&apos;s study plan ({dayMinutes.planned} min), that is more than the {dayMinutes.budget} min you have. Nothing has been moved: you could change a task&apos;s due day, or choose less study time above.
        </p>
      )}
      {moved && (
        <p role="status" className="mt-2 flex flex-wrap items-center gap-2 text-xs text-foreground/60" data-task-moved>
          Moved &ldquo;{moved.title}&rdquo; to tomorrow.
          <button type="button" onClick={() => void undoMove()} className="font-medium text-foreground underline decoration-white/25 underline-offset-4 hover:decoration-white/60">Undo</button>
        </p>
      )}
      {error && <p role="alert" className="mt-2 text-xs text-red-300">{error}</p>}
      {editing && (
        <TaskEditor
          task={editing} subjects={subjects}
          onSave={async input => { const ok = await onUpdate(editing.id, input); if (ok) setEditing(null); return ok }}
          onDelete={onRemove ? async () => { const ok = await onRemove(editing.id); if (ok) setEditing(null); return ok } : undefined}
          onClose={() => setEditing(null)}
          error={error}
        />
      )}
      {list.length > SHOWN && <p className="mt-2 text-xs text-foreground/40">and {list.length - SHOWN} more on the board</p>}
    </section>
  )
}
