'use client'

import { useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ListTree, Plus } from 'lucide-react'
import { subtreeOf } from '@repo/api/nova/product/task-tree'
import {
  TASK_STATUSES, TASK_STATUS_LABEL,
  type NovaTaskItem, type NovaTasksReady, type TaskInput, type TaskStatus,
} from '@repo/api/nova/product/tasks.types'
import { TaskEditor } from './task-editor'
import { PRIORITY_LABEL, dueLabel, isOverdue } from './task-format'

type Props = {
  view:    NovaTasksReady
  tasks:   NovaTaskItem[]
  error:   string | null
  onClearError: () => void
  onCreate: (input: TaskInput) => Promise<boolean>
  onUpdate: (id: string, changes: TaskInput) => Promise<boolean>
  onDelete: (id: string) => Promise<boolean>
  // The learner's own order for an open column (POST /api/nova/tasks/order).
  onReorder?: (status: 'todo' | 'in_progress', ids: string[]) => Promise<boolean>
}

const EMPTY: Record<TaskStatus, string> = {
  todo:        'Nothing waiting. Add what you need to get done.',
  in_progress: 'Nothing under way. Drag a task here when you start it.',
  done:        'Finished tasks land here.',
}

const PRIORITY_TONE = { high: 'text-rose-300', medium: 'text-amber-300', low: 'text-foreground/45' } as const

// A task's steps, as a checklist under it: ticking one finishes it, and a
// step's own steps sit under it. Opening one edits it like any task.
function Steps({ parent, all, onOpen, onToggle }: { parent: string; all: NovaTaskItem[]; onOpen: (t: NovaTaskItem) => void; onToggle: (t: NovaTaskItem) => void }) {
  const children = all.filter(t => t.parentId === parent)
  if (children.length === 0) return null
  return (
    <ul className="mt-1.5 space-y-1 border-l border-white/10 pl-3" data-steps>
      {children.map(t => (
        <li key={t.id} data-step={t.id}>
          <span className="flex items-start gap-2">
            <input type="checkbox" checked={t.status === 'done'} onChange={() => onToggle(t)} aria-label={`${t.status === 'done' ? 'Reopen' : 'Finish'} ${t.title}`} className="mt-0.5 size-3.5 shrink-0 accent-keppel-400" />
            <button type="button" onClick={() => onOpen(t)} className={`min-w-0 text-left text-xs leading-snug hover:underline ${t.status === 'done' ? 'text-foreground/45 line-through' : 'text-foreground/85'}`}>{t.title}</button>
          </span>
          <Steps parent={t.id} all={all} onOpen={onOpen} onToggle={onToggle} />
        </li>
      ))}
    </ul>
  )
}

