'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Check, Plus } from 'lucide-react'
import type { NovaTaskItem, TaskInput } from '@repo/api/nova/product/tasks.types'
import { dueLabel, isOverdue } from './task-format'

type Props = {
  // null: still loading.
  tasks:    NovaTaskItem[] | null
  failed:   boolean
  error:    string | null
  onCreate: (input: TaskInput) => Promise<boolean>
  onUpdate: (id: string, changes: TaskInput) => Promise<boolean>
}

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
export function TodayTasks({ tasks, failed, error, onCreate, onUpdate }: Props) {
  const [title, setTitle]   = useState('')
  const [adding, setAdding] = useState(false)

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || adding) return
    setAdding(true)
    if (await onCreate({ title })) setTitle('')
    setAdding(false)
  }

  const list  = tasks ? prioritiesOf(tasks) : []
  const shown = list.slice(0, SHOWN)

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
                      {[task.status === 'in_progress' ? 'In progress' : null, task.subjectName, task.topicName].filter(Boolean).join(' · ') || 'To do'}
                    </p>
                  </div>
                  {due && <span className={`shrink-0 text-xs ${isOverdue(task) ? 'font-medium text-rose-300' : task.dueInDays === 0 ? 'font-medium text-amber-300' : 'text-foreground/50'}`}>{due}</span>}
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
      {error && <p role="alert" className="mt-2 text-xs text-red-300">{error}</p>}
      {list.length > SHOWN && <p className="mt-2 text-xs text-foreground/40">and {list.length - SHOWN} more on the board</p>}
    </section>
  )
}
