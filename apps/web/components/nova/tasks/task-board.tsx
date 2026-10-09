'use client'

import { useState } from 'react'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
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
}

const EMPTY: Record<TaskStatus, string> = {
  todo:        'Nothing waiting. Add what you need to get done.',
  in_progress: 'Nothing under way. Drag a task here when you start it.',
  done:        'Finished tasks land here.',
}

const PRIORITY_TONE = { high: 'text-rose-300', medium: 'text-amber-300', low: 'text-foreground/45' } as const

function Card({ task, onOpen, onMove, dragging, onDragStart, onDragEnd }: {
  task: NovaTaskItem
  onOpen: () => void
  onMove: (status: TaskStatus) => void
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
        {(due || task.priority) && (
          <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
            {due && task.status !== 'done' && <span className={late ? 'font-medium text-rose-300' : 'text-foreground/55'}>{due}</span>}
            {task.priority && <span className={PRIORITY_TONE[task.priority]}>{PRIORITY_LABEL[task.priority]} priority</span>}
          </span>
        )}
      </button>
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
    </li>
  )
}

// The learner's tasks as a board. A column is a status; moving a card sets
// that status on the task and nothing else. The same rows are the list on
// Today, so what moves here has moved there.
export function TaskBoard({ view, tasks, error, onClearError, onCreate, onUpdate, onDelete }: Props) {
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
          const column = tasks.filter(t => t.status === status)
          const hidden = view.counts[status] - column.length
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
                  {column.map(task => (
                    <Card
                      key={task.id} task={task}
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
          error={error}
          onClose={close}
          onSave={input => editing ? onUpdate(editing.id, input) : onCreate(input)}
          onDelete={editing ? () => onDelete(editing.id) : undefined}
        />
      )}
    </div>
  )
}
