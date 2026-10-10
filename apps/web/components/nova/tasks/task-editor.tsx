'use client'

import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import {
  TASK_PRIORITIES, TASK_STATUSES, TASK_STATUS_LABEL, TASK_TITLE_MAX,
  type NovaTaskItem, type TaskInput, type TaskSubjectOption,
} from '@repo/api/nova/product/tasks.types'
import { PRIORITY_LABEL } from './task-format'

type Props = {
  // null: a new task.
  task:     NovaTaskItem | null
  subjects: TaskSubjectOption[]
  // The column a new task starts in.
  initialStatus?: NovaTaskItem['status']
  onSave:   (input: TaskInput) => Promise<boolean>
  onDelete?: () => Promise<boolean>
  onClose:  () => void
  error:    string | null
}

const FIELD = 'h-10 w-full rounded-xl border border-white/10 bg-white/4 px-3 text-sm text-foreground outline-none transition-colors placeholder:text-foreground/35 focus:border-keppel-400/60'
const LABEL = 'mb-1.5 block text-xs font-medium text-foreground/55'

// Create or edit one task. Nothing is saved until Save, and the dialog stays
// open with the reason when the server refuses.
export function TaskEditor({ task, subjects, initialStatus = 'todo', onSave, onDelete, onClose, error }: Props) {
  const [title, setTitle]         = useState(task?.title ?? '')
  const [status, setStatus]       = useState(task?.status ?? initialStatus)
  const [priority, setPriority]   = useState(task?.priority ?? '')
  const [subjectId, setSubjectId] = useState(task?.subjectId ?? '')
  const [topicName, setTopicName] = useState(task?.topicName ?? '')
  const [dueDay, setDueDay]       = useState(task?.dueDay ?? '')
  const [saving, setSaving]       = useState(false)
  const [confirming, setConfirming] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => { titleRef.current?.focus() }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || saving) return
    setSaving(true)
    const ok = await onSave({
      title, status,
      priority:  priority === '' ? null : priority as TaskInput['priority'],
      subjectId: subjectId || null,
      topicName: topicName.trim() || null,
      dueDay:    dueDay || null,
    })
    setSaving(false)
    if (ok) onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-6" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <form
        onSubmit={submit}
        role="dialog" aria-modal="true" aria-label={task ? 'Edit task' : 'New task'}
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-white/10 bg-card p-6 shadow-2xl sm:rounded-3xl sm:p-7"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">{task ? 'Edit task' : 'New task'}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-foreground/50 transition-colors hover:bg-white/5 hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>

        <div className="mt-5 space-y-4">
          <div>
            <label htmlFor="task-title" className={LABEL}>What needs doing</label>
            <input id="task-title" ref={titleRef} value={title} onChange={e => setTitle(e.target.value)} maxLength={TASK_TITLE_MAX} placeholder="e.g. Finish OS assignment 3" className={FIELD} />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="task-status" className={LABEL}>Status</label>
              <select id="task-status" value={status} onChange={e => setStatus(e.target.value as NovaTaskItem['status'])} className={FIELD}>
                {TASK_STATUSES.map(s => <option key={s} value={s}>{TASK_STATUS_LABEL[s]}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="task-due" className={LABEL}>Due</label>
              <input id="task-due" type="date" value={dueDay} onChange={e => setDueDay(e.target.value)} className={FIELD} />
            </div>
            <div>
              <label htmlFor="task-subject" className={LABEL}>Subject</label>
              <select id="task-subject" value={subjectId} onChange={e => setSubjectId(e.target.value)} className={FIELD}>
                <option value="">None</option>
                {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="task-priority" className={LABEL}>Priority</label>
              <select id="task-priority" value={priority} onChange={e => setPriority(e.target.value)} className={FIELD}>
                <option value="">Not set</option>
                {TASK_PRIORITIES.map(p => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="task-topic" className={LABEL}>Topic <span className="text-foreground/35">(optional)</span></label>
            <input id="task-topic" value={topicName} onChange={e => setTopicName(e.target.value)} placeholder="e.g. Deadlocks" className={FIELD} />
          </div>
        </div>

        {error && <p role="alert" className="mt-4 text-sm text-red-300">{error}</p>}

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          {task && onDelete ? (
            confirming ? (
              <span className="flex items-center gap-2 text-sm">
                <span className="text-foreground/60">Delete this task?</span>
                <button type="button" onClick={async () => { if (await onDelete()) onClose() }} className="font-medium text-red-300 hover:text-red-200">Delete</button>
                <button type="button" onClick={() => setConfirming(false)} className="text-foreground/55 hover:text-foreground">Keep</button>
              </span>
            ) : (
              <button type="button" onClick={() => setConfirming(true)} className="text-sm text-foreground/45 transition-colors hover:text-red-300">Delete</button>
            )
          ) : <span />}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="inline-flex h-10 items-center rounded-xl border border-white/12 px-4 text-sm font-medium text-foreground/80 transition-colors hover:bg-white/5">Cancel</button>
            <button type="submit" disabled={!title.trim() || saving} className="inline-flex h-10 items-center rounded-xl bg-keppel-400 px-5 text-sm font-semibold text-keppel-950 transition-colors hover:bg-keppel-300 disabled:opacity-50">
              {saving ? 'Saving…' : task ? 'Save' : 'Add task'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
