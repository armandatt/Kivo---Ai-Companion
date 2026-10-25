'use client'

import { useCallback, useEffect, useState } from 'react'
import { History, Loader2, RotateCcw, X } from 'lucide-react'
import type { VersionListItem, VersionResponse } from '@repo/api/nova/product/builder.types'
import { treeOrder } from '@repo/api/nova/product/task-tree'
import { BUTTON_PRIMARY, BUTTON_QUIET } from '@/components/nova/workspace/ui'
import { cn } from '@/lib/utils'
import * as api from './builder-api'
import type { DraftState } from './use-draft'

// Every version of this conversation's work, newest first, from the server
// (builder-history.ts): Nova's versions, the learner's edits, restores,
// builds and deletions. Looking at one shows it as it was; restoring makes
// a new version from it (nothing is removed, and the ones after it stay
// listed). For something already built, restoring proposes the changes that
// bring it back, to approve like any other: the server says which, and the
// button says what it will do before it is pressed.

const ago = (iso: string) => {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

const AUTHOR: Record<VersionListItem['author'], string> = { nova: 'Nova', learner: 'You', restore: 'Restored', build: 'Built', delete: 'Deleted' }

export function HistoryButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-foreground/60 hover:bg-white/6 hover:text-foreground" data-history-open>
      <History aria-hidden className="size-3.5" /> Version history
    </button>
  )
}

