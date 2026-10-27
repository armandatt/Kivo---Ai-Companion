'use client'

// The task board, opened under Today's planning area. The same board the
// learner had on the Planner (tasks/task-board.tsx), fed by the page's own
// useTasks, so Today's deadlines and Add to today see the same tasks. The
// board and today's flow are separate records: a task on the board is not in
// the day until the learner adds it, and taking an item out of the day leaves
// the task on the board. After a change here the page reads the flow again,
// so a renamed, ticked or deleted task shows as it now is.

import { useEffect, useRef } from 'react'
import { KanbanSquare, X } from 'lucide-react'
import type { TaskInput } from '@repo/api/nova/product/tasks.types'
import { TaskBoard } from '../tasks/task-board'
import type { useTasks } from '../tasks/use-tasks'

export const BOARD_ID = 'today-board'

export function TodayBoard({ board, onChanged, onClose, task }: {
  board: ReturnType<typeof useTasks>
  // A change on the board was saved: today's flow is read again.
  onChanged: () => void
  onClose: () => void
  // A task an incoming link named (?task=): scrolled to once the board has it.
  task: string | null
}) {
  const shownTask = useRef<string | null>(null)
  const ready = board.view?.status === 'ready'
  useEffect(() => {
    if (!task || !ready || shownTask.current === task) return
    const card = document.querySelector<HTMLElement>(`[data-task="${CSS.escape(task)}"]`)
    if (!card) return
    shownTask.current = task
    card.scrollIntoView({ block: 'center', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    card.querySelector<HTMLElement>('button')?.focus({ preventScroll: true })
  }, [task, ready, board.tasks.length])

  const after = <A extends unknown[]>(run: (...a: A) => Promise<boolean>) => async (...a: A) => {
    const ok = await run(...a)
    if (ok) onChanged()
    return ok
  }
  const counts = board.view?.status === 'ready' ? board.view.counts : null
  const open = counts ? counts.todo + counts.in_progress : 0

  return (
    <section id={BOARD_ID} aria-labelledby={`${BOARD_ID}-title`} className="mt-10 scroll-mt-6 border-t border-white/8 pt-8" data-today-board>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 id={`${BOARD_ID}-title`} className="flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
            <KanbanSquare aria-hidden className="size-4 text-nova-ink" /> Board
            {open ? <span className="text-sm font-normal text-foreground/50">· {open} open</span> : null}
          </h2>
          <p className="mt-1 text-sm text-foreground/60">All your tasks. Drag a card to move it, or open it to edit. A task joins today only when you add it to the day.</p>
        </div>
        <button type="button" onClick={onClose} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/12 px-3 text-sm text-foreground/80 hover:bg-white/5" data-today-board-close>
          <X aria-hidden className="size-4" /> Close board
        </button>
      </div>
      <div className="mt-5">
        {board.loading ? (
          <div aria-busy="true" aria-label="Loading your tasks" className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {[0, 1, 2].map(i => <div key={i} className="h-56 animate-pulse rounded-3xl bg-white/3" />)}
          </div>
        ) : board.view?.status === 'ready' ? (
          <TaskBoard
            view={board.view} tasks={board.tasks} error={board.error} onClearError={board.clearError}
            onCreate={after((input: TaskInput) => board.create(input))}
            onUpdate={after((id: string, changes: TaskInput) => board.update(id, changes))}
            onDelete={after((id: string) => board.remove(id))}
            onReorder={board.reorder}
          />
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
