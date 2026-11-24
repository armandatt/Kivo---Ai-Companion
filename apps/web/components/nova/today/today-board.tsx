'use client'

// Today's board: the tasks in today's plan, and nothing else. A task is on it
// because the learner put it in the day (here, from Add to today, or from All
// tasks) or because they approved Nova's plan with it; each card says when it
// was Nova. A task made here is due today and joins the plan. Finishing a card
// marks it done for today too; reopening puts it back.
//
// "All tasks" is the whole board, one click away (the Planner's old board
// lives here), with Add to today on every open task not in the plan yet.
// Taking a task out of today ("Not today") never changes or deletes the task.
// After every change the page reads the flow again, so the playground and the
// board always agree. day-board-model.ts holds the selection rules.

import { useEffect, useRef } from 'react'
import { CalendarCheck2, KanbanSquare, ListTodo, Plus, Sparkles, X } from 'lucide-react'
import type { NovaTaskItem, TaskInput } from '@repo/api/nova/product/tasks.types'
import type { FlowOp, NovaDayView } from '@repo/api/nova/product/day-flow.types'
import { TaskBoard } from '../tasks/task-board'
import type { useTasks } from '../tasks/use-tasks'
import { boardFor, dayTasks, flowStatusFor, type BoardScope } from './day-board-model'
import { cn } from '@/lib/utils'

export const BOARD_ID = 'today-board'

const TODAY_EMPTY = {
  todo:        'Nothing waiting today. Add a task, or pick one from All tasks.',
  in_progress: 'Drag a task here when you start it.',
  done:        'What you finish today lands here.',
}