export function VersionHistory({ state, onClose }: { state: DraftState; onClose: () => void }) {
  const draftId = state.draft?.id ?? null
  const [list, setList] = useState<VersionListItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [detail, setDetail] = useState<Extract<VersionResponse, { ok: true }> | null>(null)
  const [loadingOne, setLoadingOne] = useState(false)

  const load = useCallback(async () => {
    if (!draftId) return
    const res = await api.loadVersions(draftId)
    if (res.ok) { setList(res.versions); setError(null) } else setError(res.message)
  }, [draftId])
  // Again whenever the conversation moves on (a new version, a build).
  useEffect(() => { void load() }, [load, state.draft?.version, state.draft?.status])

  const inspect = async (v: VersionListItem) => {
    if (open === v.id) { setOpen(null); setDetail(null); return }
    setOpen(v.id); setDetail(null); setLoadingOne(true)
    const res = draftId ? await api.loadVersion(draftId, v.id) : null
    setLoadingOne(false)
    if (res?.ok) setDetail(res)
    else setError(res?.message ?? 'That version did not load.')
  }

  const restore = async (v: VersionListItem) => {
    const ok = await state.restore(v.id)
    if (ok) onClose()
  }

  return (
    <div className="absolute inset-0 z-30 flex justify-end bg-background/40 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-label="Version history" data-history>
      <div className="flex h-full w-full max-w-md flex-col border-l border-white/10 bg-card shadow-soft">
        <div className="flex items-center gap-2 border-b border-white/8 px-4 py-3">
          <History aria-hidden className="size-4 text-nova-ink" />
          <h2 className="min-w-0 flex-1 text-sm font-semibold text-foreground">Version history</h2>
          <button type="button" onClick={onClose} aria-label="Close version history" className="grid size-7 place-items-center rounded-md text-subtle hover:bg-white/6 hover:text-foreground"><X aria-hidden className="size-4" /></button>
        </div>
        <p className="border-b border-white/8 px-4 py-2 text-[11px] leading-relaxed text-subtle">Restoring makes a new version from an old one. Nothing is lost: every version stays here. For something already built, Nova proposes the changes that bring it back, and nothing changes until you approve them.</p>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {error && <p role="alert" className="m-2 text-xs text-red-400">{error}</p>}
          {state.actionError && state.errorOf === 'restore' && <p role="alert" className="m-2 text-xs text-red-400">{state.actionError}</p>}
          {!list && !error && <p className="m-3 flex items-center gap-2 text-xs text-subtle"><Loader2 aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" /> Loading the history…</p>}
          {list && list.length === 0 && <p className="m-3 text-sm text-foreground/70">No versions yet. Each proposal, edit and build is kept here from now on.</p>}
          <ol className="space-y-1">
            {list?.map(v => {
              const current = v.kind === 'proposal' && v.version === state.draft?.version
              return (
                <li key={v.id} className={cn('rounded-lg border', open === v.id ? 'border-nova/35 bg-nova/5' : 'border-transparent hover:bg-white/4')} data-version={v.version} data-kind={v.kind}>
                  <button type="button" onClick={() => void inspect(v)} aria-expanded={open === v.id} className="w-full px-3 py-2 text-left">
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{v.title}</span>
                      {current && <span className="shrink-0 rounded-full bg-action-soft px-1.5 py-0.5 text-[10px] font-medium text-action-ink">Current</span>}
                      <span className="shrink-0 text-[11px] text-subtle">{AUTHOR[v.author]} · {ago(v.createdAt)}</span>
                    </span>
                    <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-foreground/65">{v.summary}</span>
                  </button>
                  {open === v.id && (
                    <div className="space-y-2.5 px-3 pb-3">
                      {loadingOne && <p className="flex items-center gap-2 text-xs text-subtle"><Loader2 aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" /> Opening it…</p>}
                      {detail && <VersionPreview detail={detail} />}
                      {v.restores
                        ? (
                          <div className="space-y-1.5">
                            <p className="text-[11px] text-subtle">{v.restores}.</p>
                            <button type="button" onClick={() => void restore(v)} disabled={state.busy === 'restore' || state.working} className={BUTTON_PRIMARY} data-restore={v.version}>
                              {state.busy === 'restore' ? <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" /> : <RotateCcw aria-hidden className="size-4" />} Restore this version
                            </button>
                          </div>
                        )
                        : <p className="text-[11px] text-subtle">{current ? 'This is the version on screen now.' : 'Nothing to restore this to from here.'}</p>}
                    </div>
                  )}
                </li>
              )
            })}
          </ol>
        </div>
        <div className="border-t border-white/8 p-3"><button type="button" onClick={onClose} className={`${BUTTON_QUIET} w-full justify-center`}>Close</button></div>
      </div>
    </div>
  )
}

// A version as it was: a plan's milestones and tasks with their steps, a
// change set's changes, or the workspace's records then.
function VersionPreview({ detail }: { detail: Extract<VersionResponse, { ok: true }> }) {
  const rows = (tasks: Array<{ key: string; title: string; parent?: string | null }>) =>
    treeOrder(tasks.map(t => ({ ...t, parent: t.parent ?? null }))).slice(0, 14)
  if (detail.plan) {
    const p = detail.plan
    return (
      <div className="rounded-lg border border-white/8 bg-background/40 p-2.5 text-xs" data-preview="plan">
        <p className="font-medium text-foreground">{p.title}</p>
        {p.phases.length > 0 && <p className="mt-1 text-subtle">{p.phases.map(x => x.name).join(' · ')}</p>}
        <ul className="mt-1.5 space-y-0.5">{rows(p.tasks).map(({ item, depth }) => <li key={item.key} className="truncate text-foreground/75" style={{ paddingLeft: `${depth * 12}px` }}>{depth ? '↳ ' : '• '}{item.title}</li>)}</ul>
        {p.tasks.length > 14 && <p className="mt-1 text-subtle">and {p.tasks.length - 14} more</p>}
      </div>
    )
  }
  if (detail.changes) {
    return (
      <ul className="space-y-0.5 rounded-lg border border-white/8 bg-background/40 p-2.5 text-xs text-foreground/75" data-preview="changes">
        {detail.changes.ops.slice(0, 12).map(o => <li key={o.id}>• {o.says}</li>)}
        {detail.changes.ops.length > 12 && <li className="text-subtle">and {detail.changes.ops.length - 12} more</li>}
      </ul>
    )
  }
  if (detail.state) {
    const s = detail.state
    return (
      <div className="rounded-lg border border-white/8 bg-background/40 p-2.5 text-xs" data-preview="state">
        <p className="font-medium text-foreground">{s.title}</p>
        <p className="mt-1 text-subtle">{s.subjects.map(x => `${x.name} (${x.topics.length})`).join(' · ')}{s.dates.length ? ` · ${s.dates.length} date${s.dates.length === 1 ? '' : 's'}` : ''}</p>
        <ul className="mt-1.5 space-y-0.5">{rows(s.tasks).map(({ item, depth }) => <li key={item.key} className="truncate text-foreground/75" style={{ paddingLeft: `${depth * 12}px` }}>{depth ? '↳ ' : '• '}{item.title}</li>)}</ul>
      </div>
    )
  }
  return null
}
