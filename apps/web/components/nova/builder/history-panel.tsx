'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { milestonesOf } from '@repo/api/nova/product/workspace-plan'
import { History, X } from 'lucide-react'
import type { VersionItem } from '@repo/api/nova/product/builder.types'
import { treeOrder } from '@repo/api/nova/product/task-tree'
import { cn } from '@/lib/utils'
import * as api from './builder-api'
import type { DraftState } from './use-draft'

// Every version the conversation kept, newest first: what Nova proposed, the
// learner's own edits, what was restored, and the records as they were
// built. One can be looked at, read-only, and restored: restoring makes a
// new version (something already built comes back as proposed changes, to
// approve), and no version is ever lost.

const AUTHOR = { nova: 'Nova', you: 'You', restored: 'Restored' } as const
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

export function HistoryButton({ state }: { state: DraftState }) {
  const [open, setOpen] = useState(false)
  if (!state.draft) return null
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-foreground/65 hover:bg-white/6 hover:text-foreground" data-history-open>
        <History aria-hidden className="size-3.5" />History
      </button>
      {open && <HistoryDrawer state={state} onClose={() => setOpen(false)} />}
    </>
  )
}

function HistoryDrawer({ state, onClose }: { state: DraftState; onClose: () => void }) {
  const draft = state.draft!
  const [versions, setVersions] = useState<VersionItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<VersionItem | null>(null)
  const [view, setView] = useState<api.VersionView | null>(null)
  const [restoring, setRestoring] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)

  const load = useCallback(async () => {
    const r = await api.listVersions(draft.id)
    if (r.ok) setVersions(r.versions); else setError(r.message)
  }, [draft.id])
  useEffect(() => { void load(); closeRef.current?.focus() }, [load])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  useEffect(() => {
    if (!picked) { setView(null); return }
    let live = true
    void api.loadVersion(draft.id, picked.id).then(r => { if (!live) return; if (r.ok) setView(r); else setError(r.message) })
    return () => { live = false }
  }, [draft.id, picked])

  const restore = async () => {
    if (!picked) return
    setRestoring(true); setError(null)
    const r = await api.restoreVersion(draft.id, picked.id, draft.version)
    setRestoring(false)
    if (!r.ok) { setError(r.message); return }
    await state.reload()
    onClose()
  }
  const isCurrent = (v: VersionItem) => v.kind === 'proposal' && v.version === draft.version

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-[2px]" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <aside role="dialog" aria-modal="true" aria-label="History" className="flex h-full w-full max-w-md flex-col border-l border-white/10 bg-card shadow-2xl" data-history>
        <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">History</h2>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close the history" className="rounded-lg p-1.5 text-subtle hover:bg-white/5 hover:text-foreground"><X aria-hidden className="size-4" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {error && <p role="alert" className="mb-2 text-sm text-red-400">{error}</p>}
          {!versions ? <p className="text-sm text-subtle">Loading…</p> : versions.length === 0 ? <p className="text-sm text-foreground/70">No versions yet. Each proposal, your edits and each build will be kept here.</p> : (
            <ol className="space-y-1">
              {versions.map(v => (
                <li key={v.id}>
                  <button type="button" onClick={() => setPicked(p => (p?.id === v.id ? null : v))} aria-expanded={picked?.id === v.id}
                    className={cn('w-full rounded-lg border px-3 py-2 text-left transition-colors', picked?.id === v.id ? 'border-action/50 bg-action/5' : 'border-transparent hover:bg-white/4')} data-version={v.version}>
                    <span className="flex items-center gap-2 text-xs">
                      <span className="font-semibold text-foreground">v{v.version}</span>
                      <span className={cn('rounded px-1.5 py-0.5', v.kind === 'built' ? 'bg-action-soft text-action-ink' : 'bg-white/6 text-foreground/70')}>{v.kind === 'built' ? 'Built' : 'Proposal'}</span>
                      <span className="text-subtle">{AUTHOR[v.author]} · {when(v.createdAt)}</span>
                      {isCurrent(v) && <span className="ml-auto text-[11px] font-medium text-nova-ink">Current</span>}
                    </span>
                    <span className="mt-1 block line-clamp-2 text-xs leading-relaxed text-foreground/70">{v.summary}</span>
                  </button>
                  {picked?.id === v.id && (
                    <div className="mx-1 mb-2 mt-1 rounded-lg border border-white/8 bg-background/40 p-3">
                      {!view ? <p className="text-xs text-subtle">Loading this version…</p> : <VersionPreview view={view} />}
                      <div className="mt-3 flex items-center justify-end gap-2">
                        <span className="mr-auto text-[11px] text-subtle">{draft.workspace || draft.resource ? 'Restoring proposes the changes that bring it back; nothing changes until you approve.' : 'Restoring makes it the proposal again, as a new version.'}</span>
                        <button type="button" disabled={restoring || isCurrent(v) || !view} onClick={() => void restore()} className="h-8 shrink-0 rounded-lg bg-action px-3 text-xs font-semibold text-action-foreground disabled:opacity-40" data-restore>
                          {restoring ? 'Restoring…' : 'Restore this version'}
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      </aside>
    </div>
  )
}

// A version, read-only: its structure and tasks, or the changes it held.
function VersionPreview({ view }: { view: api.VersionView }) {
  if (view.changes) {
    return <ul className="space-y-0.5 text-xs text-foreground/80">{view.changes.ops.slice(0, 20).map(o => <li key={o.id}>· {o.says}</li>)}{view.changes.ops.length > 20 && <li className="text-subtle">and {view.changes.ops.length - 20} more</li>}</ul>
  }
  const subjects = view.plan ? view.plan.subjects.map(s => ({ name: s.name, topics: s.topics.map(t => t.name) })) : view.snapshot?.subjects ?? []
  const tasks = view.plan
    ? view.plan.tasks.map(t => ({ id: t.key, parent: t.parent ?? null, title: t.title, status: 'todo' as const }))
    : (view.snapshot?.tasks ?? []).map(t => ({ id: t.key, parent: t.parent, title: t.title, status: t.status }))
  const title = view.plan?.title ?? view.snapshot?.title ?? ''
  return (
    <div className="space-y-2 text-xs">
      <p className="font-medium text-foreground">{title}</p>
      {view.plan && milestonesOf(view.plan).length ? <p className="text-foreground/70">Milestones: {milestonesOf(view.plan).map(m => m.topic.name).join(' · ')}</p> : null}
      {subjects.map(s => <p key={s.name} className="text-foreground/70"><span className="text-foreground/85">{s.name}</span>{s.topics.length ? `: ${s.topics.join(', ')}` : ''}</p>)}
      {tasks.length > 0 && (
        <ul className="space-y-0.5">
          {treeOrder(tasks).slice(0, 40).map(({ item: t, depth }) => (
            <li key={t.id} style={{ paddingLeft: depth * 12 }} className={cn('text-foreground/80', t.status === 'done' && 'text-subtle line-through')}>· {t.title}</li>
          ))}
          {tasks.length > 40 && <li className="text-subtle">and {tasks.length - 40} more tasks</li>}
        </ul>
      )}
    </div>
  )
}
