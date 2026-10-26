'use client'

// Adding to today: the learner's open tasks (due and overdue first), the
// topics the planner suggests today, their other topics, grouped by the
// workspace they were built in; or a focus item for today only, in their own
// words. A topic stays a topic: nothing here makes a task, except "Make it a
// task", which is the ordinary task route with a key so it is made once.

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Hash, ListTodo, Loader2, Plus, Search, Target, X } from 'lucide-react'
import type { FlowCandidate, FlowOp, NovaDayView } from '@repo/api/nova/product/day-flow.types'
import { trappedTabTarget } from '@/components/settings/dialog-focus'

export function AddToToday({ flow, onClose, onOps, onCreateTask }: {
  flow: NovaDayView
  onClose: () => void
  onOps: (ops: FlowOp[]) => Promise<{ ok: boolean }>
  // Makes a task on the board and returns its id (the task route, keyed).
  onCreateTask: (title: string) => Promise<string | null>
}) {
  const dialog = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const listId = useId()
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [added, setAdded] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    input.current?.focus()
    return () => opener?.focus?.()
  }, [])

  const q = query.trim().toLowerCase()
  const matches = useMemo(() => flow.candidates.filter(c => !q || [c.title, c.subjectName ?? '', c.topicName ?? '', c.workspace ?? ''].join(' ').toLowerCase().includes(q)), [flow.candidates, q])
  const groups: Array<{ label: string; items: FlowCandidate[] }> = [
    { label: 'Your tasks', items: matches.filter(c => c.kind === 'task').slice(0, 30) },
    { label: 'Suggested by your planner today', items: matches.filter(c => c.kind === 'topic' && c.why).slice(0, 10) },
    { label: 'Your topics', items: matches.filter(c => c.kind === 'topic' && !c.why).slice(0, 30) },
  ].filter(g => g.items.length)

  async function add(c: FlowCandidate) {
    setBusy(c.id); setError(null)
    const res = await onOps([{ op: 'add', item: c.kind === 'task' ? { kind: 'task', taskId: c.id } : { kind: 'topic', topicId: c.id } }])
    setBusy(null)
    if (res.ok) setAdded(a => [...a, c.title]); else setError('That wasn’t added. Try again.')
  }
  async function addFocus() {
    const title = query.trim()
    if (!title) return
    setBusy('focus'); setError(null)
    const res = await onOps([{ op: 'add', item: { kind: 'focus', title } }])
    setBusy(null)
    if (res.ok) { setAdded(a => [...a, title]); setQuery('') } else setError('That wasn’t added. Try again.')
  }
  async function makeTask() {
    const title = query.trim()
    if (!title) return
    setBusy('task'); setError(null)
    const id = await onCreateTask(title)
    if (!id) { setBusy(null); setError('The task wasn’t made. Try again.'); return }
    const res = await onOps([{ op: 'add', item: { kind: 'task', taskId: id } }])
    setBusy(null)
    if (res.ok) { setAdded(a => [...a, title]); setQuery('') } else setError('The task was made, but it wasn’t added to today. Find it under Your tasks.')
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return }
    if (e.key === 'Tab' && dialog.current) {
      const stops = Array.from(dialog.current.querySelectorAll<HTMLElement>('input, button:not([disabled])'))
      const target = trappedTabTarget(stops, document.activeElement as HTMLElement | null, e.shiftKey, dialog.current)
      if (target) { e.preventDefault(); target.focus() }
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[10vh]" onKeyDown={onKeyDown}>
      <div aria-hidden className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" onClick={onClose} />
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="add-today-title" className="relative w-full max-w-xl overflow-hidden rounded-xl border border-white/10 bg-card shadow-2xl shadow-black/40" data-add-to-today>
        <header className="flex items-center gap-3 border-b border-white/8 px-4 py-3">
          <h2 id="add-today-title" className="flex-1 text-sm font-semibold text-foreground">Add to today</h2>
          <button type="button" onClick={onClose} className="inline-flex size-7 items-center justify-center rounded-lg text-subtle hover:bg-white/6 hover:text-foreground" aria-label="Close (Esc)"><X className="size-4" /></button>
        </header>
        <div className="flex items-center gap-3 border-b border-white/8 px-4">
          <Search aria-hidden className="size-4 shrink-0 text-foreground/45" />
          <input ref={input} value={query} onChange={e => setQuery(e.target.value.slice(0, 160))} aria-controls={listId}
            placeholder="Find a task or topic, or type something to do today…" aria-label="Find or type"
            className="h-12 min-w-0 flex-1 bg-transparent text-[15px] text-foreground outline-none placeholder:text-foreground/40" data-add-search />
        </div>
        <div id={listId} className="max-h-[min(55vh,26rem)] overflow-y-auto p-1.5">
          {query.trim() && (
            <div className="mb-1 space-y-0.5 border-b border-white/6 pb-1.5">
              <button type="button" disabled={!!busy} onClick={() => void addFocus()} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-white/6" data-add-focus>
                <Target className="size-4 shrink-0 text-nova-ink" aria-hidden />
                <span className="min-w-0 flex-1"><span className="block truncate text-sm text-foreground">Just for today: “{query.trim()}”</span><span className="block text-xs text-subtle">In today’s flow only. No task is made.</span></span>
                {busy === 'focus' && <Loader2 className="size-3.5 animate-spin" />}
              </button>
              <button type="button" disabled={!!busy} onClick={() => void makeTask()} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-white/6" data-add-new-task>
                <Plus className="size-4 shrink-0 text-subtle" aria-hidden />
                <span className="min-w-0 flex-1"><span className="block truncate text-sm text-foreground">Make it a task: “{query.trim()}”</span><span className="block text-xs text-subtle">On your board too, and in today.</span></span>
                {busy === 'task' && <Loader2 className="size-3.5 animate-spin" />}
              </button>
            </div>
          )}
          {groups.length === 0 && !query.trim() && <p className="px-3 py-6 text-center text-sm text-subtle">No open tasks or topics to add. Type something to do today.</p>}
          {groups.map(g => (
            <section key={g.label} className="mb-1">
              <p className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-[0.12em] text-subtle">{g.label}</p>
              <ul>
                {g.items.map(c => (
                  <li key={`${c.kind}:${c.id}`}>
                    <button type="button" disabled={!!busy} onClick={() => void add(c)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-white/6 disabled:opacity-60" data-add-candidate={`${c.kind}:${c.id}`}>
                      {c.kind === 'task' ? <ListTodo className="size-4 shrink-0 text-subtle" aria-hidden /> : <Hash className="size-4 shrink-0 text-subtle" aria-hidden />}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-foreground">{c.title}</span>
                        <span className="block truncate text-xs text-subtle">{[c.workspace, c.subjectName, c.why, c.minutes ? `${c.minutes} min` : null].filter(Boolean).join(' · ')}</span>
                      </span>
                      {busy === c.id ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5 text-subtle" aria-hidden />}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <footer className="flex items-center justify-between gap-3 border-t border-white/8 px-4 py-2.5 text-xs">
          <p role="status" className="min-w-0 truncate text-subtle">{error ?? (added.length ? `Added: ${added.slice(-3).join(', ')}` : 'A topic stays something to learn; no task is made from it.')}</p>
          <button type="button" onClick={onClose} className="shrink-0 rounded-lg bg-action px-3 py-1.5 font-semibold text-action-foreground hover:bg-action-hover">Done</button>
        </footer>
      </div>
    </div>
  )
}
