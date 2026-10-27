'use client'

import { useEffect, useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'
import type { DeletionScope } from '@repo/api/nova/product/builder.types'
import { cn } from '@/lib/utils'
import { PlaygroundHeader } from './playground'
import type { DraftState } from './use-draft'

// A deletion the learner asked for, waiting for them: everything it would
// remove (only what Nova made), what stays, and two ways out. Deleting needs
// a second, explicit confirmation in a dialog; the server deletes exactly
// the scope shown (its fingerprint) or nothing.

const GROUPS: Array<{ key: keyof DeletionScope['removes']; label: string }> = [
  { key: 'subjects', label: 'Subjects' }, { key: 'topics', label: 'Topics' }, { key: 'tasks', label: 'Tasks and steps' },
  { key: 'notes', label: 'Notes Nova wrote' }, { key: 'dates', label: 'Dates' },
]

export function DeletionPanel({ state }: { state: DraftState }) {
  const scope = state.draft?.brief.deletion
  const [asking, setAsking] = useState(false)
  const confirmRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { if (asking) confirmRef.current?.focus() }, [asking])
  useEffect(() => {
    if (!asking) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setAsking(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [asking])
  if (!scope) return null
  const total = GROUPS.reduce((n, g) => n + scope.removes[g.key].length, 0)
  const busy = state.busy === 'delete' || state.busy === 'keep'

  return (
    <div className="flex h-full min-h-0 flex-col" data-deletion>
      <PlaygroundHeader title={`Delete ${scope.title}?`} badge="live" stats={`${total} item${total === 1 ? '' : 's'} would go${scope.workspaceId ? ', with the workspace' : ''}`} />
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-6 pt-3 sm:px-5">
        <p className="rounded-xl border border-red-400/40 bg-red-400/8 px-3 py-2 text-sm leading-relaxed text-foreground/90">
          Only what Nova made for {scope.title} goes, from your Planner, Knowledge, the Knowledge Map and Notes. Nothing is deleted until you confirm.
        </p>
        {GROUPS.filter(g => scope.removes[g.key].length > 0).map(g => (
          <section key={g.key} aria-label={g.label}>
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle">{g.label} <span className="font-normal normal-case tracking-normal">· {scope.removes[g.key].length}</span></h3>
            <ul className="mt-1.5 space-y-0.5 text-sm text-foreground/85">
              {(scope.removes[g.key] as Array<{ id: string; name: string; done?: boolean; step?: boolean }>).slice(0, 30).map(x => (
                <li key={x.id} className={cn('line-through decoration-red-400/50', x.step && 'pl-4 text-foreground/70')}>
                  {x.name}{x.done && <span className="ml-1.5 text-[11px] text-subtle no-underline">finished</span>}
                </li>
              ))}
              {scope.removes[g.key].length > 30 && <li className="text-xs text-subtle">and {scope.removes[g.key].length - 30} more</li>}
            </ul>
          </section>
        ))}
        {scope.keeps.length > 0 && (
          <section aria-label="What stays">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle">Stays</h3>
            <ul className="mt-1.5 space-y-0.5 text-sm text-foreground/80">{scope.keeps.map(k => <li key={k}>{k}</li>)}</ul>
          </section>
        )}
        {state.actionError && (state.errorOf === 'delete' || state.errorOf === 'keep') && <p role="alert" className="text-sm text-red-400">{state.actionError}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-white/8 px-4 py-3 sm:px-5">
        <button type="button" disabled={busy} onClick={() => void state.keepResource()} className="h-10 rounded-xl border border-white/12 px-4 text-sm font-medium text-foreground/85 hover:bg-white/5 disabled:opacity-50">Keep it</button>
        <button type="button" disabled={busy || total === 0 && !scope.workspaceId} onClick={() => setAsking(true)} className="inline-flex h-10 items-center gap-2 rounded-xl bg-red-500/90 px-4 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50" data-delete>
          <Trash2 aria-hidden className="size-4" />Delete…
        </button>
      </div>

      {asking && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setAsking(false) }}>
          <div role="alertdialog" aria-modal="true" aria-labelledby="delete-title" aria-describedby="delete-body" className="w-full max-w-sm rounded-2xl border border-white/10 bg-card p-5 shadow-2xl">
            <h2 id="delete-title" className="text-base font-semibold text-foreground">Delete {scope.title} permanently?</h2>
            <p id="delete-body" className="mt-2 text-sm leading-relaxed text-foreground/75">
              {total} item{total === 1 ? '' : 's'} Nova made will be removed everywhere in Kivo{scope.workspaceId ? ', with the workspace' : ''}. This can&apos;t be undone.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setAsking(false)} className="h-10 rounded-xl border border-white/12 px-4 text-sm font-medium text-foreground/85 hover:bg-white/5">Cancel</button>
              <button ref={confirmRef} type="button" disabled={busy} onClick={async () => { await state.confirmDeletion(); setAsking(false) }} className="h-10 rounded-xl bg-red-500/90 px-4 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50" data-delete-confirm>
                {state.busy === 'delete' ? 'Deleting…' : 'Delete permanently'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