export function TodayBoard({ board, flow, onOps, onChanged, onClose, task, scope, onScope, onPlanWithNova }: {
  board: ReturnType<typeof useTasks>
  flow: NovaDayView | null
  // Changes to today's plan (the day flow's own operations).
  onOps: (ops: FlowOp[], opts?: { quiet?: boolean }) => Promise<{ ok: boolean }>
  // A change on the board was saved: today's flow is read again.
  onChanged: () => void
  onClose: () => void
  // A task an incoming link named (?task=): scrolled to once the board has it.
  task: string | null
  scope: BoardScope
  onScope: (scope: BoardScope) => void
  onPlanWithNova: () => void
}) {
  const shownTask = useRef<string | null>(null)
  const ready = board.view?.status === 'ready'
  useEffect(() => {
    if (!task || !ready || shownTask.current === task) return
    const card = document.querySelector<HTMLElement>(`[data-task="${CSS.escape(task)}"]`)
    if (!card) { if (scope === 'today') onScope('all'); return }
    shownTask.current = task
    card.scrollIntoView({ block: 'center', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    card.querySelector<HTMLElement>('button')?.focus({ preventScroll: true })
  }, [task, ready, board.tasks.length, scope]) // eslint-disable-line react-hooks/exhaustive-deps

  const inDay = dayTasks(flow)
  const itemFor = (taskId: string) => flow?.items.find(i => i.kind === 'task' && i.taskId === taskId) ?? null
  const shown = board.view?.status === 'ready' ? boardFor(scope, board.view, board.tasks, flow) : null
  const todayCount = board.view?.status === 'ready' ? boardFor('today', board.view, board.tasks, flow).tasks.filter(t => !t.parentId && t.status !== 'done').length : 0
  const allOpen = board.view?.status === 'ready' ? board.view.counts.todo + board.view.counts.in_progress : 0

  const addToToday = async (t: NovaTaskItem) => { const r = await onOps([{ op: 'add', item: { kind: 'task', taskId: t.id } }]); if (r.ok) onChanged() }
  const notToday = async (t: NovaTaskItem) => { const it = itemFor(t.id); if (!it) return; const r = await onOps([{ op: 'remove', id: it.id }]); if (r.ok) onChanged() }

  // Making a task from today's board: due today and in the plan. A step is
  // part of its task, so it is only made.
  const create = async (input: TaskInput): Promise<boolean> => {
    if (scope === 'all' || !flow) { const ok = await board.create(input); if (ok) onChanged(); return ok }
    const made = await board.createTask({ ...input, dueDay: input.dueDay === undefined ? flow.day : input.dueDay })
    if (!made) return false
    if (!input.parentId) await onOps([{ op: 'add', item: { kind: 'task', taskId: made.id } }], { quiet: true })
    onChanged()
    return true
  }
  // A card moved to Done is done for today as well; reopened, back in today.
  const update = async (id: string, changes: TaskInput): Promise<boolean> => {
    const ok = await board.update(id, changes)
    if (!ok) return false
    const it = changes.status ? itemFor(id) : null
    const next = it && changes.status ? flowStatusFor(changes.status, it.status) : null
    if (it && next) await onOps([{ op: 'set_status', id: it.id, status: next }], { quiet: true })
    onChanged()
    return true
  }
  const remove = async (id: string): Promise<boolean> => {
    const it = itemFor(id)
    const ok = await board.remove(id)
    if (ok && it) await onOps([{ op: 'remove', id: it.id }], { quiet: true })
    if (ok) onChanged()
    return ok
  }

  const badge = (t: NovaTaskItem) => inDay.get(t.id)?.addedBy === 'nova'
    ? <span className="mb-1.5 inline-flex items-center gap-1 rounded-full bg-nova/12 px-1.5 py-0.5 text-[10px] font-medium text-nova-ink" data-task-by-nova><Sparkles aria-hidden className="size-2.5" /> Planned with Nova</span>
    : scope === 'all' && inDay.has(t.id)
      ? <span className="mb-1.5 inline-flex items-center gap-1 rounded-full bg-white/6 px-1.5 py-0.5 text-[10px] font-medium text-foreground/70" data-task-in-today><CalendarCheck2 aria-hidden className="size-2.5" /> In today</span>
      : null
  const action = (t: NovaTaskItem) => {
    if (t.parentId) return null
    if (scope === 'today') return t.status !== 'done' && inDay.has(t.id)
      ? <button type="button" disabled={!flow} onClick={() => void notToday(t)} className="text-[11px] text-foreground/50 hover:text-foreground hover:underline" data-task-not-today>Not today</button>
      : null
    if (inDay.has(t.id) || t.status === 'done') return null
    return (
      <button type="button" disabled={!flow} onClick={() => void addToToday(t)}
        className="inline-flex h-7 items-center gap-1 rounded-lg border border-nova/30 bg-nova/[0.06] px-2 text-[11px] font-medium text-nova-ink hover:bg-nova/12 disabled:opacity-50" data-task-add-today>
        <Plus aria-hidden className="size-3" /> Add to today
      </button>
    )
  }

  const tab = (s: BoardScope, label: string, n: number) => (
    <button type="button" role="tab" aria-selected={scope === s} onClick={() => onScope(s)}
      className={cn('inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm transition-colors',
        scope === s ? 'bg-white/10 font-medium text-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]' : 'text-foreground/60 hover:text-foreground')} data-board-scope={s}>
      {label}{n > 0 && <span className={cn('tabular-nums text-xs', scope === s ? 'text-foreground/60' : 'text-foreground/40')}>{n}</span>}
    </button>
  )
  const emptyToday = scope === 'today' && shown !== null && shown.tasks.length === 0

  return (
    <section id={BOARD_ID} aria-labelledby={`${BOARD_ID}-title`} className="mt-10 scroll-mt-6 border-t border-white/8 pt-8" data-today-board data-scope={scope}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 id={`${BOARD_ID}-title`} className="flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
            <KanbanSquare aria-hidden className="size-4 text-nova-ink" /> {scope === 'today' ? 'Today’s board' : 'All tasks'}
          </h2>
          <p className="mt-1 text-sm text-foreground/60">
            {scope === 'today'
              ? 'Only the tasks in today’s plan: yours, and the ones you approved from Nova. A task you add here is due today.'
              : 'Every task you have. Add one to today and it joins today’s plan and board.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div role="tablist" aria-label="Which tasks" className="inline-flex rounded-lg border border-white/10 bg-white/[0.03] p-0.5">
            {tab('today', 'Today', todayCount)}
            {tab('all', 'All tasks', allOpen)}
          </div>
          <button type="button" onClick={onClose} aria-label="Close board" title="Close board" className="inline-flex size-9 items-center justify-center rounded-lg border border-white/12 text-foreground/70 hover:bg-white/5 hover:text-foreground" data-today-board-close>
            <X aria-hidden className="size-4" />
          </button>
        </div>
      </div>
      <div className="mt-5">
        {board.loading || (scope === 'today' && !flow) ? (
          <div aria-busy="true" aria-label="Loading your tasks" className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {[0, 1, 2].map(i => <div key={i} className="h-56 animate-pulse rounded-3xl bg-white/3" />)}
          </div>
        ) : shown ? (
          <>
            {emptyToday && (
              <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-dashed border-white/12 bg-white/[0.02] px-4 py-3.5" data-today-board-empty>
                <ListTodo aria-hidden className="size-4 shrink-0 text-foreground/45" />
                <p className="min-w-0 flex-1 text-sm text-foreground/70">No tasks in today’s plan yet. Add one below, pick from your tasks, or plan the day with Nova.</p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => onScope('all')} className="inline-flex h-8 items-center rounded-lg border border-white/12 px-3 text-sm hover:bg-white/5" data-today-board-pick>Pick from my tasks</button>
                  <button type="button" onClick={onPlanWithNova} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-nova/35 bg-nova/[0.06] px-3 text-sm font-medium text-nova-ink hover:bg-nova/12"><Sparkles aria-hidden className="size-3.5" /> Plan with Nova</button>
                </div>
              </div>
            )}
            <TaskBoard
              view={shown.view} tasks={shown.tasks} error={board.error} onClearError={board.clearError}
              onCreate={create} onUpdate={update} onDelete={remove} onReorder={board.reorder}
              cardBadge={badge} cardAction={action}
              empty={scope === 'today' ? TODAY_EMPTY : undefined}
              newTaskDueDay={scope === 'today' ? flow?.day : undefined}
            />
          </>
        ) : (
          <div role="alert" className="rounded-2xl border border-white/8 bg-card/70 p-5">
            <p className="text-sm text-foreground/70">Couldn&apos;t load your tasks. Nothing is lost.</p>
            <button type="button" onClick={() => void board.refresh()} className="mt-3 inline-flex h-9 items-center rounded-lg border border-white/12 px-4 text-sm font-medium text-foreground hover:bg-white/5">Try again</button>
          </div>
        )}
      </div>
    </section>
  )
}
