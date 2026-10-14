'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, CalendarArrowUp, Check, CheckSquare, Flag, Pencil, Play, Plus, Undo2 } from 'lucide-react'
import type { NovaTaskItem, TaskInput, TaskStatus, TaskSubjectOption } from '@repo/api/nova/product/tasks.types'
import { cn } from '@/lib/utils'
import { BUTTON_QUIET, ROW, SectionHeading, Skeleton, TEXT_LINK } from '../workspace/ui'
import { TASK_GROUP_LABEL, dueLabel, groupTasks, isOverdue, localDayKey, nextDay } from './task-format'
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
  // The composer's field, so the page's New menu can put the keyboard there.
  composerRef?: React.Ref<HTMLInputElement>
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

const SHOWN = 8
const UNDO_MS = 8000

// What "today" means for a to-do list: what is under way, what is late, what
// is due today, then what comes due next. The order is the board's own.
export function prioritiesOf(tasks: NovaTaskItem[]): NovaTaskItem[] {
  const open = tasks.filter(t => t.status !== 'done')
  const rank = (t: NovaTaskItem) =>
    t.dueInDays !== null && t.dueInDays < 0 ? 0 : t.status === 'in_progress' ? 1 : t.dueInDays === 0 ? 2 : t.dueInDays !== null ? 3 : 4
  return [...open].sort((a, b) => rank(a) - rank(b) || (a.dueInDays ?? 9999) - (b.dueInDays ?? 9999))
}

const DUE_CHOICES = [
  { label: 'No date', offset: null },
  { label: 'Today', offset: 0 },
  { label: 'Tomorrow', offset: 1 },
] as const