function Card({ task, all, onOpen, onOpenStep, onToggleStep, onAddStep, onMove, onShift, dragging, onDragStart, onDragEnd }: {
  task: NovaTaskItem
  // Every task on the board, for this one's steps.
  all: NovaTaskItem[]
  onOpen: () => void
  onOpenStep: (t: NovaTaskItem) => void
  onToggleStep: (t: NovaTaskItem) => void
  onAddStep: (title: string) => Promise<boolean>
  onMove: (status: TaskStatus) => void
  // Up or down within its column; absent where it cannot move that way.
  onShift?: { up?: () => void; down?: () => void }
  dragging: boolean
  onDragStart: () => void
  onDragEnd: () => void
}) {
  const at    = TASK_STATUSES.indexOf(task.status)
  const prev  = TASK_STATUSES[at - 1]
  const next  = TASK_STATUSES[at + 1]
  const due   = dueLabel(task)
  const late  = isOverdue(task)
  const where = [task.subjectName, task.topicName].filter(Boolean).join(' · ')
  const under = subtreeOf(all.map(t => ({ id: t.id, parent: t.parentId })), task.id).slice(1).map(id => all.find(t => t.id === id)!)
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState('')

  return (
    <li
      draggable
      onDragStart={e => { e.dataTransfer.setData('text/plain', task.id); e.dataTransfer.effectAllowed = 'move'; onDragStart() }}
      onDragEnd={onDragEnd}
      className={`group rounded-2xl border border-white/8 bg-card/80 p-3.5 transition-all ${dragging ? 'opacity-40' : 'hover:border-white/16'}`}
      data-task={task.id}
    >
      <button type="button" onClick={onOpen} className="block w-full cursor-pointer text-left outline-none focus-visible:ring-2 focus-visible:ring-keppel-400/60 rounded-lg">
        <span className={`block text-sm font-medium leading-snug ${task.status === 'done' ? 'text-foreground/50 line-through decoration-foreground/25' : 'text-foreground'}`}>{task.title}</span>
        {where && <span className="mt-1 block truncate text-xs text-foreground/50">{where}</span>}
        {(due || task.priority || task.estimatedMinutes) && (
          <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
            {due && task.status !== 'done' && <span className={late ? 'font-medium text-rose-300' : 'text-foreground/55'}>{due}</span>}
            {task.estimatedMinutes && <span className="text-foreground/55">{task.estimatedMinutes} min</span>}
            {task.priority && <span className={PRIORITY_TONE[task.priority]}>{PRIORITY_LABEL[task.priority]} priority</span>}
          </span>
        )}
      </button>
      {under.length > 0 && (
        <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="mt-2 inline-flex items-center gap-1 rounded-md text-[11px] text-foreground/60 hover:text-foreground" data-step-count>
          <ListTree aria-hidden className="size-3.5" />{under.filter(t => t.status === 'done').length} of {under.length} step{under.length === 1 ? '' : 's'} done
          <ChevronDown aria-hidden className={`size-3 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      )}
      {open && <Steps parent={task.id} all={all} onOpen={onOpenStep} onToggle={onToggleStep} />}
      {(open || under.length === 0) && task.status !== 'done' && (
        <form className="mt-2" onSubmit={async e => { e.preventDefault(); if (step.trim() && await onAddStep(step.trim())) { setStep(''); setOpen(true) } }}>
          <input aria-label={`Add a step to ${task.title}`} value={step} onChange={e => setStep(e.target.value)} placeholder="Add a step" maxLength={160}
            className="h-7 w-full rounded-lg border border-dashed border-white/10 bg-transparent px-2 text-[11px] text-foreground outline-none placeholder:text-foreground/35 focus:border-keppel-400/60" />
        </form>
      )}
      {/* Moving without dragging: for touch screens and the keyboard. */}
      <div className="mt-2.5 flex items-center justify-between border-t border-white/6 pt-2">
        <button type="button" disabled={!prev} onClick={() => prev && onMove(prev)} aria-label={prev ? `Move to ${TASK_STATUS_LABEL[prev]}` : 'First column'}
          className="inline-flex h-7 items-center gap-1 rounded-lg px-1.5 text-[11px] text-foreground/50 transition-colors hover:bg-white/5 hover:text-foreground disabled:invisible">
          <ChevronLeft className="size-3.5" />{prev ? TASK_STATUS_LABEL[prev] : ''}
        </button>
        <button type="button" disabled={!next} onClick={() => next && onMove(next)} aria-label={next ? `Move to ${TASK_STATUS_LABEL[next]}` : 'Last column'}
          className="inline-flex h-7 items-center gap-1 rounded-lg px-1.5 text-[11px] text-foreground/50 transition-colors hover:bg-white/5 hover:text-foreground disabled:invisible">
          {next ? TASK_STATUS_LABEL[next] : ''}<ChevronRight className="size-3.5" />
        </button>
      </div>
      {onShift && (onShift.up || onShift.down) && (
        <div className="mt-1 flex justify-center gap-1" data-task-order>
          <button type="button" disabled={!onShift.up} onClick={onShift.up} aria-label={`Move "${task.title}" up`}
            className="inline-flex h-7 w-8 items-center justify-center rounded-lg text-foreground/45 transition-colors hover:bg-white/5 hover:text-foreground disabled:invisible"><ChevronUp className="size-3.5" /></button>
          <button type="button" disabled={!onShift.down} onClick={onShift.down} aria-label={`Move "${task.title}" down`}
            className="inline-flex h-7 w-8 items-center justify-center rounded-lg text-foreground/45 transition-colors hover:bg-white/5 hover:text-foreground disabled:invisible"><ChevronDown className="size-3.5" /></button>
        </div>
      )}
    </li>
  )
}

// The learner's tasks as a board. A column is a status; moving a card sets
// that status on the task and nothing else. The same rows are the list on
// Today, so what moves here has moved there.
export function TaskBoard({ view, tasks, error, onClearError, onCreate, onUpdate, onDelete, onReorder }: Props) {
  const [editing, setEditing]   = useState<NovaTaskItem | null>(null)
  const [adding, setAdding]     = useState<TaskStatus | null>(null)
  const [dragged, setDragged]   = useState<string | null>(null)
  const [over, setOver]         = useState<TaskStatus | null>(null)

  const drop = (status: TaskStatus, id: string) => {
    setOver(null); setDragged(null)
    const task = tasks.find(t => t.id === id)
    if (task && task.status !== status) void onUpdate(id, { status })
  }
  const close = () => { setEditing(null); setAdding(null); onClearError() }

  return (
    <div>
      {error && !editing && adding === null && (
        <p role="alert" className="mb-4 rounded-xl border border-red-400/20 bg-red-400/8 px-4 py-2.5 text-sm text-red-200">{error}</p>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {TASK_STATUSES.map(status => {
          // Cards are tasks of their own; a step shows inside the card of its task.
          const column = tasks.filter(t => t.status === status && (!t.parentId || !tasks.some(x => x.id === t.parentId)))
          const hidden = Math.max(0, view.counts[status] - tasks.filter(t => t.status === status).length)
          return (
            <section
              key={status}
              aria-label={TASK_STATUS_LABEL[status]}
              onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (over !== status) setOver(status) }}
              onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null) }}
              onDrop={e => { e.preventDefault(); drop(status, e.dataTransfer.getData('text/plain')) }}
              className={`flex min-h-48 flex-col rounded-3xl border p-3 transition-colors ${over === status && dragged ? 'border-keppel-400/50 bg-keppel-400/5' : 'border-white/6 bg-white/2'}`}
            >
              <header className="flex items-center justify-between px-1.5 pb-3 pt-1">
                <h3 className="text-sm font-semibold text-foreground">
                  {TASK_STATUS_LABEL[status]} <span className="ml-1 font-normal text-foreground/40">{view.counts[status]}</span>
                </h3>
                {status !== 'done' && (
                  <button type="button" onClick={() => setAdding(status)} aria-label={`Add a task to ${TASK_STATUS_LABEL[status]}`}
                    className="rounded-lg p-1.5 text-foreground/50 transition-colors hover:bg-white/6 hover:text-foreground">
                    <Plus className="size-4" />
                  </button>
                )}
              </header>

              {column.length === 0 ? (
                <p className="px-1.5 py-6 text-center text-xs leading-relaxed text-foreground/40">{EMPTY[status]}</p>
              ) : (
                <ul className="space-y-2.5">
                  {column.map((task, i) => (
                    <Card
                      key={task.id} task={task} all={tasks}
                      onOpenStep={t => setEditing(t)}
                      onToggleStep={t => void onUpdate(t.id, { status: t.status === 'done' ? 'todo' : 'done' })}
                      onAddStep={title => onCreate({ title, parentId: task.id })}
                      onShift={onReorder && status !== 'done' ? {
                        // The whole column's order, with this card moved one place.
                        up:   i > 0 ? () => { const ids = column.map(t => t.id); [ids[i - 1], ids[i]] = [ids[i]!, ids[i - 1]!]; void onReorder(status, ids) } : undefined,
                        down: i < column.length - 1 ? () => { const ids = column.map(t => t.id); [ids[i + 1], ids[i]] = [ids[i]!, ids[i + 1]!]; void onReorder(status, ids) } : undefined,
                      } : undefined}
                      dragging={dragged === task.id}
                      onDragStart={() => setDragged(task.id)}
                      onDragEnd={() => { setDragged(null); setOver(null) }}
                      onOpen={() => setEditing(task)}
                      onMove={to => void onUpdate(task.id, { status: to })}
                    />
                  ))}
                </ul>
              )}
              {hidden > 0 && <p className="px-1.5 pt-3 text-[11px] text-foreground/40">and {hidden} finished earlier</p>}
            </section>
          )
        })}
      </div>

      {(editing || adding !== null) && (
        <TaskEditor
          task={editing}
          subjects={view.subjects}
          initialStatus={adding ?? 'todo'}
          // Any task but itself and its own steps.
          parents={tasks.filter(t => !editing || !subtreeOf(tasks.map(x => ({ id: x.id, parent: x.parentId })), editing.id).includes(t.id)).map(t => ({ id: t.id, title: t.title }))}
          error={error}
          onClose={close}
          onSave={input => editing ? onUpdate(editing.id, input) : onCreate(input)}
          onDelete={editing ? () => onDelete(editing.id) : undefined}
        />
      )}
    </div>
  )
}