// Today's priorities: the learner's own tasks, from the same rows as the
// Planner's board. Ticking one moves it to Done there too, and can be undone.
export function TodayTasks({ tasks, failed, error, onCreate, onUpdate, onStart, starting = null, composerRef, subjects = [], onRemove, today = null, dayMinutes }: Props) {
  const [title, setTitle]   = useState('')
  const [due, setDue]       = useState<number | null>(null)
  const [adding, setAdding] = useState(false)
  const [added, setAdded]   = useState<string | null>(null)
  // The last task ticked off, and the status it had, so it can be put back.
  const [done, setDone]     = useState<{ id: string; title: string; was: TaskStatus } | null>(null)
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

  useEffect(() => {
    if (!done) return
    const timer = setTimeout(() => setDone(null), UNDO_MS)
    return () => clearTimeout(timer)
  }, [done])

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    const text = title.trim()
    if (!text || adding) return
    setAdding(true)
    if (await onCreate({ title: text, ...(due !== null ? { dueDay: localDayKey(due) } : {}) })) {
      setTitle('')
      setAdded(text)
    }
    setAdding(false)
  }

  const finish = async (task: NovaTaskItem) => {
    setDone({ id: task.id, title: task.title, was: task.status })
    if (!(await onUpdate(task.id, { status: 'done' }))) setDone(null)
  }

  const list   = tasks ? prioritiesOf(tasks) : []
  const shown  = list.slice(0, SHOWN)
  const groups = groupTasks(shown)
  const late   = list.filter(isOverdue).length
  // Only lengths the learner gave are counted; a task without one is not guessed.
  const dueNow = list.filter(t => t.dueInDays !== null && t.dueInDays <= 0)
  const taskMinutes = dueNow.reduce((sum, t) => sum + (t.estimatedMinutes ?? 0), 0)
  const unsized = dueNow.filter(t => t.estimatedMinutes === null).length
  const over = dayMinutes && taskMinutes > 0 && dayMinutes.planned + taskMinutes > dayMinutes.budget

  return (
    <section aria-labelledby="today-tasks" data-section="today-tasks">
      <SectionHeading id="today-tasks" icon={CheckSquare} aside={
        <>
          {tasks && list.length > 0 && (
            <span>{list.length} open{late > 0 && <> · <span className="font-medium text-rose-300">{late} overdue</span></>}</span>
          )}
          <Link href="/planner?view=board" className={TEXT_LINK}>Board <ArrowRight aria-hidden className="size-3" /></Link>
        </>
      }>
        Your tasks
      </SectionHeading>

      <div className="mt-3 border-y border-white/8">
        {tasks === null && !failed ? (
          <div aria-busy="true" aria-label="Loading your tasks" className="space-y-3 py-4">
            <Skeleton className="h-4 w-2/3" /><Skeleton className="h-4 w-1/2" />
          </div>
        ) : failed && tasks === null ? (
          <p className="py-4 text-sm text-foreground/60">Your tasks didn&apos;t load. They are safe; this will try again shortly.</p>
        ) : shown.length === 0 ? (
          <p className="py-4 text-sm leading-relaxed text-foreground/60">
            {done ? 'Nothing else open.' : 'Nothing on your list.'} Add the assignment, chapter or errand that is on your mind, and it will be here and on the board.
          </p>
        ) : (
          groups.map(group => (
            <div key={group.key} data-group={group.key}>
              <h3 className={cn('pt-3 text-[11px] font-semibold', group.key === 'overdue' ? 'text-rose-300' : 'text-foreground/50')}>
                {TASK_GROUP_LABEL[group.key]}
              </h3>
              <ul className="divide-y divide-white/6">
                {group.tasks.map(task => {
                  const label = dueLabel(task)
                  return (
                    <li key={task.id} className={cn('-mx-2 flex items-center gap-3 rounded-md px-2 py-2.5', ROW)}>
                      <button
                        type="button" onClick={() => void finish(task)}
                        aria-label={`Mark "${task.title}" done`}
                        className="group flex size-5 shrink-0 items-center justify-center rounded-md border border-white/25 transition-colors hover:border-keppel-400 hover:bg-keppel-400/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-keppel-400/60"
                      >
                        <Check aria-hidden className="size-3.5 text-keppel-300 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground/90">{task.title}</p>
                        <p className="flex min-w-0 items-center gap-1.5 truncate text-xs text-foreground/55">
                          {task.priority === 'high' && <span className="inline-flex shrink-0 items-center gap-1 font-medium text-amber-300"><Flag aria-hidden className="size-3" />High</span>}
                          {task.priority === 'low' && <span className="shrink-0">Low priority</span>}
                          <span className="truncate">
                            {[task.status === 'in_progress' ? 'In progress' : null, task.subjectName, task.topicName, task.estimatedMinutes ? `${task.estimatedMinutes} min` : null].filter(Boolean).join(' · ') || (task.priority ? '' : 'To do')}
                          </span>
                        </p>
                      </div>
                      {onStart && task.subjectName && task.topicName && (
                        <button type="button" onClick={() => onStart(task)} disabled={starting !== null} data-start-task
                          aria-label={`Start a session on ${task.topicName} for "${task.title}"`}
                          className={cn(BUTTON_QUIET, 'h-8 px-2.5')}>
                          <Play aria-hidden className="size-3" /> {starting === `task:${task.id}` ? 'Starting…' : 'Focus'}
                        </button>
                      )}
                      {label && <span className={cn('shrink-0 text-xs', isOverdue(task) ? 'font-medium text-rose-300' : task.dueInDays === 0 ? 'font-medium text-amber-300' : 'text-foreground/55')}>{label}</span>}
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
            </div>
          ))
        )}

        {/* The one thing just ticked off, and a way to take it back */}
        {done && (
          <p role="status" className="flex items-center gap-2 border-t border-white/6 py-2.5 text-sm text-foreground/70">
            <Check aria-hidden className="size-4 shrink-0 text-keppel-300" />
            <span className="min-w-0 flex-1 truncate">Done: <span className="text-foreground/85">{done.title}</span></span>
            <button type="button" onClick={() => { void onUpdate(done.id, { status: done.was }); setDone(null) }}
              className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-foreground/70 hover:bg-white/5 hover:text-foreground">
              <Undo2 aria-hidden className="size-3.5" /> Undo
            </button>
          </p>
        )}

        <form onSubmit={add} className="flex flex-wrap items-center gap-2 border-t border-white/6 py-2.5">
          <Plus aria-hidden className="size-4 shrink-0 text-foreground/40" />
          <input
            ref={composerRef}
            value={title} onChange={e => { setTitle(e.target.value); setAdded(null) }} placeholder="Add a task" aria-label="Add a task" maxLength={160}
            className="h-9 min-w-0 flex-1 basis-40 bg-transparent text-sm text-foreground outline-none placeholder:text-foreground/40"
          />
          <div role="group" aria-label="Due" className="flex items-center gap-1">
            {DUE_CHOICES.map(choice => (
              <button key={choice.label} type="button" aria-pressed={due === choice.offset} onClick={() => setDue(choice.offset)}
                className={cn('h-8 rounded-md px-2 text-xs transition-colors',
                  due === choice.offset ? 'bg-white/10 font-medium text-foreground' : 'text-foreground/55 hover:bg-white/5 hover:text-foreground')}>
                {choice.label}
              </button>
            ))}
          </div>
          <button type="submit" disabled={!title.trim() || adding} className={cn(BUTTON_QUIET, 'h-8')}>
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
      {added && !error && <p role="status" className="mt-2 text-xs text-foreground/60">Added “{added}”.</p>}
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
      {list.length > SHOWN && <p className="mt-2 text-xs text-foreground/55">and {list.length - SHOWN} more on the board</p>}
    </section>
  )
}
